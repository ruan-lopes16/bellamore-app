# Push de bloqueio, recibos da Expo e ajustes de tela (C13, C14, B14) — design

**Data:** 2026-11-20 · **Branch:** `feat/push-graficos` · **Migration:** 102.

## C14 — push do bloqueio de agenda

Hoje o trigger da 069 grava em `notificacoes` três tipos de aviso: `bloqueio_pendente` (para quem aprova), `bloqueio_aprovado` e `bloqueio_recusado` (para quem pediu). Eles só aparecem no sino.

**Envio pelo cron de 5 em 5 minutos.** O cron que já existe (`/api/cron/lembretes`, chamado por `pg_cron`) passa a enviar também o push dessas notificações. O envio vai pelo web push e pelo app, com os mesmos `enviarWebPush` e `enviarPushExpo`.
- **O que entra:** notificações com `tipo in ('bloqueio_pendente','bloqueio_aprovado','bloqueio_recusado')`, `push_enviado_em is null` e `created_at` nas últimas 24 h.
- **Conteúdo:** título e mensagem da própria notificação.
- **Envio único:** `push_enviado_em` é marcado antes de enviar, só se ainda estiver nulo (`.is(null)` + `.select('id')`), com o mesmo padrão de `lembrete_30min_em`.
- **Escopo do aparelho:** só aparelhos da empresa da notificação (`push_dispositivos.empresa_id`), vistos nos últimos 30 dias. A inscrição web é a do usuário.
- **Preferência:** não há preferência para isso. É um aviso que pede ação, então vai sempre.

**Migration 102:**
- coluna `notificacoes.push_enviado_em timestamptz`;
- backfill com `now()` em todas as linhas que já existem, para não disparar avisos antigos;
- índice parcial `(created_at) where push_enviado_em is null`.

O cron usa service role. A migration confere se o trigger da 097, que só deixa mudar `lida`, barra o service role. Se barrar, ela passa a liberar `push_enviado_em` só para quem não é `authenticated`/`anon`. Pela API, a pessoa continua podendo mudar só `lida`.

## B14 — recibos da Expo e aparelho compartilhado

**Recibos.** O envio já apaga o aparelho quando o **ticket** volta com `DeviceNotRegistered`. Mas a Expo também devolve esse erro mais tarde, no **recibo**, e hoje o recibo nunca é lido.
- **Migration 102:** tabela `push_recibos (ticket_id text primary key, token text not null, criado_em timestamptz default now())`, com RLS ligada e nenhuma policy (só o service role acessa).
- **No envio:** `enviarExpo` grava o par (ticket, token) de cada ticket `ok`. Se falhar ao gravar, só registra no log; o envio continua.
- **No cron de 5 em 5 minutos:** os recibos com mais de 15 min são consultados em `https://exp.host/--/api/v2/push/getReceipts`, em lotes de até 300.
  - recibo `DeviceNotRegistered`: o aparelho é apagado de `push_dispositivos`;
  - recibos lidos e os com mais de 24 h são apagados da tabela.
- Sem a 102, a leitura e a gravação de recibos são puladas em silêncio (tabela inexistente) e o envio funciona como hoje.

**Aparelho compartilhado.** Desde a 097, `push_dispositivos.token` é único: o aparelho pertence à última conta que abriu o app. O caso "2 contas, só a 1ª recebe" vinha do caminho antigo `users.push_token`, que é só leitura e só vale sem a 097. Com a 097 aplicada em produção, ele não acontece mais e o item fica registrado como resolvido. Não há mudança de código.

## C13 — ajustes de tela

1. **Sparkline do Dashboard do app.** A largura passa a seguir o espaço do cartão (`onLayout`) em vez de 200 fixo. Assim o gráfico não passa por cima do texto em tela estreita.
2. **Gráfico do mês nos Relatórios do app.** Com mais de 10 pontos, os rótulos do eixo aparecem só em uma parte dos dias: o 1º, o último e a cada 5 dias. A regra fica numa função pura em shared (`rotulosEixoVisiveis(n, max)`), com teste.
3. **Mensagens de erro duplicadas.** Nos Relatórios (web e app), o mesmo erro aparecia no banner do topo e dentro da aba. Fica só um: o da aba, quando é erro da aba, e o banner, quando é erro geral.
4. **Alerta "0 lançadas".** No lançamento de recorrentes (web e app), quando todas as despesas do mês já existiam, a mensagem passa a ser "As despesas recorrentes deste mês já estavam lançadas." em vez de "0 lançadas". O texto fica numa constante de `shared/despesas-consultas.ts` (ou onde já está o lançamento).
5. **Spinner do histórico de Vendas do app.** O spinner aparece só na primeira carga. Nas recargas (foco da tela), a lista continua visível e a atualização é silenciosa.

## Testes

- **Unitários:**
  - push de bloqueio com db e fetch falsos: marca e envia uma vez; não reenvia; respeita 24 h e empresa;
  - recibos: grava, lê, apaga aparelho em `DeviceNotRegistered`, limpa a tabela; sem a 102 não quebra;
  - `rotulosEixoVisiveis`.
- **PGlite:** a 102 sobre a cadeia 090→101, conferindo o backfill e que pela API a pessoa ainda só consegue mudar `lida`.
- **Cruzado:** web e app usam a constante do "já estavam lançadas".

**Verificação:** vitest 100%, tsc web 0, tsc mobile só com o erro pré-existente, `next build` OK.

## Deploy

1. Rodar a 102.
2. Fazer as conferências.
3. Merge.

Sem a 102, o push de bloqueio não sai (a coluna não existe e o cron pula em silêncio) e os recibos não são lidos. Não há dependência nativa nova.
