# Permissões configuráveis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dona e gestora controlam, em Configurações → Permissões, o que cada papel e cada pessoa pode fazer, com a regra aplicada no banco (web, PWA e app) e um histórico visível.

**Architecture:** o catálogo de 27 chaves vive em `shared/permissoes.ts`. A migration 083 cria 3 tabelas (`permissoes_papel`, `permissoes_membro`, `permissoes_historico`) e a função `tem_permissao(empresa, chave)` (dona → exceção da pessoa → papel → padrão). As policies trocam `is_gestor_ou_owner` por `tem_permissao` nos pontos do catálogo. Telas leem a lista efetiva via RPC `minhas_permissoes` (com fallback para os padrões, então o deploy funciona em qualquer ordem) e gravam via RPC `salvar_permissoes`, que valida a regra da gestora e grava o histórico na mesma transação.

**Tech Stack:** Next.js (web, App Router — ler `web/node_modules/next/dist/docs/` antes de mexer em layout/server component, ver `web/AGENTS.md`), Expo/React Native (mobile, zustand + TanStack Query), Supabase Postgres + RLS, Vitest (testes em `web/tests/unit`, rodam também sobre `shared/` e leem arquivos de `mobile/` e `supabase/` como texto).

**Spec:** `docs/superpowers/specs/2026-10-02-permissoes-configuraveis-design.md`.
**Estado real das policies de produção:** `docs/superpowers/notes/2026-10-02-pg-policies-producao.csv` (lido em 2026-10-02). A migration 083 parte DESSE estado + 080/081/082, não só dos arquivos.

## Global Constraints

