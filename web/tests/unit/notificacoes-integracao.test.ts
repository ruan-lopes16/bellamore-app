import { describe, expect, it } from 'vitest';
import { carregarDadosAlertas } from '@shared/notificacoes-consultas';
import { alertasCalculados, contagemSino, type Alerta } from '@shared/notificacoes';
import { CHAVES_PERMISSAO, pode, type ChavePermissao, type PermissoesUsuario } from '@shared/permissoes';

/**
 * Integração das duas pontas dos alertas: `carregarDadosAlertas` (consultas, Task 2) monta os dados
 * com um banco falso e o resultado vai direto para `alertasCalculados` (regras, Task 1).
 *
 * O banco falso é mais fiel que o fakeDb genérico: devolve SÓ as colunas pedidas no `select`
 * (embeds `alias:rel(...)` viram a chave `alias`) e aplica os filtros `eq`/`is`. Assim, se a
 * consulta deixar de trazer uma coluna que a regra usa para conferir permissão (ex.:
 * `profissional_id` das comandas), o teste quebra.
 */

type Linha = Record<string, unknown>;

function colunasDoSelect(sel: string): string[] {
  const out: string[] = [];
  let nivel = 0; let atual = '';
  for (const ch of sel) {
    if (ch === '(') nivel++;
    if (ch === ')') nivel--;
    if (ch === ',' && nivel === 0) { out.push(atual.trim()); atual = ''; continue; }
    atual += ch;
  }
  if (atual.trim()) out.push(atual.trim());
  // `alias:rel!fk(cols)` → alias; `col` → col
  return out.map(c => c.split('(')[0].split(':')[0].split('!')[0].trim());
}

/** Linhas por tabela; `agendamentos` separa "hoje" de "sem comanda" pelo filtro `is comanda_id null`. */
function bancoFiel(tabelas: { agendamentosHoje: Linha[]; comandasAbertas: Linha[]; [t: string]: Linha[] }) {
  return {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from(tabela: string) {
      let colunas: string[] | null = null;
      const filtros: [string, unknown][] = [];
      let semComanda = false;
      const b: Record<string, unknown> = {};
      const encadear = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return b; };
      Object.assign(b, {
        select: encadear((s) => { colunas = colunasDoSelect(String(s)); }),
        eq: encadear((c, v) => { filtros.push([String(c), v]); }),
        is: encadear((c) => { if (c === 'comanda_id') semComanda = true; }),
        not: encadear(), gte: encadear(), lte: encadear(), lt: encadear(), order: encadear(),
        range: (de: number, ate: number) => {
          const base = tabela === 'agendamentos'
            ? (semComanda ? tabelas.comandasAbertas : tabelas.agendamentosHoje)
            : (tabelas[tabela] ?? []);
          const filtradas = base.filter(l => filtros.every(([c, v]) => !(c in l) || l[c] === v));
          const projetadas = filtradas.map(l => Object.fromEntries((colunas ?? Object.keys(l)).filter(c => c in l).map(c => [c, l[c]])));
          return Promise.resolve({ data: projetadas.slice(de, ate + 1), error: null });
        },
      });
      return b;
    },
  };
}

// 28/10/2026 10:00 em Brasília = 13:00Z.
const AGORA = new Date('2026-10-28T13:00:00Z');
const E = 'emp-1';
const EU = 'u-eu';
const OUTRA = 'u-outra';
const dona: PermissoesUsuario = { isOwner: true, papel: null, chaves: [...CHAVES_PERMISSAO] };
const prof = (...chaves: ChavePermissao[]): PermissoesUsuario => ({ isOwner: false, papel: 'profissional', chaves });

const banco = () => bancoFiel({
  agendamentosHoje: [
    { id: 'a1', empresa_id: E, data_hora_inicio: '2026-10-28T14:00:00Z', data_hora_fim: '2026-10-28T15:00:00Z', status: 'agendado', profissional_id: EU, cliente: { nome: 'Ana' }, servico: { nome: 'Corte' } },
    { id: 'a2', empresa_id: E, data_hora_inicio: '2026-10-28T17:00:00Z', data_hora_fim: '2026-10-28T18:00:00Z', status: 'confirmado', profissional_id: OUTRA, cliente: { nome: 'Bia' }, servico: { nome: 'Unha' } },
  ],
  comandasAbertas: [
    { id: 'n1', empresa_id: E, data_hora_inicio: '2026-10-20T13:00:00Z', profissional_id: OUTRA },
    { id: 'n2', empresa_id: E, data_hora_inicio: '2026-10-25T13:00:00Z', profissional_id: EU },
  ],
  v_produtos_estoque_baixo: [{ id: 'p1', empresa_id: E, ativo: true, nome: 'Óleo', estoque_atual: '0', estoque_minimo: '2', unidade: 'un' }],
  despesas: [{ id: 'd1', empresa_id: E, status: 'pendente', descricao: 'Aluguel', valor: '1500', data_vencimento: '2026-10-28' }],
  comissoes: [
    { id: 'c1', empresa_id: E, status: 'pendente', valor_comissao: '50', profissional_id: EU, profissional: { nome: 'Eu' } },
    { id: 'c2', empresa_id: E, status: 'pendente', valor_comissao: '100', profissional_id: OUTRA, profissional: { nome: 'Outra' } },
  ],
  clientes: [
    { id: 'k1', empresa_id: E, ativo: true, nome: 'Carla', data_nascimento: '1990-10-28', telefone: null },
    { id: 'k2', empresa_id: E, ativo: true, nome: 'Duda', data_nascimento: '1990-11-04', telefone: null },
    { id: 'k3', empresa_id: E, ativo: true, nome: 'Longe', data_nascimento: '1990-11-05', telefone: null },
  ],
});

