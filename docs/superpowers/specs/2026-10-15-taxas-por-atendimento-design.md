# Pendências — Entrega 2: taxa de reserva e de cancelamento por atendimento

**Data:** 2026-10-15 · Branch `feat/pendencias-registradas` (depois da Entrega 1).

## Decisão do dono (2026-10-15, opção "c — os dois")
As chaves gerais da empresa (Configurações: "Cobrar taxa de reserva", "Cobrar taxa de cancelamento", com modo e valor)
continuam sendo o padrão. Com a chave geral ligada, cada atendimento pode dispensar a taxa:
- **Reserva:** ao criar o agendamento, "Cobrar taxa de reserva neste atendimento" (marcado por padrão).
- **Cancelamento:** ao cancelar ou marcar falta, "Cobrar taxa de cancelamento (R$ X)?" (Sim / Não).

## Situação hoje
- Reserva: campo de valor sugerido (pela chave da empresa) + "Já foi cobrada?" em 3 telas (Agenda web,
  perfil da cliente web, novo-agendamento app). Para não cobrar, a pessoa precisa zerar o valor à mão.
- Cancelamento: trigger `gerar_taxa_cancelamento` (052) cria a taxa sempre que a chave da empresa está ligada e o status
  vira cancelado/faltou (conforme `aplica_cancelado`/`aplica_faltou`). Não há como dispensar um atendimento.

## Solução

### Banco — migration 091 (`091_taxa_cancelamento_por_atendimento.sql`)
- `agendamentos.cobrar_taxa_cancelamento boolean not null default true`.
- `gerar_taxa_cancelamento()` recriada com o corpo ATUAL da 052 + uma condição: `if not new.cobrar_taxa_cancelamento
  then` → não cria; e se existir taxa `pendente` deste atendimento, marca `cancelada` (dispensa depois de criada).
  O trigger passa a reagir também à mudança de `cobrar_taxa_cancelamento` (além de `status`).
- Idempotente, rollback, `notify`. Sem a 091, as telas não mandam a coluna (detecção como nas migrations anteriores) e
  o comportamento é o de hoje.

### `shared/taxas-atendimento.ts`
- `valorTaxaReservaSugerida(cfg, precoServico)` e `valorTaxaCancelamento(cfg, valorAtendimento)` (mesma conta do
  trigger: fixo ou percentual com 2 casas).
- `perguntaTaxaCancelamento(cfg, novoStatus, clienteId, valorAtendimento): { perguntar: boolean; valor: number }` —
  pergunta só com a chave ligada, status coberto pela configuração, cliente vinculada e valor > 0.
- `buildTaxaReservaInsert` ganha `cobrar: boolean` (falso → null, nenhuma linha).

### Telas (web e app, mesmos textos)
- **Criar agendamento** (Agenda web, perfil da cliente web, novo-agendamento app): com a chave da reserva ligada,
  switch "Cobrar taxa de reserva neste atendimento" (ligado). Desligado esconde valor e "Já foi cobrada?" e não grava
  taxa. Editar agendamento não mexe na taxa (igual a hoje).
- **Cancelar / Faltou** (todo lugar que muda status para cancelado/faltou: Agenda web — dropdown e detalhe —, detalhe
  do atendimento no app, agenda da profissional no app): quando `perguntaTaxaCancelamento` disser sim, confirmação
  "Cobrar taxa de cancelamento de R$ X?" com **Cobrar** / **Não cobrar**; o UPDATE grava `status` e
  `cobrar_taxa_cancelamento` juntos. Sem a 091: não pergunta (comportamento atual).
- **Financeiro → Taxas de cancelamento pendentes:** ação **Dispensar** (com `taxas.marcar_pagas`) → `UPDATE
  agendamentos set cobrar_taxa_cancelamento = false` do atendimento (o trigger cancela a taxa), conferindo linhas.
  Web e app.

## Testes
- SQL 091 por texto (coluna, condição nova, reação à coluna, corpo da 052 preservado — reativação após revert, guarda
  de cliente nulo, `security definer` e `search_path`).
- `shared/taxas-atendimento.ts` (contas, quando perguntar, reserva com `cobrar: false`).
- Varredura das telas (switch nas 3 telas de criar; pergunta em todos os pontos de cancelar/faltou; Dispensar no
  Financeiro web e app).

## Produção
Rodar a 091 (ordem livre).
