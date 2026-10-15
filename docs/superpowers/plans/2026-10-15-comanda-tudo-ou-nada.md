# Comanda e venda "tudo ou nada" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fechar e editar a comanda, e registrar a venda avulsa, viram uma operação única no banco. O desconto passa a ser rateado entre atendimentos e extras e entra na receita e na comissão. A taxa de reserva para de contar em dobro. A profissional passa a baixar o estoque dos produtos da comanda. A brecha de inserir comissão direto é fechada.

**Architecture:**
- Migration 090: colunas de rateio, funções `fechar_comanda(jsonb)`, `editar_comanda(jsonb)` e `registrar_venda_avulsa_v2`, triggers de comissão com a base nova e ajustes de RLS.
- `shared/comanda-gravacao.ts` monta o payload a partir do estado das telas e trata os erros.
- Sem a 090 (`PGRST202`), as telas usam o caminho atual.
- A receita passa a sair de `shared/kpis-financeiros*.ts`, com a regra nova.

**Tech Stack:** Supabase/Postgres (plpgsql, RLS, triggers), TypeScript em `shared/`, Next.js (web), Expo/React Native (app), Vitest em `web/tests/unit`.

**Spec:** `docs/superpowers/specs/2026-10-15-comanda-tudo-ou-nada-design.md`
**Inventário (leitura obrigatória para todas as tasks):** `docs/superpowers/notes/2026-10-15-inventario-gravacoes-comanda.md`

## Global Constraints

- **Idioma e importações:** comunicação, comentários, mensagens e commits em português. O web nunca importa `mobile/`.
- **Testes e tsc:**
  - testes com `cd web && npx vitest run <arquivo>`;
  - `cd web && npx tsc --noEmit` dá 0;
  - `cd mobile && npx tsc --noEmit` dá exatamente 8 erros pré-existentes neste worktree.
- **Migrations:**
  - aplicadas à mão; NUNCA com `supabase db push`; nunca executar nada contra o banco;
  - idempotentes, com cabeçalho e rollback, terminando em `notify pgrst, 'reload schema';`;
  - funções novas com `security invoker`, `revoke all … from public, anon` e `grant execute … to authenticated`;
  - nunca mudar a assinatura de uma função existente (assinatura nova = função nova).
- **Valores no banco:** recalculados no banco; valores da tela são só entrada. Sem RETURNING. 0 linhas é conferido com `GET DIAGNOSTICS`.
- **Trava de estoque:** `pg_advisory_xact_lock(hashtextextended('venda_estoque:' || produto_id::text, 0))`, em ordem de id (igual à 087 e à 088).
- **Arquivos:** CRLF preservado. Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nunca commitar `.superpowers/`.
- **Decisões do dono:**
  1. Tudo ou nada.
  2. Desconto da comanda inteira rateado proporcionalmente (atendimentos, linhas de multi-serviço e extras); comissões sobre o valor com desconto; a taxa de reserva NÃO entra no rateio.
  3. Item incluído na edição conta comissão e receita no mês de `comandas.fechada_at`.
  4. Taxa de reserva pelo dia do serviço: atendimento concluído conta inteiro e a taxa não conta à parte; só a taxa `retida` conta, por `paga_em`.
  5. Venda avulsa com chave contra repetição.

---

### Task 1: Migration 090 + contrato das funções

**Files:**
- Create: `supabase/migrations/090_comanda_tudo_ou_nada.sql`
- Create: `docs/superpowers/notes/2026-10-15-contrato-fechar-comanda.md` (contrato JSON exato do payload das três funções, campo a campo: obrigatório/opcional, tipo, regra; e cada erro que pode sair, com a mensagem)
- Test: `web/tests/unit/comanda-tudo-ou-nada-migration.test.ts`

