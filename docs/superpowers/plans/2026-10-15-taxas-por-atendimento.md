# Taxas por atendimento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** com a chave geral da empresa ligada, cada atendimento pode dispensar a taxa de reserva (ao criar) e a taxa de cancelamento (ao cancelar ou marcar falta, ou depois, no Financeiro). O comportamento é igual no web e no app.

**Spec:** `docs/superpowers/specs/2026-10-15-taxas-por-atendimento-design.md`

## Global Constraints
- **Idioma e código:** português; o web nunca importa `mobile/`; preservar CRLF.
- **Testes e tsc:** vitest em `web/` 100%; `cd web && npx tsc --noEmit` dá 0; `cd mobile && npx tsc --noEmit` dá 8 erros pré-existentes.
- **Migrations:** aplicadas à mão (nunca executar nada contra o banco), idempotentes, com rollback e `notify`. Uma função recriada precisa partir do corpo atual completo.
- **Commits:** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; nunca commitar `.superpowers/`.
- **Banco antes e depois:** as telas funcionam antes e depois da 091 (detectar a coluna nova; sem ela, não perguntar e não gravar a coluna).
- **Textos exatos:**
  - "Cobrar taxa de reserva neste atendimento"
  - "Cobrar taxa de cancelamento de R$ X?" com os botões "Cobrar" e "Não cobrar"
  - "Dispensar"

---

### Task 1: Migration 091 + `shared/taxas-atendimento.ts`
**Files:**
- Create: `supabase/migrations/091_taxa_cancelamento_por_atendimento.sql`, `shared/taxas-atendimento.ts`, testes `web/tests/unit/taxas-atendimento.test.ts` e `web/tests/unit/taxa-cancelamento-091.test.ts`
- Modify: `shared/taxa-reserva.ts` (`buildTaxaReservaInsert` com `cobrar`)

**Produz:**
- `valorTaxaReservaSugerida(cfg: { ativa: boolean; modo: 'percentual' | 'fixo'; valor: number }, preco: number): number`
- `valorTaxaCancelamento(cfg: { ativa: boolean; modo: 'percentual' | 'fixo'; valor: number; aplicaCancelado: boolean; aplicaFaltou: boolean }, valorAtendimento: number): number`
- `perguntaTaxaCancelamento(cfg, novoStatus: string, clienteId: string | null, valorAtendimento: number): { perguntar: boolean; valor: number }`
- `buildTaxaReservaInsert({ …, cobrar?: boolean })`, com `cobrar` padrão `true`
- `carregarConfigTaxas(db, empresaId)`, que lê da tabela `empresas` as colunas `taxa_reserva_*` e `taxa_cancelamento_*` e devolve as duas configurações
- `colunaCobrarTaxaExiste(db): Promise<boolean>`, que detecta se a 091 foi aplicada (`select('cobrar_taxa_cancelamento').limit(1)` sem erro de coluna) e guarda o resultado em cache por sessão

**SQL:** conforme a spec.
- A guarda de "status mudou" passa a ser "status OU `cobrar_taxa_cancelamento` mudou".
- Desligar com a taxa `pendente` marca a taxa como `cancelada`.
- Religar com o status ainda `cancelado`/`faltou` cria ou reativa a taxa (mesmo `on conflict` da 052).

- [ ] Steps: testes falhando → implementação → suíte + tsc → commit `feat(taxas): taxa de cancelamento dispensavel por atendimento (091) e regras em shared`.

### Task 2: Web
**Files:** `web/app/(app)/agenda/page.tsx`, `web/app/(app)/clientes/[id]/page.tsx`, `web/app/(app)/financeiro/page.tsx`, e qualquer outro ponto do web que mude status para cancelado/faltou (procure com grep `'cancelado'` e `'faltou'` em updates de `agendamentos`). Teste: `web/tests/unit/taxas-atendimento-telas.test.ts` (bloco web).

Requisitos (spec, seção Telas):
- switch nas 2 telas de criar;
- pergunta em todo ponto que cancela ou marca falta, com `status` e `cobrar_taxa_cancelamento` no mesmo UPDATE, conferindo as linhas;
- "Dispensar" nas taxas pendentes do Financeiro (com `taxas.marcar_pagas`);
- sem a 091, nada muda.

- [ ] Steps: teste → implementação → suíte + tsc → commit `feat(taxas/web): cobrar ou dispensar taxa de reserva e de cancelamento por atendimento`.

### Task 3: App
**Files:** `mobile/app/(empresa)/novo-agendamento.tsx`, `mobile/app/(empresa)/agendamento/[id].tsx`, a agenda da profissional (`mobile/app/(profissional)/...`) e os hooks que mudam status (`mobile/hooks/useAgenda.ts`, `useProfissional.ts`), mais `mobile/app/(empresa)/financeiro.tsx`. Teste: o mesmo arquivo, bloco app.

Requisitos e textos: os mesmos da Task 2, com `Alert` (Cobrar / Não cobrar / Voltar).

- [ ] Steps: teste → implementação → suíte + os dois tsc → commit `feat(taxas/app): cobrar ou dispensar taxa de reserva e de cancelamento por atendimento`.