- Toda comunicação, comentário, JSDoc, mensagem de commit e texto de tela em **português**.
- Padrões ✔/✘ = **comportamento de hoje**; nada pode mudar para ninguém no dia do deploy.
- **Paridade web/mobile**: toda chave que tem botão nas duas plataformas é ligada nas duas.
- **A área `mobile/app/(profissional)` não ganha telas nem menus novos** (decisão do dono).
- A dona (`empresas.owner_id = auth.uid()` ou `empresa_membros.role = 'owner'`) sempre tem tudo e nunca aparece como alvo de permissão.
- Gestora edita só o papel `profissional` e exceções de membros `profissional` que não sejam ela mesma.
- Fixo, só dona, fora do catálogo: dados da empresa, retiradas da sócia, valores sensíveis, mudar o papel de alguém.
- Ordem no SQL Editor: **080 → 081 → 082 → 083**. Migrations aplicadas à mão; **nunca `supabase db push`**. Toda migration é idempotente e termina com `notify pgrst, 'reload schema';`.
- Erros do banco mostrados ao usuário passam por `mensagemErroBanco(error, '<ação no infinitivo>')` de `shared/erros.ts` (vem do PR #142).
- Verificação por task: `cd web && npx tsc --noEmit` zerado; `cd web && npx vitest run` verde; `cd mobile && npx tsc --noEmit` com **exatamente os 6 erros pré-existentes** (configuracoes.tsx:191/208, estoque.tsx:498, useAgenda.ts:21, useNotificacoes.ts:52/59 — linhas podem deslocar, arquivos e códigos TS não).
- Worktree novo: `npm ci` falha; usar `npm install` em `web/` e `mobile/` e depois `git checkout -- package-lock.json` (e não commitar `mobile/package-lock.json`).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Pré-requisito da branch

Esta branch (`feat/permissoes-configuraveis`) depende do PR #142 (`shared/erros.ts`, migrations 081 e 082). **Antes da Task 1**: `git fetch origin && git merge origin/main` depois do #142 mergeado. Se ainda não estiver mergeado, `git merge origin/fix/profissional-cadastra-cliente`. Conferir que `shared/erros.ts` e `supabase/migrations/082_agendamentos_escrita_profissional_gestora.sql` existem.

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `shared/permissoes.ts` (novo) | Catálogo, tipos, resolvedor, `pode`, helpers puros do painel e do histórico |
| `shared/permissoes-consultas.ts` (novo) | I/O Supabase: minhas permissões (com fallback), config, salvar, histórico, permissões de um membro (API) |
| `supabase/migrations/083_permissoes_configuraveis.sql` (novo) | Tabelas, funções, trigger de papel, reescrita de policies |
| `shared/agendamentos.ts`, `shared/bloqueios.ts` | Trocar parâmetro `role` por booleano de permissão |
| `web/lib/permissions.ts`, `web/lib/auth/requireRole.ts`, `web/lib/auth/server-context.ts` | Vocabulário novo, contexto com permissões |
| `web/components/PermissoesProvider.tsx` (novo) | Contexto client + `usePermissoes()` |
| `web/components/permissoes/PermissoesPanel.tsx` (novo) | Aba Permissões (3 sub-abas) |
| `web/app/(app)/**` | Layouts e botões consultando chaves |
| `mobile/stores/authStore.ts`, `mobile/lib/permissions.ts` | Permissões na sessão + `usePermissoes()` |
| `mobile/components/PermissoesPanel.tsx` (novo) | Aba Permissões no app |
| `mobile/app/(empresa)/**`, `mobile/hooks/*`, `mobile/components/BloqueioModal.tsx` | Botões consultando chaves |

---

### Task 1: Catálogo e regras puras (`shared/permissoes.ts`)

**Files:**
- Create: `shared/permissoes.ts`
- Test: `web/tests/unit/permissoes-catalogo.test.ts`

**Interfaces:**
- Produces (usados por todas as tasks seguintes):
  - `type Papel = 'gestor' | 'profissional'`
  - `CATALOGO_PERMISSOES` (readonly, 27 itens `{ chave, grupo, rotulo, descricao, padrao: { gestor, profissional } }`), `GRUPOS_PERMISSAO`
  - `type ChavePermissao`, `CHAVES_PERMISSAO: readonly ChavePermissao[]`, `ehChavePermissao(x: string): x is ChavePermissao`
  - `type LinhasPermissao = Partial<Record<ChavePermissao, boolean>>`
  - `type PermissoesUsuario = { isOwner: boolean; papel: Papel | null; chaves: readonly ChavePermissao[] }`
  - `type Acesso = ChavePermissao | 'dona'`
  - `pode(u: PermissoesUsuario, a: Acesso): boolean`
  - `permissoesPadrao(papel: Papel | null): ChavePermissao[]`
  - `resolverPermissao(s: { isOwner: boolean; papel: Papel | null; papelLinhas: LinhasPermissao; membroLinhas: LinhasPermissao }, chave: ChavePermissao): boolean`
  - `type ConfigPermissoes = { papel: Record<Papel, LinhasPermissao>; membros: Record<string, LinhasPermissao> }`
  - `configVazia(): ConfigPermissoes`
  - `valorDoPapel(cfg, papel, chave): boolean`
  - `type EstadoExcecao = 'padrao' | 'permitir' | 'bloquear'`; `estadoDoMembro(cfg, userId, chave): EstadoExcecao`
  - `contarExcecoes(cfg, userId): number`
  - `type MudancaPermissao = { tipo: 'papel'; alvo: Papel; chave: ChavePermissao; permitido: boolean } | { tipo: 'membro'; alvo: string; chave: ChavePermissao; permitido: boolean | null }`
  - `chaveMudanca(m): string`; `aplicarMudancas(cfg, mudancas): ConfigPermissoes`
  - `type EditorPermissoes = { isOwner: boolean; papel: Papel | null; userId: string }`
  - `type AlvoPermissao = { tipo: 'papel'; papel: Papel } | { tipo: 'membro'; userId: string; papel: Papel | 'owner' }`
  - `podeEditarAlvo(editor, alvo): boolean`
  - `type LinhaHistorico = { id: string; criado_em: string; alterado_por: string | null; alvo_tipo: 'papel' | 'membro'; alvo: string; chave: string; de: boolean | null; para: boolean | null }`
  - `descreverHistorico(l: LinhaHistorico, nomes: Record<string, string>): string`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/permissoes-catalogo.test.ts
import { describe, expect, it } from 'vitest';
import {
  CATALOGO_PERMISSOES, CHAVES_PERMISSAO, ehChavePermissao, pode, permissoesPadrao,
  resolverPermissao, configVazia, valorDoPapel, estadoDoMembro, contarExcecoes,
  aplicarMudancas, chaveMudanca, podeEditarAlvo, descreverHistorico,
  type PermissoesUsuario,
} from '@shared/permissoes';

const PADRAO_PROFISSIONAL = [
  'clientes.ver_todas', 'clientes.cadastrar', 'clientes.editar', 'anamnese.ver', 'anamnese.editar',
  'comanda.fechar', 'comanda.desconto', 'comanda.editar_fechada', 'pacotes.vender',
].sort();

describe('catálogo', () => {
  it('tem 27 chaves únicas, todas com rótulo e grupo', () => {
    expect(CHAVES_PERMISSAO).toHaveLength(27);
    expect(new Set(CHAVES_PERMISSAO).size).toBe(27);
    for (const p of CATALOGO_PERMISSOES) {
      expect(p.rotulo.length).toBeGreaterThan(3);
      expect(p.grupo.length).toBeGreaterThan(2);
    }
  });

  it('padrão da gestora = tudo menos excluir cliente (comportamento de hoje)', () => {
    expect(permissoesPadrao('gestor').sort()).toEqual(CHAVES_PERMISSAO.filter(c => c !== 'clientes.excluir').sort());
  });

  it('padrão da profissional = comportamento de hoje', () => {
    expect(permissoesPadrao('profissional').sort()).toEqual(PADRAO_PROFISSIONAL);
  });

  it('sem papel = nada', () => {
    expect(permissoesPadrao(null)).toEqual([]);
  });

  it('ehChavePermissao', () => {
    expect(ehChavePermissao('agenda.excluir')).toBe(true);
    expect(ehChavePermissao('agenda.inventada')).toBe(false);
  });
});

describe('pode', () => {
  const prof: PermissoesUsuario = { isOwner: false, papel: 'profissional', chaves: ['clientes.cadastrar'] };
  const dona: PermissoesUsuario = { isOwner: true, papel: null, chaves: [] };
  it('dona pode tudo, inclusive "dona"', () => {
    expect(pode(dona, 'agenda.excluir')).toBe(true);
    expect(pode(dona, 'dona')).toBe(true);
  });
  it('demais: só as chaves da lista; "dona" nunca', () => {
    expect(pode(prof, 'clientes.cadastrar')).toBe(true);
    expect(pode(prof, 'agenda.excluir')).toBe(false);
    expect(pode(prof, 'dona')).toBe(false);
  });
});

describe('resolverPermissao — mesma ordem da função SQL tem_permissao', () => {
  const base = { isOwner: false, papel: 'profissional' as const, papelLinhas: {}, membroLinhas: {} };
  it('dona → sempre true', () => {
    expect(resolverPermissao({ ...base, isOwner: true, membroLinhas: { 'agenda.excluir': false } }, 'agenda.excluir')).toBe(true);
  });
  it('sem papel → false', () => {
    expect(resolverPermissao({ ...base, papel: null }, 'clientes.cadastrar')).toBe(false);
  });
  it('exceção da pessoa vence o papel', () => {
    expect(resolverPermissao({ ...base, papelLinhas: { 'agenda.excluir': false }, membroLinhas: { 'agenda.excluir': true } }, 'agenda.excluir')).toBe(true);
  });
  it('linha do papel vence o padrão', () => {
    expect(resolverPermissao({ ...base, papelLinhas: { 'clientes.cadastrar': false } }, 'clientes.cadastrar')).toBe(false);
  });
  it('sem linhas → padrão', () => {
    expect(resolverPermissao(base, 'clientes.cadastrar')).toBe(true);
    expect(resolverPermissao(base, 'agenda.excluir')).toBe(false);
  });
});

describe('estado do painel', () => {
  it('valorDoPapel usa a linha ou o padrão', () => {
    const cfg = configVazia();
    expect(valorDoPapel(cfg, 'profissional', 'agenda.excluir')).toBe(false);
    cfg.papel.profissional['agenda.excluir'] = true;
    expect(valorDoPapel(cfg, 'profissional', 'agenda.excluir')).toBe(true);
  });

  it('estadoDoMembro e contarExcecoes', () => {
    const cfg = configVazia();
    cfg.membros['u1'] = { 'agenda.excluir': true, 'clientes.editar': false };
    expect(estadoDoMembro(cfg, 'u1', 'agenda.excluir')).toBe('permitir');
    expect(estadoDoMembro(cfg, 'u1', 'clientes.editar')).toBe('bloquear');
    expect(estadoDoMembro(cfg, 'u1', 'pacotes.vender')).toBe('padrao');
    expect(estadoDoMembro(cfg, 'u2', 'pacotes.vender')).toBe('padrao');
    expect(contarExcecoes(cfg, 'u1')).toBe(2);
    expect(contarExcecoes(cfg, 'u2')).toBe(0);
  });

  it('aplicarMudancas não altera o original; permitido null remove a exceção', () => {
    const cfg = configVazia();
    cfg.membros['u1'] = { 'agenda.excluir': true };
    const novo = aplicarMudancas(cfg, [
      { tipo: 'papel', alvo: 'profissional', chave: 'estoque.acessar', permitido: true },
      { tipo: 'membro', alvo: 'u1', chave: 'agenda.excluir', permitido: null },
      { tipo: 'membro', alvo: 'u2', chave: 'clientes.editar', permitido: false },
    ]);
    expect(novo.papel.profissional['estoque.acessar']).toBe(true);
    expect(novo.membros['u1']['agenda.excluir']).toBeUndefined();
    expect(novo.membros['u2']['clientes.editar']).toBe(false);
    expect(cfg.membros['u1']['agenda.excluir']).toBe(true);
    expect(cfg.papel.profissional['estoque.acessar']).toBeUndefined();
  });

  it('chaveMudanca identifica alvo + chave', () => {
    expect(chaveMudanca({ tipo: 'membro', alvo: 'u1', chave: 'agenda.excluir', permitido: null })).toBe('membro:u1:agenda.excluir');
  });
});

describe('podeEditarAlvo — regra da gestora (espelha salvar_permissoes)', () => {
  const dona = { isOwner: true, papel: null, userId: 'd' };
  const gestora = { isOwner: false, papel: 'gestor' as const, userId: 'g' };
  const prof = { isOwner: false, papel: 'profissional' as const, userId: 'p' };
  it('dona edita qualquer papel e qualquer membro que não seja dona', () => {
    expect(podeEditarAlvo(dona, { tipo: 'papel', papel: 'gestor' })).toBe(true);
    expect(podeEditarAlvo(dona, { tipo: 'membro', userId: 'g', papel: 'gestor' })).toBe(true);
    expect(podeEditarAlvo(dona, { tipo: 'membro', userId: 'x', papel: 'owner' })).toBe(false);
  });
  it('gestora: só papel profissional e profissionais que não sejam ela', () => {
    expect(podeEditarAlvo(gestora, { tipo: 'papel', papel: 'profissional' })).toBe(true);
    expect(podeEditarAlvo(gestora, { tipo: 'papel', papel: 'gestor' })).toBe(false);
    expect(podeEditarAlvo(gestora, { tipo: 'membro', userId: 'p', papel: 'profissional' })).toBe(true);
    expect(podeEditarAlvo(gestora, { tipo: 'membro', userId: 'g2', papel: 'gestor' })).toBe(false);
    expect(podeEditarAlvo(gestora, { tipo: 'membro', userId: 'g', papel: 'profissional' })).toBe(false);
  });
  it('profissional nunca edita', () => {
    expect(podeEditarAlvo(prof, { tipo: 'papel', papel: 'profissional' })).toBe(false);
  });
});

describe('descreverHistorico', () => {
  it('formata em horário de Brasília com ✔/✘/padrão', () => {
    const txt = descreverHistorico(
      { id: '1', criado_em: '2026-10-02T17:30:00Z', alterado_por: 'g', alvo_tipo: 'papel', alvo: 'profissional', chave: 'agenda.excluir', de: false, para: true },
      { g: 'Carla' },
    );
    expect(txt).toBe('02/10 14:30 · Carla · Profissional · Excluir agendamento: ✘ → ✔');
  });
  it('membro e volta ao padrão', () => {
    const txt = descreverHistorico(
      { id: '2', criado_em: '2026-10-02T03:05:00Z', alterado_por: null, alvo_tipo: 'membro', alvo: 'u1', chave: 'clientes.editar', de: false, para: null },
      { u1: 'Ana' },
    );
    expect(txt).toBe('02/10 00:05 · Alguém · Ana · Editar cliente: ✘ → padrão');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd web && npx vitest run tests/unit/permissoes-catalogo.test.ts`
Expected: FAIL — `Failed to resolve import "@shared/permissoes"`.

- [ ] **Step 3: Implementar**

```ts
// shared/permissoes.ts
/**
 * Permissões configuráveis por papel e por pessoa
 * (spec docs/superpowers/specs/2026-10-02-permissoes-configuraveis-design.md).
 *
 * Fonte única do catálogo. A migration 083 repete as chaves (`permissoes_chaves()`) e os
 * padrões (`permissao_padrao()`) em SQL — o teste `permissoes-migration.test.ts` trava as
 * duas listas iguais. Ao criar uma chave: catálogo aqui + migration nova com as duas funções.
 *
 * Padrões = comportamento de antes desta feature (nada muda no deploy).
 */

export type Papel = 'gestor' | 'profissional';

export const GRUPOS_PERMISSAO = [
  'Agenda', 'Clientes', 'Comanda', 'Vendas', 'Serviços e pacotes',
  'Estoque', 'Financeiro', 'Equipe e comissões', 'Configurações',
] as const;
export type GrupoPermissao = (typeof GRUPOS_PERMISSAO)[number];

type DefPermissao = {
  chave: string;
  grupo: GrupoPermissao;
  rotulo: string;
  descricao: string;
  padrao: Record<Papel, boolean>;
};

const SIM_NAO = { gestor: true, profissional: false } as const;
const SIM_SIM = { gestor: true, profissional: true } as const;

export const CATALOGO_PERMISSOES = [
  { chave: 'agenda.ver_equipe', grupo: 'Agenda', rotulo: 'Ver agenda de toda a equipe', descricao: 'Desligado: vê só a própria agenda.', padrao: SIM_NAO },
  { chave: 'agenda.gerenciar_outras', grupo: 'Agenda', rotulo: 'Criar e editar agendamentos de outras profissionais', descricao: 'A própria agenda é sempre liberada.', padrao: SIM_NAO },
  { chave: 'agenda.excluir', grupo: 'Agenda', rotulo: 'Excluir agendamento', descricao: 'Atendimento concluído nunca pode ser excluído.', padrao: SIM_NAO },
  { chave: 'agenda.aprovar_bloqueios', grupo: 'Agenda', rotulo: 'Aprovar bloqueios e bloquear a agenda geral', descricao: 'Sem isso, o bloqueio da própria agenda fica pendente de aprovação.', padrao: SIM_NAO },
  { chave: 'clientes.ver_todas', grupo: 'Clientes', rotulo: 'Ver todas as clientes', descricao: 'Desligado: vê só as clientes que atendeu ou cadastrou.', padrao: SIM_SIM },
  { chave: 'clientes.cadastrar', grupo: 'Clientes', rotulo: 'Cadastrar cliente', descricao: 'Inclui o cadastro rápido dentro do agendamento.', padrao: SIM_SIM },
  { chave: 'clientes.editar', grupo: 'Clientes', rotulo: 'Editar cliente', descricao: 'Nome, contato, aniversário, endereço e observações.', padrao: SIM_SIM },
  { chave: 'clientes.arquivar', grupo: 'Clientes', rotulo: 'Arquivar e reativar cliente', descricao: 'A cliente some das listas, mas o histórico é mantido.', padrao: SIM_NAO },
  { chave: 'clientes.excluir', grupo: 'Clientes', rotulo: 'Excluir cliente para sempre', descricao: 'Só funciona para cliente sem nenhum histórico.', padrao: { gestor: false, profissional: false } },
  { chave: 'anamnese.ver', grupo: 'Clientes', rotulo: 'Ver ficha de anamnese', descricao: 'Dados de saúde da cliente.', padrao: SIM_SIM },
  { chave: 'anamnese.editar', grupo: 'Clientes', rotulo: 'Preencher e editar ficha de anamnese', descricao: 'Dados de saúde da cliente.', padrao: SIM_SIM },
  { chave: 'comanda.fechar', grupo: 'Comanda', rotulo: 'Fechar comanda', descricao: 'Profissional fecha só as comandas dos próprios atendimentos.', padrao: SIM_SIM },
  { chave: 'comanda.desconto', grupo: 'Comanda', rotulo: 'Dar desconto e cortesia', descricao: 'Campo de desconto e forma de pagamento "Cortesia".', padrao: SIM_SIM },
  { chave: 'comanda.editar_fechada', grupo: 'Comanda', rotulo: 'Editar comanda já fechada', descricao: 'Profissional edita só as comandas dos próprios atendimentos.', padrao: SIM_SIM },
  { chave: 'vendas.acessar', grupo: 'Vendas', rotulo: 'Registrar e ver vendas avulsas', descricao: 'Tela Vendas.', padrao: SIM_NAO },
  { chave: 'servicos.gerenciar', grupo: 'Serviços e pacotes', rotulo: 'Criar e editar serviços e categorias', descricao: 'Ver a lista de serviços é sempre liberado.', padrao: SIM_NAO },
  { chave: 'pacotes.gerenciar', grupo: 'Serviços e pacotes', rotulo: 'Criar e editar o catálogo de pacotes', descricao: 'Ver os pacotes é sempre liberado.', padrao: SIM_NAO },
  { chave: 'pacotes.vender', grupo: 'Serviços e pacotes', rotulo: 'Vender pacote para cliente', descricao: 'Na tela Pacotes, na agenda e na comanda.', padrao: SIM_SIM },
  { chave: 'estoque.acessar', grupo: 'Estoque', rotulo: 'Ver e movimentar estoque', descricao: 'A baixa automática de insumos na comanda continua para todos.', padrao: SIM_NAO },
  { chave: 'financeiro.ver', grupo: 'Financeiro', rotulo: 'Ver Financeiro, Relatórios e números da empresa', descricao: 'Inclui os cartões financeiros do Dashboard.', padrao: SIM_NAO },
  { chave: 'despesas.gerenciar', grupo: 'Financeiro', rotulo: 'Lançar, editar e pagar despesas', descricao: 'Excluir despesa continua só com a dona.', padrao: SIM_NAO },
  { chave: 'taxas.marcar_pagas', grupo: 'Financeiro', rotulo: 'Marcar taxas de reserva e cancelamento como pagas', descricao: '', padrao: SIM_NAO },
  { chave: 'financeiro.fechamentos', grupo: 'Financeiro', rotulo: 'Importar fechamentos mensais', descricao: '', padrao: SIM_NAO },
  { chave: 'equipe.gerenciar', grupo: 'Equipe e comissões', rotulo: 'Convidar, editar e desativar pessoas da equipe', descricao: 'Promover alguém a gestora é sempre só da dona.', padrao: SIM_NAO },
  { chave: 'comissoes.ver_todas', grupo: 'Equipe e comissões', rotulo: 'Ver comissões de todas', descricao: 'A própria comissão é sempre liberada.', padrao: SIM_NAO },
  { chave: 'comissoes.pagar', grupo: 'Equipe e comissões', rotulo: 'Pagar comissões', descricao: '', padrao: SIM_NAO },
  { chave: 'config.taxas', grupo: 'Configurações', rotulo: 'Editar taxas de reserva e cancelamento', descricao: 'Os demais dados da empresa são só da dona.', padrao: SIM_NAO },
] as const satisfies readonly DefPermissao[];

export type ChavePermissao = (typeof CATALOGO_PERMISSOES)[number]['chave'];
export const CHAVES_PERMISSAO: readonly ChavePermissao[] = CATALOGO_PERMISSOES.map(p => p.chave);

const POR_CHAVE = new Map<string, (typeof CATALOGO_PERMISSOES)[number]>(CATALOGO_PERMISSOES.map(p => [p.chave, p]));

export function ehChavePermissao(x: string): x is ChavePermissao {
  return POR_CHAVE.has(x);
}

export type LinhasPermissao = Partial<Record<ChavePermissao, boolean>>;

/** Permissões efetivas de quem está logado, prontas para a tela (serializáveis). */
export type PermissoesUsuario = { isOwner: boolean; papel: Papel | null; chaves: readonly ChavePermissao[] };

/** `'dona'` = coisas fixas da dona, fora do catálogo (dados da empresa, retiradas, mudar papel). */
export type Acesso = ChavePermissao | 'dona';

/** Decide se a pessoa logada pode fazer `a`. A dona sempre pode. */
export function pode(u: PermissoesUsuario, a: Acesso): boolean {
  if (u.isOwner) return true;
  if (a === 'dona') return false;
  return u.chaves.includes(a);
}

/** Chaves ligadas por padrão para o papel (comportamento de antes da feature). */
export function permissoesPadrao(papel: Papel | null): ChavePermissao[] {
  if (!papel) return [];
  return CATALOGO_PERMISSOES.filter(p => p.padrao[papel]).map(p => p.chave);
}

/**
 * Mesma ordem da função SQL `tem_permissao`: dona → exceção da pessoa → papel → padrão.
 * Usada pelas rotas de API (service role, sem auth.uid()) e pelos testes.
 */
export function resolverPermissao(
  s: { isOwner: boolean; papel: Papel | null; papelLinhas: LinhasPermissao; membroLinhas: LinhasPermissao },
  chave: ChavePermissao,
): boolean {
  if (s.isOwner) return true;
  if (!s.papel) return false;
  const membro = s.membroLinhas[chave];
  if (membro !== undefined) return membro;
  const papel = s.papelLinhas[chave];
  if (papel !== undefined) return papel;
  return POR_CHAVE.get(chave)!.padrao[s.papel];
}

// ── Estado do painel de Configurações ───────────────────────────

/** Linhas gravadas em `permissoes_papel` e `permissoes_membro` (sem os padrões). */
export type ConfigPermissoes = { papel: Record<Papel, LinhasPermissao>; membros: Record<string, LinhasPermissao> };

export function configVazia(): ConfigPermissoes {
  return { papel: { gestor: {}, profissional: {} }, membros: {} };
}

/** Valor efetivo de uma chave para um papel (linha gravada ou padrão). */
export function valorDoPapel(cfg: ConfigPermissoes, papel: Papel, chave: ChavePermissao): boolean {
  return cfg.papel[papel][chave] ?? POR_CHAVE.get(chave)!.padrao[papel];
}

export type EstadoExcecao = 'padrao' | 'permitir' | 'bloquear';

export function estadoDoMembro(cfg: ConfigPermissoes, userId: string, chave: ChavePermissao): EstadoExcecao {
  const v = cfg.membros[userId]?.[chave];
  return v === undefined ? 'padrao' : v ? 'permitir' : 'bloquear';
}

export function contarExcecoes(cfg: ConfigPermissoes, userId: string): number {
  return Object.keys(cfg.membros[userId] ?? {}).length;
}

/** Uma alteração pendente. Para membro, `permitido: null` = voltar ao padrão do papel. */
export type MudancaPermissao =
  | { tipo: 'papel'; alvo: Papel; chave: ChavePermissao; permitido: boolean }
  | { tipo: 'membro'; alvo: string; chave: ChavePermissao; permitido: boolean | null };

/** Identidade de uma mudança no rascunho (a última para o mesmo alvo+chave vence). */
export function chaveMudanca(m: MudancaPermissao): string {
  return `${m.tipo}:${m.alvo}:${m.chave}`;
}

/** Aplica o rascunho sobre a config gravada, sem mutar o original (para pré-visualizar). */
export function aplicarMudancas(cfg: ConfigPermissoes, mudancas: readonly MudancaPermissao[]): ConfigPermissoes {
  const novo: ConfigPermissoes = {
    papel: { gestor: { ...cfg.papel.gestor }, profissional: { ...cfg.papel.profissional } },
    membros: Object.fromEntries(Object.entries(cfg.membros).map(([k, v]) => [k, { ...v }])),
  };
  for (const m of mudancas) {
    if (m.tipo === 'papel') {
      novo.papel[m.alvo][m.chave] = m.permitido;
    } else {
      const linhas = (novo.membros[m.alvo] ??= {});
      if (m.permitido === null) delete linhas[m.chave];
      else linhas[m.chave] = m.permitido;
    }
  }
  return novo;
}

// ── Quem pode editar o quê (espelha a função SQL salvar_permissoes) ──

export type EditorPermissoes = { isOwner: boolean; papel: Papel | null; userId: string };
export type AlvoPermissao = { tipo: 'papel'; papel: Papel } | { tipo: 'membro'; userId: string; papel: Papel | 'owner' };

/**
 * Dona: qualquer papel e qualquer membro que não seja dona.
 * Gestora: só o papel `profissional` e membros `profissional` que não sejam ela mesma.
 */
export function podeEditarAlvo(editor: EditorPermissoes, alvo: AlvoPermissao): boolean {
  if (alvo.tipo === 'membro' && alvo.papel === 'owner') return false;
  if (editor.isOwner) return true;
  if (editor.papel !== 'gestor') return false;
  if (alvo.tipo === 'papel') return alvo.papel === 'profissional';
  return alvo.papel === 'profissional' && alvo.userId !== editor.userId;
}

// ── Histórico ───────────────────────────────────────────────────

export type LinhaHistorico = {
  id: string;
  criado_em: string;
  alterado_por: string | null;
  alvo_tipo: 'papel' | 'membro';
  alvo: string;
  chave: string;
  de: boolean | null;
  para: boolean | null;
};

const ROTULO_PAPEL: Record<Papel, string> = { gestor: 'Gestora', profissional: 'Profissional' };
const simbolo = (v: boolean | null) => (v === null ? 'padrão' : v ? '✔' : '✘');
const dois = (n: number) => String(n).padStart(2, '0');

/**
 * "02/10 14:30 · Carla · Profissional · Excluir agendamento: ✘ → ✔".
 * Horário de Brasília (UTC−3 fixo, mesma regra de shared/periodos) sem Intl — o Hermes do
 * app não tem locale pt-BR completo.
 */
export function descreverHistorico(l: LinhaHistorico, nomes: Record<string, string>): string {
  const d = new Date(Date.parse(l.criado_em) - 3 * 3600_000);
  const quando = `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)} ${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}`;
  const autor = (l.alterado_por && nomes[l.alterado_por]) || 'Alguém';
  const alvo = l.alvo_tipo === 'papel' ? (ROTULO_PAPEL[l.alvo as Papel] ?? l.alvo) : (nomes[l.alvo] ?? 'Membro removido');
  const rotulo = POR_CHAVE.get(l.chave)?.rotulo ?? l.chave;
  return `${quando} · ${autor} · ${alvo} · ${rotulo}: ${simbolo(l.de)} → ${simbolo(l.para)}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd web && npx vitest run tests/unit/permissoes-catalogo.test.ts && npx tsc --noEmit`
Expected: PASS; tsc sem saída.

- [ ] **Step 5: Commit**

```bash
git add shared/permissoes.ts web/tests/unit/permissoes-catalogo.test.ts
git commit -m "feat(permissoes): catalogo de permissoes e regras puras em shared"
```

---

### Task 2: Consultas ao banco (`shared/permissoes-consultas.ts`)

**Files:**
- Create: `shared/permissoes-consultas.ts`
- Test: `web/tests/unit/permissoes-consultas.test.ts`

**Interfaces:**
- Consumes: tudo da Task 1.
- Produces:
  - `interface ClienteDbPermissoes { from(t: string): any; rpc(fn: string, args?: Record<string, unknown>): any }`
  - `carregarMinhasPermissoes(sb, empresaId: string, isOwner: boolean, papel: Papel | null): Promise<PermissoesUsuario>` — nunca lança; sem a migration (ou erro), cai nos padrões.
  - `carregarConfigPermissoes(sb, empresaId): Promise<ConfigPermissoes>` — lança em erro.
  - `salvarPermissoes(sb, empresaId, mudancas: MudancaPermissao[]): Promise<{ error: { code?: string; message: string } | null }>`
  - `carregarHistoricoPermissoes(sb, empresaId, limite = 50): Promise<LinhaHistorico[]>` — lança em erro.
  - `carregarPermissoesDoMembro(admin, empresaId, userId): Promise<PermissoesUsuario | null>` — para rotas de API com service role (lê as tabelas e resolve em TS); `null` se não é membro ativo nem dona.
  - `papelDeRole(role: string | null | undefined): Papel | null`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/permissoes-consultas.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  carregarMinhasPermissoes, carregarConfigPermissoes, salvarPermissoes,
  carregarPermissoesDoMembro, papelDeRole,
} from '@shared/permissoes-consultas';
import { permissoesPadrao } from '@shared/permissoes';

/** Query builder falso: qualquer encadeamento devolve a si mesmo; await resolve `resposta`. */
function fakeQuery(resposta: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'maybeSingle', 'single']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok);
  return q;
}

describe('carregarMinhasPermissoes', () => {
  it('dona: todas as chaves, sem consultar', async () => {
    const sb = { from: vi.fn(), rpc: vi.fn() };
    const r = await carregarMinhasPermissoes(sb, 'e', true, null);
    expect(r.isOwner).toBe(true);
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it('usa minhas_permissoes e ignora chave desconhecida / não permitida', async () => {
    const sb = { from: vi.fn(), rpc: vi.fn().mockResolvedValue({
      data: [
        { chave: 'agenda.excluir', permitido: true },
        { chave: 'clientes.cadastrar', permitido: false },
        { chave: 'chave.velha', permitido: true },
      ], error: null }) };
    const r = await carregarMinhasPermissoes(sb, 'e', false, 'profissional');
    expect(sb.rpc).toHaveBeenCalledWith('minhas_permissoes', { p_empresa: 'e' });
    expect(r.chaves).toEqual(['agenda.excluir']);
  });

  it('erro (ex.: migration 083 ainda não aplicada) → padrões do papel', async () => {
    const sb = { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } }) };
    const r = await carregarMinhasPermissoes(sb, 'e', false, 'profissional');
    expect([...r.chaves].sort()).toEqual(permissoesPadrao('profissional').sort());
  });

  it('exceção lançada → padrões do papel', async () => {
    const sb = { from: vi.fn(), rpc: vi.fn().mockRejectedValue(new Error('rede')) };
    const r = await carregarMinhasPermissoes(sb, 'e', false, 'gestor');
    expect([...r.chaves].sort()).toEqual(permissoesPadrao('gestor').sort());
  });
});

describe('carregarConfigPermissoes', () => {
  it('monta papel e membros a partir das duas tabelas, ignorando chave desconhecida', async () => {
    const sb = {
      rpc: vi.fn(),
      from: vi.fn((t: string) => fakeQuery(t === 'permissoes_papel'
        ? { data: [{ papel: 'profissional', chave: 'agenda.excluir', permitido: true }, { papel: 'gestor', chave: 'x.y', permitido: true }], error: null }
        : { data: [{ user_id: 'u1', chave: 'clientes.editar', permitido: false }], error: null })),
    };
    const cfg = await carregarConfigPermissoes(sb, 'e');
    expect(cfg.papel.profissional).toEqual({ 'agenda.excluir': true });
    expect(cfg.papel.gestor).toEqual({});
    expect(cfg.membros).toEqual({ u1: { 'clientes.editar': false } });
  });

  it('lança o erro do banco', async () => {
    const sb = { rpc: vi.fn(), from: vi.fn(() => fakeQuery({ data: null, error: { message: 'boom' } })) };
    await expect(carregarConfigPermissoes(sb, 'e')).rejects.toThrow('boom');
  });
});

describe('salvarPermissoes', () => {
  it('chama salvar_permissoes com o rascunho', async () => {
    const sb = { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ error: null }) };
    const m = [{ tipo: 'papel' as const, alvo: 'profissional' as const, chave: 'agenda.excluir' as const, permitido: true }];
    const r = await salvarPermissoes(sb, 'e', m);
    expect(sb.rpc).toHaveBeenCalledWith('salvar_permissoes', { p_empresa: 'e', p_mudancas: m });
    expect(r.error).toBeNull();
  });
});

