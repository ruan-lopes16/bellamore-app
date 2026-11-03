# Pendências — dinheiro e falhas silenciosas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** corrigir os itens A1, A2, A3, A5, A7, A8, A9, B1, B4, B5, B6 e B7 do backlog, nas duas plataformas.

**Architecture:** a migration 100 cuida da taxa retida, da validade do pacote, da venda de pacotes e da trava de comanda. As regras puras ficam em `shared/`. As telas do web e do app só consomem essas regras.

**Spec:** `docs/superpowers/specs/2026-11-03-pendencias-dinheiro-falhas-design.md`. Todas as tasks devem lê-la antes.

## Global Constraints

- **Idioma e escopo:**
  - tudo em português;
  - o web nunca importa `mobile/`;
  - preservar CRLF;
  - nunca commitar `.superpowers/` nem `.env*`.
- **Verificação:** vitest 100%, tsc web 0, tsc mobile só com o erro pré-existente de `hooks/useAgenda.ts` (TS2430).
- **Banco:**
  - migration única `supabase/migrations/100_pendencias_dinheiro_falhas.sql` (098 e 099 já existem na main);
  - idempotente, com cabeçalho (por quê, conferências, rollback) e `notify pgrst, 'reload schema';`;
  - nunca executar nada contra o banco real;
  - nunca mudar a assinatura de função existente;
  - funções novas: `security definer` com `set search_path = public`, `revoke ... from public, anon` e `grant ... to authenticated`, sem RETURNING.
- **Gravações e erros:**
  - toda gravação no cliente usa `.select('id')` ou RPC, com as linhas conferidas;
  - erros em português via `mensagemErroBanco`;
  - erro de carga mostra "—" e um aviso, nunca zero ou lista vazia.
- **Commits:** cada commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Textos exatos:**
  - `MSG_VENDA_VARIOS_PACOTES(n)` = `Esta venda tem ${n} pacotes. Para tirar só um, exclua a venda inteira e venda de novo os que ficam.`
  - Botão: "Excluir a venda inteira"
  - `AVISO_PACOTE_PARCIAL` = "Este pacote não cobre todos os serviços deste atendimento. Para usar a sessão, separe o serviço do pacote num atendimento próprio."
  - Sem a 100: "Atualize o sistema: falta a migration 100."
  - Relatório: `${n} pacotes vendidos antes do registro de venda — ${valor} fora do faturamento` (valor por `formatarMoeda`)
  - Erro de vínculos: título "Não foi possível carregar suas empresas", botões "Tentar de novo" e "Sair"
  - Trava de comanda: "Já fechado na comanda. Para mudar, edite a comanda."
  - Sessão usada (venda inteira): "Um dos pacotes desta venda já tem sessões usadas. Para cancelar, fale com a dona."

---

### Task 1: Migration 100 e testes em PGlite (modelo: opus)

**Files:**
- Create: `supabase/migrations/100_pendencias_dinheiro_falhas.sql`
- Create: `web/tests/unit/pendencias-100-pglite.test.ts`. Monte o esquema como `web/tests/unit/pacotes-096.test.ts`, aplicando a cadeia 090→099 e depois a 100.
- Modify: `shared/kpis-financeiros.ts`. Só o comentário de `DadosFinanceiros.taxasReserva`, que passa a dizer: a receita conta toda taxa com `paga_em`, qualquer status.

**Requisitos**, conforme a spec, seção "Banco":

1. **A1: `reter_taxa_reserva()`.**
   - Parta do corpo da 061 e confira se alguma migration posterior recriou a função; se sim, parta da mais nova.
   - Ramo novo no início, depois do `if old.status = new.status`: se `old.status in ('cancelado','faltou') and new.status not in ('cancelado','faltou')`, faça `update taxas_reserva set status = case when paga_em is not null then 'pago' else 'pendente' end where agendamento_id = new.id and status = 'retida'`. Em seguida continue no fluxo atual, **sem** `return`, para o `concluido` cancelar a pendente.
   - Backfill pela mesma regra só para agendamentos hoje em `agendado`/`confirmado`.
   - No cabeçalho, a consulta só de leitura dos concluídos com taxa `retida` (cliente, data, valor, comanda).
2. **A5: `fn_registrar_uso_pacote()`.**
   - Use o corpo exato da 078. Única troca: `CURRENT_DATE` vira `(NEW.data_hora_inicio at time zone 'America/Sao_Paulo')::date`.
   - Adicione `set search_path = public`, como na 090.
   - O trigger `trg_uso_pacote` não muda.
