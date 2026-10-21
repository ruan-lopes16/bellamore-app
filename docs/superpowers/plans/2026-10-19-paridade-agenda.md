# Paridade Agenda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a agenda do web e a do app ficam iguais: mesmas regras (em `shared/agenda.ts`), mesmas visões e o mesmo detalhe do atendimento. Junto, a migration 094 com a trava de Concluído, a correção da avaliação e a preferência de abertura da agenda.

**Architecture:**
- As regras puras ficam em `shared/agenda.ts`, testadas e consumidas pelas duas plataformas.
- As travas de dinheiro e de dados ficam no banco (094).
- A gravação do agendamento continua em passos, com erro conferido.

**Tech Stack:** Supabase/Postgres (plpgsql, RLS, triggers), TypeScript em `shared/`, Next.js (web), Expo/React Native + TanStack Query (app), Vitest em `web/tests/unit` (inclui PGlite em `@electric-sql/pglite` e varredura de texto das telas).

**Spec:** `docs/superpowers/specs/2026-10-19-paridade-agenda-design.md` (leitura obrigatória para todas as tasks).

## Global Constraints

- **Idioma:** comunicação, comentários, mensagens e commits em português.
- **Imports:** o web nunca importa `mobile/`; o app importa `@shared/*`.
- **Verificação:**
  - `cd web && npx vitest run` → tudo PASS;
  - `cd web && npx tsc --noEmit` → 0;
  - `cd mobile && npx tsc --noEmit` → exatamente os 8 erros pré-existentes deste worktree, nenhum novo.
- **Migrations:**
  - aplicadas à mão; NUNCA `supabase db push`; nunca executar nada contra o banco;
  - idempotentes, com cabeçalho, rollback e `notify pgrst, 'reload schema';`;
  - funções `security definer` com `set search_path = public` e conferência de `auth.uid()`;
  - `revoke all … from public, anon` e `grant execute … to authenticated`;
  - nunca mudar a assinatura de uma função existente.
- **Gravações:** toda gravação usa `.select('id')` e confere as linhas afetadas. Os erros passam por `mensagemErroBanco`. Erro de carga mostra "—" ou um aviso, nunca zero.
- **Arquivos e commits:**
  - preservar o fim de linha de cada arquivo (CRLF);
  - commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - nunca commitar `.superpowers/`.
- **Textos exatos:**
  - "Esse horário já passou. Registrar mesmo assim?"
  - "Já fechado na comanda. Para mudar, edite a comanda."
  - "Reabrir este atendimento?"
  - "Já existe atendimento de {nome} às {HH:MM}. Agendar mesmo assim?"
  - "Minha agenda abre em" com as opções "Minha agenda" e "Todas as profissionais"
  - "Todas as profissionais" (opção do filtro)
- **Regras de tela:**
  - semana de domingo a sábado em Brasília;
  - horários de 15 em 15 minutos, com campo livre;
  - janela padrão de 7h a 21h, que se estica para incluir o que houver no dia.

---

### Task 1: `shared/agenda.ts` (regras puras)

**Files:**
- Create: `shared/agenda.ts`
- Test: `web/tests/unit/agenda-regras.test.ts`

