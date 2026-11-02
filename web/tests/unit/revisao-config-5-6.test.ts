/**
 * Revisão das Tasks 5 e 6 (Paridade Configurações / Notificações / Papéis):
 * - Notificações iguais no web e no app (textos, agrupamento, rotas que não voltam para a própria tela);
 * - sino e badges dos menus por contagens leves (sem carregar clientes e comandas inteiras);
 * - badge de comandas do app só das próprias sem `agenda.gerenciar_outras`, igual ao web;
 * - senha mínima 8 em toda troca de senha (web e app);
 * - falha de registro do push guardada e registrada;
 * - nenhuma 2ª empresa por engano quando a leitura dos vínculos falha.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  alertasCalculados, alertaTemRota, avisoTemRota, badgesDoMenu, contagemSino, resumoAgendamentosHoje,
  rotuloNaoLidas, separarAlertas, TEXTOS_NOTIFICACOES, type Alerta, type ContagensSino,
} from '@shared/notificacoes';
import { carregarContagensSino, type DadosAlertas } from '@shared/notificacoes-consultas';
import { SENHA_MINIMA, validarNovaSenha, validarSenhaOpcional } from '@shared/senha';
import { CHAVES_FINANCEIRO } from '@shared/invalidacao-financeira';
import type { PermissoesUsuario, Acesso } from '@shared/permissoes';

const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');

const dona: PermissoesUsuario = { isOwner: true, papel: null, chaves: [] };
const prof = (chaves: string[]): PermissoesUsuario => ({ isOwner: false, papel: 'profissional', chaves: chaves as PermissoesUsuario['chaves'] });

// ── Sino e badges por contagens leves ─────────────────────────

const AGORA = new Date('2026-10-28T15:00:00Z'); // 12:00 em Brasília
const dados = (): DadosAlertas => ({
  agendamentosHoje: [],
  estoqueBaixo: [
    { id: 'p1', nome: 'Óleo', estoque_atual: 0, estoque_minimo: 2, unidade: null },
    { id: 'p2', nome: 'Creme', estoque_atual: 1, estoque_minimo: 2, unidade: null },
  ],
  despesasVencendo: [{ id: 'd1', descricao: 'Luz', valor: 100, data_vencimento: '2026-10-29' }],
  comissoesPendentes: [
    { id: 'c1', valor_comissao: 10, profissional_id: 'u1', profissional: { nome: 'Ana' } },
    { id: 'c2', valor_comissao: 10, profissional_id: 'u2', profissional: { nome: 'Bia' } },
  ],
  aniversariantes: [],
  comandasNaoFechadas: [
    { id: 'a1', data_hora_inicio: '2026-10-27T13:00:00Z', profissional_id: 'u1' },
    { id: 'a2', data_hora_inicio: '2026-10-27T14:00:00Z', profissional_id: 'u2' },
  ],
  soPropriaAgenda: false, soPropriasComissoes: false, hoje: '2026-10-28',
});

/** O que `carregarContagensSino` contaria nos mesmos dados (consultas já filtradas pela permissão). */
function contagensDe(d: DadosAlertas, p: PermissoesUsuario, userId: string): ContagensSino {
  const tem = (a: Acesso) => p.isOwner || p.chaves.includes(a as never);
  return {
    estoqueBaixo: tem('estoque.acessar') ? d.estoqueBaixo!.length : null,
    despesasVencendo: tem('financeiro.ver') ? d.despesasVencendo!.length : null,
    comissoesPendentes: d.comissoesPendentes.filter(c => tem('comissoes.ver_todas') || c.profissional_id === userId).length,
    comandasNaoFechadas: tem('comanda.fechar')
      ? d.comandasNaoFechadas!.filter(c => tem('agenda.gerenciar_outras') || c.profissional_id === userId).length
      : null,
  };
}

