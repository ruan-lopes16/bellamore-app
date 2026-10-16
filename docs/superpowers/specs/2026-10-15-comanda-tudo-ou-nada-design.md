# Pendências — Entrega 1: comanda e venda "tudo ou nada"

**Data:** 2026-10-15 · Branch `feat/pendencias-registradas`.
Inventário das gravações atuais: `docs/superpowers/notes/2026-10-15-inventario-gravacoes-comanda.md`.

## Decisões do dono (2026-10-15)

1. Fechar e editar a comanda gravam tudo numa transação (função no banco), no modelo da 087.
2. **Desconto é da comanda inteira**: rateado proporcionalmente entre atendimentos (e linhas de multi-serviço) e itens
   extras (serviço, produto, pacote vendido); cada comissão sai sobre o valor **com desconto**. A taxa de reserva paga
   **não** entra no rateio (é pagamento adiantado, não desconto).
3. Item incluído ao editar comanda de outro mês: comissão e receita no **mês do fechamento** (`comandas.fechada_at`).
4. **Taxa de reserva no faturamento (regra final, fa8b6d8):** atendimento concluído conta inteiro
   (`valor − desconto_rateado`) na data do atendimento. **A parte da reserva descontada na comanda não conta de novo;
   o resto conta pela `paga_em`** (`parteReservaNaoDescontada`, que distribui `comandas.desconto_reserva` entre as
   taxas pagas da comanda). Reserva sem comanda (atendimento que não aconteceu, taxa `retida`) conta inteira pela `paga_em`.
5. Venda avulsa ganha chave contra repetição (queda de rede depois do commit não duplica).

## Problemas que resolve

- Fechamento/edição em 10+ chamadas soltas: falha no meio deixa comanda órfã, atendimento concluído sem pagamento,
  venda sem itens, pagamentos apagados sem reinserção. Duplicidade conferida por SELECT separado (corrida).
- Baixa de estoque dos produtos extras recusada para a profissional sem `estoque.acessar` (comanda só com extras).
- Desconto manual não entra em receita nem em comissão (KPI soma `agendamentos.valor` bruto; venda via comanda grava
  `desconto = 0`).
- Taxa de reserva paga contada duas vezes (conferido em produção: 11 atendimentos, R$ 279,00 a mais).
- `comandas.fechada_at` ignorado na comissão de item incluído na edição (`created_at = now()`).
- Policy "comissoes: membro insere": qualquer membro insere comissão pela API.
- `comanda.editar_fechada`, `comanda.desconto`, `pacotes.vender` só conferidos na tela.

## Solução

### 1. Migration 090 (`090_comanda_tudo_ou_nada.sql`)

**Colunas:** `agendamentos.desconto_rateado numeric(10,2) not null default 0`,
`agendamento_servicos.desconto_rateado` (idem), `comanda_itens.desconto_rateado` (idem),
`estoque_movimentos.comanda_id uuid references comandas(id) on delete set null`.

**Função `fechar_comanda(p jsonb) returns uuid`** (plpgsql, security invoker, uma transação):
- `p.comanda_id` (uuid gerado na tela) é a **chave de idempotência**: se a comanda já existe e é desta empresa, devolve o
  id sem gravar nada.
- Permissões: `comanda.fechar`; desconto > 0 ou pagamento cortesia com valor → `comanda.desconto`; pacote vendido →
  `pacotes.vender`. 42501 em português.
- Atendimentos: `UPDATE ... WHERE id = any(...) AND comanda_id IS NULL` com contagem conferida (`GET DIAGNOSTICS`):
  diferente do esperado → "Este atendimento já teve a comanda fechada." (desfaz tudo).
- Valores **recalculados no banco** a partir do payload (valor de cada atendimento/linha/extra, quantidade): subtotal,
  desconto manual (valida ≤ subtotal), desconto de reserva lido de `taxas_reserva` paga dos atendimentos, total,
  pagamentos cobrem o total (troco permitido; total zero = cortesia R$ 0 obrigatória).
- **Rateio do desconto manual** em centavos, proporcional ao valor de cada parte; o resto de centavos vai para a maior
  parte. Grava `desconto_rateado` em cada atendimento, linha de `agendamento_servicos` e item.
- Ordem de gravação preservando os triggers: `comandas` (profissional_id = `auth.uid()`) → `agendamento_servicos`
  (valor + desconto) → `agendamentos` (valor, desconto_rateado, pacote_cliente_id, comanda_id, status concluido **no
  mesmo UPDATE**, para `gerar_comissao`/`fn_registrar_uso_pacote`) → `comanda_itens` → pacotes vendidos
  (`pacote_clientes` + `vendas`) → produtos (trava `venda_estoque:` por produto em ordem de id, saldo **não** bloqueia
  — decisão de 29/09 —, `estoque_movimentos` saída com `comanda_id`, `vendas` + `venda_itens` com o desconto rateado
  dos produtos) → `pagamentos` (`comanda_id`).