3. **A2: venda de pacotes.**
   - **`excluir_pacote_cliente`:** use o corpo da 096. Antes de apagar, conte os pacotes com o mesmo `venda_id`; se for mais de 1, `raise exception` com `MSG_VENDA_VARIOS_PACOTES(n)`. O ramo `update public.vendas set valor_total = greatest(...)` sai (fica inalcançável).
   - **`excluir_venda_pacotes(p_empresa uuid, p_venda uuid) returns void`:** conforme a spec. Ela precisa ligar `perform set_config('app.pacote_rpc','on',true)`, senão as guardas da 096 recusam (security definer cai em `current_user` dono, mas confira a guarda de `vendas`, que é definer e olha `pacote_clientes`: apague os pacotes antes da venda).
4. **B1: trava de `comanda_id`.**
   - Função `fn_trava_vinculo_comanda()` (invoker, `search_path`) e trigger `trg_trava_vinculo_comanda`, `before update of comanda_id on public.agendamentos`.
   - Conforme a spec, só para `current_user in ('authenticated','anon')`.

**Testes (PGlite):**
- retida → pago (com `paga_em`) e → pendente (sem) ao ir de cancelado para agendado;
- de cancelado direto para concluído: pendente → cancelada, e paga continua paga;
- backfill;
- sessão consumida às 22h de Brasília do último dia de validade (instante UTC do dia seguinte);
- o corpo da nova `fn_registrar_uso_pacote` comparado com a 078 (só a troca da data);
- `excluir_pacote_cliente` recusa com "Esta venda tem 2 pacotes…";
- `excluir_venda_pacotes` apaga pacotes, pagamentos e venda, e recusa com sessão usada, com `comanda_id` e com outra empresa;
- trava: `set role authenticated` mudando `comanda_id` → erro; como postgres → passa.

- [ ] Escrever os testes (falham) → migration → testes passam → `cd web && npx vitest run` e `npx tsc --noEmit` → commit `feat(banco): taxa retida reabre, validade pelo dia do atendimento, venda de pacotes inteira e trava de comanda (100)`.

### Task 2: Regras em shared (modelo: sonnet)

**Files:**
- Modify: `shared/pacotes.ts`, `shared/pacotes-venda.ts`, `shared/pacotes-consultas.ts`, `shared/push-dispositivos.ts`
- Test: `web/tests/unit/pendencias-shared.test.ts`

**Produces:**
- `pacoteCobreAtendimento(p: PacoteClienteOpt, servicoIds: string[]): boolean`. Dá verdadeiro se, para cada id distinto não vazio, `p.servicos.some(s => s.servico_id === id)`. Lista vazia dá `false`.
- `AVISO_PACOTE_PARCIAL` (texto exato).
- `pacotesDoAtendimento(ativos: PacoteClienteOpt[], servicoIds: string[]): { elegiveis: PacoteClienteOpt[]; temParcial: boolean }`. `temParcial` = existe pacote que cobre algum serviço mas não todos.
- `MSG_VENDA_VARIOS_PACOTES(n: number): string`, `MSG_SEM_MIGRATION_100 = 'Atualize o sistema: falta a migration 100.'` e `excluirVendaPacotes(db: ClienteDbRpc, empresaId: string, vendaId: string): Promise<void>`. Ela chama a RPC `excluir_venda_pacotes`: `PGRST202` lança `ErroPacote(MSG_SEM_MIGRATION_100)`, o resto segue o padrão de `excluirPacoteCliente`.
- `pacotesDaMesmaVenda(vendidos: PacoteVendido[], v: PacoteVendido): number`. Conta os vendidos com o mesmo `venda_id` não nulo; sem venda, 1.
- `PacoteVendido` ganha `comanda_id: string | null`. Inclua `comanda_id` no select com as colunas da 096 em `carregarPacotesVendidos`, com o mesmo fallback sem a 096.
- `calcularRelatorioUtilizacao`:
  - a receita só soma `cobranca === 'paga' && (venda_id || comanda_id)`;
  - os demais pagos sem venda nem comanda entram em `foraDoFaturamento: { quantidade: number; valor: number }` (valor = `valor_pago ?? preço`, em centavos → reais);
  - `RelatorioUtilizacao` ganha o campo.
  - **Atenção:** sem a 096, nenhum pacote tem `venda_id`. Nesse caso (detectado pela leitura sem as colunas da 096), mantenha a receita antiga e `foraDoFaturamento` zerado. Exponha isso com um parâmetro `colunas096: boolean` vindo do carregador.
