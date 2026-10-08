# Comanda A — fechamento correto (web e app)

**Data:** 2026-10-08
**Status:** Desenho aprovado pelo dono; aguardando revisão desta spec

## Contexto

Paridade web × app, bloco "Comanda / Vendas" do inventário
(`docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md`, linhas 55–76). O dono dividiu
em três partes: **A — fechamento correto (dinheiro)** (esta spec), B — recursos da comanda no app,
C — Vendas avulsas (PDV) no app.

### Estado atual (levantado no código em 2026-10-08)

- App (`mobile/app/(empresa)/nova-comanda.tsx`): fecha com total > 0 sem pagamento ou com pagamento
  parcial; não grava `bandeira`, `parcelas`, `taxa_perc`, `valor_liquido`; desconto em R$; não grava o
  valor cobrado em `agendamentos.valor`/`agendamento_servicos.valor` (com pacote a comissão sai sobre o
  valor cheio); não confere erro em `comanda_itens`, `pagamentos`, `vendas`, `venda_itens` e mostra
  "Comanda fechada!" mesmo com falha; UPDATEs sem `.eq('empresa_id')`.
- Web (`web/app/(app)/comanda/page.tsx`): exige o total coberto (troco permitido, ~1743); desconto em %;
  taxas fixas em `web/lib/taxas-cartao.ts` (débito 2,39%, crédito à vista 4,99%, parcelado 5,59%,
  InfinitePay); edição de comanda fechada perde o desconto manual, não aplica Cortesia R$0, mistura
  comandas da mesma cliente no mesmo dia, não confere erros e não ajusta estoque/vendas.
- Banco: `pagamentos` já tem `bandeira` (021), `parcelas`, `taxa_perc`, `valor_liquido` (026). O trigger
  `trg_empresas_nao_dona_so_taxas` (083) deixa quem não é dona alterar só colunas `taxa_*` de `empresas`,
  com a permissão `config.taxas`.

## Decisões do dono (2026-10-08)