**Interfaces (produz):**
```ts
export type Janela = { ini: number; fim: number };            // horas inteiras, 0..24
export function janelaDoDia(itens: { inicio: string; fim: string }[], padrao?: Janela): Janela;
export function horariosDoDia(janela: Janela, passoMin?: number): string[];   // "HH:MM"
export function diasDaSemana(chaveDia: string): string[];      // 7 chaves "AAAA-MM-DD", domingo primeiro
export function semanaVizinha(chaveDia: string, delta: number): string; // mesma posição, ±7*delta dias
export function instanteNoPassado(iso: string, agoraMs: number): boolean;
export type StatusAg = 'agendado' | 'confirmado' | 'concluido' | 'cancelado' | 'faltou';
export function statusPermitidos(atual: StatusAg, comandaFechada: boolean): StatusAg[];
export const MSG_CONCLUIDO_COM_COMANDA = 'Já fechado na comanda. Para mudar, edite a comanda.';
export function precisaConfirmarStatus(atual: StatusAg, novo: StatusAg): string | null; // texto da pergunta
export type LinhaAgendamento = { servico_id: string; profissional_id: string; valor: string; duracao_min: number; preco: number };
export type EntradaAgendamento = { linhas: LinhaAgendamento[]; inicioIso: string; duracaoEditadaMin?: number | null };
export function montarAgendamento(e: EntradaAgendamento): { valorTotal: number; duracaoMin: number; fimIso: string; linhas: { servico_id: string; profissional_id: string; valor: number; duracao_min: number }[] };
export function conflitosDeHorario(novo: { profissional_id: string; inicioIso: string; fimIso: string }, existentes: { id: string; profissional_id: string; inicio: string; fim: string; status: string; cliente_nome?: string | null }[], ignorarId?: string): { id: string; cliente_nome: string | null; inicio: string }[];
export function linhasIniciaisEdicao(ag: { servico_id: string | null; profissional_id: string; valor: number | null; duracao_min: number | null }, linhas: { servico_id: string; profissional_id: string; valor: number; duracao_min: number }[]): { servico_id: string; profissional_id: string; valor: number; duracao_min: number }[];
export function colunasPorProfissional<T extends { profissional_id: string }>(ags: T[], profissionais: { id: string; nome: string }[]): { profissional: { id: string; nome: string }; itens: T[] }[];
export function resumoDoDia(ags: { status: string; profissional_id: string; valor: number | null; pacote_cliente_id?: string | null }[]): { total: number; receitaPrevista: number; profissionais: number; pendentes: number };
export const MSG_HORARIO_PASSADO = 'Esse horário já passou. Registrar mesmo assim?';
export const MSG_REABRIR = 'Reabrir este atendimento?';
export function msgConflito(nome: string, hhmm: string): string; // "Já existe atendimento de {nome} às {HH:MM}. Agendar mesmo assim?"
```

**Regras:**
- **Datas:**
  - horas sempre em Brasília, usando `shared/periodos.ts` (`horaBRT`, `chaveDiaBRT`, `somarDias`, `diaDaSemana`);
  - `janelaDoDia` usa `floor` da hora de início e `ceil` da hora de fim de cada item, e fica dentro dos limites 0 e 24.
- **Status:** `statusPermitidos` segue a tabela da spec.
  - `precisaConfirmarStatus` pede confirmação para cancelado, para faltou e para sair de cancelado/faltou com `MSG_REABRIR`;
  - para cancelado devolve "Cancelar este atendimento?" e para faltou "Marcar falta neste atendimento?".
- **Montagem (`montarAgendamento`):**
  - valor vazio vira `preco`, e `"0"` continua 0;
  - lê o texto com `parseValorBR` de `shared/` (procure o arquivo);
  - a duração é `duracaoEditadaMin` quando for maior que 0; senão, a soma das linhas.
- **Conflitos:** ignoram os status cancelado e faltou e o `ignorarId`, e consideram a sobreposição estrita (`a.ini < b.fim && b.ini < a.fim`).
- **`resumoDoDia`:** mesma regra do `useResumoDia` do app (`mobile/hooks/useAgenda.ts`). Leia esse hook e copie a regra. Confirme se "receita prevista" usa `faturamentoPrevistoDia` de `shared/kpis-financeiros.ts`; se usar, chame essa função em vez de duplicar.

- [ ] Steps:
  1. Testes primeiro, cobrindo: janela padrão e esticada (5h30–22h15 → 5..23); limites 0/24; horários de 15 em 15; semana começando no domingo (inclusive na virada de mês e de ano); `semanaVizinha`; passado; tabela de status inteira; confirmações; cortesia 0; campo vazio virando preço; duração editada; conflito ignorando cancelado; edição de atendimento antigo sem linhas; colunas; resumo.
  2. Confirmar que os testes falham.
  3. Implementar.
  4. Rodar a suíte e o tsc.
  5. Commit `feat(shared): regras da agenda (janela, semana, status, montagem, conflito, resumo)`.

