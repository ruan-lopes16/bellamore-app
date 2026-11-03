# Pendências — dinheiro e falhas silenciosas (web × app) — design

**Data:** 2026-11-03 · **Branch:** `feat/pendencias-dinheiro-falhas` · **Migration:** 100.

**Fonte:** `docs/superpowers/notes/2026-11-03-backlog-pendencias.md`, grupos A e B1–B7, conferidos no código em 03/11.

**Fora da fase:**
- já resolvidos por fases anteriores: A4 (comissão do extra datada por `fechada_at`, 090), A6 (validade com último dia valendo, 096), B2 (guarda de rota, 097), B10 (`avisoExtrasSoProprias`);
- B3: "Reativar" sem aceite fica como está, porque é ato da dona sobre quem já aceitou uma vez.

## Decisões do dono (2026-11-03)

1. **A2:** um pacote de uma venda "Cobrar agora" com vários **não** sai sozinho. Só a venda inteira sai (pacotes + venda + pagamentos).
2. **A7:** pacote vinculado a atendimento com vários serviços só se cobrir **todos** os serviços do atendimento. O modelo "o atendimento inteiro é da sessão" continua.

## Banco — `100_pendencias_dinheiro_falhas.sql`

Idempotente, com cabeçalho (por quê, conferências, rollback) e `notify pgrst, 'reload schema';`. Depende da 090–099.

### A1 — taxa de reserva retida volta ao reabrir o atendimento

`reter_taxa_reserva()` (corpo atual da 061), com um ramo novo **antes** dos atuais:
- quando `old.status in ('cancelado','faltou')` e `new.status not in ('cancelado','faltou')`, as linhas `retida` do agendamento voltam a `pago` (se `paga_em is not null`) ou `pendente`;
- depois continua a regra atual: se `new.status = 'concluido'`, a `pendente` vira `cancelada`.

**Backfill:** taxas `retida` de agendamentos hoje em `agendado`/`confirmado` voltam para `pago`/`pendente`, pela mesma regra.
- Não muda número nenhum: a receita da taxa é datada por `paga_em`, sem olhar o status (`shared/kpis-financeiros.ts`).
- O comentário errado em `DadosFinanceiros.taxasReserva` ("Só as 'retida' contam") é corrigido.

**Atendimentos já `concluido` com taxa `retida`** (a cliente pode ter pago duas vezes):
- não são alterados;
- a nota de deploy traz uma consulta só de leitura que os lista, com cliente, data, valor da taxa e comanda.

### A5 — validade da sessão pelo dia do atendimento

`fn_registrar_uso_pacote()` recriada com o corpo da 078, mais o `search_path` da 090. Uma só troca:
- antes: `pc.data_validade >= CURRENT_DATE`;
- depois: `pc.data_validade >= (new.data_hora_inicio at time zone 'America/Sao_Paulo')::date`.

O teste compara o corpo com a 078 linha a linha, para provar que só esse trecho mudou.

### A2 — venda de pacotes com vários: só sai inteira

**`excluir_pacote_cliente(p_empresa, p_id)`:**
- a assinatura não muda;
- se a venda do pacote tem outro pacote, a função recusa com: "Esta venda tem N pacotes. Para tirar só um, exclua a venda inteira e venda de novo os que ficam." (N = total de pacotes da venda);
- o ramo antigo, que só diminuía `valor_total`, sai.

**`excluir_venda_pacotes(p_empresa uuid, p_venda uuid) returns void`** (nova):
- security definer, `search_path = public`, mesmas conferências de empresa e permissão de `excluir_pacote_cliente`;
- trava a venda e os pacotes dela (`for update`);
- recusa se a venda não é de pacote, se algum pacote tem `pacote_uso` ("Um dos pacotes desta venda já tem sessões usadas. Para cancelar, fale com a dona.") ou se algum tem `comanda_id`;
- desliga `agendamentos.pacote_cliente_id` desses pacotes;
- apaga os pacotes, os pagamentos, os `venda_itens` e a venda, conferindo as linhas apagadas;
- `revoke` de public/anon e `grant` a authenticated.

### B1 — vínculo com a comanda não sai pela API

Trigger `before update of comanda_id on agendamentos`. Se `old.comanda_id is not null`, `new.comanda_id is distinct from old.comanda_id` e `current_user in ('authenticated','anon')`:
- erro "Já fechado na comanda. Para mudar, edite a comanda." (P0001).

Hoje nenhuma tela nem função troca esse vínculo (conferido: `fechar_comanda`/`editar_comanda` só gravam `comanda_id` em linha com `comanda_id` nulo ou igual).

### B4 — push só para aparelho visto há até 30 dias

Sem mudança de tabela: `registrar_push_dispositivo` já renova `visto_em`.
- **App:** chama o registro ao abrir com sessão válida e permissão concedida (`statusPermissaoNotificacoes() === 'granted'`), no máximo 1 vez por abertura.
- **Crons** (`web/lib/push/*`): só leem dispositivos com `visto_em >= now() - 30 dias`. A constante `DIAS_DISPOSITIVO_ATIVO = 30` fica em `shared/push-dispositivos.ts`.

## Regras em `shared/` e telas

### A3 — "Fat. hoje" da profissional com o desconto da comanda

`web/app/(app)/dashboard/DashboardProfissionalView.tsx` e `mobile/hooks/useProfissional.ts` (KPIs do dia):
- passam a ler `desconto_rateado` no select de `agendamentos`;
- `faturamentoPrevistoDia` já usa `valorCobradoAtendimento`.

