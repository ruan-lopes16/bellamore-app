# Agendamento cancelado some da agenda e fica só no histórico da cliente

**Data:** 2026-09-09
**Branch:** `claude/cancelamento-historico-limpeza-532894`
**Tipo:** bugfix / alinhamento de comportamento entre plataformas (sem migration, sem RLS, sem arquivo novo)

---

## 1. Problema

Ao cancelar um agendamento, a agenda **web** continua exibindo a linha — riscada e com
fundo hachurado (tratamento `inativo`). O usuário quer que um agendamento cancelado:

- **suma da agenda** (web e app nativo);
- apareça **apenas no histórico da cliente** (web e app nativo).

O print que originou o pedido é o PWA (app web aberto no iPhone), na visão Timeline.

## 2. Estado atual (levantado no código)

| Local | Hoje | Alvo |
|---|---|---|
| Agenda web — `web/app/(app)/agenda/page.tsx` (lista "Semana", "Timeline", bolinhas do "Mês") | mostra `cancelado` riscado/hachurado | **sumir** |
| Agenda nativa — `(empresa)/agenda.tsx` + `(profissional)/agenda.tsx` (via `useAgendamentoDia`, `useAgendaProfissional`, `useDiasComAgendamento`, `useDiasProfissional`, `useKpisDiaProfissional`) | já filtra `.neq('status','cancelado')` | já ok |
| Histórico da cliente — web `web/app/(app)/clientes/[id]/page.tsx` (`carregarHistorico`) | já mostra `cancelado` com badge "Cancelado" | já ok |
| Histórico da cliente — app nativo `mobile/hooks/useClientes.ts` (`useClienteDetalhe`) | **esconde** `cancelado` (`.neq('status','cancelado')` na linha ~225) | **mostrar** |

Ou seja, o comportamento hoje é assimétrico entre plataformas e o alvo é
convergir: agenda nunca mostra `cancelado`; histórico da cliente sempre mostra.

## 3. Decisões

- **`faltou` NÃO muda.** Hoje a agenda web trata `faltou` e `cancelado` de forma
  idêntica (`const inativo = ag.status === 'faltou' || ag.status === 'cancelado'`).
  Só `cancelado` sai da agenda. `faltou` continua visível e riscado — é um evento
  real do dia (o horário foi perdido / a cliente não compareceu).
- **Alinhar o histórico da cliente no app nativo** para mostrar `cancelado`, igual
  ao web. Assim "aparece só no histórico" vale nas duas plataformas.
- **Sem migration.** É tudo filtro de query e de render no cliente.
- **Ramos de estilo `cancelado` mortos ficam como estão.** Depois do filtro,
  `cancelado` nunca chega ao render da agenda; os trechos que estilizam
  `ag.status === 'cancelado'` (hachura, `line-through`, `STATUS_CFG.cancelado`
  no `AgCard`) viram inalcançáveis mas inofensivos. Não serão removidos, para
  manter o diff cirúrgico e não tocar em código que funciona.

## 4. Mudanças

### 4.1 Agenda web — `web/app/(app)/agenda/page.tsx`

Cobre desktop **e** o PWA no celular num único arquivo.

1. **`fetchDia`** (query que alimenta lista "Semana" e "Timeline"): adicionar
   `.neq('status', 'cancelado')` ao `select` de `agendamentos`. Espelha o que os
   hooks do app nativo já fazem. Um dia inteiro de cancelados nem é carregado.

2. **`fetchMes`** (query de contagem por dia da visão "Mês"): adicionar o mesmo
   `.neq('status', 'cancelado')`, para dia só-cancelado não pintar ponto no
   calendário nem entrar no tooltip "N agendamentos".

