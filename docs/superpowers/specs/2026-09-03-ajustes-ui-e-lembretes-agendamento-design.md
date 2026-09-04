# Lote de ajustes de UI + lembretes de atendimento

## Contexto

Feedback do usuário a partir de 12 screenshots do **PWA (app web) rodando no
iPhone**, mais dois recados de acompanhamento sobre a limpeza de notificações.
São 13 itens: correções de UI, um bug real de gráfico, uma troca no menu inferior
e uma reformulação do sistema de lembretes de atendimento.

Todas as telas são do app web (`web/`). O app Expo (`mobile/`) recebe o espelho
**onde houver equivalente** — as exceções estão marcadas item a item.

Baseline conhecida antes de começar: `npx tsc --noEmit` zerado no web; ~10 erros
pré-existentes no mobile (não relacionados) que devem permanecer inalterados.

---

## A. Agenda — `web/app/(app)/agenda/page.tsx`

### A1. Nome + telefone do cliente cortados (anexo 1)

**Causa:** `web/components/SearchSelect.tsx` — no estado fechado com opção
selecionada, `label` e `sub` ficam na mesma linha dentro de um `<span class="flex-1 truncate">`.
Nome longo (“Lazara Maria Pacheco Marques”) + `sub` `(34) 99910-…` estoura e
trunca os dois.

**Design:** quando há opção selecionada **e** ela tem `sub`, empilhar:
- linha 1: `label` (pode truncar só em nome realmente extremo);
- linha 2: `sub` em `text-xs text-text-4`.

O contêiner do campo passa de `h-10` fixo para `min-h-10` com `py-1.5`, altura
automática. O modo busca (input) e o modo sem `sub` continuam iguais (1 linha,
`h-10`). Aplicar a mudança no componente — beneficia todo select com `sub`
(cliente, produto, pacote).

**Mobile:** o picker de cliente do Expo (`novo-agendamento.tsx`) usa layout
próprio; conferir se trunca da mesma forma e, se sim, aplicar o mesmo empilhamento.

### A2. Rótulo “Vender pacote agora” (anexo 1)

**Web:** `page.tsx` ~L781 — trocar
`Vender pacote agora <span…>(opcional — preenche os serviços e vende na hora)</span>`
por **`Pacote`** (sem o parêntese). O rótulo irmão (~L723) fica
`Pacote do cliente` (também sem o parêntese, por simetria).

**Mobile:** `novo-agendamento.tsx` já usa “Vender pacote agora” sem sufixo;
alinhar para `Pacote` / `Pacote do cliente`.

### A3. Scroll horizontal no modal “Editar agendamento” (anexo 2)

**Causa provável:** as células do `grid grid-cols-2 gap-2` de Duração/Valor
(`page.tsx` ~L826) e os inputs `type="date"`/`type="time"` (usam `inputClass`,
que tem `w-full` mas **não** `min-w-0`) têm largura mínima intrínseca no iOS
Safari maior que a coluna, empurrando o conteúdo além do `max-w-sm` do modal.

**Design:**
- adicionar `min-w-0` às células do grid de serviço e `min-w-0 max-w-full` ao
  `inputClass` (ou classe dedicada para os inputs date/time);
- varredura de `whitespace-nowrap` dentro do `<form>` do modal;
- **verificação obrigatória no navegador** a 320 px e 375 px: `document.documentElement.scrollWidth <= clientWidth`
  e o modal sem scrollbar horizontal.

### A4. Modal “Detalhes” espremido / dropdown cortado (anexos 3 e 4)

**Causa:** dentro do modal mobile (`page.tsx` ~L1448, `bm-modal-mobile`,
`max-w-sm max-h-[85dvh]`), o `AgCard` (~L183) renderiza o status como um menu
`absolute right-0 top-full` com backdrop `fixed inset-0`. O menu escapa dos
limites do modal e aparece cortado; o card fica apertado numa faixa.

**Design:**
- No `AgCard`, quando renderizado **dentro do modal mobile de Detalhes**,
  trocar o dropdown de status por uma **lista inline** de opções (coluna de
  “chips”/botões: Agendado · Confirmado · Concluído · Cancelado · Faltou),
  sem `position:absolute`, com o item atual destacado. Selecionar chama o mesmo
  `onStatus`.
