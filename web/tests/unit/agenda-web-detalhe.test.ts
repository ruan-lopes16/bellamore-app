import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { contatosCliente, resumoDoDia, statusPermitidos } from '@shared/agenda';
import { carregarDetalheAtendimento } from '@shared/atendimento-detalhe-consultas';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

type Resp = { data: unknown; error: { code?: string; message: string } | null };

/** Client falso: resposta por tabela; grava a cadeia de chamadas de cada `from`. */
function falso(porTabela: Record<string, Resp>) {
  const ops: [string, string, unknown[]][] = [];
  const db = {
    from(t: string) {
      const resp = porTabela[t] ?? { data: [], error: null };
      const builder: Record<string, unknown> = new Proxy({}, {
        get(_a, prop) {
          if (prop === 'then') return (ok: (v: Resp) => unknown) => ok(resp);
          return (...args: unknown[]) => { ops.push([t, String(prop), args]); return builder; };
        },
      });
      ops.push([t, 'from', []]);
      return builder;
    },
  };
  return { db, ops };
}

describe('resumoDoDia — decisão do dono (01/10): agendamentos não contam cancelados', () => {
  it('cancelado fica fora do total, das profissionais e da receita', () => {
    const r = resumoDoDia([
      { status: 'agendado', profissional_id: 'a', valor: 100 },
      { status: 'cancelado', profissional_id: 'b', valor: 200 },
      { status: 'faltou', profissional_id: 'c', valor: 50 },
      { status: 'confirmado', profissional_id: 'a', valor: 30 },
    ]);
    expect(r).toEqual({ total: 3, receitaPrevista: 130, profissionais: 2, pendentes: 1 });
  });
  it('só cancelados = tudo zero', () => {
    expect(resumoDoDia([{ status: 'cancelado', profissional_id: 'a', valor: 10 }]))
      .toEqual({ total: 0, receitaPrevista: 0, profissionais: 0, pendentes: 0 });
  });
});

describe('contatosCliente', () => {
  it('monta tel: e wa.me com DDI 55 (mesmo formato do app)', () => {
    expect(contatosCliente('(34) 99178-0000')).toEqual({
      ligar: 'tel:34991780000',
      whatsapp: 'https://wa.me/5534991780000',
    });
  });
  it('não duplica o DDI quando o número já tem 55', () => {
    expect(contatosCliente('+55 34 99178-0000')?.whatsapp).toBe('https://wa.me/5534991780000');
  });
  it('sem telefone (ou sem dígitos) não há botões', () => {
    expect(contatosCliente(null)).toBeNull();
    expect(contatosCliente(undefined)).toBeNull();
    expect(contatosCliente('')).toBeNull();
    expect(contatosCliente(' - ')).toBeNull();
  });
});

describe('carregarDetalheAtendimento', () => {
  it('sem comanda não consulta nada e devolve "sem_comanda"', async () => {
    const { db, ops } = falso({});
    const d = await carregarDetalheAtendimento(db, 'ag1', null);
    expect(d.situacao).toBe('sem_comanda');
    expect(ops).toEqual([]);
  });
  it('com comanda consulta comanda, itens, pagamentos e atendimentos dela e monta o detalhe', async () => {
    const { db, ops } = falso({
      comandas: { data: { id: 'c1', valor_total: 150, desconto: 20, desconto_reserva: 5, fechada_at: '2026-10-20T15:00:00Z' }, error: null },
      comanda_itens: { data: [{ id: 'i1', tipo: 'produto', descricao: 'Óleo', quantidade: 2, valor_unit: 25, profissional: null }], error: null },
      pagamentos: { data: [{ id: 'p1', metodo: 'pix', valor: 130 }], error: null },
      agendamentos: { data: [{ id: 'ag1', data_hora_inicio: '2026-10-20T14:00:00Z', valor: 100, servico: { nome: 'Cílios' }, agendamento_servicos: [], profissional: { nome: 'Ana Paula' } }], error: null },
    });
    const d = await carregarDetalheAtendimento(db, 'ag1', 'c1');
    expect(d.situacao).toBe('completo');
    expect(d.itens.map(i => [i.descricao, i.valorLinha, i.esteAtendimento])).toEqual([['Cílios', 100, true], ['Óleo', 50, false]]);
    expect(d.pagamentos).toHaveLength(1);
    expect(d.descontoManual).toBe(15);
    expect(d.descontoReserva).toBe(5);
    expect(d.total).toBe(130);
    for (const t of ['comandas', 'comanda_itens', 'pagamentos', 'agendamentos']) {
      expect(ops).toContainEqual([t, 'eq', [t === 'comandas' ? 'id' : 'comanda_id', 'c1']]);
    }
  });
  it('comanda que não volta (RLS) vira "bloqueado_por_rls"', async () => {
    const { db } = falso({ comandas: { data: null, error: null } });
    expect((await carregarDetalheAtendimento(db, 'ag1', 'c1')).situacao).toBe('bloqueado_por_rls');
  });
  it('erro do banco lança em português (nunca mostra comanda vazia)', async () => {
    const { db } = falso({ pagamentos: { data: null, error: { code: 'PGRST301', message: 'JWT expired' } } });
    await expect(carregarDetalheAtendimento(db, 'ag1', 'c1')).rejects.toThrow('Sua sessão expirou. Entre de novo.');
  });
});