3. **Lista visível derivada.** No componente `AgendaPage`, criar:

   ```ts
   const agsVisiveis = useMemo(
     () => ags.filter(a => a.status !== 'cancelado'),
     [ags],
   );
   ```

   e passar `agsVisiveis` (em vez de `ags`) para `<ListaDia ags=…>` (usado nas
   views "semana" e "mes") e `<TimelineView ags=…>`.

   **Por quê o filtro no render além do filtro na query:** `mudarStatus` faz update
   otimista — `setAgs(prev => prev.map(a => a.id === id ? { ...a, status } : a))` —
   e, em caso de erro na gravação, reverte relendo `statusOriginal` de `ags`.
   Ao marcar "Cancelado" pelo painel de detalhes, a linha continua em `ags` com
   `status: 'cancelado'` até o próximo `fetchDia`. O filtro no render faz a linha
   sumir imediatamente; `ags` cru permanece intacto como fonte de verdade do
   revert (se a gravação falhar, o status volta ao original e a linha reaparece
   sozinha, porque `agsVisiveis` recomputa).

   `ags` cru continua sendo usado **apenas** por `mudarStatus` (busca +
   revert). Todo consumo visual passa por `agsVisiveis`.

4. **Não mexer** em: `TimelineView` internamente (`inativo`, hachura), `AgCard`
   (`STATUS_CFG.cancelado`), `ListaDia` internamente. Ramos mortos, sem efeito.

Nenhuma assinatura Realtime repovoa `ags` nesta tela (confirmado — só `fetchDia`
e `mudarStatus` chamam `setAgs`).

### 4.2 Histórico da cliente no app nativo — `mobile/hooks/useClientes.ts`

Em `useClienteDetalhe`, na sub-query de `agendamentos` dentro do `Promise.all`
(hoje com `.neq('status', 'cancelado')` por volta da linha 225):

- **Remover** o `.neq('status', 'cancelado')`. Passa a trazer também os cancelados
  para `historico`.

Downstream verificado, sem efeito colateral:

- `linhasDeVisita = historicoCompleto.filter(a => a.status === 'concluido')` —
  contagem de visitas, `total_gasto`, `ultima_visita` e `tags` derivam só de
  `concluido`. Incluir cancelados em `historico` não altera nenhum desses números.
- A aba "Histórico" de `mobile/app/(empresa)/cliente/[id].tsx` renderiza
  `cliente.historico` e resolve `STATUS_CONFIG[ag.status]`, que já tem entrada
  `cancelado` (badge vermelho "Cancelado"). Fica igual ao web.

## 5. Fora de escopo (já atende hoje)

- Agenda nativa (empresa + profissional), KPIs do dia, bolinhas do mês nativo — já
  filtram `cancelado`.
- Histórico da cliente no web — já mostra `cancelado`.
- App do cliente final (`mobile/app/(cliente)/historico.tsx`) — não faz parte do
  pedido; não será tocado nesta entrega.
- Detecção de conflito ao criar/editar agendamento no web já ignora
  `cancelado`/`faltou` (`.not('status','in','("cancelado","faltou")')`).

## 6. Verificação

Não há função pura nova — é filtro de query e de render. Portanto:

- `cd web && npx tsc --noEmit` — zero erros.
- `cd web && npm test` — suíte existente verde (nada deve quebrar).
- `cd mobile && npx tsc --noEmit` — mantém exatamente os ~10 erros pré-existentes
  (baseline), zero novos, nenhum nos arquivos tocados.
- Conferência manual dos caminhos de render:
  1. Agenda web "Semana" (lista do dia) — cancelado não aparece.
  2. Agenda web "Timeline" — cancelado não aparece; `faltou` continua riscado.
  3. Agenda web "Mês" — dia só-cancelado não pinta ponto; contagem exclui cancelado.
  4. Painel de detalhes → marcar "Cancelado" — linha some na hora; erro simulado
     de gravação → linha reaparece com status original.
  5. Histórico da cliente (app nativo) — cancelado aparece com badge; contagem de
     visitas e total gasto inalterados.

## 7. Risco

Baixo. Mudanças aditivas de filtro, um `useMemo` local, e a remoção de um filtro
no mobile que devolve dado que o web já mostra. Sem schema, sem RLS, sem contrato
de API novo.