- Dar respiro ao modal: `p-4` no corpo, largura `max-w-sm` mantida mas conteúdo
  numa hierarquia clara (cliente, serviços, horário, profissional, valor, status).
- O painel lateral do **desktop** (`hidden md:block`, ~L1467) continua com o
  dropdown atual — lá há espaço e o problema não ocorre.

Fazer isso via uma prop no `AgCard` (ex.: `statusInline?: boolean`) para não
afetar os outros usos (`ListaDia`, painel desktop).

**Mobile (Expo):** `agendamento/[id].tsx` já usa botões de ação de status
(Confirmar/Concluir/Faltou/Cancelar), não dropdown — nada a fazer.

### A5. Timeline: horário e todos os serviços (anexo 5)

**Causa:** no bloco da timeline (`page.tsx` ~L1406-1431):
- serviço exibido é só `ag.servico?.nome` (o serviço legado único), ignorando
  `ag.agendamento_servicos`;
- o horário (`{h >= 54 && …}`) só aparece quando o bloco tem ≥ 54 px de altura —
  atendimentos curtos (30–40 min) ficam sem horário.

**Design:**
- **Horário sempre visível:** mover o intervalo `HH:mm–HH:mm` para a mesma linha
  do nome (formato compacto, ex.: `17:30 · Fulana`), removendo o gate de altura.
  Em bloco muito baixo, priorizar nome + horário e ocultar o serviço.
- **Todos os serviços:** onde hoje mostra `ag.servico?.nome`, usar
  `agendamento_servicos` ordenado por `ordem`, nomes unidos por ` + `, com
  fallback para `ag.servico?.nome`. `truncate` na linha. (Mesmo padrão já usado
  no `AgCard`, ~L209-211.)

**Mobile (Expo):** `agenda.tsx` — o `AgendamentoCard` da timeline já mostra o
horário num “pill”, mas o serviço também é só `ag.servico?.nome`. Aplicar a
concatenação de `agendamento_servicos` (o Expo só cria 1 serviço por
agendamento, mas exibe agendamentos criados no web que podem ter vários).

---

## B. Financeiro — `web/app/(app)/financeiro/`

### B1. Skeleton fora do formato real (anexos 6 e 7)

**Causa:** `financeiro/loading.tsx` (skeleton de rota do Next, mostrado primeiro)
usa `grid-cols-1 sm:grid-cols-3` + `grid-cols-1 sm:grid-cols-2` — empilhado no
mobile. A tela real (`page.tsx` ~L1493, ~L1517) usa **`grid grid-cols-2 lg:grid-cols-3`**
em duas linhas. O usuário vê skeleton empilhado e depois um layout 2-colunas.

**Design:** reescrever `financeiro/loading.tsx` para espelhar o layout real:
header + seletor de mês + **um único grid `grid-cols-2 lg:grid-cols-3`** com o
número de cards que a tela costuma mostrar (6–8), + o grid de 2 colunas
(evolução / top serviços) + a lista de despesas. O bloco de `loading` interno do
componente (~L1478) já bate com o real — usá-lo como referência.

**Mobile (Expo):** conferir o skeleton de `financeiro.tsx` contra o layout real
de KPIs e alinhar se divergir.

### B2. Célula vazia no grid de KPIs (anexo 7)

**Causa:** a linha 1 de KPIs tem **3 itens** (Faturamento Bruto, Taxas de Cartão,
Líquido após Taxas) num grid de **2 colunas** no mobile → sobra a 4ª célula vazia
ao lado de “Líquido após Taxas” (o retângulo marcado no anexo 7). A linha 2 tem
3–5 itens e por acaso fecha par.

**Design:** unir as duas linhas num **único array** e um único grid
`grid grid-cols-2 lg:grid-cols-3`. Quando a contagem total for **ímpar**, o
último card recebe `col-span-2 lg:col-span-1` (ocupa a largura inteira no mobile,
volta a 1 coluna no desktop). Sem buraco no mobile. Ordem dos cards preservada
(Bruto → Taxas Cartão → Líquido → Comissões → Gastos → Lucro → [Taxas Cancel.]
→ [Taxas Reserva]).

**Verificação no navegador:** 375 px, sem célula vazia; 1280 px, grid de 3
colunas intacto.