### A7 — pacote só se cobrir o atendimento inteiro

`shared/pacotes.ts`:
- **`pacoteCobreAtendimento(p: PacoteClienteOpt, servicoIds: string[]): boolean`**: verdadeiro se o pacote cobre cada serviço distinto do atendimento. Lista vazia dá `false`.
- **`AVISO_PACOTE_PARCIAL`** = "Este pacote não cobre todos os serviços deste atendimento. Para usar a sessão, separe o serviço do pacote num atendimento próprio."

**Uso:**
- **Comanda web** (`comanda/page.tsx`, bloco "Vínculo com sessão de pacote") e **app** (`nova-comanda.tsx`): elegíveis = os que cobrem todos os `servico_id` das linhas daquele `agendamento_id`. Se há pacote ativo que cobre só parte, mostra o aviso.
- **Agenda web** (`agenda/page.tsx`) e **app** (`novo-agendamento.tsx`): o seletor de pacote considera todos os serviços escolhidos no formulário, com a mesma regra e o mesmo aviso. Trocar os serviços com um pacote já escolhido que deixou de cobrir desliga o pacote e mostra o aviso.

### A2 — tela de Pacotes

`shared/pacotes-venda.ts` (ao lado de `excluirPacoteCliente`) ganha `excluirVendaPacotes(db, empresaId, vendaId)`, com fallback `PGRST202` → erro "Atualize o sistema: falta a migration 100.". Nas telas de Pacotes (web e app), ao excluir:
- **venda com 1 pacote:** fluxo atual;
- **venda com vários:** a confirmação mostra o texto da decisão 1 e o botão "Excluir a venda inteira", que chama a função nova. A contagem vem dos vendidos já carregados (mesmo `venda_id`).

### A8 — relatório de Pacotes

`calcularRelatorioUtilizacao` (`shared/pacotes-consultas.ts`):
- **`receitaTotal` e a receita por pacote:** passam a somar só os pacotes com venda registrada (`venda_id` ou `comanda_id`, com `cobranca = 'paga'`), o mesmo que entra no faturamento.
- **Campo novo `foraDoFaturamento: { quantidade, valor }`:** os pacotes sem venda nem comanda, com `coalesce(valor_pago, preço)`.
- **As duas telas** mostram, quando `quantidade > 0`: "N pacotes vendidos antes do registro de venda — R$ X fora do faturamento".

### A9 — total igual à soma dos cartões

Onde o total e as partes são arredondados separadamente:
- **Relatórios:** cartões por profissional e componentes da receita.
- **Regra:** o total exibido passa a ser a soma das partes já arredondadas, com uma função única em `shared/kpis-financeiros.ts` (`somarArredondado`).

O plano lista os pontos exatos depois de conferir o código.

### B5 — erro nos vínculos e convite

- **Web** (`getAppContext`/layout) e **app** (`carregarSessao`): erro ao ler `empresa_membros` mostra a tela "Não foi possível carregar suas empresas", com "Tentar de novo" e "Sair". Nunca redireciona para `/login`, que continua só para quem não tem sessão.
- **Convite** (`/convite/aceitar` e o banner de aceite do app): a empresa ativa só muda depois do aceite com sucesso. Abrir o link sem aceitar não troca nada.

### B6 — exportar com erro

Nas 9 telas com exportação, nas duas plataformas, o botão Exportar fica desligado enquanto a carga está com erro ou carregando. Clientes é o caso conhecido; o plano confere as outras.

### B7 — clientes no novo agendamento do app

`mobile/app/(empresa)/novo-agendamento.tsx`:
- carrega as clientes por `carregarBaseClientes`, ou pela consulta paginada atual de shared;
- erro mostra a mensagem com "Tentar de novo", nunca lista vazia;
- o mesmo na rota da profissional, se ela usar a mesma tela.

## Erros

Toda gravação nova usa `.select('id')` ou RPC sem RETURNING. As mensagens ficam em português (`mensagemErroBanco`). Erro de carga mostra "—" e aviso, nunca zero.

## Testes

**Unitários:**
- `pacoteCobreAtendimento` (todos, parte, vazio, repetidos);
- `somarArredondado`;
- `calcularRelatorioUtilizacao` com `foraDoFaturamento`;
- filtro de `visto_em` dos crons (fetch falso);
- B6 por varredura (todo `ExportButton` recebe `disabled` ligado ao erro).

**100 em PGlite, sobre 090→099:**
- retida → pago/pendente ao reabrir, e cancelada ao concluir depois;
- backfill;
- sessão consumida no último dia às 22h em Brasília;
- `excluir_pacote_cliente` recusa com N; `excluir_venda_pacotes` apaga tudo e recusa com sessão usada;
- trava de `comanda_id` para `authenticated` e liberada para o dono da função.

**Cruzado:** web e app usam `pacoteCobreAtendimento`, `AVISO_PACOTE_PARCIAL` e `excluirVendaPacotes`.

**Verificação:** vitest 100%, tsc web 0, tsc mobile só com o erro pré-existente, `next build` OK.

## Deploy

1. Consulta só de leitura dos atendimentos concluídos com taxa retida (para o dono decidir devoluções).
2. Rodar a 100.
3. Conferências.
4. Merge e deploy.
5. Recarregar o PWA.

Sem a 100, o botão "Excluir a venda inteira" mostra "falta a migration 100". O resto funciona.