- Sem RETURNING; ids gerados na função.

**Função `editar_comanda(p jsonb) returns void`**: mesma regra de permissões (`comanda.editar_fechada`), diff dos extras
(inclui/altera/remove, nunca apaga item com comissão paga — o trigger da 085 já recusa), novo desconto e rateio,
`agendamentos.valor`/`desconto_rateado` e linhas, pagamentos apagados e reinseridos **na mesma transação** (os não
alterados mantêm `taxa_perc`, `maquininha_id` e `created_at`). Produtos, quantidades de produto e pacote continuam só
leitura (decisão anterior).

**Triggers:**
- `gerar_comissao` (065) e `sincronizar_comissao_valor` (075): base = `valor − desconto_rateado`; o 075 passa a reagir
  também a `desconto_rateado`.
- 085 (`gerar_comissao_item` / `sincronizar_comissao_item`): base = `valor_unit × quantidade − desconto_rateado`;
  `created_at` da comissão = `comandas.fechada_at` (decisão 3).
- Nenhuma mudança de regra para comissão já paga além das que já existem (075/085).

**RLS:**
- `estoque_movimentos` INSERT: ramo novo `tipo = 'saida' and comanda_id is not null and comanda_pertence_ao_profissional(comanda_id)`
  (baixa dos produtos da comanda que ela fechou).
- Drop da policy "comissoes: membro insere" (comissões só nascem por trigger). Conferir antes no CSV/produção os nomes
  das policies de INSERT de `comissoes` e manter só as necessárias aos triggers (que são `security definer`).
- Recriar com `search_path` as funções `fn_registrar_uso_pacote` e `notificar_estoque_baixo` se forem tocadas.

**Venda avulsa (087):** `registrar_venda_avulsa` ganha parâmetro opcional `p_venda_id uuid default null` (assinatura
nova = função nova `registrar_venda_avulsa_v2` para não quebrar clientes antigos — regra do cabeçalho da 087): se a
venda já existe, devolve o id sem gravar. A tela gera o id uma vez por carrinho e reaproveita na nova tentativa.

### 2. Receita (`shared/kpis-financeiros.ts` e consultas)
- Serviços = `Σ (agendamentos.valor − desconto_rateado)` dos concluídos sem pacote (linhas de multi-serviço idem).
- Extras = `Σ (valor_unit × quantidade − desconto_rateado)`.
- Taxas de reserva: a parte descontada na comanda (`comandas.desconto_reserva`) não conta de novo; o resto conta pela `paga_em`.
- Mesma função em Financeiro, Dashboard, Relatórios e exportações (web e app) — já é única desde a 2A.
- Histórico: atendimentos antigos têm `desconto_rateado = 0` (sem backfill; o desconto antigo nunca entrou na receita —
  registrar no PR).

### 3. Telas (web `comanda/page.tsx`, app `nova-comanda.tsx`, PDV web e Vendas app)
- Fechar e editar chamam as funções (via `shared/comanda-gravacao.ts`, que monta o payload a partir do estado da tela
  e trata o erro: 42501, duplicidade, sem resposta → "Sem resposta do servidor: a comanda pode ter sido fechada. Confira
  antes de repetir." e reaproveita o mesmo `comanda_id`).
- Sem a 090 (`PGRST202`): caminho atual (ordem de deploy livre).
- Resumo da comanda mostra o desconto já dividido? Não — a tela continua mostrando subtotal/desconto/total; o rateio é
  interno (comissões e relatórios).

## Fora do escopo
- Trava de saldo negativo na comanda (comanda não bloqueia sem estoque — decisão de 29/09).
- Backfill de `desconto_rateado` em comandas antigas.

## Testes
- SQL da 090 lido como texto: assinatura, security invoker, permissões, `GET DIAGNOSTICS`, ordem das gravações, trava de
  estoque, rateio, idempotência, grants, triggers com a base nova, drop da policy de comissões.
- `shared/comanda-gravacao.ts` com `fakeDb`: payload certo nos casos do inventário (simples, multi-serviço, pacote,
  combo, extras com profissional, produto, reserva, cortesia, só extras, avulso), `PGRST202` → caminho antigo, erros.
- Rateio: feito só no banco (fonte única); teste do SQL confere a regra de centavos (resto na maior parte) e uma função pura espelho `ratearDescontoCentavos` em `shared/comanda-fechamento.ts` documenta e testa os casos (usada só em testes e no aviso de prévia, se houver).
- Receita: fixture com reserva paga + atendimento concluído conta uma vez (a parte descontada na comanda não conta de novo; o resto conta pela `paga_em`); desconto rateado sai da receita.

## Produção
Rodar a 090 no SQL Editor (ordem livre: sem ela as telas usam o caminho atual). Depois: fechar uma comanda com
desconto e serviço extra e conferir comissões e Financeiro.