**Interfaces (produz):**
- `public.fechar_comanda(p jsonb) returns uuid`
- `public.editar_comanda(p jsonb) returns void`
- `public.registrar_venda_avulsa_v2(p_venda_id uuid, p_empresa uuid, p_cliente uuid, p_desconto numeric, p_itens jsonb, p_pagamentos jsonb) returns uuid`
- colunas `desconto_rateado` em `agendamentos`, `agendamento_servicos` e `comanda_itens`; coluna `estoque_movimentos.comanda_id`
- o contrato (arquivo acima) é o que as Tasks 2–4 vão consumir

**Requisitos:** os da spec §1, aplicados sobre o inventário. Em especial:
- **Payload:**
  - montar a partir do que as telas já calculam hoje (inventário, passos F1–F10 e edição E1–E5);
  - nenhum campo que o banco possa calcular sozinho vem confiado da tela: o subtotal, o total e o rateio são recalculados;
  - `profissional_id` da comanda = `auth.uid()`.
- **Idempotência:** `comanda_id` (e `p_venda_id` na venda) já existente nesta empresa → devolve sem gravar. Já existente em outra empresa → erro.
- **Duplicidade de atendimento:** `UPDATE … WHERE comanda_id IS NULL` com contagem conferida.
- **Ordem:** a ordem das gravações garante os triggers (inventário §3). `valor`, `desconto_rateado`, `pacote_cliente_id`, `comanda_id` e `status = 'concluido'` vão no MESMO UPDATE de `agendamentos`.
- **Rateio:** em centavos, proporcional ao valor de cada parte (atendimento sem linhas, cada linha de multi-serviço, cada extra). O resto vai para a maior parte. Sessão de pacote (valor 0) não recebe desconto.
- **Produtos:**
  - trava do estoque em ordem de id, saldo NÃO bloqueia, `estoque_movimentos.comanda_id`;
  - venda via comanda com `desconto` = soma do rateio dos produtos;
  - pacote vendido com `vendas.desconto` = rateio dele.
- **Edição:**
  - `comanda.editar_fechada`;
  - diff de extras;
  - novo rateio;
  - pagamentos apagados e reinseridos na mesma transação, e os não alterados mantêm `taxa_perc`, `maquininha_id` e `created_at`;
  - pagamentos novos da edição com `created_at = comandas.fechada_at`.
- **Triggers 065/075/085:**
  - base `valor − desconto_rateado`;
  - o 075 reage também a `desconto_rateado`;
  - na 085, `created_at` da comissão = `comandas.fechada_at`.
- **RLS:**
  - ramo novo em `estoque_movimentos` INSERT (saída com `comanda_id` de comanda que pertence a ela);
  - drop de "comissoes: membro insere" (confira no inventário e em `docs/superpowers/notes/2026-10-02-pg-policies-producao.csv` o nome exato e se algo legítimo depende dela, já que os triggers são definer);
  - `search_path` nas funções que recriar.
- **Teste SQL** (texto): assinaturas, security invoker, permissões (`comanda.fechar`, `comanda.desconto`, `comanda.editar_fechada`, `pacotes.vender`), `GET DIAGNOSTICS`, `comanda_id IS NULL`, idempotência, ordem das gravações por `indexOf`, a trava, o rateio com resto, a base nova dos triggers, o drop da policy, grants e notify.

- [ ] Steps: teste falhando → SQL e contrato → teste passando → `cd web && npx vitest run` (tudo PASS) → commit `feat(banco): fechar e editar comanda tudo ou nada, desconto rateado e venda com chave (090)`.

---

### Task 2: `shared/` — rateio espelho, gravação da comanda e receita nova

**Files:**
- Modify: `shared/comanda-fechamento.ts` (acrescenta `ratearDescontoCentavos`)
- Create: `shared/comanda-gravacao.ts`
- Modify: `shared/venda.ts` (`gravarVenda` usa `registrar_venda_avulsa_v2` com `vendaId` da tela; sem a v2, cai para a v1 e depois para o caminho antigo)
- Modify: `shared/kpis-financeiros.ts`, `shared/kpis-financeiros-consultas.ts` (e onde a receita de extras e de taxas é montada)
- Test: `web/tests/unit/comanda-gravacao.test.ts`, `web/tests/unit/receita-reserva-desconto.test.ts`, ajustes em `venda.test.ts`

