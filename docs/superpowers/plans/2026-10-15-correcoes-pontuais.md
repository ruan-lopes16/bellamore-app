# Correções pontuais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Spec:** `docs/superpowers/specs/2026-10-15-correcoes-pontuais-design.md`

## Global Constraints
- Restrições de sempre:
  - português;
  - o web nunca importa `mobile/`;
  - CRLF;
  - vitest 100%, tsc web 0, tsc mobile 8;
  - migrations à mão, idempotentes, com rollback e `notify`;
  - nunca executar nada contra o banco;
  - commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Funções recriadas sempre a partir do corpo atual, que é o da 090 para as funções da comanda e da venda.

### Task 1: Banco (itens 9, 10 e 11)
- Migration `093_alinhamentos_finais.sql`:
  - `comanda_pertence_ao_profissional` com vínculo ativo;
  - conferência de empresa de `cliente_id`, `maquininha_id` e `profissional_id` nas três funções da 090;
  - drop condicional da policy ampla de `vendas`/`venda_itens` ("membro gerencia").
- Teste por texto e caso PGlite.
- Commit: `fix(banco): pertencimento com vinculo ativo e conferencia de empresa nas funcoes (093)`.

### Task 2: Regras em shared (itens 7, 8, 14 e TZ)
- `montarPagamentos` grava 0% como 0;
- `parseValorBR` com "0.xxx";
- `mensagemErroBanco` mostra o texto próprio das funções;
- setup do vitest com TZ.
- Commit: `fix(shared): taxa 0%, 0.xxx em dinheiro e mensagens das funcoes`.

### Task 3: Telas (itens 4, 12, 13 e 15) no web e no app
- Mês importado sem linhas avulsas;
- `expo-crypto` no app (dependência + gerador injetado em `shared/uuid.ts`);
- aviso de extras só das próprias comandas;
- spinner, contador, badges com `.error` e mensagem de "todas já lançadas".
- Commit: `fix(telas): mes importado, uuid seguro no app, avisos e ajustes`.