**Mobile (Expo):** conferir o grid de KPIs de `financeiro.tsx` (usa
`flexWrap: 'wrap'`) — se houver “buraco” equivalente, aplicar largura cheia ao
último quando ímpar.

---

## C. Relatórios — `web/app/(app)/relatorios/page.tsx`

### C1. Gráfico “Evolução de faturamento” não escala (anexo 9)

**Bug confirmado:** `ChartBar` (~L295-316) calcula `heightPct = value / maxValue * 100`
e aplica `height: ${heightPct}%` numa `<div>` cujo pai (`flex-1 flex flex-col justify-end`)
**não tem altura definida**, porque o contêiner externo (`flex items-end`,
`height: 140`) não estica os filhos (`align-items: end`). `%` de pai sem altura
resolve para `auto` → toda barra colapsa para `minHeight: 4`. Resultado: barras
todas iguais independente do valor (jul 9.619 / ago 9.309 / set 930 → mesma
altura).

**Design:** dar altura definida à cadeia:
- `ChartBar` raiz: `self-stretch` (ou `h-full`) para herdar os 140 px;
- wrapper interno: manter `flex-1` + `min-h-0` para o `%` da barra resolver
  contra ele.

Não mexer no skeleton do gráfico (~L1103) — lá o `%` já resolve porque os `Sk`
são filhos diretos do contêiner com `height: 140`.

**Verificação no navegador:** três valores bem distintos (ex.: 9600 / 9300 / 930)
→ alturas visivelmente proporcionais (a barra de 930 ≈ 10 % da de 9600).

**Mobile (Expo):** `relatorios.tsx` — conferir o gráfico de evolução; se usar o
mesmo padrão de `%` sobre pai sem altura, corrigir de forma equivalente (RN:
garantir `flex: 1` na cadeia ou calcular a altura em px a partir de `maxValor`).

### C2. Comissão em rosa parece erro/pendente (anexo 10)

**Causa:** na aba Equipe (~L1312 e ~L1324), “Comissão: R$ …” e “Total comissões
no período” usam `text-pink-500`. O rosa é a cor de alerta/erro no resto do app.

**Design:** trocar por cor neutra — `text-text-2` no rótulo/linha da comissão do
profissional e `text-text` (negrito) no total. Reservar rosa/vermelho só para
deduções e alertas.

**Mobile (Expo):** conferir a aba Equipe de `relatorios.tsx` (tem `rose`/`#D4608A`
no tema) e aplicar cor neutra à comissão da mesma forma.

### C3. Card “Funil de atendimentos” redundante (anexo 11)

**Causa:** o card (~L1204-1227: Total marcados / Concluídos / Cancelados /
Faltaram) repete o que os KPIs no topo já mostram (Atendimentos concluídos,
Taxa de comparecimento, Taxa de cancelamento com “N perdido(s)”).

**Decisão:** **remover o card inteiro** (bloco `{!loading && (…Funil…)}`). Não
adicionar “Total marcados” como KPI — o usuário classificou como redundante e não
pediu para preservar nada.

**Mobile (Expo):** remover o “Funil de atendimentos” equivalente de
`relatorios.tsx`.

---

## D. Menu inferior do celular (anexo 8)

**Web:** `web/components/Sidebar.tsx` — no `MOBILE_NAV` (~L43), trocar o item
`/financeiro` por `/comanda` (label “Comanda”, ícone `Receipt`). Resultado:
`Início · Agenda · Clientes · Comanda · Mais`. Em `MAIS_NAV` (~L52), **adicionar
`/financeiro`** (label “Financeiro”, ícone `DollarSign`, permissão
`ver_resumo_financeiro`) e **remover `/comanda`** (que sobe para o nav). A
`Sidebar` desktop (`NAV`) não muda. A regra de “Financeiro some do bottom nav
quando restrito” passa a valer para o item dentro de “Mais”.

**Mobile (Expo) — decisão:** o app Expo **não tem tela de lista de Comanda**
(só `nova-comanda.tsx` e a visualização via `agendamento/[id]?tipo=comanda`).
Nesta leva, o menu inferior do Expo (`mobile/app/(empresa)/_layout.tsx`)
**fica como está** (Financeiro permanece). O swap no Expo depende de criar antes
uma tela de lista de comandas abertas — registrado como **follow-up separado**,
fora do escopo deste lote.

---