---

### Task 2: Migration 094 (trava de Concluído, avaliação, preferência)

**Files:**
- Create: `supabase/migrations/094_agenda_status_avaliacao_preferencia.sql`
- Create: `shared/agenda-consultas.ts`
- Test: `web/tests/unit/agenda-094.test.ts` (texto + PGlite, no padrão de `web/tests/unit/cadeia-090-093-pglite.test.ts` e da fixture dele)

**Interfaces (produz):**
- **Banco:**
  - trigger `trg_trava_concluido_com_comanda` em `agendamentos`;
  - trigger `trg_avaliacao_profissional` em `avaliacoes`;
  - policies `avaliacoes: membro ve` / `avaliacoes: quem atende grava` / `avaliacoes: quem atende altera` / `avaliacoes: gestor apaga`;
  - coluna `empresa_membros.agenda_abre_em`;
  - função `public.salvar_preferencia_agenda(p_empresa uuid, p_valor text) returns void`.
- **`shared/agenda-consultas.ts`:**
  - `carregarPreferenciaAgenda(db, empresaId, userId): Promise<'propria' | 'todas'>`: a coluna ausente (erro de coluna inexistente detectado por código: `42703`/`PGRST204`) devolve `'propria'`;
  - `salvarPreferenciaAgenda(db, empresaId, valor): Promise<void>`: `PGRST202` vira o Error "Atualização do banco pendente: peça para rodar a migration 094.", e os outros erros passam por `mensagemErroBanco`;
  - `salvarAvaliacao(db, { empresaId, agendamentoId, clienteId, nota, comentario }): Promise<void>`: faz upsert por `agendamento_id`, nunca manda `profissional_id`, confere o erro e as linhas.

**Requisitos:** os da spec §Migration 094. Antes de escrever:
- confira que `editar_comanda` e `fechar_comanda` (090/093) e qualquer outro caminho legítimo nunca tiram um agendamento com `comanda_id` de concluído. Isso inclui o "desfazer" de pacote e a exclusão. Documente a conclusão no cabeçalho;
- confira os triggers da 043/083 em `empresa_membros`, para garantir que a função consegue gravar a coluna nova.

O trigger de avaliação procura `empresa_membros.id` por `empresa_id` e `user_id = agendamentos.profissional_id`, e recusa quando `cliente_id` ou `empresa_id` não batem com o atendimento.

- [ ] Steps:
  1. Testes primeiro:
     - texto: triggers, policies, drop de `empresa_all_avaliacoes`, revoke/grant, notify;
     - PGlite: Concluído com comanda é recusado e sem comanda passa; avaliação com `profissional_id` lixo grava o id certo; cliente de outro atendimento é recusado; a profissional avalia o próprio atendimento e não o de colega sem `agenda.gerenciar_outras`; preferência `todas` sem `agenda.ver_equipe` é recusada; a função não altera a linha de outra pessoa; a 094 roda duas vezes.
  2. Confirmar que os testes falham.
  3. Escrever o SQL e `shared/agenda-consultas.ts`.
  4. Rodar a suíte e o tsc.
  5. Commit `feat(banco): trava de concluido com comanda, avaliacao com profissional certo e preferencia da agenda (094)`.

---