- `DIAS_DISPOSITIVO_ATIVO = 30` e `limiteVistoEm(agora: Date): string` (ISO de agora − 30 dias) em `shared/push-dispositivos.ts`.
- A9: teste de propriedade em `calcularKpisFinanceiros`: com 500 conjuntos aleatórios de valores de 2 casas (sem fechamento), `bruto` = soma das partes (`receitaServicos + receitaServicosExtras + receitaVendas + receitaTaxasCancelamento + receitaTaxasReserva`), arredondada.
  - Se falhar, corrija com uma função `somarArredondado(partes: number[]): number` em `shared/kpis-financeiros.ts` (soma em centavos inteiros) e use-a para o `bruto` quando não há fechamento.
  - Se passar, registre no relatório que o 1 centavo não se reproduz com valores de 2 casas, e não mude o código.

- [ ] Testes de cada função (falham) → implementar → `cd web && npx vitest run` + tsc web + tsc mobile → commit `feat(shared): pacote cobre atendimento, venda de pacotes inteira, relatório fora do faturamento e dispositivos ativos`.

### Task 3: Push — crons e app (modelo: sonnet)

**Files:**
- Modify: `web/lib/push/cron-lembretes.ts`, `web/lib/push/cron-resumo.ts` (e `web/lib/push/expo.ts`, se for lá a leitura de `push_dispositivos`)
- Modify: `mobile/lib/notifications.ts` e o ponto de abertura da sessão no app (`mobile/app/_layout.tsx` ou `mobile/stores/authStore.ts`, onde a sessão fica pronta)
- Test: `web/tests/unit/push-097.test.ts`

**Consumes:** `limiteVistoEm` (Task 2).

**Requisitos:**
- Toda leitura de `push_dispositivos` nos crons ganha `.gte('visto_em', limiteVistoEm(agora))`. O fallback por `users.push_token` (sem a 097) não muda.
- No app, com a sessão pronta, a empresa ativa definida e `statusPermissaoNotificacoes() === 'granted'`, chame o registro uma vez por abertura (guarda em módulo), sem pedir permissão.
  - Erros são ignorados em silêncio só neste caminho, porque é renovação e não ativação.
  - `sem_migration` não faz nada.

**Testes:**
- com `fetch` falso, dispositivo com `visto_em` antigo não recebe push;
- varredura confirma que o app chama a renovação sem `requestPermissionsAsync`.

- [ ] Commit `feat(push): renovar o aparelho ao abrir o app e enviar só para aparelhos vistos nos últimos 30 dias`.

### Task 4: Telas do web (modelo: sonnet)

**Files:**
- `web/app/(app)/dashboard/DashboardProfissionalView.tsx` (A3)
- `web/app/(app)/comanda/page.tsx` e `web/app/(app)/agenda/page.tsx` (A7)
- `web/app/(app)/pacotes/page.tsx` (A2, A8)
- todo arquivo com `ExportButton` em `web/app` (B6: `grep -rln ExportButton web/app`)

**Consumes:** Task 2.

**Requisitos:**
- **A3:** inclua `desconto_rateado` no select de `agendamentos` do Fat. hoje.
- **A7 na Comanda:**
  - no bloco "Vínculo com sessão de pacote", os serviços do atendimento são os `servico_id` de todas as linhas `itens` com aquele `agendamento_id`;
  - use `pacotesDoAtendimento`;
  - sem elegível e com `temParcial`, mostre `AVISO_PACOTE_PARCIAL` (texto pequeno, `text-text-3`).
- **A7 na Agenda:**
  - o seletor de pacote filtra pelos serviços escolhidos no formulário;
  - mudar os serviços e o pacote escolhido deixar de cobrir: limpa o pacote e mostra o aviso;
  - na edição, o pacote já vinculado continua aparecendo (regra que já existe: nunca desvincular em silêncio).
- **A2:**
  - ao excluir um vendido com `pacotesDaMesmaVenda(...) > 1`, o modal de confirmação mostra `MSG_VENDA_VARIOS_PACOTES(n)` e o botão "Excluir a venda inteira", que chama `excluirVendaPacotes`;
  - sucesso recarrega a lista; erro é mostrado no modal.
- **A8:** na aba Relatório, com `foraDoFaturamento.quantidade > 0`, mostre a linha do texto exato abaixo da receita.
- **B6:**
  - cada `ExportButton` recebe `disabled` verdadeiro enquanto a carga dos dados que ele exporta está com erro ou carregando;
  - se o componente ainda não tem a prop `disabled`, adicione no próprio componente;
  - documente no relatório as telas que já faziam isso.

