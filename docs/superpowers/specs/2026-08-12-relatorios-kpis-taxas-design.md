# Relatórios: KPIs de valor para taxa de reserva e cancelamento

## Contexto

A grade de KPIs em `web/app/(app)/relatorios/page.tsx` já calcula `brutoReserva`
(soma de `taxas_reserva.valor` pagas no período) e `brutoTaxas` (soma de
`taxas_cancelamento.valor` pagas no período) — ambos já entram no cálculo de
Faturamento Bruto, mas não aparecem como card próprio na grade. A grade já
tem um card "Taxa de cancelamento" que mostra uma **porcentagem** (% de
agendamentos cancelados/faltosos sobre o total), não um valor em R$.

## Decisão aprovada

Adicionar dois novos `KpiCard` à grade existente (`grid-cols-2 md:grid-cols-4`,
linhas ~951-972), posicionados logo após o card "Taxa de cancelamento" (%) e
antes de "Total comissões":

1. **"Taxa de reserva"** — `fmtBRL(brutoReserva)`, ícone `CalendarCheck`,
   cor `#1D4ED8`.
2. **"Taxa de cancelamento (R$)"** — `fmtBRL(brutoTaxas)`, ícone `Receipt`,
   cor `#DC2626`. Nome escolhido deliberadamente para distinguir do card de
   porcentagem já existente ("Taxa de cancelamento", sem sufixo).

Ambos seguem o padrão de visibilidade condicional já usado pelo card "Taxas
de cartão" (`{taxasCartao > 0 && (...)}`): só renderizam quando o valor do
período é maior que zero.

## Dados

Nenhuma query nova. `brutoReserva` e `brutoTaxas` já existem no componente
(useMemo, linhas ~565-566), calculados a partir das queries já carregadas em
`carregar()` (`taxas_reserva` e `taxas_cancelamento`, ambas já filtradas por
pago no período).

## Fora de escopo

- Alterar o card "Taxa de cancelamento" (%) existente.
- Novas queries ou novos campos de banco.
- Replicar esses KPIs em Financeiro ou Dashboard (só Relatórios, onde a
  conversa começou).
- Ranking ou breakdown adicional dessas taxas (ex.: por cliente).

## Verificação

- `npx tsc --noEmit` no web.
- Sem teste unitário novo — os valores somados (`brutoReserva`, `brutoTaxas`)
  já existem e não mudam; a mudança é puramente de apresentação (novos
  `KpiCard`).
- Conferência visual não é possível nesta sessão (sem conta de teste) — como
  já registrado na sessão anterior.
