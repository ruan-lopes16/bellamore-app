# Vendas avulsas: gravação tudo ou nada + ajustes da tela do app

**Data:** 2026-10-13 · **Fase:** melhoria da Comanda C (PR #147, já em produção com a 086).
**Decisão do dono (2026-10-13):** gravação "tudo ou nada" por função no banco; desconto e cortesia já
seguem a regra da comanda (`comanda.desconto`) — sem mudança.

## Problema

`shared/venda.ts` → `gravarVenda` grava em 4 chamadas separadas: `vendas` → `venda_itens` →
`estoque_movimentos` → `pagamentos`. Falha no meio deixa estado parcial:

- itens falham → tenta apagar a venda (policy de DELETE da 086); se não conseguir, venda sem itens conta como receita;
- estoque falha → venda e pagamento ficam, só um aviso (`avisoEstoque`);
- pagamentos falham → venda conta no faturamento sem pagamento; a tela trava (`vendaIncompleta`).

Além disso, o limite de estoque só existe no carrinho (saldo lido ao carregar a tela): duas vendas do
último item ao mesmo tempo (web + app, ou duas abas) deixam `estoque_atual` em −1.

Na tela do app (`mobile/app/(empresa)/vendas.tsx`):
- a tela fica montada na pilha: ao voltar, estoque dos cards e histórico do dia são os antigos;
- "Sem permissão" pisca enquanto as permissões carregam (`podeVendas` falso antes de `permissoesCarregadas`);
- clientes sem paginação (web e app): acima de 1000 a lista é cortada pelo PostgREST.

## Solução

### 1. Migration 087 — `registrar_venda_avulsa`

```
public.registrar_venda_avulsa(
  p_empresa uuid, p_cliente uuid, p_desconto numeric,
  p_itens jsonb,       -- [{ produto_id, quantidade, preco_unitario }]
  p_pagamentos jsonb   -- linhas de montarPagamentos sem venda_id
) returns uuid         -- id da venda
```

- `language plpgsql`, **security invoker** (sem `security definer`): todas as policies valem como hoje.
  Quem não tem `vendas.acessar` é recusado (checagem explícita no início com `tem_permissao`, errcode
  `42501`, além do RLS de `estoque_movimentos`).
- Uma transação só (a função inteira): qualquer `raise` desfaz tudo.
- Validações no servidor (mensagens em português, errcode `P0001`):
  - `p_itens` não vazio; cada quantidade > 0 e preço ≥ 0;
  - `valor_total` = soma de `quantidade × preco_unitario`, **calculado na função** (não vem da tela);
  - `0 ≤ p_desconto ≤ valor_total`;
  - soma dos pagamentos ≥ total − 0,005 (total = valor_total − desconto); total zero aceita a linha de cortesia R$ 0.
- Estoque: para cada produto (itens agrupados por `produto_id`, em ordem de id para não haver deadlock),
  `pg_advisory_xact_lock(hashtextextended('venda_estoque:' || produto_id, 0))`, depois lê `nome, estoque_atual`
  de `produtos` com `empresa_id = p_empresa and tipo = 'venda' and ativo`. Não achou → "Produto indisponível
  para venda". Saldo < quantidade → `Estoque insuficiente: <nome> (restam <saldo>)`.
  (Advisory lock e não `select … for update`: `for update` exige a policy de UPDATE de `produtos`
  = `estoque.acessar`, que quem só tem `vendas.acessar` não tem.)
- Inserts: `vendas` (observacao null) → `venda_itens` → `estoque_movimentos` (`saida`, motivo
  `'Venda avulsa'`; o trigger `atualizar_estoque` baixa o saldo) → `pagamentos` com `venda_id`
  (colunas `valor, metodo::pagamento_metodo, bandeira, parcelas, taxa_perc, valor_liquido, maquininha_id, status`).
- `grant execute … to authenticated`; `revoke … from anon, public`.
- Cabeçalho com rollback (`drop function`) e `notify pgrst, 'reload schema';`.

### 2. `shared/venda.ts` — `gravarVenda` chama a função

- Mesma assinatura e mesmas validações locais de hoje (carrinho, desconto, `resumoComanda`).
- Monta `p_pagamentos` com `montarPagamentos` (sem `vendaId`) e chama `db.rpc('registrar_venda_avulsa', …)`.
- Sucesso → `{ vendaId, avisoEstoque: null }`.
- Erro `PGRST202` (função ainda não existe — a 087 não foi rodada) → caminho atual em 4 passos,
  sem mudança (ordem de deploy livre).
- Qualquer outro erro → `ErroVenda('venda', mensagemErroBanco(erro, 'registrar a venda'), null)`:
  nada ficou gravado, pode tentar de novo.
- O tipo `ClienteDb` ganha `rpc` (estrutural, como em `permissoes-consultas.ts`).
- As telas não mudam o tratamento de erro: `vendaIncompleta`/`avisoEstoque` continuam para o caminho antigo.

### 3. Tela de Vendas do app

- `useFocusEffect` (expo-router): ao voltar para a tela, recarrega catálogo (estoque) e, na aba
  Histórico, as vendas do dia. A primeira montagem não carrega duas vezes.
- Enquanto `permissoesCarregadas` for falso, mostra o carregamento em vez de "Sem permissão".
- Clientes paginados (`buscarTodasOuLancar` de `shared/kpis-financeiros-consultas.ts` (erro vira mensagem, nunca lista cortada), com `.order('id')` de desempate),
  no app e no web (`web/app/(app)/vendas/page.tsx`).

## Fora do escopo

- Gravação da comanda (continua em passos; função própria no futuro).
- Comanda continua sem bloquear produto sem estoque (decisão de 29/09).
- Taxa de 0% gravada como null (Cartões).

## Testes

- `web/tests/unit/venda.test.ts` (ampliar): banco simulado — rpc chamado com `p_itens`, `p_desconto`,
  `p_pagamentos` certos (sem `venda_id`, cortesia em total zero); `PGRST202` cai no caminho antigo;
  erro da função vira `ErroVenda` com `vendaId` null e não faz nenhum insert.
- Teste lendo `087_*.sql`: sem `security definer`; `tem_permissao(…'vendas.acessar')`;
  `pg_advisory_xact_lock`; `valor_total` calculado na função; `grant execute … authenticated`.
- Teste lendo `mobile/app/(empresa)/vendas.tsx`: `useFocusEffect`, `permissoesCarregadas`,
  clientes via `buscarTodasOuLancar`; e o web também pagina clientes.

## Produção

Rodar `087_registrar_venda_avulsa.sql` no SQL Editor
(https://supabase.com/dashboard/project/qpiepxolyqmoankeyeva/sql/new). Ordem livre em relação ao deploy.
