# Convite com aceite + histórico da Equipe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Spec:** `docs/superpowers/specs/2026-10-15-convite-aceite-historico-design.md`

## Global Constraints
- Restrições de sempre:
  - português;
  - o web nunca importa `mobile/`;
  - CRLF;
  - vitest 100%, tsc web 0 e tsc mobile 8;
  - migrations à mão, idempotentes, com rollback e `notify`;
  - nunca executar nada contra o banco;
  - commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Funções `security definer` sempre com `set search_path = public` e com a conferência explícita de `auth.uid()`.
- Conta existente NUNCA é vinculada sem aceite.

### Task 1: Migration 092 + `shared/equipe.ts` (`descreverHistoricoEquipe`) + `shared/convites-consultas.ts`
- **Arquivos:**
  - criar `supabase/migrations/092_convites_e_historico_equipe.sql` e `shared/convites-consultas.ts`;
  - alterar `shared/equipe.ts`;
  - testes `web/tests/unit/convites-092.test.ts` (texto + PGlite, seguindo o padrão do `comanda-tudo-ou-nada-pglite.test.ts`) e `web/tests/unit/convites-consultas.test.ts`.
- **Produz:**
  - `carregarMeusConvites(db)`;
  - `aceitarConvite(db, id)`;
  - `recusarConvite(db, id)`;
  - `carregarConvitesPendentes(db, empresaId)`;
  - `cancelarConvite(db, empresaId, id)`, que chama a função ou a rota;
  - `carregarHistoricoEquipe(db, empresaId, pagina)`;
  - `descreverHistoricoEquipe(linha, nomes)`.
- Commit: `feat(equipe): convite com aceite e historico da equipe (092)`.

### Task 2: API
- **Arquivos:** `web/app/api/profissionais/route.ts` e `web/app/api/convites/route.ts`, além de uma rota para cancelar o convite (pode ser `DELETE /api/convites`).
- **Conta existente sem vínculo ativo:** grava o convite pendente e responde `{ status: 'convite_pendente' }`.
- **PATCH com troca de login:** grava `login_trocado` no histórico.
- **Sem a 092:** a conta existente recebe 503 com a mensagem "Atualização do banco pendente: peça para rodar a migration 092."
- **Teste de varredura:** nenhum `upsert` em `empresa_membros` no caminho de conta existente sem vínculo ativo.
- Commit: `feat(api/equipe): conta existente recebe convite pendente; historico da troca de login`.

### Task 3: Web
- **Banner da convidada:** no `AppLayout` e em `/criar-empresa`, com aceitar e recusar. Ao aceitar, troca a empresa ativa e recarrega.
- **Equipe:**
  - seção "Convites pendentes", com Cancelar;
  - aba "Histórico", paginada.
- **Mensagem de convite pendente** nos modais de cadastro.
- Commit: `feat(equipe/web): aceitar convite, convites pendentes e historico`.

### Task 4: App
- O mesmo da Task 3 no app:
  - banner no layout `(empresa)`/`(profissional)` e na tela de criar empresa;
  - na Equipe: convites pendentes e histórico;
  - mensagem no `convidar-profissional`.
- Commit: `feat(equipe/app): aceitar convite, convites pendentes e historico`.