### Task 3: Web — bugs da agenda

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`
- Modify: `web/app/(app)/clientes/[id]/page.tsx`, se ele criar ou editar agendamento com taxa de reserva (confira)
- Test: `web/tests/unit/agenda-web-bugs.test.ts`

**Interfaces (consome):** da Task 1, `montarAgendamento` e `linhasIniciaisEdicao`; da Task 2, `salvarAvaliacao`.

**Requisitos:**
- **Edição de atendimento antigo:** abrir um atendimento sem linhas em `agendamento_servicos` monta as linhas com `linhasIniciaisEdicao` (hoje começa vazio).
- **Taxa de reserva:**
  - a sugerida passa a ser calculada sobre o `valorTotal` de `montarAgendamento` e é recalculada quando o total muda;
  - depois que a pessoa digita um valor na taxa, para de recalcular (flag `taxaEditadaManual`);
  - vale nas duas telas de criar (Agenda e perfil da cliente).
- **Cortesia:** o valor da linha "0" grava 0 (confirme que o web já respeita e trave com teste).
- **Avaliação:** passa a usar `salvarAvaliacao` (sem `profissional_id`), com erro mostrado na tela.
- **Carga do dia:** `fetchDia` confere o erro e mostra um aviso, sem lista vazia silenciosa.

- [ ] Steps:
  1. Escrever os testes (varredura de texto e uma função pura, se extrair alguma).
  2. Implementar.
  3. Rodar a suíte e o tsc.
  4. Commit `fix(agenda/web): edicao de atendimento antigo, taxa de reserva sobre o total, avaliacao e erros da carga`.

---

### Task 4: App — criar e editar agendamento igual ao web

**Files:**
- Modify: `mobile/app/(empresa)/novo-agendamento.tsx` (crie componentes em `mobile/components/agenda/` se o arquivo crescer demais)
- Modify: `mobile/hooks/useAgenda.ts` (`useProfissionais`)
- Test: `web/tests/unit/agenda-app-agendar.test.ts`

**Interfaces (consome):** da Task 1, `montarAgendamento`, `horariosDoDia`, `janelaDoDia`, `conflitosDeHorario`, `instanteNoPassado`, `linhasIniciaisEdicao`, `msgConflito`, `MSG_HORARIO_PASSADO`; de `shared/bloqueios.ts`, `bloqueioEmConflito`; de `shared/taxas-atendimento.ts` e `shared/taxa-reserva.ts`, o que a tela já usa.

**Interfaces (produz):** a tela aceita os parâmetros `?id=` (edição), `?data=AAAA-MM-DD`, `?hora=HH:MM` e `?profissional=<user_id>`.

**Requisitos:** a tela tem o comportamento do web (`web/app/(app)/agenda/page.tsx`, modal de novo/editar). Leia o web antes de começar.
- **Serviços:**
  - várias linhas (serviço, profissional, valor, duração), com adicionar e remover;
  - grava `agendamentos` e depois `agendamento_servicos`, na mesma ordem e com o mesmo formato do web;
  - na edição, troca as linhas como o web faz e confere cada erro.
- **Duração e horário:**
  - duração total editável;
  - horários de `horariosDoDia(janelaDoDia([...]))` de 15 em 15 minutos, mais um campo "Outro horário" (HH:MM).
- **Checagens antes de salvar:**
  - conflito com aviso e confirmação;
  - horário passado com confirmação;
  - bloqueio recusado antes de salvar, com a mensagem do trigger 074.
  - A faixa de dias deixa de desabilitar os dias passados; a confirmação substitui o bloqueio.
- **Valor e taxa:**
  - cortesia 0 respeitada (`parseFloat(valor) || preco` sai);
  - taxa de reserva sugerida sobre o total, igual à Task 3.
- **Profissionais:** `useProfissionais` lista todos os membros ativos (dona, gestora e profissional), sem `.eq('role','profissional')`.
  - Quem não tem `agenda.gerenciar_outras` só agenda para si (regra atual).
- **Hooks:** nenhum `return` antes de hooks e nenhum `setState` dentro de `useMemo`.
- **Remover:** o ramo morto de "Conflito" no tratamento de erro.

- [ ] Steps:
  1. Escrever os testes por varredura:
     - usa as funções de shared;
     - grava `agendamento_servicos`;
     - não sobra `role','profissional'` em `useProfissionais`;
     - não sobra `|| servico.preco`;
     - não sobra `HORARIOS` fixo;
     - nenhum `return null` antes do último hook.
  2. Implementar.
  3. Rodar a suíte, os dois tsc e o baseline de 8 erros do mobile.
  4. Commit `feat(agenda/app): agendar e editar com varios servicos, duracao, conflito, bloqueio e horario passado`.