1. Dividir em A/B/C; começar pela A.
2. Desconto: a pessoa **escolhe % ou R$**; grava-se sempre o valor em reais.
3. Taxas da maquininha **editáveis em Configurações**.
4. Caminho: regra única em `shared/` + gravação pelo aparelho conferindo cada erro (fechamento "tudo
   ou nada" no banco fica para fase própria).
5. Na edição de comanda fechada, **produtos e quantidades ficam só leitura**; editáveis: valores dos
   serviços, desconto e pagamentos.
6. Regras já decididas no inventário: desconto acima do subtotal é bloqueado nas duas plataformas;
   a comanda permite repetir método de pagamento (ex.: dois cartões).

## Design

### 1. `shared/comanda-fechamento.ts` (puro, testado)

- `type ModoDesconto = 'percentual' | 'valor'`.
- `calcularDesconto(subtotal: number, entrada: number, modo: ModoDesconto): { valor: number; erro: string | null }`
  — percentual: `subtotal × entrada / 100`, arredondado a centavos; valor: a própria entrada. Negativo → 0.
  Maior que o subtotal → `erro: 'O desconto não pode ser maior que o subtotal'` e `valor` limitado ao subtotal.
- `type Split = { metodo: string; valor: number; bandeira?: string | null; parcelas?: number }`.
- `resumoComanda({ subtotal, desconto, descontoReserva, splits })` → `{ subtotal, desconto, descontoReserva,
  total, recebido, falta, troco, cortesiaAutomatica, podeFechar, motivo }`:
  - `total = max(subtotal − desconto − descontoReserva, 0)` (o desconto de reserva continua via
    `aplicarDescontoReserva` de `shared/taxa-reserva.ts`);
  - `cortesiaAutomatica = total < 0,01`; `podeFechar` exige `total < 0,01` ou `recebido ≥ total − 0,01`;
  - `motivo` em português quando não pode ("Ainda faltam R$ X para cobrir o total"; erro de desconto).
- `montarPagamentos(splits, contexto: { empresaId, comandaId, taxas: TaxasCartao })` → linhas de
  `pagamentos` com `metodo`, `valor`, `bandeira` (só cartão), `parcelas` (crédito; senão 1), `taxa_perc`,
  `valor_liquido`, `status: 'pago'`. Cortesia automática → uma linha `metodo 'cortesia'`, valor 0.
- `valorCobradoPorAtendimento(itens)` → para cada agendamento/serviço da comanda, o valor efetivamente
  cobrado (sessão de pacote = 0; demais = valor do item). É o que se grava em `agendamentos.valor` e
  `agendamento_servicos.valor`.

### 2. Taxas da maquininha editáveis

- Migration `084_taxas_cartao_empresa.sql`: `empresas` ganha `taxa_cartao_debito`,
  `taxa_cartao_credito_avista`, `taxa_cartao_credito_parcelado` (`numeric(6,4) not null`, default
  `0.0239`, `0.0499`, `0.0559`, check `between 0 and 0.2`). Idempotente, `notify pgrst` no fim. Sem
  policy nova (o trigger da 083 já cobre `taxa_*`).
- `shared/taxas-cartao.ts` (substitui `web/lib/taxas-cartao.ts`): `type TaxasCartao`, `TAXAS_PADRAO`,
  `taxasDaEmpresa(empresa)` (lê as colunas; ausentes → padrão, para funcionar antes da migration),
  `calcTaxa(metodo, parcelas, taxas)`, `valorLiquido`, `fmtTaxa`, `OPCOES_PARCELAS`.
- Configurações → Empresa (web e app): bloco "Taxas da maquininha" com os 3 percentuais (máscara de %),
  visível/editável com `pode('config.taxas')` (dona sempre). Descrição da chave `config.taxas` no
  catálogo (`shared/permissoes.ts`) passa a "Editar taxas de reserva, cancelamento e maquininha".
- Pagamentos já gravados mantêm o `taxa_perc` com que foram gravados.

### 3. App — comanda

- Pagamento com bandeira e parcelas (crédito), igual ao web (`OPCOES_PARCELAS`, bandeiras do web).
- Desconto com seletor %/R$ (some sem `pode('comanda.desconto')`, como hoje).
- Botão Fechar desabilitado enquanto `!resumo.podeFechar`, com "Falta R$ X" / "Troco R$ X" visíveis.
- Ao fechar, na ordem do web: checagem de comanda já fechada → `comandas` → `comanda_itens` →
  agendamentos (`status`, `comanda_id`, `valor` cobrado; `.eq('empresa_id')`) → `agendamento_servicos.valor`
  → pacotes/vendas (fluxo existente) → `estoque_movimentos` → `vendas`/`venda_itens` de produtos →
  `pagamentos` (`montarPagamentos`). Cada passo confere `error`; na primeira falha: para, mostra
  `mensagemErroBanco(erro, 'fechar a comanda')` com o passo que falhou e NÃO mostra "Comanda fechada!".
  A tela recarrega o estado para não permitir cobrar de novo o que já entrou.

### 4. Web — comanda

- Seletor %/R$ no desconto; `resumoComanda`, `calcularDesconto` e `montarPagamentos` do shared no lugar
  dos cálculos locais (comportamento do fechamento novo igual ao de hoje, exceto o desconto em R$
  possível e o bloqueio de desconto > subtotal).
- Edição de comanda fechada (`abrirComandaFechada`/`editarComanda`):
  - carrega o desconto manual gravado (`comandas.desconto − comandas.desconto_reserva`) em modo R$;
  - aplica Cortesia R$0 automática como no fechamento;
  - opera só sobre a comanda escolhida (`comanda_id`), nunca sobre outras da mesma cliente no dia;
  - produtos e quantidades só leitura (decisão 5); editáveis: valores dos serviços, desconto, pagamentos;
  - grava valor cobrado nos atendimentos e confere todos os erros (mesma mensagem do item 3).

- Vendas avulsas do web (`web/app/(app)/vendas/page.tsx`) também usa as taxas: passa a importar de
  `@shared/taxas-cartao` e calcular com `taxasDaEmpresa(empresa)` — nenhuma outra mudança no PDV.

### 5. Erros e bordas

- Desconto > subtotal: bloqueia com mensagem (nas duas).
- Total R$0: Cortesia automática; não exige pagamento.
- Troco: permitido; `pagamentos.valor` grava o recebido (como hoje no web).
- Falha no meio: mensagem com o passo que falhou; nada de "Comanda fechada!"; recarregar.
- Empresa sem as colunas novas (084 não aplicada): `taxasDaEmpresa` usa o padrão — deploy em
  qualquer ordem.

## Testes

- Unitários: `calcularDesconto` (%, R$, negativo, acima do subtotal, arredondamento), `resumoComanda`
  (sem pagamento, parcial, exato, troco, cortesia, reserva), `calcTaxa`/`valorLiquido`/`taxasDaEmpresa`,
  `montarPagamentos` (débito, crédito 1x/3x com bandeira, pix, dinheiro, cortesia), `valorCobradoPorAtendimento`
  (pacote = 0).
- Migration 084 (texto): colunas, defaults, check, idempotência, `notify pgrst`.
- Paridade (varredura): web e app importam de `@shared/comanda-fechamento` e `@shared/taxas-cartao`;
  `web/lib/taxas-cartao.ts` removido; app não fecha sem `podeFechar`; UPDATEs de agendamentos no app
  com `.eq('empresa_id'`.
- `tsc` web zerado; mobile com os 6 erros pré-existentes.

## Fora de escopo

- Comanda B (backlog de dias, editar comanda fechada no app, multi-serviço, remover item, profissional em
  extra, recibo WhatsApp, editar valor/quantidade no app).
- Vendas avulsas (PDV) no app — parte C (e o PDV do web continua com seus métodos não repetidos).
- Fechamento atômico no banco (RPC) — fase própria.
- Ajuste de estoque/vendas ao editar produtos de comanda fechada (bloqueado por decisão 5).