describe('carregarPermissoesDoMembro (service role)', () => {
  it('não membro e não dona → null', async () => {
    const sb = { rpc: vi.fn(), from: vi.fn((t: string) => fakeQuery(t === 'empresas'
      ? { data: { owner_id: 'outra' }, error: null }
      : { data: null, error: null })) };
    expect(await carregarPermissoesDoMembro(sb, 'e', 'u')).toBeNull();
  });

  it('profissional com exceção', async () => {
    const respostas: Record<string, unknown> = {
      empresas: { data: { owner_id: 'dona' }, error: null },
      empresa_membros: { data: { role: 'profissional' }, error: null },
      permissoes_papel: { data: [], error: null },
      permissoes_membro: { data: [{ chave: 'equipe.gerenciar', permitido: true }], error: null },
    };
    const sb = { rpc: vi.fn(), from: vi.fn((t: string) => fakeQuery(respostas[t])) };
    const r = await carregarPermissoesDoMembro(sb, 'e', 'u');
    expect(r?.chaves).toContain('equipe.gerenciar');
    expect(r?.chaves).toContain('clientes.cadastrar');
    expect(r?.chaves).not.toContain('agenda.excluir');
  });
});

describe('papelDeRole', () => {
  it('converte o role do banco', () => {
    expect(papelDeRole('gestor')).toBe('gestor');
    expect(papelDeRole('profissional')).toBe('profissional');
    expect(papelDeRole('owner')).toBeNull();
    expect(papelDeRole(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd web && npx vitest run tests/unit/permissoes-consultas.test.ts`
Expected: FAIL — `Failed to resolve import "@shared/permissoes-consultas"`.

- [ ] **Step 3: Implementar**

```ts
// shared/permissoes-consultas.ts
/**
 * Leitura e gravação de permissões no Supabase — usado por web (server e client) e mobile,
 * que passam o próprio client. Regras puras ficam em ./permissoes.
 */
import {
  CHAVES_PERMISSAO, configVazia, ehChavePermissao, permissoesPadrao, resolverPermissao,
  type ConfigPermissoes, type LinhaHistorico, type LinhasPermissao, type MudancaPermissao,
  type Papel, type PermissoesUsuario,
} from './permissoes';

/** O mínimo do client supabase-js usado aqui (web: @supabase/ssr; mobile: @supabase/supabase-js). */
export interface ClienteDbPermissoes {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
}

/** `empresa_membros.role` → papel configurável (`owner` e desconhecidos viram null). */
export function papelDeRole(role: string | null | undefined): Papel | null {
  return role === 'gestor' || role === 'profissional' ? role : null;
}

/**
 * Permissões efetivas da pessoa logada (RPC `minhas_permissoes`). Nunca lança: se a migration
 * 083 ainda não foi aplicada (ou der qualquer erro), devolve os padrões do papel — que são o
 * comportamento de antes da feature. Isso deixa o deploy seguro em qualquer ordem.
 */
export async function carregarMinhasPermissoes(
  sb: ClienteDbPermissoes, empresaId: string, isOwner: boolean, papel: Papel | null,
): Promise<PermissoesUsuario> {
  if (isOwner) return { isOwner: true, papel, chaves: [...CHAVES_PERMISSAO] };
  const padrao: PermissoesUsuario = { isOwner: false, papel, chaves: permissoesPadrao(papel) };
  try {
    const { data, error } = await sb.rpc('minhas_permissoes', { p_empresa: empresaId });
    if (error || !Array.isArray(data)) return padrao;
    const chaves = (data as { chave: string; permitido: boolean }[])
      .filter(r => r.permitido && ehChavePermissao(r.chave))
      .map(r => r.chave as (typeof CHAVES_PERMISSAO)[number]);
    return { isOwner: false, papel, chaves };
  } catch {
    return padrao;
  }
}

/** Linhas gravadas (sem padrões) para o painel de Configurações. Lança em erro. */
export async function carregarConfigPermissoes(sb: ClienteDbPermissoes, empresaId: string): Promise<ConfigPermissoes> {
  const [rPapel, rMembro] = await Promise.all([
    sb.from('permissoes_papel').select('papel, chave, permitido').eq('empresa_id', empresaId),
    sb.from('permissoes_membro').select('user_id, chave, permitido').eq('empresa_id', empresaId),
  ]);
  if (rPapel.error) throw new Error(rPapel.error.message);
  if (rMembro.error) throw new Error(rMembro.error.message);
  const cfg = configVazia();
  for (const l of (rPapel.data ?? []) as { papel: string; chave: string; permitido: boolean }[]) {
    const papel = papelDeRole(l.papel);
    if (papel && ehChavePermissao(l.chave)) cfg.papel[papel][l.chave] = l.permitido;
  }
  for (const l of (rMembro.data ?? []) as { user_id: string; chave: string; permitido: boolean }[]) {
    if (ehChavePermissao(l.chave)) (cfg.membros[l.user_id] ??= {})[l.chave] = l.permitido;
  }
  return cfg;
}

/** Grava o rascunho via RPC (valida a regra da gestora e grava o histórico no banco). */
export async function salvarPermissoes(
  sb: ClienteDbPermissoes, empresaId: string, mudancas: MudancaPermissao[],
): Promise<{ error: { code?: string; message: string } | null }> {
  const { error } = await sb.rpc('salvar_permissoes', { p_empresa: empresaId, p_mudancas: mudancas });
  return { error: error ?? null };
}

/** Últimas alterações (mais recentes primeiro). Lança em erro. */
export async function carregarHistoricoPermissoes(
  sb: ClienteDbPermissoes, empresaId: string, limite = 50,
): Promise<LinhaHistorico[]> {
  const { data, error } = await sb.from('permissoes_historico')
    .select('id, criado_em, alterado_por, alvo_tipo, alvo, chave, de, para')
    .eq('empresa_id', empresaId)
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as LinhaHistorico[];
}

/**
 * Permissões de um usuário qualquer, para rotas de API que usam service role (sem
 * auth.uid(), então `minhas_permissoes` não serve). Mesma ordem de `tem_permissao`.
 */
export async function carregarPermissoesDoMembro(
  admin: ClienteDbPermissoes, empresaId: string, userId: string,
): Promise<PermissoesUsuario | null> {
  const [rEmp, rMembro] = await Promise.all([
    admin.from('empresas').select('owner_id').eq('id', empresaId).maybeSingle(),
    admin.from('empresa_membros').select('role').eq('empresa_id', empresaId).eq('user_id', userId).eq('ativo', true).maybeSingle(),
  ]);
  const role = (rMembro.data as { role?: string } | null)?.role;
  const isOwner = (rEmp.data as { owner_id?: string } | null)?.owner_id === userId || role === 'owner';
  if (isOwner) return { isOwner: true, papel: null, chaves: [...CHAVES_PERMISSAO] };
  const papel = papelDeRole(role);
  if (!papel) return null;

  const [rPapel, rM] = await Promise.all([
    admin.from('permissoes_papel').select('chave, permitido').eq('empresa_id', empresaId).eq('papel', papel),
    admin.from('permissoes_membro').select('chave, permitido').eq('empresa_id', empresaId).eq('user_id', userId),
  ]);
  const paraLinhas = (rows: unknown): LinhasPermissao => {
    const out: LinhasPermissao = {};
    for (const l of ((rows ?? []) as { chave: string; permitido: boolean }[])) if (ehChavePermissao(l.chave)) out[l.chave] = l.permitido;
    return out;
  };
  // Tabelas ainda inexistentes (migration não aplicada) → erro → linhas vazias → padrões.
  const papelLinhas = rPapel.error ? {} : paraLinhas(rPapel.data);
  const membroLinhas = rM.error ? {} : paraLinhas(rM.data);
  const chaves = CHAVES_PERMISSAO.filter(c => resolverPermissao({ isOwner: false, papel, papelLinhas, membroLinhas }, c));
  return { isOwner: false, papel, chaves };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd web && npx vitest run tests/unit/permissoes-consultas.test.ts tests/unit/permissoes-catalogo.test.ts && npx tsc --noEmit`
Expected: PASS; tsc sem saída.

- [ ] **Step 5: Commit**

```bash
git add shared/permissoes-consultas.ts web/tests/unit/permissoes-consultas.test.ts
git commit -m "feat(permissoes): consultas de permissoes com fallback para os padroes"
```

---

### Task 3: Migration 083 (tabelas, funções, policies)

**Files:**
- Create: `supabase/migrations/083_permissoes_configuraveis.sql`
- Test: `web/tests/unit/permissoes-migration.test.ts`

**Interfaces:**
- Consumes: `CATALOGO_PERMISSOES`, `permissoesPadrao` (Task 1) — só no teste.
- Produces (no banco): tabelas `permissoes_papel`, `permissoes_membro`, `permissoes_historico`; funções `permissoes_chaves()`, `permissao_padrao(text, text)`, `tem_permissao(uuid, text)`, `minhas_permissoes(uuid)`, `salvar_permissoes(uuid, jsonb)`; coluna `clientes.criado_por`; trigger `trg_membros_papel_so_dona`.

Regras de reescrita (estado de produção em `docs/superpowers/notes/2026-10-02-pg-policies-producao.csv` + 080/081/082). Cada policy é recriada com **o mesmo nome** e só troca `is_gestor_ou_owner(...)` pelo `tem_permissao` da chave — o resto da condição fica idêntico. Policies fora do catálogo **não** são tocadas (inclusive as manuais "gestor pode gerenciar agendamentos/comissoes", que só liberam a dona e continuam inofensivas).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/permissoes-migration.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CATALOGO_PERMISSOES, permissoesPadrao } from '@shared/permissoes';

const root = join(__dirname, '..', '..', '..');
const sql = readFileSync(join(root, 'supabase/migrations/083_permissoes_configuraveis.sql'), 'utf8');

/** Extrai a lista literal de `array[...]` logo depois de um marcador. */
function arrayDepois(marcador: string): string[] {
  const i = sql.indexOf(marcador);
  expect(i, `marcador ${marcador}`).toBeGreaterThan(-1);
  const trecho = sql.slice(i, sql.indexOf(']', i));
  return [...trecho.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]).sort();
}

describe('migration 083 ↔ catálogo', () => {
  it('permissoes_chaves() lista exatamente as chaves do catálogo', () => {
    expect(arrayDepois('-- @chaves')).toEqual(CATALOGO_PERMISSOES.map(p => p.chave).sort());
  });
  it('padrão da profissional igual ao catálogo', () => {
    expect(arrayDepois('-- @padrao-profissional')).toEqual(permissoesPadrao('profissional').sort());
  });
  it('padrão da gestora = tudo menos as chaves negadas, iguais ao catálogo', () => {
    const negadasCatalogo = CATALOGO_PERMISSOES.filter(p => !p.padrao.gestor).map(p => p.chave).sort();
    expect(arrayDepois('-- @padrao-gestor-negado')).toEqual(negadasCatalogo);
  });
});

describe('migration 083 — estrutura', () => {
  it('cria as 3 tabelas com RLS e só SELECT para membros', () => {
    for (const t of ['permissoes_papel', 'permissoes_membro', 'permissoes_historico']) {
      expect(sql).toContain(`create table if not exists public.${t}`);
      expect(sql).toContain(`alter table public.${t} enable row level security`);
      expect(sql).toMatch(new RegExp(`on public\\.${t} for select`));
      expect(sql).not.toMatch(new RegExp(`on public\\.${t} for (insert|update|delete|all)`));
    }
  });

  it('tem_permissao: dona → exceção → papel → padrão; membro inativo → false', () => {
    const corpo = sql.slice(sql.indexOf('function public.tem_permissao'), sql.indexOf('function public.minhas_permissoes'));
    const ordem = ['owner_id = auth.uid()', 'ativo', 'permissoes_membro', 'permissoes_papel', 'permissao_padrao('];
    let ultimo = -1;
    for (const t of ordem) {
      const i = corpo.indexOf(t, ultimo + 1);
      expect(i, t).toBeGreaterThan(ultimo);
      ultimo = i;
    }
    expect(corpo).toMatch(/security definer/);
  });

  it('salvar_permissoes valida a regra da gestora e grava histórico', () => {
    const corpo = sql.slice(sql.indexOf('function public.salvar_permissoes'));
    expect(corpo).toMatch(/coalesce\(v_papel_editor, ''\) <> 'gestor'/);
    expect(corpo).toMatch(/v_alvo <> 'profissional'/);
    expect(corpo).toMatch(/v_alvo_papel <> 'profissional'/);
    expect(corpo).toMatch(/v_alvo_user = auth\.uid\(\)/);
    expect(corpo).toMatch(/insert into public\.permissoes_historico/);
    expect(corpo).toMatch(/errcode = '42501'/);
  });

  it('mudar papel de alguém continua só com a dona (trigger)', () => {
    expect(sql).toMatch(/before update of role on public\.empresa_membros/);
  });

  it('clientes ganha criado_por e índice para "só as que atendeu"', () => {
    expect(sql).toMatch(/alter table public\.clientes add column if not exists criado_por uuid default auth\.uid\(\)/);
    expect(sql).toMatch(/create index if not exists idx_agendamentos_cliente_profissional/);
  });

  it('termina recarregando o schema do PostgREST', () => {
    expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});

describe('migration 083 — cada chave "Banco" aparece numa policy', () => {
  const chavesBanco = [
    'agenda.ver_equipe', 'agenda.gerenciar_outras', 'agenda.excluir', 'agenda.aprovar_bloqueios',
    'clientes.ver_todas', 'clientes.cadastrar', 'clientes.editar', 'clientes.arquivar', 'clientes.excluir',
    'anamnese.ver', 'anamnese.editar', 'comanda.fechar', 'servicos.gerenciar', 'pacotes.gerenciar',
    'pacotes.vender', 'financeiro.ver', 'despesas.gerenciar', 'taxas.marcar_pagas',
    'financeiro.fechamentos', 'equipe.gerenciar', 'comissoes.ver_todas', 'comissoes.pagar',
  ];
  for (const c of chavesBanco) {
    it(c, () => expect(sql).toMatch(new RegExp(`tem_permissao\\((old\\.|p\\.)?empresa_id, '${c.replace('.', '\\.')}'\\)`)));
  }

  it('chaves "Tela" não aparecem em policy', () => {
    for (const c of ['comanda.desconto', 'comanda.editar_fechada', 'vendas.acessar', 'estoque.acessar', 'config.taxas']) {
      expect(sql).not.toContain(`tem_permissao(empresa_id, '${c}')`);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd web && npx vitest run tests/unit/permissoes-migration.test.ts`
Expected: FAIL — `ENOENT ... 083_permissoes_configuraveis.sql`.

- [ ] **Step 3: Escrever a migration**

```sql
-- ============================================================
-- 083 — Permissões configuráveis por papel e por pessoa
-- ============================================================
-- Spec: docs/superpowers/specs/2026-10-02-permissoes-configuraveis-design.md
-- Estado de partida: pg_policies de produção lido em 2026-10-02
--   (docs/superpowers/notes/2026-10-02-pg-policies-producao.csv) + migrations 080, 081, 082.
-- ORDEM OBRIGATÓRIA no SQL Editor: 080 → 081 → 082 → 083 (esta recria policies criadas lá).
--
-- O que faz:
--  1. Catálogo em SQL (permissoes_chaves / permissao_padrao) — espelho de shared/permissoes.ts,
--     travado pelo teste web/tests/unit/permissoes-migration.test.ts.
--  2. Tabelas permissoes_papel, permissoes_membro, permissoes_historico (só SELECT via RLS;
--     escrita só pela função salvar_permissoes).
--  3. tem_permissao(empresa, chave): dona → exceção da pessoa → papel → padrão.
--  4. minhas_permissoes(empresa) e salvar_permissoes(empresa, mudancas).
--  5. Trigger: mudar o papel de alguém em empresa_membros continua só com a dona.
--  6. Policies dos itens "Banco" do catálogo trocam is_gestor_ou_owner por tem_permissao,
--     com o MESMO nome e o resto da condição idêntico. Sem linhas gravadas, tem_permissao
--     devolve os padrões = comportamento de antes, então nada muda no dia em que roda.
--
-- Rollback: recriar as policies listadas abaixo exatamente como estão no CSV de 2026-10-02
-- (mais 080/081/082), e então:
--   drop trigger if exists trg_membros_papel_so_dona on public.empresa_membros;
--   drop function if exists public.fn_membros_papel_so_dona();
--   drop function if exists public.salvar_permissoes(uuid, jsonb);
--   drop function if exists public.minhas_permissoes(uuid);
--   drop table if exists public.permissoes_historico, public.permissoes_membro, public.permissoes_papel;
--   drop function if exists public.tem_permissao(uuid, text);
--   drop function if exists public.permissao_padrao(text, text);
--   drop function if exists public.permissoes_chaves();
--   (clientes.criado_por pode ficar — é nullable e só é lida pela policy de SELECT)
--   O trigger de clientes.ativo volta ao corpo da 081 (is_gestor_ou_owner).

-- ── 1. Catálogo ───────────────────────────────────────────────

create or replace function public.permissoes_chaves()
returns text[] language sql immutable as $$
  select array[ -- @chaves
    'agenda.ver_equipe', 'agenda.gerenciar_outras', 'agenda.excluir', 'agenda.aprovar_bloqueios',
    'clientes.ver_todas', 'clientes.cadastrar', 'clientes.editar', 'clientes.arquivar', 'clientes.excluir',
    'anamnese.ver', 'anamnese.editar',
    'comanda.fechar', 'comanda.desconto', 'comanda.editar_fechada',
    'vendas.acessar',
    'servicos.gerenciar', 'pacotes.gerenciar', 'pacotes.vender',
    'estoque.acessar',
    'financeiro.ver', 'despesas.gerenciar', 'taxas.marcar_pagas', 'financeiro.fechamentos',
    'equipe.gerenciar', 'comissoes.ver_todas', 'comissoes.pagar',
    'config.taxas'
  ]::text[];
$$;

create or replace function public.permissao_padrao(p_papel text, p_chave text)
returns boolean language sql immutable as $$
  select p_chave = any (public.permissoes_chaves()) and case p_papel
    when 'gestor' then not (p_chave = any (array[ -- @padrao-gestor-negado
      'clientes.excluir'
    ]::text[]))
    when 'profissional' then p_chave = any (array[ -- @padrao-profissional
      'clientes.ver_todas', 'clientes.cadastrar', 'clientes.editar', 'anamnese.ver', 'anamnese.editar',
      'comanda.fechar', 'comanda.desconto', 'comanda.editar_fechada', 'pacotes.vender'
    ]::text[])
    else false
  end;
$$;

-- ── 2. Tabelas ────────────────────────────────────────────────

create table if not exists public.permissoes_papel (
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  papel       text not null check (papel in ('gestor', 'profissional')),
  chave       text not null check (chave = any (public.permissoes_chaves())),
  permitido   boolean not null,
  alterado_por uuid,
  alterado_em timestamptz not null default now(),
  primary key (empresa_id, papel, chave)
);

create table if not exists public.permissoes_membro (
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  user_id     uuid not null,
  chave       text not null check (chave = any (public.permissoes_chaves())),
  permitido   boolean not null,
  alterado_por uuid,
  alterado_em timestamptz not null default now(),
  primary key (empresa_id, user_id, chave)
);

create table if not exists public.permissoes_historico (
  id           uuid primary key default uuid_generate_v4(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  alterado_por uuid,
  alvo_tipo    text not null check (alvo_tipo in ('papel', 'membro')),
  alvo         text not null,
  chave        text not null,
  de           boolean,
  para         boolean,
  criado_em    timestamptz not null default now()
);
create index if not exists idx_permissoes_historico_empresa
  on public.permissoes_historico (empresa_id, criado_em desc);

alter table public.permissoes_papel     enable row level security;
alter table public.permissoes_membro    enable row level security;
alter table public.permissoes_historico enable row level security;

drop policy if exists "permissoes_papel: membro ve" on public.permissoes_papel;
create policy "permissoes_papel: membro ve" on public.permissoes_papel for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "permissoes_membro: membro ve" on public.permissoes_membro;
create policy "permissoes_membro: membro ve" on public.permissoes_membro for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "permissoes_historico: membro ve" on public.permissoes_historico;
create policy "permissoes_historico: membro ve" on public.permissoes_historico for select
  using (empresa_id in (select minha_empresas()));

-- ── 3. tem_permissao ──────────────────────────────────────────

create or replace function public.tem_permissao(p_empresa uuid, p_chave text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_papel text;
  v_val   boolean;
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.empresas where id = p_empresa and owner_id = auth.uid()) then
    return true;
  end if;
  select role::text into v_papel from public.empresa_membros
    where empresa_id = p_empresa and user_id = auth.uid() and ativo = true
    limit 1;
  if v_papel is null then return false; end if;
  if v_papel = 'owner' then return true; end if;

  select permitido into v_val from public.permissoes_membro
    where empresa_id = p_empresa and user_id = auth.uid() and chave = p_chave;
  if found then return v_val; end if;

  select permitido into v_val from public.permissoes_papel
    where empresa_id = p_empresa and papel = v_papel and chave = p_chave;
  if found then return v_val; end if;

  return public.permissao_padrao(v_papel, p_chave);
end;
$$;

-- ── 4. minhas_permissoes / salvar_permissoes ──────────────────

create or replace function public.minhas_permissoes(p_empresa uuid)
returns table (chave text, permitido boolean)
language sql stable security definer set search_path = public
as $$
  select c, public.tem_permissao(p_empresa, c) from unnest(public.permissoes_chaves()) as c;
$$;
grant execute on function public.minhas_permissoes(uuid) to authenticated;

/*
 * p_mudancas: [{ "tipo": "papel"|"membro", "alvo": "<papel ou user_id>", "chave": "...",
 *                "permitido": true|false|null }]   (null só para membro = volta ao padrão)
 * Dona: tudo (menos a própria dona como alvo). Gestora: só papel 'profissional' e membros
 * 'profissional' que não sejam ela. Demais: recusa. Tudo numa transação, com histórico.
 */
create or replace function public.salvar_permissoes(p_empresa uuid, p_mudancas jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_owner        boolean;
  v_papel_editor text;
  m              jsonb;
  v_tipo         text;
  v_alvo         text;
  v_chave        text;
  v_para         boolean;
  v_de           boolean;
  v_alvo_user    uuid;
  v_alvo_papel   text;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida' using errcode = '42501';
  end if;
  v_owner := exists (select 1 from public.empresas where id = p_empresa and owner_id = auth.uid());
  select role::text into v_papel_editor from public.empresa_membros
    where empresa_id = p_empresa and user_id = auth.uid() and ativo = true limit 1;
  if v_papel_editor = 'owner' then v_owner := true; end if;
  if not v_owner and coalesce(v_papel_editor, '') <> 'gestor' then
    raise exception 'Só a dona ou a gestora pode alterar permissões' using errcode = '42501';
  end if;

  for m in select * from jsonb_array_elements(coalesce(p_mudancas, '[]'::jsonb)) loop
    v_tipo  := m->>'tipo';
    v_alvo  := m->>'alvo';
    v_chave := m->>'chave';
    v_para  := case when m->'permitido' is null or jsonb_typeof(m->'permitido') = 'null'
                    then null else (m->>'permitido')::boolean end;

    if not (v_chave = any (public.permissoes_chaves())) then
      raise exception 'Permissão desconhecida: %', v_chave using errcode = '22023';
    end if;

    if v_tipo = 'papel' then
      if v_alvo not in ('gestor', 'profissional') then
        raise exception 'Papel inválido: %', v_alvo using errcode = '22023';
      end if;
      if not v_owner and v_alvo <> 'profissional' then
        raise exception 'A gestora só altera o papel Profissional' using errcode = '42501';
      end if;
      if v_para is null then
        raise exception 'Permissão do papel precisa ser ligada ou desligada' using errcode = '22023';
      end if;
      select permitido into v_de from public.permissoes_papel
        where empresa_id = p_empresa and papel = v_alvo and chave = v_chave;
      if not found then v_de := public.permissao_padrao(v_alvo, v_chave); end if;
      if v_de is distinct from v_para then
        insert into public.permissoes_papel (empresa_id, papel, chave, permitido, alterado_por, alterado_em)
          values (p_empresa, v_alvo, v_chave, v_para, auth.uid(), now())
          on conflict (empresa_id, papel, chave)
          do update set permitido = excluded.permitido, alterado_por = excluded.alterado_por, alterado_em = now();
        insert into public.permissoes_historico (empresa_id, alterado_por, alvo_tipo, alvo, chave, de, para)
          values (p_empresa, auth.uid(), 'papel', v_alvo, v_chave, v_de, v_para);
      end if;

    elsif v_tipo = 'membro' then
      v_alvo_user := v_alvo::uuid;
      select role::text into v_alvo_papel from public.empresa_membros
        where empresa_id = p_empresa and user_id = v_alvo_user limit 1;
      if v_alvo_papel is null
         or v_alvo_papel = 'owner'
         or exists (select 1 from public.empresas where id = p_empresa and owner_id = v_alvo_user) then
        raise exception 'Membro inválido para exceção' using errcode = '22023';
      end if;
      if not v_owner and (v_alvo_papel <> 'profissional' or v_alvo_user = auth.uid()) then
        raise exception 'A gestora só altera exceções de profissionais (e nunca as próprias)' using errcode = '42501';
      end if;
      select permitido into v_de from public.permissoes_membro
        where empresa_id = p_empresa and user_id = v_alvo_user and chave = v_chave;
      if not found then v_de := null; end if;
      if v_de is distinct from v_para then
        if v_para is null then
          delete from public.permissoes_membro
            where empresa_id = p_empresa and user_id = v_alvo_user and chave = v_chave;
        else
          insert into public.permissoes_membro (empresa_id, user_id, chave, permitido, alterado_por, alterado_em)
            values (p_empresa, v_alvo_user, v_chave, v_para, auth.uid(), now())
            on conflict (empresa_id, user_id, chave)
            do update set permitido = excluded.permitido, alterado_por = excluded.alterado_por, alterado_em = now();
        end if;
        insert into public.permissoes_historico (empresa_id, alterado_por, alvo_tipo, alvo, chave, de, para)
          values (p_empresa, auth.uid(), 'membro', v_alvo, v_chave, v_de, v_para);
      end if;

    else
      raise exception 'Tipo de mudança inválido: %', v_tipo using errcode = '22023';
    end if;
  end loop;
end;
$$;
grant execute on function public.salvar_permissoes(uuid, jsonb) to authenticated;

-- ── 5. Mudar papel de alguém: só a dona ───────────────────────
-- Sem isso, quem ganhasse "equipe.gerenciar" (UPDATE em empresa_membros) poderia se
-- promover a gestora. auth.uid() nulo = service role / SQL editor (rotas de API).

create or replace function public.fn_membros_papel_so_dona()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not exists (select 1 from public.empresas where id = old.empresa_id and owner_id = auth.uid()) then
    raise exception 'Só a dona pode mudar o papel de alguém' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_membros_papel_so_dona on public.empresa_membros;
create trigger trg_membros_papel_so_dona
  before update of role on public.empresa_membros
  for each row execute function public.fn_membros_papel_so_dona();

-- ── 6. Policies ───────────────────────────────────────────────

-- clientes (006 + 081)
alter table public.clientes add column if not exists criado_por uuid default auth.uid();
create index if not exists idx_agendamentos_cliente_profissional
  on public.agendamentos (cliente_id, profissional_id);

drop policy if exists "clientes: membro ve" on public.clientes;
create policy "clientes: membro ve" on public.clientes for select using (
  empresa_id in (select minha_empresas())
  and (
    tem_permissao(empresa_id, 'clientes.ver_todas')
    or criado_por = auth.uid()
    or exists (select 1 from public.agendamentos a
               where a.cliente_id = clientes.id and a.profissional_id = auth.uid())
  )
);
drop policy if exists "clientes: membro pode inserir" on public.clientes;
create policy "clientes: membro pode inserir" on public.clientes for insert
  with check (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'clientes.cadastrar'));
drop policy if exists "clientes: membro pode atualizar" on public.clientes;
create policy "clientes: membro pode atualizar" on public.clientes for update
  using (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'clientes.editar'))
  with check (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'clientes.editar'));
drop policy if exists "clientes: owner pode deletar" on public.clientes;
drop policy if exists "clientes: excluir" on public.clientes;
create policy "clientes: excluir" on public.clientes for delete
  using (tem_permissao(empresa_id, 'clientes.excluir'));

create or replace function public.fn_clientes_ativo_so_gestor()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.ativo is distinct from old.ativo
     and auth.uid() is not null
     and not tem_permissao(old.empresa_id, 'clientes.arquivar') then
    raise exception 'Sem permissão para arquivar ou reativar cliente' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- agendamentos (042 + 066 + 082)
drop policy if exists "agendamentos: ver" on public.agendamentos;
create policy "agendamentos: ver" on public.agendamentos for select using (
  profissional_id = auth.uid()
  or cliente_id = auth.uid()
  or (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'agenda.ver_equipe'))
);
drop policy if exists "agendamentos: equipe insere" on public.agendamentos;
create policy "agendamentos: equipe insere" on public.agendamentos for insert with check (
  empresa_id in (select minha_empresas())
  and (tem_permissao(empresa_id, 'agenda.gerenciar_outras') or profissional_id = auth.uid())
);
drop policy if exists "agendamentos: equipe atualiza" on public.agendamentos;
create policy "agendamentos: equipe atualiza" on public.agendamentos for update
  using (
    empresa_id in (select minha_empresas())
    and (tem_permissao(empresa_id, 'agenda.gerenciar_outras') or profissional_id = auth.uid())
  )
  with check (
    empresa_id in (select minha_empresas())
    and (tem_permissao(empresa_id, 'agenda.gerenciar_outras') or profissional_id = auth.uid())
  );
drop policy if exists "agendamentos: gestor ou owner exclui" on public.agendamentos;
create policy "agendamentos: gestor ou owner exclui" on public.agendamentos for delete
  using (tem_permissao(empresa_id, 'agenda.excluir'));

-- agenda_bloqueios (068, conforme produção)
drop policy if exists "bloqueios: aprovar" on public.agenda_bloqueios;
create policy "bloqueios: aprovar" on public.agenda_bloqueios for update
  using (tem_permissao(empresa_id, 'agenda.aprovar_bloqueios'))
  with check (tem_permissao(empresa_id, 'agenda.aprovar_bloqueios'));
drop policy if exists "bloqueios: criar" on public.agenda_bloqueios;
create policy "bloqueios: criar" on public.agenda_bloqueios for insert with check (
  empresa_id in (select minha_empresas())
  and (
    tem_permissao(empresa_id, 'agenda.aprovar_bloqueios')
    or (escopo = 'profissional' and profissional_id = auth.uid() and criado_por = auth.uid()
        and situacao = 'pendente' and motivo is not null)
  )
);
drop policy if exists "bloqueios: excluir" on public.agenda_bloqueios;
create policy "bloqueios: excluir" on public.agenda_bloqueios for delete using (
  tem_permissao(empresa_id, 'agenda.aprovar_bloqueios')
  or (criado_por = auth.uid() and situacao = 'pendente')
);
drop policy if exists "bloqueios: ver" on public.agenda_bloqueios;
create policy "bloqueios: ver" on public.agenda_bloqueios for select using (
  empresa_id in (select minha_empresas())
  and (situacao = 'aprovado' or criado_por = auth.uid() or tem_permissao(empresa_id, 'agenda.aprovar_bloqueios'))
);

-- anamnese_fichas (080)
drop policy if exists "anamnese: ver" on public.anamnese_fichas;
create policy "anamnese: ver" on public.anamnese_fichas for select
  using (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'anamnese.ver'));
drop policy if exists "anamnese: inserir" on public.anamnese_fichas;
create policy "anamnese: inserir" on public.anamnese_fichas for insert with check (
  empresa_id in (select minha_empresas())
  and tem_permissao(empresa_id, 'anamnese.editar')
  and cliente_id in (select id from public.clientes where empresa_id in (select minha_empresas()))
);
drop policy if exists "anamnese: atualizar" on public.anamnese_fichas;
create policy "anamnese: atualizar" on public.anamnese_fichas for update
  using (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'anamnese.editar'))
  with check (
    empresa_id in (select minha_empresas())
    and tem_permissao(empresa_id, 'anamnese.editar')
    and cliente_id in (select id from public.clientes where empresa_id in (select minha_empresas()))
  );

-- comandas (073): fechar = criar a comanda
drop policy if exists "comandas: membro insere" on public.comandas;
create policy "comandas: membro insere" on public.comandas for insert
  with check (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'comanda.fechar'));

-- servicos + categorias (078, 063)
drop policy if exists "servicos: gestor gerencia" on public.servicos;
create policy "servicos: gestor gerencia" on public.servicos for all
  using (tem_permissao(empresa_id, 'servicos.gerenciar'))
  with check (tem_permissao(empresa_id, 'servicos.gerenciar'));
drop policy if exists "categorias_servico: gestor insere" on public.categorias_servico;
create policy "categorias_servico: gestor insere" on public.categorias_servico for insert
  with check (tem_permissao(empresa_id, 'servicos.gerenciar'));
drop policy if exists "categorias_servico: gestor atualiza" on public.categorias_servico;
create policy "categorias_servico: gestor atualiza" on public.categorias_servico for update
  using (tem_permissao(empresa_id, 'servicos.gerenciar'))
  with check (tem_permissao(empresa_id, 'servicos.gerenciar'));
drop policy if exists "categorias_servico: gestor deleta" on public.categorias_servico;
create policy "categorias_servico: gestor deleta" on public.categorias_servico for delete
  using (tem_permissao(empresa_id, 'servicos.gerenciar'));

-- pacotes (078)
drop policy if exists "pacotes: gestor gerencia" on public.pacotes;
create policy "pacotes: gestor gerencia" on public.pacotes for all
  using (tem_permissao(empresa_id, 'pacotes.gerenciar'))
  with check (tem_permissao(empresa_id, 'pacotes.gerenciar'));
drop policy if exists "pacote_servicos: gestor gerencia" on public.pacote_servicos;
create policy "pacote_servicos: gestor gerencia" on public.pacote_servicos for all
  using (exists (select 1 from public.pacotes p
                 where p.id = pacote_servicos.pacote_id and tem_permissao(p.empresa_id, 'pacotes.gerenciar')))
  with check (exists (select 1 from public.pacotes p
                      where p.id = pacote_servicos.pacote_id and tem_permissao(p.empresa_id, 'pacotes.gerenciar')));

-- pacote_clientes: era "membro gerencia" FOR ALL; só a venda (INSERT) passa a depender da chave
drop policy if exists "pacote_clientes: membro gerencia" on public.pacote_clientes;
drop policy if exists "pacote_clientes: membro ve" on public.pacote_clientes;
create policy "pacote_clientes: membro ve" on public.pacote_clientes for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "pacote_clientes: vender" on public.pacote_clientes;
create policy "pacote_clientes: vender" on public.pacote_clientes for insert
  with check (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'pacotes.vender'));
drop policy if exists "pacote_clientes: membro atualiza" on public.pacote_clientes;
create policy "pacote_clientes: membro atualiza" on public.pacote_clientes for update
  using (empresa_id in (select minha_empresas()))
  with check (empresa_id in (select minha_empresas()));
drop policy if exists "pacote_clientes: membro exclui" on public.pacote_clientes;
create policy "pacote_clientes: membro exclui" on public.pacote_clientes for delete
  using (empresa_id in (select minha_empresas()));

-- despesas (042 + 003). DELETE continua só da dona (fora do catálogo).
drop policy if exists "despesas: gestor ou owner ve" on public.despesas;
create policy "despesas: gestor ou owner ve" on public.despesas for select
  using (tem_permissao(empresa_id, 'financeiro.ver'));
drop policy if exists "despesas: gestor pode inserir" on public.despesas;
create policy "despesas: gestor pode inserir" on public.despesas for insert
  with check (tem_permissao(empresa_id, 'despesas.gerenciar'));
drop policy if exists "despesas: gestor pode atualizar" on public.despesas;
create policy "despesas: gestor pode atualizar" on public.despesas for update
  using (tem_permissao(empresa_id, 'despesas.gerenciar'))
  with check (tem_permissao(empresa_id, 'despesas.gerenciar'));

-- taxas_reserva (054 + 058). SELECT também para quem gerencia agenda de outras: a comanda
-- lê as taxas pagas para descontar (bug de 2026-08-12 — sem leitura o desconto zera calado).
drop policy if exists "taxas_reserva: profissional ou gestor ve" on public.taxas_reserva;
create policy "taxas_reserva: profissional ou gestor ve" on public.taxas_reserva for select using (
  tem_permissao(empresa_id, 'financeiro.ver')
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras')
  or exists (select 1 from public.agendamentos a
             where a.id = taxas_reserva.agendamento_id and a.profissional_id = auth.uid())
);
drop policy if exists "taxas_reserva: gestor ou owner atualiza" on public.taxas_reserva;
create policy "taxas_reserva: gestor ou owner atualiza" on public.taxas_reserva for update
  using (tem_permissao(empresa_id, 'taxas.marcar_pagas'))
  with check (tem_permissao(empresa_id, 'taxas.marcar_pagas'));

-- taxas_cancelamento (047)
drop policy if exists "taxas_cancelamento: gestor ou owner ve" on public.taxas_cancelamento;
create policy "taxas_cancelamento: gestor ou owner ve" on public.taxas_cancelamento for select
  using (tem_permissao(empresa_id, 'financeiro.ver'));
drop policy if exists "taxas_cancelamento: gestor ou owner atualiza" on public.taxas_cancelamento;
create policy "taxas_cancelamento: gestor ou owner atualiza" on public.taxas_cancelamento for update
  using (tem_permissao(empresa_id, 'taxas.marcar_pagas'))
  with check (tem_permissao(empresa_id, 'taxas.marcar_pagas'));

-- financeiro_ajustes_mensais (040). DELETE continua só da dona.
drop policy if exists "financeiro_ajustes_mensais: gestor pode inserir" on public.financeiro_ajustes_mensais;
create policy "financeiro_ajustes_mensais: gestor pode inserir" on public.financeiro_ajustes_mensais for insert
  with check (tem_permissao(empresa_id, 'financeiro.fechamentos'));
drop policy if exists "financeiro_ajustes_mensais: gestor pode atualizar" on public.financeiro_ajustes_mensais;
create policy "financeiro_ajustes_mensais: gestor pode atualizar" on public.financeiro_ajustes_mensais for update
  using (tem_permissao(empresa_id, 'financeiro.fechamentos'))
  with check (tem_permissao(empresa_id, 'financeiro.fechamentos'));

-- empresa_membros (043, conforme produção)
drop policy if exists "membros: gestor ou owner atualiza" on public.empresa_membros;
create policy "membros: gestor ou owner atualiza" on public.empresa_membros for update
  using (tem_permissao(empresa_id, 'equipe.gerenciar'))
  with check (tem_permissao(empresa_id, 'equipe.gerenciar'));
drop policy if exists "membros: gestor ou owner convida" on public.empresa_membros;
create policy "membros: gestor ou owner convida" on public.empresa_membros for insert with check (
  role = any (array['gestor'::perfil_role, 'profissional'::perfil_role])
  and tem_permissao(empresa_id, 'equipe.gerenciar')
  and (role = 'profissional'::perfil_role
       or exists (select 1 from public.empresas
                  where empresas.id = empresa_membros.empresa_id and empresas.owner_id = auth.uid()))
);

-- comissoes (042)
drop policy if exists "comissoes: ver" on public.comissoes;
create policy "comissoes: ver" on public.comissoes for select
  using (profissional_id = auth.uid() or tem_permissao(empresa_id, 'comissoes.ver_todas'));
drop policy if exists "comissoes: gestor ou owner atualiza" on public.comissoes;
create policy "comissoes: gestor ou owner atualiza" on public.comissoes for update
  using (tem_permissao(empresa_id, 'comissoes.pagar'))
  with check (tem_permissao(empresa_id, 'comissoes.pagar'));

notify pgrst, 'reload schema';
```

> Nota para o teste "cada chave Banco aparece numa policy": `clientes.arquivar` aparece como `tem_permissao(old.empresa_id, ...)` (trigger) e `pacotes.gerenciar` também como `tem_permissao(p.empresa_id, ...)` — a regex aceita os três prefixos.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd web && npx vitest run tests/unit/permissoes-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Conferir de novo contra o CSV**

Para cada `drop policy if exists "<nome>"` da migration, confirmar no CSV `docs/superpowers/notes/2026-10-02-pg-policies-producao.csv` (ou em 080/081/082) que o nome existe e que, tirando o `is_gestor_ou_owner` → `tem_permissao`, a condição recriada é idêntica. Anotar no commit qualquer divergência encontrada.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/083_permissoes_configuraveis.sql web/tests/unit/permissoes-migration.test.ts docs/superpowers/notes/2026-10-02-pg-policies-producao.csv
git commit -m "feat(permissoes): migration 083 — tabelas, tem_permissao e policies por chave"
```

---

### Task 4: Shared de agenda/bloqueio deixam de olhar o papel

**Files:**
- Modify: `shared/agendamentos.ts:16-20`, `shared/bloqueios.ts:33-95`
- Modify (chamadas): `web/app/(app)/agenda/page.tsx`, `mobile/app/(empresa)/agendamento/[id].tsx`, `mobile/components/BloqueioModal.tsx`, `mobile/hooks/useAgenda.ts`, `mobile/hooks/useProfissional.ts`
- Test: `web/tests/unit/agendamentos-exclusao.test.ts`, `web/tests/unit/bloqueios.test.ts` (atualizar)

**Interfaces:**
- Produces:
  - `podeExcluirAgendamento(status: string, podeExcluir: boolean): boolean`
  - `podeSelecionarEscopoGeral(podeAprovarBloqueios: boolean): boolean`
  - `situacaoInicialBloqueio(podeAprovarBloqueios: boolean): SituacaoBloqueio`
  - `MontarInsertBloqueioInput` troca `role: string` por `podeAprovarBloqueios: boolean`

Nesta task, as chamadas passam o booleano **ainda derivado do papel** (`meuRole === 'owner' || meuRole === 'gestor'`), para o comportamento não mudar. As Tasks 6 e 8 trocam a origem pelo `pode(...)`.

- [ ] **Step 1: Atualizar os testes existentes**

Em `web/tests/unit/agendamentos-exclusao.test.ts` e `web/tests/unit/bloqueios.test.ts`, trocar cada chamada com papel pela versão booleana: `'owner'`/`'gestor'` → `true`, `'profissional'` → `false`. Exemplos:

```ts
expect(podeExcluirAgendamento('agendado', true)).toBe(true);
expect(podeExcluirAgendamento('agendado', false)).toBe(false);
expect(podeExcluirAgendamento('concluido', true)).toBe(false);
expect(situacaoInicialBloqueio(true)).toBe('aprovado');
expect(situacaoInicialBloqueio(false)).toBe('pendente');
expect(montarInsertBloqueio({ ...base, podeAprovarBloqueios: false, escopo: 'geral' }).escopo).toBe('profissional');
```

Run: `cd web && npx vitest run tests/unit/agendamentos-exclusao.test.ts tests/unit/bloqueios.test.ts`
Expected: FAIL (tipos/valores antigos).

- [ ] **Step 2: Implementar em `shared/`**

```ts
// shared/agendamentos.ts
/** Pode excluir quem tem a permissão `agenda.excluir`, nunca um atendimento concluído. */
export function podeExcluirAgendamento(status: string, podeExcluir: boolean): boolean {
  return podeExcluir && status !== 'concluido';
}
```
(Manter qualquer outra condição de status que a função já tenha hoje — ler o corpo atual e só trocar `ehGestao` por `podeExcluir`.)

```ts
// shared/bloqueios.ts — trocar as três funções
/** Escolher "Toda a agenda" exige `agenda.aprovar_bloqueios`. */
export function podeSelecionarEscopoGeral(podeAprovarBloqueios: boolean): boolean {
  return podeAprovarBloqueios;
}

/** Quem aprova bloqueios cria já aprovado; os demais criam pendente. */
export function situacaoInicialBloqueio(podeAprovarBloqueios: boolean): SituacaoBloqueio {
  return podeAprovarBloqueios ? 'aprovado' : 'pendente';
}
```
Em `MontarInsertBloqueioInput`, substituir `role: string;` por `/** Tem `agenda.aprovar_bloqueios` (dona sempre tem). */ podeAprovarBloqueios: boolean;` e, em `montarInsertBloqueio`, trocar `const ehGestao = input.role === 'owner' || input.role === 'gestor';` por `const ehGestao = input.podeAprovarBloqueios;` e `situacaoInicialBloqueio(input.role)` por `situacaoInicialBloqueio(input.podeAprovarBloqueios)`. Atualizar o comentário "Ignorado ... quando role = profissional" para "quando não pode aprovar bloqueios".

- [ ] **Step 3: Atualizar as chamadas (comportamento idêntico)**

Rodar `cd web && npx tsc --noEmit` e `cd mobile && npx tsc --noEmit`; corrigir cada erro novo passando `ehGestao` (ou `meuRole === 'owner' || meuRole === 'gestor'`) onde antes passava `meuRole`/`role`. Pontos conhecidos:
- `web/app/(app)/agenda/page.tsx`: linha ~318 `podeExcluirAgendamento(agEditar.status, meuRole)`; ~1236 `podeSelecionarEscopoGeral(meuRole)`; ~1262 `role: meuRole` no `montarInsertBloqueio`.
- `mobile/app/(empresa)/agendamento/[id].tsx` ~444 e uso de `podeExcluirAgendamento`.
- `mobile/components/BloqueioModal.tsx`, `mobile/hooks/useAgenda.ts` ~249, `mobile/hooks/useProfissional.ts` (onde montam o insert de bloqueio).

- [ ] **Step 4: Verificar**

Run: `cd web && npx tsc --noEmit && npx vitest run` e `cd mobile && npx tsc --noEmit`
Expected: web zerado e verde; mobile com os mesmos 6 erros da baseline.

- [ ] **Step 5: Commit**

```bash
git add shared/agendamentos.ts shared/bloqueios.ts web/tests/unit "web/app/(app)/agenda/page.tsx" "mobile/app/(empresa)/agendamento/[id].tsx" mobile/components/BloqueioModal.tsx mobile/hooks/useAgenda.ts mobile/hooks/useProfissional.ts
git commit -m "refactor(agenda): regras de exclusao e bloqueio recebem permissao em vez de papel"
```

---

### Task 5: Web — contexto, provider, rotas, Sidebar e APIs

**Files:**
- Modify: `web/lib/permissions.ts` (reescrever), `web/lib/auth/requireRole.ts`, `web/lib/auth/server-context.ts`, `web/components/AppLayout.tsx`, `web/components/Sidebar.tsx`
- Create: `web/components/PermissoesProvider.tsx`
- Modify layouts: `web/app/(app)/{comissoes,configuracoes,dashboard,equipe,estoque,financeiro,relatorios,servicos,vendas}/layout.tsx`, `web/app/(app)/dashboard/page.tsx`, `web/app/(app)/comissoes/page.tsx`
- Modify APIs: `web/app/api/convites/route.ts`, `web/app/api/profissionais/route.ts`
- Test: `web/tests/unit/permissions.test.ts` (reescrever), `web/tests/unit/permissoes-web-rotas.test.ts` (novo)

**Interfaces:**
- Consumes: `pode`, `PermissoesUsuario`, `Acesso` (Task 1); `carregarMinhasPermissoes`, `papelDeRole`, `carregarPermissoesDoMembro` (Task 2).
- Produces:
  - `web/lib/permissions.ts`: re-exporta `pode`, `type Acesso`, `type PermissoesUsuario`; mantém `rotaInicial(role)` e `podeAtribuirRole(...)` como estão. **Remove** `temPermissao` e `type Permissao`.
  - `web/lib/auth/requireRole.ts`: `exigirAcesso(permissoes: PermissoesUsuario, acesso: Acesso): void` (redirect para `/dashboard`).
  - `AppContext` ganha `isOwner: boolean` e `permissoes: PermissoesUsuario`.
  - `web/components/PermissoesProvider.tsx`: `PermissoesProvider({ value, children })`, `usePermissoes(): PermissoesUsuario & { pode(a: Acesso): boolean }`.
  - `Sidebar` recebe `permissoes: PermissoesUsuario` no lugar de `role`.

- [ ] **Step 1: Testes que falham**

```ts
// web/tests/unit/permissions.test.ts  (substitui o conteúdo atual)
import { describe, expect, it } from 'vitest';
import { pode, rotaInicial, podeAtribuirRole } from '@/lib/permissions';

describe('web/lib/permissions', () => {
  it('reexporta pode', () => {
    expect(pode({ isOwner: false, papel: 'profissional', chaves: ['agenda.excluir'] }, 'agenda.excluir')).toBe(true);
  });
  it('rotaInicial e podeAtribuirRole seguem iguais', () => {
    expect(rotaInicial('profissional')).toBe('/dashboard');
    expect(podeAtribuirRole('gestor', 'gestor')).toBe(false);
    expect(podeAtribuirRole('owner', 'gestor')).toBe(true);
  });
});
```

```ts
// web/tests/unit/permissoes-web-rotas.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const web = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(web, p), 'utf8');

describe('rotas do web usam chaves do catálogo', () => {
  const guardas: [string, string][] = [
    ['app/(app)/equipe/layout.tsx', 'equipe.gerenciar'],
    ['app/(app)/estoque/layout.tsx', 'estoque.acessar'],
    ['app/(app)/financeiro/layout.tsx', 'financeiro.ver'],
    ['app/(app)/relatorios/layout.tsx', 'financeiro.ver'],
    ['app/(app)/vendas/layout.tsx', 'vendas.acessar'],
  ];
  for (const [arq, chave] of guardas) {
    it(`${arq} exige ${chave}`, () => expect(ler(arq)).toContain(`exigirAcesso(permissoes, '${chave}')`));
  }
  for (const arq of ['app/(app)/configuracoes/layout.tsx', 'app/(app)/servicos/layout.tsx', 'app/(app)/comissoes/layout.tsx', 'app/(app)/dashboard/layout.tsx']) {
    it(`${arq} liberado para todos`, () => expect(ler(arq)).not.toMatch(/exigir(Acesso|Permissao)\(/));
  }
  it('ninguém mais usa temPermissao', () => {
    for (const arq of ['components/Sidebar.tsx', 'app/(app)/dashboard/page.tsx', 'app/(app)/pacotes/page.tsx', 'app/(app)/servicos/page.tsx', 'app/(app)/notificacoes/page.tsx']) {
      expect(ler(arq)).not.toContain('temPermissao');
    }
  });
  it('APIs de equipe checam equipe.gerenciar', () => {
    for (const arq of ['app/api/convites/route.ts', 'app/api/profissionais/route.ts']) {
      const src = ler(arq);
      expect(src).toContain('carregarPermissoesDoMembro(');
      expect(src).toContain("'equipe.gerenciar'");
    }
  });
});
```

Run: `cd web && npx vitest run tests/unit/permissions.test.ts tests/unit/permissoes-web-rotas.test.ts`
Expected: FAIL.

- [ ] **Step 2: `web/lib/permissions.ts` e `requireRole.ts`**

```ts
// web/lib/permissions.ts
import type { PerfilRole } from '@/types';
export { pode } from '@shared/permissoes';
export type { Acesso, PermissoesUsuario, ChavePermissao } from '@shared/permissoes';

export function rotaInicial(role: PerfilRole | 'owner'): string {
  switch (role) {
    case 'owner':
    case 'gestor':
    case 'profissional': return '/dashboard';
    default:            return '/login';
  }
}

/** Mudar/atribuir papel é fixo (fora do catálogo): gestora só convida profissional. */
export function podeAtribuirRole(
  quemConvida: 'owner' | PerfilRole,
  roleAlvo: 'gestor' | 'profissional',
): boolean {
  if (roleAlvo === 'gestor') return quemConvida === 'owner';
  return quemConvida === 'owner' || quemConvida === 'gestor';
}
```

```ts
// web/lib/auth/requireRole.ts
import { redirect } from 'next/navigation';
import { pode, type Acesso, type PermissoesUsuario } from '@/lib/permissions';

/** Redireciona para o Dashboard (liberado a todos) quando a pessoa não tem o acesso. */
export function exigirAcesso(permissoes: PermissoesUsuario, acesso: Acesso): void {
  if (!pode(permissoes, acesso)) redirect('/dashboard');
}
```

- [ ] **Step 3: `server-context.ts`**

Dentro de `getAppContext`, depois de obter `membro` e `empresa`, antes do `return`:

```ts
    const isOwner = membro.role === 'owner';
    const permissoes = await carregarMinhasPermissoes(supabase, membro.empresa_id, isOwner, papelDeRole(membro.role));
```
e incluir `isOwner, permissoes` no objeto retornado; no tipo `AppContext` acrescentar `isOwner: boolean; permissoes: PermissoesUsuario;`. Imports: `import { carregarMinhasPermissoes, papelDeRole } from '@shared/permissoes-consultas';` e `import type { PermissoesUsuario } from '@shared/permissoes';`.

- [ ] **Step 4: Provider e AppLayout**

```tsx
// web/components/PermissoesProvider.tsx
'use client';
import { createContext, useContext, useMemo } from 'react';
import { pode, type Acesso, type PermissoesUsuario } from '@shared/permissoes';

const Ctx = createContext<PermissoesUsuario>({ isOwner: false, papel: null, chaves: [] });

/** Disponibiliza para componentes client as permissões lidas no servidor (getAppContext). */
export function PermissoesProvider({ value, children }: { value: PermissoesUsuario; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** `const { pode } = usePermissoes(); if (pode('clientes.arquivar')) ...` */
export function usePermissoes() {
  const p = useContext(Ctx);
  return useMemo(() => ({ ...p, pode: (a: Acesso) => pode(p, a) }), [p]);
}
```

Em `web/components/AppLayout.tsx`: desestruturar `permissoes` de `getAppContext()`, trocar `role={role}` por `permissoes={permissoes}` na `Sidebar` e envolver `<PrivacyProvider>{children}</PrivacyProvider>` com `<PermissoesProvider value={permissoes}>…</PermissoesProvider>`.

- [ ] **Step 5: Sidebar**

Em `web/components/Sidebar.tsx`: trocar imports para `import { pode, type Acesso, type PermissoesUsuario } from '@/lib/permissions';` (remover `PerfilRole`), trocar `permissao?: Permissao` por `permissao?: Acesso` nos 4 arrays e os valores:
- `/vendas` → `'vendas.acessar'`; `/financeiro` e `/relatorios` → `'financeiro.ver'`; `/equipe` → `'equipe.gerenciar'`; `/estoque` → `'estoque.acessar'`;
- `/servicos`, `/comissoes`, `/configuracoes`: **remover** o campo `permissao` (liberado a todos).
- Prop `role: string | null` → `permissoes: PermissoesUsuario`; `efetivo` sai; `podeVerEstoque = pode(permissoes, 'estoque.acessar')`; filtros: `item => !item.permissao || pode(permissoes, item.permissao)`.

- [ ] **Step 6: Layouts e páginas server**

```tsx
// padrão para equipe, estoque, financeiro, relatorios, vendas (troque a chave)
import { getAppContext } from '@/lib/auth/server-context';
import { exigirAcesso } from '@/lib/auth/requireRole';

export default async function EquipeLayout({ children }: { children: React.ReactNode }) {
  const { permissoes } = await getAppContext();
  exigirAcesso(permissoes, 'equipe.gerenciar');
  return <>{children}</>;
}
```
Chaves: equipe → `'equipe.gerenciar'`, estoque → `'estoque.acessar'`, financeiro e relatorios → `'financeiro.ver'`, vendas → `'vendas.acessar'`. Manter o nome da função de layout de cada arquivo.

`configuracoes/layout.tsx`, `servicos/layout.tsx`, `comissoes/layout.tsx`, `dashboard/layout.tsx`: liberados — corpo vira só `return <>{children}</>;` (remover imports não usados).

`dashboard/page.tsx`: trocar `temPermissao(efetivo, 'ver_resumo_financeiro')` por `pode(permissoes, 'financeiro.ver')` e `temPermissao(efetivo, 'fechar_comanda')` por `pode(permissoes, 'comanda.fechar')`, pegando `permissoes` de `getAppContext()` (remover `efetivo` se ficar sem uso).

`comissoes/page.tsx`:
```tsx
export default async function ComissoesPage() {
  const { permissoes } = await getAppContext();
  return pode(permissoes, 'comissoes.ver_todas') ? <ComissoesGestorView /> : <ComissoesProfissionalView />;
}
```

- [ ] **Step 7: APIs de equipe**

Em `web/app/api/convites/route.ts` e `web/app/api/profissionais/route.ts`, logo depois do `if (!membroReq) return ... 403` e antes do `podeAtribuirRole`:

```ts
    const permsReq = await carregarPermissoesDoMembro(adminClient, empresaId, requesterId);
    if (!permsReq || !pode(permsReq, 'equipe.gerenciar')) {
      return NextResponse.json({ error: 'Você não tem permissão para gerenciar a equipe.' }, { status: 403 });
    }
```
Imports: `import { carregarPermissoesDoMembro } from '@shared/permissoes-consultas';` e `pode` de `@/lib/permissions`. (Em `profissionais/route.ts`, usar os nomes de variáveis que o arquivo já usa para o client admin, a empresa e o solicitante — conferir lendo o arquivo; o padrão é o mesmo de `convites`.) Se a rota tiver outro método (PATCH/DELETE) que altera membro, aplicar a mesma checagem.

- [ ] **Step 8: Verificar**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tsc zerado (os demais usos de `temPermissao` — notificacoes, pacotes, servicos — quebram aqui: trocar já, como no Step 9).

- [ ] **Step 9: Páginas client que usavam `temPermissao`**

- `web/app/(app)/notificacoes/page.tsx` ~107: `const podeVerEstoque = temPermissao(...)` → usar `const { pode } = usePermissoes();` no topo do componente e `pode('estoque.acessar')`.
- `web/app/(app)/pacotes/page.tsx` ~740: `podeGerenciarCatalogo = pode('pacotes.gerenciar')` via `usePermissoes()`.
- `web/app/(app)/servicos/page.tsx` ~587: `podeGerenciar = pode('servicos.gerenciar')` via `usePermissoes()`.
Remover as consultas de `role` que existiam só para isso.

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tudo verde.

- [ ] **Step 10: Commit**

```bash
git add web
git commit -m "feat(permissoes/web): contexto com permissoes efetivas, rotas, sidebar e APIs por chave"
```

---

### Task 6: Web — botões por chave

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`, `web/app/(app)/clientes/page.tsx`, `web/app/(app)/clientes/[id]/page.tsx`, `web/app/(app)/comanda/page.tsx`, `web/app/(app)/pacotes/page.tsx`, `web/app/(app)/financeiro/page.tsx`, `web/app/(app)/equipe/page.tsx`, `web/app/(app)/configuracoes/page.tsx`
- Test: `web/tests/unit/permissoes-web-botoes.test.ts`

**Interfaces:**
- Consumes: `usePermissoes()` (Task 5); funções de shared com booleano (Task 4).

Tabela de ligação (cada linha: onde → condição nova). "Esconder" = não renderizar o botão/campo.

| Arquivo | Ponto | Condição |
|---|---|---|
| agenda/page.tsx | `ehGestao` (~2020) e `souGestao` (~2046) — lista de profissionais/grade de equipe | `pode('agenda.ver_equipe')` (no `useEffect`, usar o valor do hook; `pode` vem do contexto, já está pronto no 1º render) |
| agenda/page.tsx | escolher profissional ≠ eu no modal de agendamento | `pode('agenda.gerenciar_outras')`; sem ela, o seletor de profissional fica travado em mim |
| agenda/page.tsx | `podeExcluirAgendamento(..., X)` (~318) e aviso ~1123 `meuRole !== 'profissional'` | `X = pode('agenda.excluir')`; aviso só se `pode('agenda.excluir')` |
| agenda/page.tsx | `podeSelecionarEscopoGeral(X)` (~1236), `montarInsertBloqueio({ podeAprovarBloqueios: X })` (~1262), filtro/remover bloqueio (~1698, ~1705), lista de pendentes | `X = pode('agenda.aprovar_bloqueios')` |
| agenda/page.tsx | "Nova cliente" no modal (`salvarNovoCliente`) | esconder sem `pode('clientes.cadastrar')` |
| agenda/page.tsx | vender pacote no agendamento (`pacoteVenderId`) | esconder sem `pode('pacotes.vender')` |
| clientes/page.tsx | botão "Novo cliente" | `pode('clientes.cadastrar')` |
| clientes/[id]/page.tsx | editar dados (botão que abre `editInfo`) | `pode('clientes.editar')` |
| clientes/[id]/page.tsx | botão lixeira (`desativar`, ~941) | só se `pode('clientes.arquivar') \|\| pode('clientes.excluir')`; no modal, opção Arquivar ↔ `clientes.arquivar`, Excluir permanentemente ↔ `clientes.excluir` |
| clientes/[id]/page.tsx | aba Anamnese | aba some sem `pode('anamnese.ver')`; editar ficha ↔ `pode('anamnese.editar')` |
| clientes/[id]/page.tsx | vender pacote / novo agendamento do perfil | vender ↔ `pacotes.vender` |
| comanda/page.tsx | input `descontoPct` (~1530) e método `cortesia` (`METODOS`, ~111) | sem `pode('comanda.desconto')`: esconder o campo e filtrar `cortesia` da lista |
| comanda/page.tsx | `jaFeita ? abrirComandaFechada(cliente) : abrirComanda(cliente)` (~1156) | comanda já feita só abre se `pode('comanda.editar_fechada')`; senão o card mostra "Comanda fechada" sem ação |
| comanda/page.tsx | fechar (`abrirComanda`) | sem `pode('comanda.fechar')`: botão desabilitado com título "Sem permissão para fechar comanda" |
| pacotes/page.tsx | botão "Vender" | `pode('pacotes.vender')` |
| financeiro/page.tsx | nova/editar/marcar paga despesa | `pode('despesas.gerenciar')` |
| financeiro/page.tsx | "marcar como paga" de taxas de reserva/cancelamento | `pode('taxas.marcar_pagas')` |
| financeiro/page.tsx | importar fechamento mensal | `pode('financeiro.fechamentos')` |
| financeiro/page.tsx | `isOwner` (~1006) — retiradas | `pode('dona')` (substitui a consulta de owner) |
| equipe/page.tsx | `meuRole` só para promover/convidar gestora | manter (fixo); badge de exceções vem na Task 7 |
| configuracoes/page.tsx | `podeEditarTaxa` (~311) | `pode('config.taxas')`; `isOwner` → `pode('dona')` |

- [ ] **Step 1: Teste que falha (varredura de código)**

```ts
// web/tests/unit/permissoes-web-botoes.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const app = join(__dirname, '..', '..', 'app', '(app)');
const ler = (p: string) => readFileSync(join(app, p), 'utf8');

const esperado: [string, string[]][] = [
  ['agenda/page.tsx', ['agenda.ver_equipe', 'agenda.gerenciar_outras', 'agenda.excluir', 'agenda.aprovar_bloqueios', 'clientes.cadastrar', 'pacotes.vender']],
  ['clientes/page.tsx', ['clientes.cadastrar']],
  ['clientes/[id]/page.tsx', ['clientes.editar', 'clientes.arquivar', 'clientes.excluir', 'anamnese.ver', 'anamnese.editar', 'pacotes.vender']],
  ['comanda/page.tsx', ['comanda.desconto', 'comanda.editar_fechada', 'comanda.fechar']],
  ['pacotes/page.tsx', ['pacotes.gerenciar', 'pacotes.vender']],
  ['financeiro/page.tsx', ['despesas.gerenciar', 'taxas.marcar_pagas', 'financeiro.fechamentos']],
  ['configuracoes/page.tsx', ['config.taxas']],
];

describe('botões do web consultam a chave certa', () => {
  for (const [arq, chaves] of esperado) {
    for (const c of chaves) it(`${arq} usa ${c}`, () => expect(ler(arq)).toContain(`pode('${c}')`));
  }
  it('agenda não decide mais pelo papel', () => {
    const src = ler('agenda/page.tsx');
    expect(src).not.toMatch(/meuRole === 'owner' \|\| meuRole === 'gestor'/);
    expect(src).not.toMatch(/membro\.role === 'owner' \|\| membro\.role === 'gestor'/);
  });
});
```

Run: `cd web && npx vitest run tests/unit/permissoes-web-botoes.test.ts` → FAIL.

- [ ] **Step 2: Aplicar a tabela, arquivo por arquivo**

Em cada componente client: `import { usePermissoes } from '@/components/PermissoesProvider';` e `const { pode } = usePermissoes();` no topo do componente que renderiza o ponto (sub-componentes como `NovoAgendamentoModal`/`NovoBloqueioModal` chamam o hook eles mesmos — não passar por prop). Onde `meuRole` deixar de ter uso, remover o estado e a consulta de `role` (manter a de `empresa_id`/`user.id`).

- [ ] **Step 3: Verificar**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tudo verde (inclusive os testes antigos de agenda/bloqueio — se algum lia `meuRole` como texto, atualizar a asserção para a chave nova, sem afrouxar o que ela protege).

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "feat(permissoes/web): botoes de agenda, clientes, comanda, pacotes, financeiro e config por chave"
```

---

### Task 7: Web — Configurações em 3 abas, painel de Permissões e selo na Equipe

**Files:**
- Create: `web/components/permissoes/PermissoesPanel.tsx`
- Modify: `web/app/(app)/configuracoes/page.tsx` (abas), `web/app/(app)/equipe/page.tsx` (selo)
- Test: `web/tests/unit/permissoes-painel-web.test.ts`

**Interfaces:**
- Consumes: Task 1 (`CATALOGO_PERMISSOES`, `GRUPOS_PERMISSAO`, `valorDoPapel`, `estadoDoMembro`, `contarExcecoes`, `aplicarMudancas`, `chaveMudanca`, `podeEditarAlvo`, `descreverHistorico`), Task 2 (`carregarConfigPermissoes`, `salvarPermissoes`, `carregarHistoricoPermissoes`), Task 5 (`usePermissoes`), `mensagemErroBanco` (`@shared/erros`), `SmoothTabs`, `SearchSelect`, `Sk*` de `@/components/Skeleton`.
- Produces: `<PermissoesPanel empresaId={string} meuUserId={string} membroInicial?: string />`.

- [ ] **Step 1: Teste que falha**

```ts
// web/tests/unit/permissoes-painel-web.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const web = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(web, p), 'utf8');

describe('Configurações → Permissões (web)', () => {
  const cfg = ler('app/(app)/configuracoes/page.tsx');
  const painel = ler('components/permissoes/PermissoesPanel.tsx');

  it('três abas: Empresa (dona ou config.taxas), Permissões (dona/gestora), Meu perfil (todos)', () => {
    expect(cfg).toContain("{ key: 'permissoes', label: 'Permissões' }");
    expect(cfg).toContain("{ key: 'perfil', label: 'Meu perfil' }");
    expect(cfg).toMatch(/pode\('dona'\) \|\| pode\('config\.taxas'\)/);
    expect(cfg).toContain('<PermissoesPanel');
  });

  it('painel tem as 3 sub-abas, salva via salvarPermissoes e mostra histórico', () => {
    expect(painel).toContain("'Por papel'");
    expect(painel).toContain("'Por pessoa'");
    expect(painel).toContain("'Histórico'");
    expect(painel).toContain('salvarPermissoes(');
    expect(painel).toContain('carregarHistoricoPermissoes(');
    expect(painel).toContain('descreverHistorico(');
    expect(painel).toContain('podeEditarAlvo(');
    expect(painel).toContain('mensagemErroBanco(');
    expect(painel).toMatch(/alterações? não salvas?/);
  });

  it('Equipe mostra selo de exceções com atalho para Configurações', () => {
    const eq = ler('app/(app)/equipe/page.tsx');
    expect(eq).toContain('contarExcecoes(');
    expect(eq).toContain('/configuracoes?aba=permissoes&membro=');
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implementar o painel**

```tsx
// web/components/permissoes/PermissoesPanel.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, History, Shield, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { SmoothTabs } from '@/components/SmoothTabs';
import { SearchSelect } from '@/components/SearchSelect';
import { SkCardList } from '@/components/Skeleton';
import { usePermissoes } from '@/components/PermissoesProvider';
import {
  CATALOGO_PERMISSOES, GRUPOS_PERMISSAO, aplicarMudancas, chaveMudanca, configVazia, contarExcecoes,
  descreverHistorico, estadoDoMembro, podeEditarAlvo, valorDoPapel,
  type ChavePermissao, type ConfigPermissoes, type EstadoExcecao, type LinhaHistorico,
  type MudancaPermissao, type Papel,
} from '@shared/permissoes';
import { carregarConfigPermissoes, carregarHistoricoPermissoes, salvarPermissoes } from '@shared/permissoes-consultas';
import { mensagemErroBanco } from '@shared/erros';

const supabase = createClient();

type Membro = { user_id: string; nome: string; role: 'owner' | 'gestor' | 'profissional' };
type SubAba = 'papel' | 'pessoa' | 'historico';

const ROTULO_ESTADO: Record<EstadoExcecao, string> = { padrao: 'Padrão', permitir: 'Permitir', bloquear: 'Bloquear' };

/** Liga/desliga no mesmo visual do ToggleLinha de Configurações. */
function Switch({ ligado, disabled, onChange, rotulo }: { ligado: boolean; disabled?: boolean; onChange: (v: boolean) => void; rotulo: string }) {
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} disabled={disabled}
      onClick={() => onChange(!ligado)}
      className={`relative w-10 h-5 rounded-full transition flex-shrink-0 ${ligado ? 'bg-primary' : 'bg-border'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${ligado ? 'left-[22px]' : 'left-0.5'}`}/>
    </button>
  );
}

/**
 * Aba Permissões de Configurações. Dona edita tudo; gestora só o papel Profissional e
 * exceções de profissionais (nunca as próprias). Alterações ficam num rascunho até "Salvar",
 * que chama a RPC salvar_permissoes (valida no banco e grava o histórico).
 */
export function PermissoesPanel({ empresaId, meuUserId, membroInicial }: { empresaId: string; meuUserId: string; membroInicial?: string }) {
  const { isOwner, papel } = usePermissoes();
  const editor = { isOwner, papel, userId: meuUserId };

  const [sub, setSub] = useState<SubAba>(membroInicial ? 'pessoa' : 'papel');
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState<ConfigPermissoes>(configVazia());
  const [membros, setMembros] = useState<Membro[]>([]);
  const [historico, setHistorico] = useState<LinhaHistorico[]>([]);
  const [rascunho, setRascunho] = useState<Record<string, MudancaPermissao>>({});
  const [membroSel, setMembroSel] = useState(membroInicial ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [toast, setToast] = useState('');

  async function carregar() {
    setLoading(true); setErro('');
    try {
      const [c, h, rM] = await Promise.all([
        carregarConfigPermissoes(supabase, empresaId),
        carregarHistoricoPermissoes(supabase, empresaId),
        supabase.from('empresa_membros').select('user_id, role, user:users(nome)')
          .eq('empresa_id', empresaId).in('role', ['owner', 'gestor', 'profissional']),
      ]);
      if (rM.error) throw new Error(rM.error.message);
      setCfg(c); setHistorico(h);
      setMembros(((rM.data ?? []) as { user_id: string; role: Membro['role']; user: { nome: string } | null }[])
        .map(m => ({ user_id: m.user_id, role: m.role, nome: m.user?.nome ?? 'Sem nome' }))
        .sort((a, b) => a.nome.localeCompare(b.nome)));
    } catch (e) {
      setErro(`Não foi possível carregar as permissões: ${(e as Error).message}`);
    }
    setLoading(false);
  }

  useEffect(() => { if (empresaId) carregar(); }, [empresaId]);

  const mudancas = useMemo(() => Object.values(rascunho), [rascunho]);
  const visivel = useMemo(() => aplicarMudancas(cfg, mudancas), [cfg, mudancas]);
  const nomes = useMemo(() => Object.fromEntries(membros.map(m => [m.user_id, m.nome])), [membros]);
  const membrosEditaveis = membros.filter(m => podeEditarAlvo(editor, { tipo: 'membro', userId: m.user_id, papel: m.role }));
  const membroAtual = membros.find(m => m.user_id === membroSel);

  function mudar(m: MudancaPermissao) {
    setRascunho(prev => {
      const k = chaveMudanca(m);
      // Voltar ao valor gravado remove a mudança do rascunho (não conta como "não salva").
      const igualAoGravado = m.tipo === 'papel'
        ? valorDoPapel(cfg, m.alvo, m.chave) === m.permitido
        : (cfg.membros[m.alvo]?.[m.chave] ?? null) === m.permitido;
      const prox = { ...prev };
      if (igualAoGravado) delete prox[k]; else prox[k] = m;
      return prox;
    });
  }

  async function salvar() {
    setSalvando(true); setErro('');
    const { error } = await salvarPermissoes(supabase, empresaId, mudancas);
    setSalvando(false);
    if (error) { setErro(mensagemErroBanco(error, 'alterar estas permissões')); return; }
    setRascunho({});
    setToast('Permissões salvas'); setTimeout(() => setToast(''), 3000);
    await carregar();
  }

  if (loading) return <SkCardList count={4}/>;

  return (
    <div className="max-w-3xl flex flex-col gap-5">
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-green text-white px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm">
          <Check size={16} strokeWidth={2.5}/> {toast}
        </div>
      )}

      <SmoothTabs
        tabs={[{ key: 'papel', label: 'Por papel' }, { key: 'pessoa', label: 'Por pessoa' }, { key: 'historico', label: 'Histórico' }]}
        active={sub}
        onChange={k => setSub(k as SubAba)}
      />

      {erro && <p className="text-sm text-rose bg-rose-soft rounded-xl px-4 py-3">{erro}</p>}

      {sub === 'papel' && (
        <div className="flex flex-col gap-4">
          {!isOwner && (
            <p className="text-xs text-text-3">Como gestora, você altera só o papel Profissional. A coluna Gestora é somente leitura.</p>
          )}
          {GRUPOS_PERMISSAO.map(grupo => (
            <section key={grupo} className="bg-surface border border-border rounded-2xl overflow-hidden">
              <header className="flex items-center px-4 py-2.5 bg-bg2 text-[11px] font-bold uppercase tracking-wide text-text-3">
                <span className="flex-1">{grupo}</span>
                <span className="w-20 text-center">Gestora</span>
                <span className="w-20 text-center">Profissional</span>
              </header>
              {CATALOGO_PERMISSOES.filter(p => p.grupo === grupo).map(p => (
                <div key={p.chave} className="flex items-center gap-2 px-4 py-3 border-t border-border">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text">{p.rotulo}</p>
                    {p.descricao && <p className="text-[11.5px] text-text-3">{p.descricao}</p>}
                  </div>
                  {(['gestor', 'profissional'] as Papel[]).map(pp => (
                    <div key={pp} className="w-20 flex justify-center">
                      <Switch rotulo={`${p.rotulo} — ${pp === 'gestor' ? 'Gestora' : 'Profissional'}`}
                        ligado={valorDoPapel(visivel, pp, p.chave)}
                        disabled={!podeEditarAlvo(editor, { tipo: 'papel', papel: pp })}
                        onChange={v => mudar({ tipo: 'papel', alvo: pp, chave: p.chave, permitido: v })}/>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {sub === 'pessoa' && (
        <div className="flex flex-col gap-4">
          <SearchSelect
            options={membrosEditaveis.map(m => {
              const n = contarExcecoes(visivel, m.user_id);
              return { value: m.user_id, label: m.nome, sub: `${m.role === 'gestor' ? 'Gestora' : 'Profissional'}${n ? ` · ${n} ${n === 1 ? 'exceção' : 'exceções'}` : ''}` };
            })}
            value={membroSel}
            onChange={setMembroSel}
            placeholder="Escolha alguém da equipe..."
          />
          {membrosEditaveis.length === 0 && (
            <p className="text-sm text-text-3">Ninguém da equipe que você possa ajustar individualmente.</p>
          )}
          {membroAtual && membroAtual.role !== 'owner' && GRUPOS_PERMISSAO.map(grupo => (
            <section key={grupo} className="bg-surface border border-border rounded-2xl overflow-hidden">
              <header className="px-4 py-2.5 bg-bg2 text-[11px] font-bold uppercase tracking-wide text-text-3">{grupo}</header>
              {CATALOGO_PERMISSOES.filter(p => p.grupo === grupo).map(p => {
                const papelAlvo = membroAtual.role as Papel;
                const estado = estadoDoMembro(visivel, membroAtual.user_id, p.chave as ChavePermissao);
                const padrao = valorDoPapel(visivel, papelAlvo, p.chave);
                return (
                  <div key={p.chave} className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-border">
                    <p className="flex-1 min-w-[180px] text-[13px] font-semibold text-text">{p.rotulo}</p>
                    <div className="flex gap-1">
                      {(['padrao', 'permitir', 'bloquear'] as EstadoExcecao[]).map(e => (
                        <button key={e} type="button"
                          onClick={() => mudar({ tipo: 'membro', alvo: membroAtual.user_id, chave: p.chave, permitido: e === 'padrao' ? null : e === 'permitir' })}
                          className={`press px-2.5 py-1 rounded-full text-[11.5px] font-semibold border transition ${estado === e ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text-2'}`}>
                          {e === 'padrao' ? `${ROTULO_ESTADO[e]} (${padrao ? '✔' : '✘'})` : ROTULO_ESTADO[e]}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
          {!membroAtual && membrosEditaveis.length > 0 && (
            <p className="flex items-center gap-2 text-sm text-text-3"><User size={14}/> Escolha uma pessoa para ver e ajustar as exceções dela.</p>
          )}
        </div>
      )}

      {sub === 'historico' && (
        <div className="bg-surface border border-border rounded-2xl">
          {historico.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-text-3"><History size={14}/> Nenhuma alteração registrada ainda.</p>
          ) : historico.map(l => (
            <p key={l.id} className="px-4 py-2.5 border-t first:border-t-0 border-border text-[12.5px] text-text-2">
              {descreverHistorico(l, nomes)}
            </p>
          ))}
        </div>
      )}

      {mudancas.length > 0 && (
        <div className="sticky bottom-[calc(var(--bm-mobile-content-bottom)+8px)] lg:bottom-4 z-30 flex flex-wrap items-center gap-3 bg-ink text-white rounded-2xl px-4 py-3 shadow-lg">
          <Shield size={16}/>
          <span className="flex-1 text-sm font-semibold">
            {mudancas.length} {mudancas.length === 1 ? 'alteração não salva' : 'alterações não salvas'}
          </span>
          <button type="button" onClick={() => setRascunho({})} className="press text-sm font-semibold opacity-80">Descartar</button>
          <button type="button" onClick={salvar} disabled={salvando}
            className="press bg-primary text-white text-sm font-semibold px-4 py-1.5 rounded-xl disabled:opacity-60">
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  );
}
```

> Classes de cor: usar as que já existem no projeto (`bg-primary`, `bg-border`, `text-text-2`, `bg-bg2` etc. — confira em `web/app/globals.css`/tema). Se alguma classe acima não existir (`bg-ink`, `text-rose`, `bg-rose-soft`), troque pela equivalente já usada em `configuracoes/page.tsx` ou por `style={{ background: 'var(--color-...)' }}` como o resto da página faz.

- [ ] **Step 3: Abas em Configurações**

Em `web/app/(app)/configuracoes/page.tsx`:
- `const { pode } = usePermissoes();`
- `aba` passa a `'empresa' | 'permissoes' | 'perfil'`; valor inicial lido de `useSearchParams().get('aba')` (se válido e permitido), senão `pode('dona') || pode('config.taxas') ? 'empresa' : 'perfil'`. `membro` da URL vai para `membroInicial`. (Ver no `node_modules/next/dist/docs/` como `useSearchParams` exige `Suspense` nesta versão do Next e seguir.)
- Abas:
```tsx
tabs={[
  ...(pode('dona') || pode('config.taxas') ? [{ key: 'empresa', label: 'Empresa' }] : []),
  ...(pode('dona') || papel === 'gestor' ? [{ key: 'permissoes', label: 'Permissões' }] : []),
  { key: 'perfil', label: 'Meu perfil' },
]}
```
(`papel` vem de `usePermissoes()`.)
- Na aba Empresa: `isOwner` → `pode('dona')`; `podeEditarTaxa` → `pode('config.taxas')`. Blocos de dados da empresa só renderizam com `pode('dona')`; o bloco de taxas com `pode('config.taxas')`. Remover os estados `isOwner`/`podeEditarTaxa` e a consulta que os preenchia.
- Nova aba: `{aba === 'permissoes' && <PermissoesPanel empresaId={empresaId} meuUserId={userId} membroInicial={membroDaUrl ?? undefined}/>}`.

- [ ] **Step 4: Selo na Equipe**

Em `web/app/(app)/equipe/page.tsx`: no `carregarEquipe`, buscar também `carregarConfigPermissoes(supabase, empId)` dentro do mesmo `Promise.all` (com `.catch(() => configVazia())` para não quebrar a Equipe se a migration ainda não rodou) e guardar em estado `cfgPerms`. No card de cada pessoa (não-owner), quando `contarExcecoes(cfgPerms, p.user_id) > 0`:

```tsx
<Link href={`/configuracoes?aba=permissoes&membro=${p.user_id}`}
  className="press inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
  style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
  <Shield size={11}/> {n} {n === 1 ? 'exceção' : 'exceções'}
</Link>
```

- [ ] **Step 5: Verificar**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(permissoes/web): aba Permissoes em Configuracoes e selo de excecoes na Equipe"
```

---

### Task 8: App — permissões na sessão e botões por chave

**Files:**
- Modify: `mobile/stores/authStore.ts`, `mobile/lib/permissions.ts`, `mobile/app/_layout.tsx`
- Modify (ligação): `mobile/app/(empresa)/_layout.tsx`, `agenda.tsx`, `agendamento/[id].tsx`, `comissoes.tsx`, `configuracoes.tsx`, `dashboard.tsx`, `mais.tsx`, `pacotes.tsx`, `relatorios.tsx`, `servicos.tsx`, `novo-cliente.tsx`, `novo-agendamento.tsx`, `cliente/[id].tsx`, `cliente/[id]/editar.tsx`, `cliente/[id]/anamnese.tsx`, `nova-comanda.tsx`, `financeiro.tsx`, `equipe.tsx`; `mobile/hooks/useAgenda.ts`; `mobile/components/BloqueioModal.tsx`; `mobile/app/(profissional)/*` só onde já existe botão do catálogo
- Test: `web/tests/unit/permissoes-mobile.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4.
- Produces:
  - `useAuthStore`: novo estado `permissoes: PermissoesUsuario` (inicial `{ isOwner: false, papel: null, chaves: [] }`) e ação `recarregarPermissoes(): Promise<void>`.
  - `mobile/lib/permissions.ts`: exporta `pode`, `type Acesso`, `usePermissoes()` (mesma forma do web), mantém `rotaInicial` e `podeAtribuirRole`; **remove** `temPermissao` e `type Permissao`.

- [ ] **Step 1: Teste que falha**

```ts
// web/tests/unit/permissoes-mobile.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const mob = join(__dirname, '..', '..', '..', 'mobile');
const ler = (p: string) => readFileSync(join(mob, p), 'utf8');

describe('app: permissões na sessão', () => {
  it('authStore carrega e recarrega as permissões efetivas', () => {
    const s = ler('stores/authStore.ts');
    expect(s).toContain('carregarMinhasPermissoes(');
    expect(s).toContain('recarregarPermissoes');
  });
  it('_layout raiz recarrega ao voltar ao app', () => {
    expect(ler('app/_layout.tsx')).toMatch(/AppState[\s\S]*recarregarPermissoes/);
  });
  it('lib/permissions não tem mais a matriz fixa', () => {
    const s = ler('lib/permissions.ts');
    expect(s).not.toContain('temPermissao');
    expect(s).toContain('usePermissoes');
  });
});

describe('app: botões consultam a chave certa', () => {
  const esperado: [string, string[]][] = [
    ['app/(empresa)/_layout.tsx', ['financeiro.ver']],
    ['app/(empresa)/agendamento/[id].tsx', ['agenda.excluir']],
    ['app/(empresa)/comissoes.tsx', ['comissoes.ver_todas']],
    ['app/(empresa)/configuracoes.tsx', ['config.taxas']],
    ['app/(empresa)/dashboard.tsx', ['estoque.acessar', 'financeiro.ver', 'comanda.fechar']],
    ['app/(empresa)/mais.tsx', ['financeiro.ver', 'comissoes.ver_todas']],
    ['app/(empresa)/pacotes.tsx', ['pacotes.gerenciar']],
    ['app/(empresa)/relatorios.tsx', ['comissoes.pagar']],
    ['app/(empresa)/servicos.tsx', ['servicos.gerenciar']],
    ['app/(empresa)/novo-agendamento.tsx', ['clientes.cadastrar']],
    ['app/(empresa)/cliente/[id].tsx', ['clientes.arquivar', 'clientes.excluir', 'clientes.editar']],
    ['app/(empresa)/nova-comanda.tsx', ['comanda.desconto']],
    ['hooks/useAgenda.ts', ['agenda.aprovar_bloqueios']],
  ];
  for (const [arq, chaves] of esperado) {
    for (const c of chaves) it(`${arq} usa ${c}`, () => expect(ler(arq)).toContain(`pode('${c}')`));
  }
  it('área da profissional não ganhou telas novas', () => {
    expect(readdirSync(join(mob, 'app', '(profissional)')).sort()).toEqual(
      ['_layout.tsx', 'agenda.tsx', 'agendamento', 'comissoes.tsx', 'configuracoes.tsx', 'inicio.tsx', 'pacotes.tsx', 'servicos.tsx'].sort(),
    );
  });
});
```

Run → FAIL.

- [ ] **Step 2: Store e lib**

Em `mobile/stores/authStore.ts`:
- Imports: `import { carregarMinhasPermissoes, papelDeRole } from '@shared/permissoes-consultas';` e `import type { PermissoesUsuario } from '@shared/permissoes';`.
- Interface: `permissoes: PermissoesUsuario; recarregarPermissoes: () => Promise<void>;`
- Estado inicial: `permissoes: { isOwner: false, papel: null, chaves: [] },`
- Ao final de `carregarSessao`, depois do `set({...})`: `await get().recarregarPermissoes();`
- `selecionarEmpresa`: depois do `set`, `void get().recarregarPermissoes();`
- `limparSessao`: incluir `permissoes: { isOwner: false, papel: null, chaves: [] }`.
- Nova ação:
```ts
  recarregarPermissoes: async () => {
    const { empresaAtiva, isOwner, roleAtivo } = get();
    if (!empresaAtiva) return;
    // Owner entra no store com roleAtivo 'gestor' (ver carregarSessao) — isOwner manda.
    const permissoes = await carregarMinhasPermissoes(supabase, empresaAtiva.id, isOwner, isOwner ? null : papelDeRole(roleAtivo));
    if (get().empresaAtiva?.id === empresaAtiva.id) set({ permissoes });
  },
```

`mobile/lib/permissions.ts` (substituir tudo):
```ts
import { useMemo } from 'react';
import { PerfilRole } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { pode, type Acesso } from '@shared/permissoes';

export { pode };
export type { Acesso };

/** `const { pode } = usePermissoes(); if (pode('clientes.arquivar')) ...` */
export function usePermissoes() {
  const p = useAuthStore(s => s.permissoes);
  return useMemo(() => ({ ...p, pode: (a: Acesso) => pode(p, a) }), [p]);
}

// Retorna a rota inicial baseada no perfil
export function rotaInicial(role: PerfilRole | 'owner'): string {
  switch (role) {
    case 'owner':
    case 'gestor':
      return '/(empresa)/dashboard';
    case 'profissional':
      return '/(profissional)/inicio';
    default:
      return '/(auth)/login';
  }
}

export function podeAtribuirRole(
  quemConvida: 'owner' | PerfilRole,
  roleAlvo: 'gestor' | 'profissional'
): boolean {
  if (roleAlvo === 'gestor') return quemConvida === 'owner';
  return quemConvida === 'owner' || quemConvida === 'gestor';
}
```

Em `mobile/app/_layout.tsx`: adicionar um `useEffect` que assina `AppState.addEventListener('change', s => { if (s === 'active') useAuthStore.getState().recarregarPermissoes(); })` e remove no cleanup (`import { AppState } from 'react-native'`).

- [ ] **Step 3: Ligação dos botões**

Para cada arquivo da lista de Files, trocar `temPermissao(role, '<antiga>')` por `pode('<nova>')` (com `const { pode } = usePermissoes();`), mapa de chaves antigas: `ver_resumo_financeiro`/`ver_despesas` → `financeiro.ver`; `gerenciar_estoque`/`gerenciar_produtos` → `estoque.acessar`; `fechar_comanda` → `comanda.fechar`; `ver_comissoes_todas` → `comissoes.ver_todas` (exceto `relatorios.tsx` `podePagar` → `comissoes.pagar`); `gerenciar_pacotes` → `pacotes.gerenciar`; `gerenciar_servicos` → `servicos.gerenciar`. E, com a mesma tabela de ligação da Task 6:
- `configuracoes.tsx` ~119 `podeEditarTaxa` → `pode('config.taxas')`; dados da empresa editáveis só com `pode('dona')`.
- `agenda.tsx` ~213 e `agendamento/[id].tsx` ~444: `meuRole` → `pode('agenda.ver_equipe')` / `pode('agenda.excluir')` / `pode('agenda.aprovar_bloqueios')` conforme o uso (as funções de shared já recebem booleano desde a Task 4).
- `hooks/useAgenda.ts` ~249 e `components/BloqueioModal.tsx`: `podeAprovarBloqueios: pode('agenda.aprovar_bloqueios')` (no hook, `usePermissoes()` é um hook — chamar no topo do hook).
- `novo-agendamento.tsx`: criar cliente inline só com `pode('clientes.cadastrar')`; escolher outra profissional só com `pode('agenda.gerenciar_outras')`.
- `novo-cliente.tsx`: se `!pode('clientes.cadastrar')`, mostrar aviso "Você não tem permissão para cadastrar cliente." no lugar do formulário.
- `cliente/[id].tsx`: botão Editar ↔ `pode('clientes.editar')`; no modal de remover, Arquivar ↔ `pode('clientes.arquivar')`, Excluir permanentemente ↔ `pode('clientes.excluir')`; botão que abre o modal some se nenhum dos dois; aba/link de anamnese ↔ `pode('anamnese.ver')`.
- `cliente/[id]/editar.tsx`: sem `pode('clientes.editar')`, voltar com aviso.
- `cliente/[id]/anamnese.tsx`: edição ↔ `pode('anamnese.editar')`.
- `nova-comanda.tsx`: bloco "Desconto" (~886) e método `cortesia` (~60) só com `pode('comanda.desconto')`; sem `pode('comanda.fechar')` o botão de fechar fica desabilitado com aviso.
- `pacotes.tsx`: vender ↔ `pode('pacotes.vender')`.
- `financeiro.tsx`: nova/editar/pagar despesa ↔ `pode('despesas.gerenciar')`; marcar taxa paga ↔ `pode('taxas.marcar_pagas')`; `isOwner` (retiradas) → `pode('dona')`.
- `equipe.tsx`: ações de editar/desativar/convidar ↔ `pode('equipe.gerenciar')`; `podeAlterarRole={isOwner}` fica.
- `mais.tsx`: itens Estoque ↔ `estoque.acessar`, Equipe ↔ `equipe.gerenciar`, Vendas ↔ `vendas.acessar` (se existirem no menu).
- `(profissional)/*`: só trocar `temPermissao`/papel por `pode(...)` onde já houver botão do catálogo; **não** criar tela, aba ou item de menu.

- [ ] **Step 4: Verificar**

Run: `cd web && npx vitest run` e `cd mobile && npx tsc --noEmit`
Expected: verde; mobile com os mesmos 6 erros da baseline.

- [ ] **Step 5: Commit**

```bash
git add mobile web/tests/unit/permissoes-mobile.test.ts
git commit -m "feat(permissoes/app): permissoes efetivas na sessao e botoes por chave"
```

---

### Task 9: App — aba Permissões em Configurações (dona/gestora)

**Files:**
- Create: `mobile/components/PermissoesPanel.tsx`
- Modify: `mobile/app/(empresa)/configuracoes.tsx`, `mobile/app/(empresa)/equipe.tsx` (selo)
- Test: `web/tests/unit/permissoes-painel-mobile.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 8 (`usePermissoes` do mobile); `SmoothTabs` (`mobile/components/SmoothTabs.tsx`), `C` (tema já importado nas telas — copiar o import de `configuracoes.tsx`), `mensagemErroBanco`.
- Produces: `<PermissoesPanel empresaId={string} meuUserId={string} membroInicial?: string />` (React Native).

- [ ] **Step 1: Teste que falha**

```ts
// web/tests/unit/permissoes-painel-mobile.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const mob = join(__dirname, '..', '..', '..', 'mobile');
const ler = (p: string) => readFileSync(join(mob, p), 'utf8');

describe('app: Configurações → Permissões', () => {
  const painel = ler('components/PermissoesPanel.tsx');
  it('mesmas 3 sub-abas, rascunho, salvar e histórico do web', () => {
    for (const t of ["'Por papel'", "'Por pessoa'", "'Histórico'", 'salvarPermissoes(', 'carregarHistoricoPermissoes(', 'descreverHistorico(', 'podeEditarAlvo(', 'mensagemErroBanco(']) {
      expect(painel).toContain(t);
    }
    expect(painel).toMatch(/alterações? não salvas?/);
  });
  it('Configurações mostra a aba só para dona/gestora', () => {
    const cfg = ler('app/(empresa)/configuracoes.tsx');
    expect(cfg).toContain('<PermissoesPanel');
    expect(cfg).toMatch(/pode\('dona'\) \|\| papel === 'gestor'/);
  });
  it('Equipe mostra selo de exceções', () => {
    expect(ler('app/(empresa)/equipe.tsx')).toContain('contarExcecoes(');
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implementar o painel (React Native)**

```tsx
// mobile/components/PermissoesPanel.tsx
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { usePermissoes } from '@/lib/permissions';
import { SmoothTabs } from '@/components/SmoothTabs';
import { C } from '@/constants/theme';
import {
  CATALOGO_PERMISSOES, GRUPOS_PERMISSAO, aplicarMudancas, chaveMudanca, configVazia, contarExcecoes,
  descreverHistorico, estadoDoMembro, podeEditarAlvo, valorDoPapel,
  type ConfigPermissoes, type EstadoExcecao, type LinhaHistorico, type MudancaPermissao, type Papel,
} from '@shared/permissoes';
import { carregarConfigPermissoes, carregarHistoricoPermissoes, salvarPermissoes } from '@shared/permissoes-consultas';
import { mensagemErroBanco } from '@shared/erros';

type Membro = { user_id: string; nome: string; role: 'owner' | 'gestor' | 'profissional' };
type SubAba = 'papel' | 'pessoa' | 'historico';
const ROTULO_ESTADO: Record<EstadoExcecao, string> = { padrao: 'Padrão', permitir: 'Permitir', bloquear: 'Bloquear' };
const F = { r: 'PlusJakartaSans_400Regular', s: 'PlusJakartaSans_600SemiBold', b: 'PlusJakartaSans_700Bold' };

/** Aba Permissões do app — mesma regra e mesmo fluxo de rascunho/salvar do web. */
export function PermissoesPanel({ empresaId, meuUserId, membroInicial }: { empresaId: string; meuUserId: string; membroInicial?: string }) {
  const { isOwner, papel } = usePermissoes();
  const editor = { isOwner, papel, userId: meuUserId };

  const [sub, setSub] = useState<SubAba>(membroInicial ? 'pessoa' : 'papel');
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState<ConfigPermissoes>(configVazia());
  const [membros, setMembros] = useState<Membro[]>([]);
  const [historico, setHistorico] = useState<LinhaHistorico[]>([]);
  const [rascunho, setRascunho] = useState<Record<string, MudancaPermissao>>({});
  const [membroSel, setMembroSel] = useState(membroInicial ?? '');
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    setLoading(true);
    try {
      const [c, h, rM] = await Promise.all([
        carregarConfigPermissoes(supabase, empresaId),
        carregarHistoricoPermissoes(supabase, empresaId),
        supabase.from('empresa_membros').select('user_id, role, user:users(nome)')
          .eq('empresa_id', empresaId).in('role', ['owner', 'gestor', 'profissional']),
      ]);
      if (rM.error) throw new Error(rM.error.message);
      setCfg(c); setHistorico(h);
      setMembros(((rM.data ?? []) as any[])
        .map(m => ({ user_id: m.user_id, role: m.role, nome: m.user?.nome ?? 'Sem nome' }))
        .sort((a: Membro, b: Membro) => a.nome.localeCompare(b.nome)));
    } catch (e) {
      Alert.alert('Erro', `Não foi possível carregar as permissões: ${(e as Error).message}`);
    }
    setLoading(false);
  }
  useEffect(() => { if (empresaId) carregar(); }, [empresaId]);

  const mudancas = useMemo(() => Object.values(rascunho), [rascunho]);
  const visivel = useMemo(() => aplicarMudancas(cfg, mudancas), [cfg, mudancas]);
  const nomes = useMemo(() => Object.fromEntries(membros.map(m => [m.user_id, m.nome])), [membros]);
  const editaveis = membros.filter(m => podeEditarAlvo(editor, { tipo: 'membro', userId: m.user_id, papel: m.role }));
  const filtrados = editaveis.filter(m => m.nome.toLowerCase().includes(busca.trim().toLowerCase()));
  const membroAtual = membros.find(m => m.user_id === membroSel);

  function mudar(m: MudancaPermissao) {
    setRascunho(prev => {
      const k = chaveMudanca(m);
      const igual = m.tipo === 'papel'
        ? valorDoPapel(cfg, m.alvo, m.chave) === m.permitido
        : (cfg.membros[m.alvo]?.[m.chave] ?? null) === m.permitido;
      const prox = { ...prev };
      if (igual) delete prox[k]; else prox[k] = m;
      return prox;
    });
  }

  async function salvar() {
    setSalvando(true);
    const { error } = await salvarPermissoes(supabase, empresaId, mudancas);
    setSalvando(false);
    if (error) { Alert.alert('Erro', mensagemErroBanco(error, 'alterar estas permissões')); return; }
    setRascunho({});
    Alert.alert('Pronto', 'Permissões salvas');
    await carregar();
  }

  if (loading) return <ActivityIndicator color={C.primary} style={{ marginTop: 24 }}/>;

  const tituloGrupo = (g: string) => (
    <Text style={{ fontFamily: F.b, fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 18, marginBottom: 8 }}>{g}</Text>
  );

  return (
    <View style={{ gap: 12 }}>
      <SmoothTabs
        tabs={[{ key: 'papel', label: 'Por papel' }, { key: 'pessoa', label: 'Por pessoa' }, { key: 'historico', label: 'Histórico' }]}
        active={sub}
        onChange={(k: string) => setSub(k as SubAba)}
      />

      {sub === 'papel' && (
        <View>
          {!isOwner && <Text style={{ fontFamily: F.r, fontSize: 12, color: C.text3 }}>Como gestora, você altera só o papel Profissional.</Text>}
          {GRUPOS_PERMISSAO.map(g => (
            <View key={g}>
              {tituloGrupo(g)}
              {CATALOGO_PERMISSOES.filter(p => p.grupo === g).map(p => (
                <View key={p.chave} style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: C.border }}>
                  <Text style={{ fontFamily: F.s, fontSize: 14, color: C.text }}>{p.rotulo}</Text>
                  {!!p.descricao && <Text style={{ fontFamily: F.r, fontSize: 11, color: C.text4 }}>{p.descricao}</Text>}
                  <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
                    {(['gestor', 'profissional'] as Papel[]).map(pp => (
                      <View key={pp} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Switch
                          value={valorDoPapel(visivel, pp, p.chave)}
                          disabled={!podeEditarAlvo(editor, { tipo: 'papel', papel: pp })}
                          onValueChange={v => mudar({ tipo: 'papel', alvo: pp, chave: p.chave, permitido: v })}
                          trackColor={{ true: C.primary, false: C.border }}
                        />
                        <Text style={{ fontFamily: F.r, fontSize: 12, color: C.text2 }}>{pp === 'gestor' ? 'Gestora' : 'Profissional'}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      {sub === 'pessoa' && (
        <View>
          <TextInput value={busca} onChangeText={setBusca} placeholder="Buscar pessoa da equipe..."
            placeholderTextColor={C.text4}
            style={{ fontFamily: F.r, fontSize: 14, color: C.text, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12 }}/>
          {filtrados.map(m => {
            const n = contarExcecoes(visivel, m.user_id);
            const ativo = m.user_id === membroSel;
            return (
              <Pressable key={m.user_id} onPress={() => setMembroSel(m.user_id)}
                style={{ paddingVertical: 10, paddingHorizontal: 12, marginTop: 6, borderRadius: 12, borderWidth: 1, borderColor: ativo ? C.primary : C.border }}>
                <Text style={{ fontFamily: F.s, fontSize: 14, color: C.text }}>{m.nome}</Text>
                <Text style={{ fontFamily: F.r, fontSize: 11, color: C.text4 }}>
                  {m.role === 'gestor' ? 'Gestora' : 'Profissional'}{n ? ` · ${n} ${n === 1 ? 'exceção' : 'exceções'}` : ''}
                </Text>
              </Pressable>
            );
          })}
          {editaveis.length === 0 && <Text style={{ fontFamily: F.r, fontSize: 13, color: C.text3, marginTop: 8 }}>Ninguém da equipe que você possa ajustar individualmente.</Text>}
          {membroAtual && membroAtual.role !== 'owner' && GRUPOS_PERMISSAO.map(g => (
            <View key={g}>
              {tituloGrupo(g)}
              {CATALOGO_PERMISSOES.filter(p => p.grupo === g).map(p => {
                const estado = estadoDoMembro(visivel, membroAtual.user_id, p.chave);
                const padrao = valorDoPapel(visivel, membroAtual.role as Papel, p.chave);
                return (
                  <View key={p.chave} style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: C.border }}>
                    <Text style={{ fontFamily: F.s, fontSize: 14, color: C.text }}>{p.rotulo}</Text>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                      {(['padrao', 'permitir', 'bloquear'] as EstadoExcecao[]).map(e => (
                        <Pressable key={e}
                          onPress={() => mudar({ tipo: 'membro', alvo: membroAtual.user_id, chave: p.chave, permitido: e === 'padrao' ? null : e === 'permitir' })}
                          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1,
                                   borderColor: estado === e ? C.primary : C.border, backgroundColor: estado === e ? C.primarySoft : 'transparent' }}>
                          <Text style={{ fontFamily: F.s, fontSize: 11.5, color: estado === e ? C.primary : C.text2 }}>
                            {e === 'padrao' ? `${ROTULO_ESTADO[e]} (${padrao ? '✔' : '✘'})` : ROTULO_ESTADO[e]}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}

      {sub === 'historico' && (
        <View>
          {historico.length === 0
            ? <Text style={{ fontFamily: F.r, fontSize: 13, color: C.text3 }}>Nenhuma alteração registrada ainda.</Text>
            : historico.map(l => (
              <Text key={l.id} style={{ fontFamily: F.r, fontSize: 12.5, color: C.text2, paddingVertical: 8, borderBottomWidth: 1, borderColor: C.border }}>
                {descreverHistorico(l, nomes)}
              </Text>
            ))}
        </View>
      )}

      {mudancas.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.text, borderRadius: 16, padding: 12, marginTop: 8 }}>
          <Text style={{ flex: 1, fontFamily: F.s, fontSize: 13, color: '#fff' }}>
            {mudancas.length} {mudancas.length === 1 ? 'alteração não salva' : 'alterações não salvas'}
          </Text>
          <Pressable onPress={() => setRascunho({})}><Text style={{ fontFamily: F.s, color: '#fff', opacity: 0.8 }}>Descartar</Text></Pressable>
          <Pressable onPress={salvar} disabled={salvando}
            style={{ backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, opacity: salvando ? 0.6 : 1 }}>
            <Text style={{ fontFamily: F.s, color: '#fff' }}>{salvando ? 'Salvando…' : 'Salvar'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
```

> `C` e os nomes de cor (`primary`, `primarySoft`, `border`, `text`, `text2`, `text3`, `text4`): conferir no arquivo de tema importado por `mobile/app/(empresa)/configuracoes.tsx` e usar o mesmo caminho de import e os mesmos nomes (lembrete da Fase 1: `C.text2` já deu erro de tipo antes — use só chaves que existem). `SmoothTabs` do mobile: conferir as props em `mobile/components/SmoothTabs.tsx` e ajustar.

- [ ] **Step 3: Configurações e Equipe no app**

`mobile/app/(empresa)/configuracoes.tsx`: adicionar seletor de abas no topo (`SmoothTabs` com Empresa / Permissões / Meu perfil, mesmas condições do web: Empresa ↔ `pode('dona') || pode('config.taxas')`; Permissões ↔ `pode('dona') || papel === 'gestor'`), renderizar `<PermissoesPanel empresaId={empresaAtiva.id} meuUserId={user.id} membroInicial={membro ?? undefined}/>` na aba Permissões (`membro` via `useLocalSearchParams`). O conteúdo atual da tela fica dividido entre Empresa (dados e taxas) e Meu perfil (nome, telefone, senha, notificações, sair), sem remover nada.

`mobile/app/(empresa)/equipe.tsx`: carregar `carregarConfigPermissoes` (com `.catch(() => configVazia())`) junto do que a tela já carrega; no card de cada pessoa não-owner com `contarExcecoes(cfg, user_id) > 0`, mostrar o selo "N exceções" que navega para `router.push(\`/(empresa)/configuracoes?aba=permissoes&membro=${user_id}\`)`.

- [ ] **Step 4: Verificar**

Run: `cd web && npx vitest run` e `cd mobile && npx tsc --noEmit`
Expected: verde; mobile com os 6 erros da baseline.

- [ ] **Step 5: Commit**

```bash
git add mobile web/tests/unit/permissoes-painel-mobile.test.ts
git commit -m "feat(permissoes/app): aba Permissoes em Configuracoes e selo de excecoes na Equipe"
```

---

### Task 10: Documentação e revisão final da branch

**Files:**
- Modify: `CLAUDE.md` (histórico de auditorias + pendências), `docs/superpowers/specs/2026-10-02-permissoes-configuraveis-design.md` (status)

- [ ] **Step 1: Varredura final**

Run (na raiz):
```bash
grep -rn "temPermissao\|ver_resumo_financeiro\|gerenciar_estoque\|ver_comissoes_todas" web/app web/components web/lib mobile/app mobile/components mobile/hooks mobile/lib --include=*.ts --include=*.tsx
```
Expected: nenhuma ocorrência.

```bash
grep -rn "role === 'owner' || .*role === 'gestor'\|=== 'gestor' ||" web/app mobile/app mobile/hooks mobile/components --include=*.tsx --include=*.ts
```
Expected: só pontos fixos fora do catálogo (convidar/promover gestora, rótulo de papel). Revisar cada um.

- [ ] **Step 2: Suite completa**

Run: `cd web && npx tsc --noEmit && npx vitest run` e `cd mobile && npx tsc --noEmit`
Expected: web zerado e verde; mobile 6 erros da baseline.

- [ ] **Step 3: Revisão final de branch (opus)**

Despachar um revisor (model: opus) sobre `git diff origin/main...HEAD` com foco em: (1) cada policy recriada na 083 é idêntica à de produção exceto a troca por `tem_permissao`; (2) condição de tela × condição do banco em cada chave (o botão some exatamente quando o banco recusaria); (3) gestora não consegue, por nenhum caminho (RPC, UPDATE direto em `empresa_membros`, API), aumentar as próprias permissões; (4) nenhum fluxo de profissional que funcionava antes quebra com os padrões (fechar comanda com desconto de reserva, vender pacote na comanda, baixa de estoque, criar bloqueio pendente); (5) fallback quando a 083 não foi aplicada.

- [ ] **Step 4: CLAUDE.md**

Acrescentar a sessão "2026-10-02 — Bugs de RLS (cliente/agendamento) + permissões configuráveis" ao histórico de auditorias, no formato das anteriores (tabela de critérios, score parcial, bugs encontrados, decisões do dono, pendências). Pendências obrigatórias:
- SQL Editor, nesta ordem: `080` (se ainda não aplicada; ver bloco de pendências de 2026-09-29), `081`, `082`, `083`.
- Conferência pós-083 (somente leitura): `select * from minhas_permissoes('<empresa>')` logado como a profissional deve devolver exatamente os 9 padrões ✔.
- 046 nunca aplicada (vendas abertas para leitura de membros) — decisão consciente: não aplicar, porque a comanda da profissional lê vendas.
- Policies manuais "gestor pode gerenciar agendamentos/comissoes" (só dona) seguem no banco, inofensivas; versionar ou remover numa limpeza futura.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-02-permissoes-configuraveis-design.md
git commit -m "docs: auditoria da sessao de permissoes configuraveis"
```