async function alertasDe(permissoes: PermissoesUsuario, db = banco()): Promise<Alerta[]> {
  const dados = await carregarDadosAlertas(db, E, { userId: EU, pode: a => pode(permissoes, a) }, AGORA);
  return alertasCalculados(dados, permissoes, { userId: EU, agora: AGORA });
}
const doGrupo = (l: Alerta[], g: Alerta['grupo']) => l.filter(a => a.grupo === g);

describe('carregarDadosAlertas → alertasCalculados', () => {
  it('dona: todos os alertas, com os dados exatamente como a consulta devolve', async () => {
    const l = await alertasDe(dona);
    expect(doGrupo(l, 'agendamentos').map(a => a.id)).toEqual(['ag-a1', 'ag-a2']);
    expect(doGrupo(l, 'estoque').map(a => [a.titulo, a.urgente])).toEqual([['Estoque baixo: Óleo', true]]);
    expect(doGrupo(l, 'despesas').map(a => a.descricao)).toEqual(['Vence hoje!']);
    expect(doGrupo(l, 'comissoes').map(a => a.descricao)).toEqual(['R$ 50,00 a pagar', 'R$ 100,00 a pagar']);
    expect(doGrupo(l, 'comandas').map(a => [a.titulo, a.descricao])).toEqual([['2 comandas não fechadas', 'A mais antiga é de 20/10']]);
    expect(contagemSino(l, 2)).toBe(1 + 1 + 1 + 1 + 2);
  });

  it('a consulta das comandas traz profissional_id: a regra confere as próprias sem depender só do filtro', async () => {
    const dados = await carregarDadosAlertas(banco(), E, { userId: EU, pode: () => true }, AGORA);
    expect(dados.comandasNaoFechadas?.every(c => 'profissional_id' in c)).toBe(true);
    // Mesmo que a consulta devolvesse a comanda de outra (ex.: RLS ampla), a regra só mostra a própria.
    const l = alertasCalculados(dados, prof('comanda.fechar'), { userId: EU, agora: AGORA });
    expect(doGrupo(l, 'comandas').map(a => [a.titulo, a.descricao])).toEqual([['1 comanda não fechada', 'A mais antiga é de 25/10']]);
  });

  it('profissional com comanda.fechar e sem gerenciar_outras: as duas pontas dão só as próprias', async () => {
    const l = await alertasDe(prof('comanda.fechar'));
    expect(doGrupo(l, 'agendamentos').map(a => a.id)).toEqual(['ag-a1']);
    expect(doGrupo(l, 'comissoes').map(a => a.titulo)).toEqual(['Comissão pendente: Eu']);
    expect(doGrupo(l, 'comandas').map(a => a.titulo)).toEqual(['1 comanda não fechada']);
    expect(doGrupo(l, 'estoque')).toEqual([]);
    expect(doGrupo(l, 'despesas')).toEqual([]);
  });

  it('aniversariantes: próximos 7 dias (hoje em destaque), igual ao web atual', async () => {
    const a = doGrupo(await alertasDe(prof()), 'aniversarios');
    expect(a.map(x => [x.id, x.urgente])).toEqual([['aniv-k1', true], ['aniv-k2', false]]);
  });

  it('aniversariantes: sem o teto de 8 do Dashboard (a tela de Notificações do web lista todos)', async () => {
    const muitos = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, empresa_id: E, ativo: true, nome: `C${String(i).padStart(2, '0')}`, data_nascimento: '1990-10-30', telefone: null }));
    const db = bancoFiel({ agendamentosHoje: [], comandasAbertas: [], clientes: muitos });
    expect(doGrupo(await alertasDe(prof(), db), 'aniversarios')).toHaveLength(12);
  });
});