describe('badgesDoMenu (sino e badges dos menus, web e app)', () => {
  it.each([
    ['dona', dona],
    ['profissional com estoque', prof(['estoque.acessar'])],
    ['profissional com comanda', prof(['comanda.fechar'])],
    ['profissional com financeiro e todas as comissões', prof(['financeiro.ver', 'comissoes.ver_todas'])],
  ])('sino igual ao contagemSino da tela (%s)', (_n, p) => {
    const d = dados();
    const esperado = contagemSino(alertasCalculados(d, p, { userId: 'u1', agora: AGORA }), 3);
    expect(badgesDoMenu(contagensDe(d, p, 'u1'), p, 3).sino).toBe(esperado);
  });
  it('comissões: todas com ver_todas, senão só as próprias; comandas só as próprias sem gerenciar_outras', () => {
    expect(badgesDoMenu(contagensDe(dados(), dona, 'u1'), dona, 0)).toMatchObject({ comissoes: 2, comandas: 2 });
    const p = prof(['comanda.fechar']);
    expect(badgesDoMenu(contagensDe(dados(), p, 'u1'), p, 0)).toMatchObject({ comissoes: 1, comandas: 1 });
  });
  it('sem permissão a parte não entra, mesmo que a contagem venha preenchida', () => {
    const c: ContagensSino = { estoqueBaixo: 5, despesasVencendo: 5, comissoesPendentes: 0, comandasNaoFechadas: 5 };
    expect(badgesDoMenu(c, prof([]), 0)).toEqual({ sino: 0, comissoes: 0, comandas: 0 });
  });
  it('erro (null) → nada, a tela mantém o número anterior', () => {
    expect(badgesDoMenu(null, dona, 0)).toEqual({ sino: null, comissoes: null, comandas: null });
    expect(badgesDoMenu(contagensDe(dados(), dona, 'u1'), null, 0)).toEqual({ sino: null, comissoes: null, comandas: null });
    expect(badgesDoMenu(contagensDe(dados(), dona, 'u1'), dona, null).sino).toBeNull();
  });
});

type Op = [string, unknown[]];
function stubContagem(contagens: Record<string, number>, erroEm?: string) {
  const consultas: { tabela: string; ops: Op[] }[] = [];
  return {
    consultas,
    db: {
      from(tabela: string) {
        const c = { tabela, ops: [] as Op[] };
        consultas.push(c);
        const b: Record<string, unknown> = new Proxy({}, {
          get(_a, prop) {
            if (prop === 'then') {
              return (ok: (v: unknown) => unknown) => ok(tabela === erroEm
                ? { count: null, error: { message: 'falhou' } }
                : { count: contagens[tabela] ?? 0, error: null });
            }
            return (...args: unknown[]) => { c.ops.push([String(prop), args]); return b; };
          },
        });
        return b;
      },
    },
  };
}
const temOp = (ops: Op[], m: string, ...args: unknown[]) => ops.some(([x, a]) => x === m && JSON.stringify(a) === JSON.stringify(args));

describe('carregarContagensSino', () => {
  const pode = (p: PermissoesUsuario) => (a: Acesso) => p.isOwner || p.chaves.includes(a as never);
  it('dona: 4 contagens com head, sem baixar linhas', async () => {
    const { db, consultas } = stubContagem({ v_produtos_estoque_baixo: 2, despesas: 1, comissoes: 4, agendamentos: 3 });
    const c = await carregarContagensSino(db, 'e1', { userId: 'u1', pode: pode(dona) }, AGORA);
    expect(c).toEqual({ estoqueBaixo: 2, despesasVencendo: 1, comissoesPendentes: 4, comandasNaoFechadas: 3 });
    expect(consultas.map(x => x.tabela).sort()).toEqual(['agendamentos', 'comissoes', 'despesas', 'v_produtos_estoque_baixo']);
    for (const x of consultas) expect(temOp(x.ops, 'select', 'id', { count: 'exact', head: true }), x.tabela).toBe(true);
    // Nada de aniversariantes nem agenda do dia: o sino não conta esses.
    expect(consultas.some(x => x.tabela === 'clientes')).toBe(false);
  });
  it('sem permissões: só as próprias comissões, nada de estoque/despesas/comandas', async () => {
    const { db, consultas } = stubContagem({ comissoes: 1 });
    const c = await carregarContagensSino(db, 'e1', { userId: 'u1', pode: pode(prof([])) }, AGORA);
    expect(c).toEqual({ estoqueBaixo: null, despesasVencendo: null, comissoesPendentes: 1, comandasNaoFechadas: null });
    expect(consultas.map(x => x.tabela)).toEqual(['comissoes']);
    expect(temOp(consultas[0].ops, 'eq', 'profissional_id', 'u1')).toBe(true);
  });
  it('comanda.fechar sem gerenciar_outras conta só as próprias', async () => {
    const { db, consultas } = stubContagem({ agendamentos: 1 });
    await carregarContagensSino(db, 'e1', { userId: 'u1', pode: pode(prof(['comanda.fechar'])) }, AGORA);
    const ag = consultas.find(x => x.tabela === 'agendamentos')!;
    expect(temOp(ag.ops, 'eq', 'profissional_id', 'u1')).toBe(true);
    expect(temOp(ag.ops, 'is', 'comanda_id', null)).toBe(true);
  });
  it('erro em qualquer contagem lança (nunca um número falso)', async () => {
    const { db } = stubContagem({}, 'comissoes');
    await expect(carregarContagensSino(db, 'e1', { userId: 'u1', pode: pode(dona) }, AGORA)).rejects.toThrow();
  });
});