---

### Task 5: App — agendar pela área da profissional e editar pelo detalhe

**Files:**
- Create: `mobile/app/(profissional)/novo-agendamento.tsx` (reexporta ou embrulha a tela da Task 4 travada na própria profissional)
- Modify: `mobile/app/(profissional)/_layout.tsx`, `mobile/app/(profissional)/agenda.tsx`, `mobile/app/(empresa)/agendamento/[id].tsx`, `mobile/app/(profissional)/agendamento/[id].tsx`
- Test: `web/tests/unit/agenda-app-rotas.test.ts`

**Interfaces (consome):** os parâmetros de tela da Task 4; `podeMexerNoAgendamento` de `shared/agendamentos.ts`.

**Requisitos:**
- **Rota da profissional:** a rota passa a existir e fica registrada no layout. A agenda da profissional manda `?data=` e `?hora=HH:MM` (hoje manda a hora como número).
- **Botão "Editar":** aparece nos dois detalhes para quem pode mexer no atendimento, exceto em concluído com comanda, e abre a tela da Task 4 com `?id=`.

- [ ] Steps:
  1. Escrever os testes.
  2. Implementar.
  3. Rodar a suíte e os dois tsc.
  4. Commit `feat(agenda/app): agendar pela area da profissional e editar pelo detalhe`.

---

### Task 6: App — visões (semana, mês, janela, colunas, bloqueios)

**Files:**
- Modify: `mobile/app/(empresa)/agenda.tsx`, `mobile/app/(profissional)/agenda.tsx`, `mobile/hooks/useAgenda.ts`, `mobile/hooks/useProfissional.ts` (crie componentes em `mobile/components/agenda/`)
- Test: `web/tests/unit/agenda-app-visoes.test.ts`

**Interfaces (consome):** da Task 1, `diasDaSemana`, `semanaVizinha`, `janelaDoDia`, `horariosDoDia`, `colunasPorProfissional`; de `shared/periodos.ts`, `gradeCalendarioMes`.

**Interfaces (produz):** a prop/estado `filtroProfissional: string | 'todas'` na agenda da empresa, que a Task 8 usa para o valor inicial.

**Requisitos:**
- **Semana:**
  - as setas da faixa de semana chamam `semanaVizinha` e movem o dia selecionado;
  - o rótulo do mês acompanha o dia;
  - nenhum `weekStartsOn: 1` sobra nos dois arquivos nem nos hooks de agenda.
- **Alternância:** Dia / Mês, na mesma tela.
- **Visão Mês:** `gradeCalendarioMes` com contagem de atendimentos por dia (uma consulta do mês, paginada se passar de 1000); tocar num dia abre a visão Dia nele.
- **Janela:** `janelaDoDia` nas duas agendas, no lugar do `HORAS` de 7 a 19.
- **Bloqueios:**
  - `useBloqueiosDia` filtra pela profissional escolhida, mantendo os bloqueios de escopo geral;
  - o slot vazio só some com bloqueio dessa profissional ou geral.
- **Modo "Todas":** uma coluna por profissional, com rolagem horizontal e o nome no topo (`colunasPorProfissional`). O chip continua aparecendo só com `agenda.ver_equipe`.
- **Filtro inicial:** a própria pessoa. A Task 8 troca isso pela preferência.

- [ ] Steps:
  1. Escrever os testes.
  2. Implementar.
  3. Rodar a suíte e os dois tsc.
  4. Commit `feat(agenda/app): semana de verdade, visao mes, janela do dia, colunas por profissional e bloqueios filtrados`.

