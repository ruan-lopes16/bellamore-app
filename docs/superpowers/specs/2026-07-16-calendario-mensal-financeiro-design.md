# Calendario Mensal No Financeiro - Design

## Objetivo

Adicionar ao topo do modulo Financeiro uma forma visual de entender o mes selecionado, usando uma grade de calendario inspirada na Agenda.

## Escopo aprovado

- Usar a opcao 1: calendario mensal recolhivel abaixo do seletor compacto.
- Manter o Financeiro com filtro mensal, sem transformar a tela em uma visao diaria.
- Preservar a navegacao por mes ja existente: seta esquerda volta um mes, seta direita avanca ate o mes atual.
- Bloquear meses futuros como o seletor atual ja faz.
- Usar o visual da grade mensal da Agenda como referencia.

## Fluxo de usuario

1. O usuario abre o Financeiro.
2. O topo continua mostrando o mes atual no seletor compacto.
3. Ao tocar no centro do seletor, a grade do calendario abre ou fecha.
4. As setas mudam o mes visualizado e atualizam os KPIs/listas do Financeiro.
5. A grade mostra todos os dias do mes selecionado e os dias vizinhos para completar as semanas.

## Componentes tecnicos

- Novo componente client-side `FinanceMonthCalendar`, focado apenas em exibir o mes.
- A tela `web/app/(app)/financeiro/page.tsx` controla o estado aberto/fechado e continua dona de `mesRef`.
- A grade deve usar `date-fns` e `ptBR`, como Agenda e Financeiro ja usam.

## Criterios de aceite

- O seletor compacto abre e fecha uma grade mensal.
- O mes selecionado aparece destacado na grade.
- Dias fora do mes ficam com menor contraste.
- O botao de proximo mes continua desabilitado quando o mes exibido e o mes atual.
- `npm.cmd test -- tests/unit/finance-month-calendar.test.tsx` passa.
- `npx.cmd tsc --noEmit` passa sem erros.