describe('sino e badges usam as contagens leves', () => {
  it('Sidebar do web', () => {
    const s = ler('web/components/Sidebar.tsx');
    expect(s).toContain('carregarContagensSino(');
    expect(s).not.toContain('carregarDadosAlertas(');
    expect(ler('web/lib/sino.ts')).toContain('badgesDoMenu');
  });
  it('app: useSino e useBadgesMenu pela mesma regra', () => {
    const h = ler('mobile/hooks/useNotificacoes.ts');
    expect(h).toContain('carregarContagensSino(');
    expect(h).toContain('badgesDoMenu(');
    expect(h).toMatch(/export function useBadgesMenu/);
    const m = ler('mobile/app/(empresa)/mais.tsx');
    expect(m).toContain('useBadgesMenu(');
    expect(m).not.toContain('useComandasNaoFechadas(');
    expect(m).not.toContain('useResumoComissoesPendentes(');
  });
  it('mexer em dinheiro invalida o sino do app', () => {
    expect(CHAVES_FINANCEIRO).toContain('notificacoes');
  });
});

// ── Tela de Notificações igual nas duas plataformas ───────────

const ag = (id: string, titulo: string): Alerta => ({ id, grupo: 'agendamentos', titulo, descricao: 'x', destino: { tela: 'agenda' }, urgente: false });
const aniv: Alerta = { id: 'aniv-1', grupo: 'aniversarios', titulo: 'a', descricao: 'b', destino: { tela: 'cliente', id: 'c1' }, urgente: false };

describe('regras de exibição (shared)', () => {
  it('separa agendamentos (1 linha-resumo) dos demais alertas', () => {
    const { agendamentos, outros } = separarAlertas([ag('a', '09:00 — Ana'), aniv, ag('b', '10:00 — Bia')]);
    expect(agendamentos.map(a => a.id)).toEqual(['a', 'b']);
    expect(outros).toEqual([aniv]);
    expect(resumoAgendamentosHoje(agendamentos)).toEqual({ titulo: '2 atendimentos hoje', descricao: 'próximo 09:00 — Ana' });
    expect(resumoAgendamentosHoje([ag('a', '09:00 — Ana')])!.titulo).toBe('1 atendimento hoje');
    expect(resumoAgendamentosHoje([])).toBeNull();
  });
  it('rótulo de não lidas', () => {
    expect(rotuloNaoLidas(null)).toBe('—');
    expect(rotuloNaoLidas(1)).toBe('1 não lida');
    expect(rotuloNaoLidas(4)).toBe('4 não lidas');
  });
  it('profissional do app: alerta/aviso sem tela própria não navega (não reabre Notificações)', () => {
    expect(alertaTemRota({ tela: 'cliente', id: 'c1' }, 'app', 'profissional')).toBe(false);
    expect(alertaTemRota({ tela: 'estoque' }, 'app', 'profissional')).toBe(false);
    expect(alertaTemRota({ tela: 'agenda' }, 'app', 'profissional')).toBe(true);
    expect(alertaTemRota({ tela: 'cliente', id: 'c1' }, 'app', 'empresa')).toBe(true);
    expect(alertaTemRota({ tela: 'cliente', id: 'c1' }, 'web')).toBe(true);
    expect(avisoTemRota('estoque_baixo', 'app', 'profissional')).toBe(false);
    expect(avisoTemRota('agendamento', 'app', 'profissional')).toBe(true);
    expect(avisoTemRota('tipo_antigo', 'web')).toBe(false);
  });
});

describe('telas de Notificações com os mesmos textos e comportamento', () => {
  const web = ler('web/app/(app)/notificacoes/page.tsx');
  const app = ler('mobile/components/TelaNotificacoes.tsx');
  it('as duas usam os textos e regras de shared', () => {
    for (const s of [web, app]) {
      for (const f of ['TEXTOS_NOTIFICACOES', 'separarAlertas(', 'resumoAgendamentosHoje(', 'rotuloNaoLidas(',
        'alertaTemRota(', 'avisoTemRota(', 'rotuloDataHoraBRT(']) expect(s).toContain(f);
    }
  });
  it('o app marca um aviso pelo botão, como o web, e mostra data em Brasília', () => {
    expect(app).toMatch(/accessibilityLabel={T.marcarUma}/);
    expect(app).not.toContain('formatDistanceToNow');
  });
  it('nenhum texto da tela fica fora de shared', () => {
    for (const s of [web, app]) {
      for (const t of ['Nenhum alerta no momento.', 'Nenhum aviso', 'Marcar todas como lidas', 'Tudo em ordem!']) {
        expect(s).not.toContain(t);
      }
    }
    expect(Object.values(TEXTOS_NOTIFICACOES)).toContain('Marcar todas como lidas');
  });
});