- [ ] tsc + vitest → commit `feat(web): fat. hoje com desconto, pacote só se cobrir o atendimento, venda de pacotes inteira, relatório e exportar com erro`.

### Task 5: Telas do app (modelo: sonnet)

**Files:**
- `mobile/hooks/useProfissional.ts` (A3)
- `mobile/app/(empresa)/nova-comanda.tsx` e `mobile/app/(empresa)/novo-agendamento.tsx` (A7, B7)
- `mobile/app/(empresa)/pacotes.tsx` (A2, A8)
- botões de exportar do app (B6: `grep -rln "Exportar" mobile/app mobile/components`)

**Consumes:** Task 2.

**Requisitos:**
- **A3, A7, A2, A8 e B6:** os mesmos da Task 4, com os componentes do app (`Alert` / modal já usado na tela de Pacotes).
- **B7, clientes do novo agendamento:**
  - em `novo-agendamento.tsx`, as clientes carregam paginadas pela função de shared já usada na lista de Clientes, ou por `buscarTodasOuLancar` em `@shared/paginacao` com `.order('nome').order('id')`;
  - erro mostra a mensagem em português e o botão "Tentar de novo", nunca lista vazia;
  - confira se a rota da profissional reaproveita essa tela; se sim, vale para as duas.

- [ ] tsc mobile (só o erro pré-existente) + vitest → commit `feat(app): fat. hoje com desconto, pacote só se cobrir o atendimento, venda de pacotes inteira, relatório, exportar com erro e clientes paginadas no agendamento`.

### Task 6: Erro nos vínculos e convite (modelo: sonnet)

**Files:**
- **Web:** `web/lib/auth/server-context.ts` (ou onde `getAppContext` lê `empresa_membros`), `web/app/(app)/layout.tsx` e o componente novo `web/components/ErroVinculos.tsx`.
- **Convite:** `web/app/convite/aceitar/*`.
- **App:** `mobile/stores/authStore.ts` (`carregarSessao`), o layout raiz e o banner de aceite de convite.

**Requisitos (spec, B5):**
- **Erro na leitura dos vínculos:** é um estado próprio (`erroVinculos`), diferente de "sem empresa" e de "sem sessão". Ele mostra o título e os dois botões do texto exato:
  - "Tentar de novo" recarrega (web: `router.refresh()`/reload; app: `carregarSessao()`);
  - "Sair" faz o logout do fluxo atual (no web, inclusive tirar a inscrição de push, como na 097).
- **Nunca redirecionar para `/login` ou `/criar-empresa` nesse caso.**
- **Convite:** a empresa ativa (cookie `bm_empresa` / AsyncStorage) só é gravada depois do aceite com sucesso. Abrir a página não grava.

**Testes:**
- unitário do roteamento (o estado `erroVinculos` não vai para login);
- varredura confirma que a página de convite só chama `POST /api/empresa-ativa` (ou o setter do app) depois do aceite.

- [ ] Commit `fix(auth): erro ao carregar empresas não manda para o login e convite só troca a empresa depois do aceite`.

### Task 7: Teste cruzado e nota de deploy (modelo: haiku)

**Files:**
- Create: `web/tests/unit/paridade-pendencias-cruzada.test.ts`
- Create: `docs/superpowers/notes/2026-11-03-deploy-pendencias.md`

**O que o teste cruzado confere (varredura):**
- web e app usam `pacotesDoAtendimento`, `AVISO_PACOTE_PARCIAL`, `excluirVendaPacotes` e `MSG_VENDA_VARIOS_PACOTES`;
- os dois "Fat. hoje" leem `desconto_rateado`;
- nenhum `ExportButton` do web fica sem `disabled`;
- o texto "Não foi possível carregar suas empresas" aparece nas duas plataformas.

**Nota de deploy (SQL do cabeçalho da 100):**
1. consulta só de leitura dos concluídos com taxa retida;
2. rodar a 100;
3. conferências: funções novas com `prosecdef` e `proconfig`, os 2 triggers novos, o backfill com 0 linhas `retida` em agendamento agendado/confirmado;
4. merge e deploy;
5. recarregar o PWA.

Sem a 100: "Excluir a venda inteira" mostra a mensagem de migration.

- [ ] Commit `test: paridade das pendências e nota de deploy da 100`.