describe('status pela regra única', () => {
  it('concluído com comanda não oferece nenhum status', () => {
    expect(statusPermitidos('concluido', true)).toEqual([]);
  });
});

describe('web: detalhe do atendimento, contatos, resumo do dia e status (varredura)', () => {
  const page = ler('web/app/(app)/agenda/page.tsx');
  const det = ler('web/app/(app)/agenda/DetalheAtendimento.tsx');
  const perfil = ler('web/app/(app)/clientes/[id]/page.tsx');

  it('o seletor de status usa statusPermitidos (nunca a lista fixa dos 5)', () => {
    expect(page).toContain('statusPermitidos(');
    expect(page).not.toMatch(/STATUS_OPCOES\.map/);
  });
  it('troca de status pede confirmação por precisaConfirmarStatus com ConfirmDialog', () => {
    expect(page).toContain('precisaConfirmarStatus(');
    const i = page.indexOf('confirmStatus && (');
    expect(i).toBeGreaterThan(-1);
    expect(page.slice(i, i + 600)).toContain('<ConfirmDialog');
  });
  it('a pergunta da taxa substitui a confirmação de cancelar (sai antes de abrir o ConfirmDialog)', () => {
    const i = page.indexOf('if (pergunta.perguntar)');
    expect(i).toBeGreaterThan(-1);
    expect(page.slice(i, i + 160)).toContain('return;');
    expect(page.slice(i, i + 160)).not.toContain('setConfirmStatus');
  });
  it('concluído com comanda mostra MSG_CONCLUIDO_COM_COMANDA no lugar do seletor', () => {
    expect(page).toMatch(/opcoesStatus\.length === 0[\s\S]{0,400}MSG_CONCLUIDO_COM_COMANDA/);
  });
  it('resumo do dia pela função de shared, no topo do dia', () => {
    expect(page).toContain('resumoDoDia(');
    expect(det).toContain('Receita prevista');
    expect(det).toContain('Pendentes');
  });
  it('detalhe com comanda e pagamentos (consulta só ao abrir) e botões Ligar/WhatsApp/Perfil', () => {
    expect(det).toContain('carregarDetalheAtendimento(');
    expect(det).toContain('contatosCliente(');
    expect(det).toContain('/clientes/${');
    expect(det).toContain('Ligar');
    expect(det).toContain('WhatsApp');
    expect(det).toContain('Perfil');
    expect(page).toContain('<DetalheAtendimento');
  });
  it('perfil da cliente e agenda usam a mesma consulta e o mesmo bloco de comanda', () => {
    expect(perfil).toContain('carregarDetalheAtendimento(');
    expect(perfil).toContain('<ConteudoComanda');
    expect(det).toContain('<ConteudoComanda');
  });
  it('o web nunca importa mobile/', () => {
    for (const src of [page, det]) expect(src).not.toMatch(/from ['"][^'"]*mobile\//);
  });
});

describe('app: resumo do dia pela mesma função', () => {
  it('agenda do app usa resumoDoDia e o hook antigo sumiu', () => {
    const tela = ler('mobile/app/(empresa)/agenda.tsx');
    const hook = ler('mobile/hooks/useAgenda.ts');
    expect(tela).toContain('resumoDoDia(');
    expect(tela).toContain('resumo.receitaPrevista');
    expect(tela).not.toContain('useResumoDia');
    expect(hook).not.toContain('useResumoDia');
  });
});