// ── Senha mínima ──────────────────────────────────────────────

describe('senha mínima 8 em toda troca de senha', () => {
  it('regra única em shared', () => {
    expect(SENHA_MINIMA).toBe(8);
    expect(validarNovaSenha('1234567', '1234567')).toBe('A senha deve ter pelo menos 8 caracteres.');
    expect(validarNovaSenha('12345678', '12345678')).toBeNull();
    // Campo opcional do app ("deixe em branco para manter").
    expect(validarSenhaOpcional('')).toBeNull();
    expect(validarSenhaOpcional('12345')).toBe('A senha deve ter pelo menos 8 caracteres.');
    expect(validarSenhaOpcional('12345678')).toBeNull();
  });
  it.each(['web/app/convite/aceitar/page.tsx', 'web/app/redefinir-senha/page.tsx', 'web/app/(app)/configuracoes/page.tsx'])('%s usa a regra', (p) => {
    const s = ler(p);
    expect(s).toContain('validarNovaSenha(');
    expect(s).not.toMatch(/length < 6|minLength=\{6\}|mínimo 6/);
  });
  it.each(['mobile/app/(empresa)/configuracoes.tsx', 'mobile/app/(profissional)/configuracoes.tsx'])('%s não ignora senha curta em silêncio', (p) => {
    const s = ler(p);
    expect(s).toContain('validarSenhaOpcional(');
    expect(s).not.toMatch(/length >= 6/);
  });
});

// ── Push: falha de registro guardada ──────────────────────────

describe('registro de push que falha por outro motivo', () => {
  it('fica guardado para Configurações e registrado no log, sem token', () => {
    const n = ler('mobile/lib/notifications.ts');
    expect(n).toMatch(/export function erroRegistroPush\(\)/);
    expect(n).toContain('ultimoErro =');
    const l = ler('mobile/app/_layout.tsx');
    expect(l).toContain('console.warn(');
    expect(l).not.toMatch(/console\.warn\([^)]*token/i);
  });
});

// ── Nenhuma 2ª empresa por engano ─────────────────────────────

describe('criar empresa só sem vínculo confirmado', () => {
  it('web: erro ao ler os vínculos não mostra o formulário', () => {
    const s = ler('web/app/criar-empresa/page.tsx');
    expect(s).toContain('erroVinculos');
    expect(s).not.toMatch(/catch \{\s*temVinculo = false;/);
  });
  it('app: erro ao ler empresas não vira "sem empresa" e a tela confere antes de criar', () => {
    const st = ler('mobile/stores/authStore.ts');
    expect(st).toContain('erroMembros');
    expect(st).toMatch(/semEmpresa: !erroEmpresas && disponíveis\.length === 0/);
    const c = ler('mobile/app/criar-empresa.tsx');
    expect(c).toContain('temVinculoAtivo(');
  });
});

describe('temVinculoAtivo (shared)', () => {
  const db = (resp: Record<string, { count: number | null; error: { message: string } | null }>) => ({
    from(t: string) {
      const b: Record<string, unknown> = new Proxy({}, {
        get(_a, prop) {
          if (prop === 'then') return (ok: (v: unknown) => unknown) => ok(resp[t]);
          return () => b;
        },
      });
      return b;
    },
  });
  it('vínculo ou empresa própria → true; nenhum → false; erro lança', async () => {
    const { temVinculoAtivo } = await import('@shared/empresa-ativa');
    expect(await temVinculoAtivo(db({ empresa_membros: { count: 0, error: null }, empresas: { count: 1, error: null } }), 'u')).toBe(true);
    expect(await temVinculoAtivo(db({ empresa_membros: { count: 0, error: null }, empresas: { count: 0, error: null } }), 'u')).toBe(false);
    await expect(temVinculoAtivo(db({ empresa_membros: { count: null, error: { message: 'x' } }, empresas: { count: 0, error: null } }), 'u')).rejects.toThrow();
  });
});