**Interfaces:**
- **Consome:** o contrato da Task 1.
- **Produz:**
  - `ratearDescontoCentavos(partes: number[], desconto: number): number[]`: mesma regra do SQL;
  - `montarPayloadFechamento(estado): object` e `montarPayloadEdicao(estado): object`, com tipos de estado documentados a partir do que as duas telas têm;
  - `fecharComandaNoBanco(db, payload): Promise<{ via: 'funcao' } | { via: 'antigo' }>` e `editarComandaNoBanco(db, payload)`: `PGRST202` → `{ via: 'antigo' }` (a tela segue pelo caminho atual); outros erros → `Error` em português; erro sem `code` → "Sem resposta do servidor: a comanda pode ter sido fechada. Confira antes de repetir.";
  - `gravarVenda(db, dados & { vendaId: string })`.
- **Receita:** serviços = `valor − desconto_rateado`, incluindo multi-serviço. Extras = `valor_unit × quantidade − desconto_rateado`. Taxas de reserva só `retida`, por `paga_em`. As colunas novas ausentes (antes da 090) valem 0. Confira nas consultas que o select não quebra sem a coluna: use o padrão de detecção já usado no projeto para colunas novas, ou ler com `*`.
- **Testes:** os casos do inventário para o payload; reserva paga + atendimento concluído conta uma vez; retida conta; desconto rateado sai da receita; `PGRST202`; sem resposta; idempotência da venda (mesmo `vendaId` na nova tentativa).

- [ ] Steps: testes falhando → implementação → `cd web && npx vitest run` (tudo PASS, ajustando testes antigos que fixavam a receita velha, com explicação) → `cd web && npx tsc --noEmit` → commit `feat(shared): gravacao da comanda pela funcao, rateio e receita sem reserva em dobro`.

---

### Task 3: Web — Comanda e PDV pelas funções

**Files:**
- Modify: `web/app/(app)/comanda/page.tsx`
- Modify: `web/app/(app)/vendas/page.tsx`
- Test: `web/tests/unit/comanda-tudo-ou-nada-telas.test.ts` (bloco web)

**Requisitos:**
- **Fechar e editar:**
  - montam o payload com `shared/comanda-gravacao.ts` e chamam a função;
  - `{ via: 'antigo' }` → o código atual segue igual;
  - sucesso pela função → mesmo pós-sucesso de hoje (tela de sucesso, recibo, recarga, `invalidarFinanceiro`).
- **`comanda_id`** é gerado uma vez por comanda aberta e reaproveitado na nova tentativa depois de "sem resposta".
- **PDV:** gera o `vendaId` uma vez por carrinho e o limpa só no sucesso ou em "Nova venda".
- **Erros:** em português e na tela, inclusive "já teve a comanda fechada".

- [ ] Steps: teste → implementação → suíte + tsc → commit `feat(comanda/web): fechar e editar pela funcao tudo ou nada; PDV com chave de venda`.

---

### Task 4: App — Comanda e Vendas pelas funções

**Files:**
- Modify: `mobile/app/(empresa)/nova-comanda.tsx`
- Modify: `mobile/app/(empresa)/vendas.tsx`
- Test: `web/tests/unit/comanda-tudo-ou-nada-telas.test.ts` (bloco app)

**Requisitos:** os mesmos da Task 3, com os mesmos textos. O id vem de `novoUuid` (`@shared/uuid`).

- [ ] Steps: teste → implementação → suíte + os dois tsc → commit `feat(comanda/app): fechar e editar pela funcao tudo ou nada; vendas com chave`.
