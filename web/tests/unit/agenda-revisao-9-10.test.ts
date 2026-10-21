import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { avisoTaxaPagaAoExcluir, MSG_ERRO_TAXAS_EXCLUIR } from '@shared/agenda-consultas';

// Revisão das Tasks 9 e 10 da paridade da Agenda: exclusão e contatos iguais no web e no app,
// resumo do dia com a mesma entrada e erros em português.
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

type Resp = { data: unknown; error: { code?: string; message: string } | null };

/** Client falso: resposta por tabela; guarda a cadeia de chamadas. */
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

const WEB = 'web/app/(app)/agenda/page.tsx';
const EMP = 'mobile/app/(empresa)/agendamento/[id].tsx';
const PROF = 'mobile/app/(profissional)/agendamento/[id].tsx';
const LIB = 'mobile/lib/statusAtendimento.ts';
const EQUIPE = 'mobile/app/(empresa)/equipe.tsx';

describe('avisoTaxaPagaAoExcluir (shared, web e app)', () => {
  it('soma as taxas pagas de reserva e cancelamento do atendimento', async () => {
    const { db, ops } = falso({
      taxas_reserva: { data: [{ valor: 30, status: 'pago', paga_em: '2026-10-01' }, { valor: 99, status: 'pendente', paga_em: null }], error: null },
      taxas_cancelamento: { data: [{ valor: '20.50', status: 'pago', paga_em: null }], error: null },
    });
    const aviso = await avisoTaxaPagaAoExcluir(db, 'ag1');
    expect(aviso).toBe(' A taxa de R$ 50,50 (paga) também será removida e sai do faturamento daquele período.');
    expect(ops).toContainEqual(['taxas_reserva', 'eq', ['agendamento_id', 'ag1']]);
    expect(ops).toContainEqual(['taxas_cancelamento', 'eq', ['agendamento_id', 'ag1']]);
  });
  it('sem taxa paga devolve texto vazio', async () => {
    const { db } = falso({ taxas_reserva: { data: [{ valor: 30, status: 'pendente', paga_em: null }], error: null } });
    expect(await avisoTaxaPagaAoExcluir(db, 'ag1')).toBe('');
  });
  it('falha de qualquer consulta LANÇA (a tela não exclui sem conseguir avisar)', async () => {
    const { db } = falso({ taxas_cancelamento: { data: null, error: { code: '42501', message: 'permission denied' } } });
    await expect(avisoTaxaPagaAoExcluir(db, 'ag1')).rejects.toThrow(MSG_ERRO_TAXAS_EXCLUIR);
  });
});

describe('exclusão igual nas duas plataformas', () => {
  it('web usa a função de shared e, se falhar, mostra o erro e não abre a confirmação', () => {
    const t = ler(WEB);
    expect(t).toContain('await avisoTaxaPagaAoExcluir(supabase, agEditar.id)');
    expect(t).not.toContain("supabase.from('taxas_reserva').select('valor, status, paga_em')");
    const corpo = t.slice(t.indexOf('async function abrirConfirmExcluir'), t.indexOf('async function excluirAgendamento'));
    expect(corpo).toMatch(/catch \(e\) \{\s*setErro\(\(e as Error\)\.message\);\s*return;/);
  });
  it('web traduz o erro da exclusão', () => {
    const t = ler(WEB);
    expect(t).not.toContain('Erro ao excluir: ${error.message}');
    expect(t).toContain("mensagemErroBanco(error, 'excluir este agendamento')");
  });
  it('app usa a mesma função de shared', () => {
    const l = ler(LIB);
    expect(l).toContain("from '@shared/agenda-consultas'");
    expect(l).not.toContain("from('taxas_reserva')");
    expect(ler(EMP)).toContain('await avisoTaxaPagaAoExcluir(');
  });
});

describe('contatos do app pela regra de shared (sem duplicar o DDI 55)', () => {
  it('os dois detalhes usam contatosCliente e não montam mais wa.me/55 à mão', () => {
    for (const f of [EMP, PROF]) {
      const t = ler(f);
      expect(t).toContain('contatosCliente(ag.cliente?.telefone)');
      expect(t).not.toContain('wa.me/55${');
      expect(t).not.toContain('tel:${ag.cliente');
    }
  });
  it('os botões somem sem telefone e "Perfil" some sem cliente (como no web)', () => {
    for (const f of [EMP, PROF]) {
      expect(ler(f)).toMatch(/\.filter\(\(a\): a is AcaoRapida => !!a\)/);
    }
    expect(ler(EMP)).toMatch(/clienteIdPerfil \? \{ icon: <User[^\n]*label: 'Perfil'/);
  });
  it('Equipe do app também não duplica o DDI', () => {
    const t = ler(EQUIPE);
    expect(t).not.toContain('wa.me/55${');
    expect(t).toContain('toWhatsApp(');
  });
});

describe('resumo do dia com a mesma entrada', () => {
  it('web passa o profissional_id da linha (como o app), não o do embed', () => {
    const t = ler(WEB);
    expect(t).toContain('profissional_id: a.profissional_id ?? a.profissional?.id');
    expect(t).not.toContain("profissional_id: a.profissional?.id ?? '',");
  });
});

describe('erros em português no detalhe da profissional (app)', () => {
  it('o UPDATE de status usa mensagemErroBanco', () => {
    const t = ler(PROF);
    expect(t).not.toContain("Alert.alert('Erro', error.message)");
    expect(t).toContain("mensagemErroBanco(error, 'mudar o status deste atendimento')");
  });
});