---

### Task 7: Web — visões (Todas, colunas, janela, bloqueios em Semana e Mês)

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx` (extraia componentes para `web/app/(app)/agenda/` ou `web/components/agenda/` se ajudar; o arquivo tem 2.673 linhas)
- Test: `web/tests/unit/agenda-web-visoes.test.ts`

**Interfaces (consome):** da Task 1, `janelaDoDia`, `colunasPorProfissional`, `diasDaSemana`.

**Interfaces (produz):** o estado `filtroProfissional: string | 'todas'` (para a Task 8).

**Requisitos:**
- **Filtro:**
  - "Todas as profissionais" no seletor, só com `agenda.ver_equipe` (remova o comentário e a regra que proíbem);
  - "Todas" carrega os atendimentos e os bloqueios de todos.
- **Timeline:**
  - `janelaDoDia` substitui `TL_H_START`/`TL_H_END` fixos, e nenhum card fica cortado;
  - em "Todas", uma coluna por profissional com o nome no topo.
- **Bloqueios em Semana e Mês:**
  - a visão Semana (`ListaDia`) mostra os bloqueios do dia como itens;
  - a visão Mês (`MesView`) marca os dias com bloqueio;
  - mesma carga e mesmo filtro por profissional da Timeline.
- **Semana:** continua começando no domingo; confira que todas as visões usam `diasDaSemana`.

- [ ] Steps:
  1. Escrever os testes.
  2. Implementar.
  3. Rodar a suíte e o tsc.
  4. Commit `feat(agenda/web): todas as profissionais, colunas na timeline, janela do dia e bloqueios em semana e mes`.

---

### Task 8: Preferência "Minha agenda abre em" (web e app)

**Files:**
- Modify: Configurações → Perfil do web (`web/app/(app)/configuracoes/...`; ache a aba Perfil) e do app (`mobile/app/(empresa)/configuracoes*` ou equivalente; ache a tela de perfil)
- Modify: as duas agendas da empresa (valor inicial do filtro)
- Test: `web/tests/unit/agenda-preferencia.test.ts`

**Interfaces (consome):** da Task 2, `carregarPreferenciaAgenda` e `salvarPreferenciaAgenda`; o estado `filtroProfissional` das Tasks 6 e 7.

**Requisitos:**
- **Campo:**
  - "Minha agenda abre em", com as opções "Minha agenda" e "Todas as profissionais";
  - só aparece para quem tem `agenda.ver_equipe` e quando a 094 existe (a detecção sai da consulta).
- **Salvar:** ao salvar, mostra o retorno da gravação; erro em português.
- **Abertura das agendas:**
  - as agendas da empresa (web e app) abrem pela preferência: `todas` mais a permissão resultam em "Todas", e o resto abre na própria pessoa;
  - a troca manual do filtro na tela não altera a preferência.
- **App:** a área `(profissional)` não muda (sempre a própria pessoa).

- [ ] Steps:
  1. Escrever os testes.
  2. Implementar.
  3. Rodar a suíte e os dois tsc.
  4. Commit `feat(agenda): preferencia de abertura da agenda em configuracoes (web e app)`.

---

### Task 9: App — detalhe do atendimento (status, avaliação, taxa paga ao excluir)

**Files:**
- Modify: `mobile/app/(empresa)/agendamento/[id].tsx`, `mobile/app/(profissional)/agendamento/[id].tsx`
- Test: `web/tests/unit/agenda-app-detalhe.test.ts`

**Interfaces (consome):** da Task 1, `statusPermitidos`, `precisaConfirmarStatus`, `MSG_CONCLUIDO_COM_COMANDA`; da Task 2, `salvarAvaliacao`; de `shared/taxas-atendimento.ts`, `perguntaTaxaCancelamento` (fluxo da 091 já existente).

**Requisitos:**
- **Status:**
  - os botões vêm de `statusPermitidos(status, !!comanda_id)` e substituem as transições fixas;
  - cada troca passa por `precisaConfirmarStatus` (`Alert`);
  - cancelar ou marcar falta com taxa usa só a pergunta da taxa (sem duas perguntas);
  - concluído com comanda mostra `MSG_CONCLUIDO_COM_COMANDA` no lugar dos botões.
- **Avaliação:**
  - aparece só em concluído: 1 a 5 estrelas e comentário opcional;
  - carrega a existente e salva com `salvarAvaliacao`;
  - só para quem pode mexer no atendimento.
- **Excluir:** antes de excluir, consulta as taxas de reserva e de cancelamento pagas do atendimento e mostra o valor no aviso, com o mesmo texto do web (`web/app/(app)/agenda/page.tsx`, perto da exclusão).

- [ ] Steps:
  1. Escrever os testes.
  2. Implementar.
  3. Rodar a suíte e os dois tsc.
  4. Commit `feat(agenda/app): status pela regra unica, avaliacao e aviso de taxa paga ao excluir`.

---

### Task 10: Web — detalhe do atendimento (comanda, contatos, resumo do dia, status)

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx` (`AgCard` e o detalhe)
- Modify: `mobile/app/(empresa)/agenda.tsx` (só para trocar `useResumoDia` por `resumoDoDia` de shared, se ainda não for igual)
- Test: `web/tests/unit/agenda-web-detalhe.test.ts`