## E. Lembretes de atendimento + limpeza de alertas (anexo 12 + recados)

### Situação atual

- `web/vercel.json`: cron `0 10 * * *` → `web/app/api/cron/lembretes/route.ts`
  envia **1 push-resumo por empresa** (“Bom dia — X atendimentos hoje…”), para
  **todas** as assinaturas da empresa (`web_push_subscriptions`).
- `web/app/(app)/notificacoes/page.tsx`: a seção “Alertas ativos” lista **cada**
  agendamento pendente do dia como uma linha (o “paredão de 17”).
- Infra de push já existe: VAPID, `web/public/sw.js` (handler `push` +
  `notificationclick`), `web/components/SwRegister.tsx`, tabela
  `web_push_subscriptions` (com `user_id` e `empresa_id`), `web-push` no
  `package.json`.

### Cadência aprovada (revisada 2026-09-04)

> A cadência inicial (véspera + 30 min, com push também gravando no Histórico
> sem idempotência) causou spam em produção — o cron re-disparava a cada 5 min
> porque a `066` não tinha sido aplicada e o marcador nunca gravava. O usuário
> reespecificou:

- **Tipo 1 — por atendimento:** **1 h antes** + **15 min antes**. Sem véspera,
  sem 30 min. Conteúdo: `cliente · serviço (ou nome do pacote) · HH:mm`. Não
  dispara se o horário já passou, ou status `concluido` (= comanda fechada), ou
  `cancelado`. Cada janela dispara **uma vez** (colunas de marca-tempo).
- **Tipo 2 — resumo diário:** **1×/dia às 07:00 BRT** — nº de atendimentos do
  dia, despesas que vencem hoje, produtos com estoque baixo.
- **Tipo 3 — limpeza:** **1×/dia às 01:00 BRT** apaga **todas** as
  `notificacoes` de dias anteriores (qualquer `tipo`).

### E1. Migration 066 — colunas de rastreio

> **O que já existe e é reaproveitado (não recriar):** `005_push_token.sql` e
> `019_web_push_subscriptions.sql` — a infra de push, já em produção.

`supabase/migrations/066_agendamento_lembretes.sql`:
```sql
alter table public.agendamentos
  drop column if exists lembrete_vespera_em,
  drop column if exists lembrete_30min_em,
  add  column if not exists lembrete_1h_em    timestamptz,
  add  column if not exists lembrete_15min_em timestamptz;
```
O `drop … if exists` torna a migration segura mesmo em bancos onde a versão
antiga chegou a rodar. Nulas por padrão, sem policy nova (RLS de `agendamentos`
cobre colunas novas; o cron usa `service_role`).

### E2. `/api/cron/lembretes` — motor por atendimento (1 h + 15 min)

Auth `Authorization: Bearer ${CRON_SECRET}`. Por empresa ativa, em **uma** query,
busca agendamentos com `status in ('agendado','confirmado')` e
`data_hora_inicio` entre `now()` e `now() + 90 min`. Resolve `descricao_servico`
= `Pacote <nome>` quando há `pacote_cliente_id`, senão os nomes de
`agendamento_servicos` unidos por ` + ` (fallback: `servico.nome`).

Para cada janela `['1h','15min']`, `selecionarLembrete()` (função pura em
`shared/lembretes.ts`) filtra:
- janela **1h**: início entre `now+45min` e `now+75min`, `lembrete_1h_em is null`;
- janela **15min**: início entre `now` e `now+20min` (nunca depois do início),
  `lembrete_15min_em is null`.

Para cada selecionado: push individual (`titulo` = "Atendimento em 1 hora" /
"Atendimento em 15 minutos", `body` = `corpoLembrete(ag)`) aos destinatários
(`profissional_id` do ag ∪ owners/gestores), **1 linha** em `notificacoes`
(`tipo='agendamento'`, `user_id` do profissional), e `update agendamentos set
lembrete_Xh_em = now()`. Assinatura com erro 404/410 é apagada.

### E2b. `/api/cron/resumo-diario` — resumo diário (novo arquivo)

Mesma auth. Por empresa: conta agendamentos de hoje (`agendado`/`confirmado`,
fuso `America/Sao_Paulo`), despesas `pendente` com `data_vencimento = hoje`, e
linhas de `v_produtos_estoque_baixo`. `corpoResumoDiario()` monta o texto (só
linhas > 0; tudo zero → não envia). 1 push a **todas** as assinaturas da empresa
+ 1 linha `notificacoes` (`tipo='resumo'`) por membro ativo.