**Interfaces (consome):** da Task 1, `statusPermitidos`, `precisaConfirmarStatus`, `resumoDoDia`, `MSG_CONCLUIDO_COM_COMANDA`; de `shared/atendimento-detalhe.ts`, `montarDetalheAtendimento` (veja como `web/app/(app)/clientes/[id]/page.tsx` monta e consulta).

**Requisitos:**
- **Detalhe com comanda:** quando o atendimento tem comanda, o detalhe mostra os itens e os pagamentos, igual ao perfil da cliente. A consulta é feita só ao abrir o detalhe.
- **Contatos:**
  - botões "Ligar" (`tel:`), "WhatsApp" (`https://wa.me/55…`, mesmo formato do app) e "Perfil" (`/clientes/{id}`);
  - os botões somem quando não há telefone ou cliente.
- **Resumo do dia:** no topo da visão Dia, com os 4 números (Agendamentos, Receita prevista, Profissionais, Pendentes), via `resumoDoDia`. O app passa a usar a mesma função.
- **Status:**
  - o seletor mostra só `statusPermitidos(...)`;
  - `precisaConfirmarStatus` aparece com `ConfirmDialog` antes de gravar;
  - a pergunta da taxa substitui a confirmação de cancelar;
  - concluído com comanda mostra `MSG_CONCLUIDO_COM_COMANDA`.

- [ ] Steps:
  1. Escrever os testes.
  2. Implementar.
  3. Rodar a suíte e os dois tsc.
  4. Commit `feat(agenda/web): comanda e pagamentos no detalhe, contatos, resumo do dia e status pela regra unica`.

---

### Task 11: Teste cruzado da agenda

**Files:**
- Create: `web/tests/unit/paridade-agenda-cruzada.test.ts`

**Requisitos:** varredura que trava a paridade.
- As duas agendas, as duas telas de agendar e os dois detalhes importam de `@shared/agenda` as funções correspondentes.
- Nenhum `weekStartsOn: 1` nos arquivos de agenda nem nos hooks.
- Nenhum `HORAS`/`HORARIOS` fixo.
- Nenhum `TL_H_START = 7` fixo.
- Nenhum `|| servico.preco`.
- Nenhum `profissional_id` enviado ao gravar `avaliacoes`.
- Os textos exatos das Global Constraints presentes nas duas plataformas.

- [ ] Steps:
  1. Escrever o teste.
  2. Rodar a suíte inteira e os dois tsc.
  3. Commit `test(agenda): teste cruzado de paridade da agenda`.