### E3. Migration 067 — agendadores `pg_cron` + `pg_net`

`supabase/migrations/067_cron_lembretes_pg_cron.sql` — extensões + dois jobs:
- `lembretes-atendimento` `*/5 * * * *` → `<APP_URL>/api/cron/lembretes`
- `resumo-diario` `0 10 * * *` (07:00 BRT) → `<APP_URL>/api/cron/resumo-diario`

`<APP_URL>` e `<CRON_SECRET>` são **placeholders documentados** no cabeçalho.
`cron.schedule` por nome é upsert (rodar de novo substitui). Remove nomes de
versões anteriores (`prune-notificacoes-agendamento`). `web/vercel.json` fica
`{}` (o cron diário sai; o `pg_cron` assume).

### E4. Migration 068 — limpeza diária de `notificacoes`

`supabase/migrations/068_prune_notificacoes_agendamento.sql` — job
`limpeza-notificacoes` `0 4 * * *` (01:00 BRT):
```sql
delete from public.notificacoes
where created_at < date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
```
**Todos os tipos**, não só agendamento. O que precisa reaparecer (estoque,
despesas, agendamentos do dia) é recalculado ao vivo na tela de Notificações.

### E5. Página Notificações — colapsar o “paredão”

`web/app/(app)/notificacoes/page.tsx` — na seção “Alertas ativos”, os alertas de
agendamento do dia (hoje construídos 1 por linha, ~L146-160) passam a ser **uma
única linha-resumo expansível**:
- fechada: “6 atendimentos hoje · próximo 14:00 — Fulana ▸”;
- expandida: a lista atual de linhas.

Os demais alertas (estoque, despesas, comissões, aniversários) continuam linha a
linha. Nada muda no cálculo — só a apresentação do grupo `ag-*`.

### E6. Mobile (Expo) — lembrete local

`mobile/lib/notifications.ts` — nova função
`agendarLembretesLocais(agendamentos)`:
- usa `expo-notifications` `scheduleNotificationAsync` com `trigger` de data;
- por atendimento futuro do usuário: 1 disparo **1 h antes** + 1 disparo
  **15 min antes**;
- cancela/reprograma (`cancelAllScheduledNotificationsAsync` + reschedule, ou
  por `identifier`) quando a agenda recarrega / um agendamento muda de horário
  ou é cancelado.

Chamada a partir da tela de agenda do Expo quando a lista do dia/semana carrega.
Não depende do servidor (funciona offline). O motor de push do servidor (E2)
continua cobrindo o PWA; o Expo usa agendamento local, que é mais confiável no
iOS nativo.

---

## Fora de escopo

- Swap de menu inferior no Expo (depende de criar tela de lista de Comanda —
  follow-up separado).
- Tornar a cadência de lembrete (1 h / 15 min) configurável pela empresa.
- Lembrete por SMS/WhatsApp/e-mail.
- Reformular a seção “Histórico” da página de Notificações além do prune E4.
- Multi-serviço no formulário de agendamento do Expo (continua 1 por
  agendamento).
- Refatoração ampla de `SearchSelect`, `AgCard` ou do grid de KPIs além do
  necessário para os itens acima.

---

## Verificação

- `npx tsc --noEmit` no web, zerado, a cada tarefa.
- `npx tsc --noEmit` no mobile: os ~10 erros de baseline preservados, nenhum
  novo.
- **Verificação no navegador (obrigatória) para:** A3 (sem scroll-x a 320/375),
  B1/B2 (skeleton bate com o real; sem célula vazia), C1 (barras proporcionais).
- Testes unitários novos: função de resolução de destinatários e a lógica de
  janela dos lembretes (E2) como funções puras testáveis, no padrão de
  `shared/`.
- `pg_cron`/`pg_net` e as migrations **066–068 (novas)** são **entregues mas não
  aplicadas** — dependem do usuário rodar `supabase db push` e substituir os
  placeholders de `APP_URL`/`CRON_SECRET` (mesma pendência das migrations 062/063
  anteriores). As migrations de push que o usuário já rodou são a `005` e a `019`
  — o plano só as consome, não mexe nelas.
