# Bloqueio de agenda (tipos + motivo + aprovação) & excluir agendamento

**Data:** 2026-09-02
**Branch:** `claude/bloqueio-profissional-ajustes-3d4742`
**Entrega:** uma branch, um PR, com as duas partes abaixo.

---

## 1. Contexto e objetivo

Dois ajustes pedidos pelo usuário na Agenda:

1. **Bloqueio de agenda** hoje (`web/app/(app)/agenda/page.tsx` + migration `033_agenda_bloqueios.sql`,
   **só no app web**) é um modal simples: título livre, um `<select>` de profissional com opção
   "Todos os profissionais" (grava `profissional_id = null`), data, início, fim. Não há trava por
   papel — qualquer pessoa, inclusive `profissional`, cria bloqueio geral. Queremos:
   - Dois **tipos explícitos** de bloqueio: **"de um profissional"** e **"geral"** (agenda toda).
   - Um campo **motivo** obrigatório (Folga, Feriado, Almoço, Reunião, Manutenção, Outro).
   - O tipo **"geral" só aparece para dona (`owner`) e gestora (`gestor`)**.
   - Profissional **pode** pedir bloqueio da própria agenda, mas nasce **pendente** e só vale
     depois que dona/gestora **aprova**. Dona/gestora fica sabendo pelo sino (notificação) na
     hora e por uma lista de "pendentes" na Agenda; ao aprovar/recusar, a profissional é
     notificada de volta.
   - Registrar o **tipo de contrato** da profissional (`PJ / Comissionada` ou `CLT`) no cadastro
     da Equipe. Hoje não muda o fluxo (os dois tipos caem em aprovação) — fica guardado.
   - Tudo isso refletido **no app web e no app nativo** (`mobile/`), incluindo a tela
     `(profissional)/agenda.tsx` (onde a profissional cria o pedido) e a `(empresa)/agenda.tsx`
     (onde a dona/gestora aprova).

2. **Excluir agendamento**: hoje não existe — só troca de status. A dona/gestora quer poder
   **apagar de vez** um agendamento que foi lançado ou cancelado por engano. É uma **ação manual
   opcional** com confirmação — cancelar um agendamento **nunca** o apaga sozinho.

---

## 2. Escopo

### Entra
- **Parte A — Excluir agendamento** (web + nativo `(empresa)`).
- **Parte B — Bloqueio**: tipos, motivo, trava do "geral", tipo de contrato na Equipe, fluxo de
  aprovação com notificação no sino e lista de pendentes (web + nativo `(empresa)` e
  `(profissional)`).

### Não entra
- **Supabase Realtime / WebSocket.** O "avisar na hora" é: notificação no sino (já funciona) +
  a lista de pendentes se recarrega sozinha a cada ~30 s enquanto a Agenda está aberta e ao
  focar a aba/tela. Decisão explícita do usuário.
- **Push notification (Expo).** Só notificação in-app (sino).
- **Excluir agendamento `concluído`.** Tem comissão / uso de pacote / movimento de estoque
  amarrados sem `ON DELETE CASCADE` — apagar dá erro de FK e mexeria em faturamento. Fica de
  fora; a ação some/desabilita para `concluído`.
- **Bloqueio impedir agendamento de fato.** Hoje bloqueio é só visual (o teste de conflito em
  `page.tsx` só olha `agendamentos`). Segue só visual.
- **Recorrência de bloqueio** ("toda segunda"), e desenhar bloqueio nas visões "Semana"/"Mês"
  do web (hoje só a Timeline desenha). Sem mudança.

---

## 3. Parte A — Excluir agendamento

### 3.1 Comportamento

- Ação **"Excluir agendamento"** disponível para **`owner` e `gestor` apenas**.
- Habilitada para status `agendado`, `confirmado`, `cancelado`, `faltou`.
  Em `concluído`: ação **desabilitada** com aviso *"Atendimento concluído tem comissão e
  financeiro vinculados. Reverta o status antes de excluir."*
- Sempre passa por **confirmação** (`ConfirmDialog` no web, `Alert.alert` no nativo),
  `variant="danger"`, texto base: *"Excluir este agendamento? Esta ação não pode ser desfeita."*
- Se o agendamento tiver **taxa de reserva ou de cancelamento já paga** vinculada, a confirmação
  ganha uma linha a mais, com o valor: *"A taxa de R$ X (paga) também será removida e sai do
  faturamento daquele período."* (query rápida a `taxas_reserva`/`taxas_cancelamento` ao abrir a
  confirmação).
- Exclusão = `DELETE` físico em `public.agendamentos`. Cascatas de FK cuidam de
  `agendamento_servicos`, `taxas_reserva`, `taxas_cancelamento`, `avaliacoes`
  (todas já têm `ON DELETE CASCADE`).
- Toda chamada de `.delete()` usa `.select('id')` e checa linhas afetadas; zero linhas = RLS
  barrou → toast *"Você não tem permissão para excluir agendamentos."* (lição registrada no
  projeto sobre update/delete silencioso sob RLS).

### 3.2 Banco / RLS

Não há **nenhuma** policy de `INSERT`/`UPDATE`/`DELETE` para `public.agendamentos` nos arquivos
de migration — só a de `SELECT` (`001` + reescrita na `042`). As de escrita provavelmente foram
criadas direto no painel do Supabase e nunca versionadas. Para o estado final ser determinístico:

**Migration `066_agendamentos_delete_gestor_owner.sql`:**
```sql
alter table public.agendamentos enable row level security;  -- idempotente

drop policy if exists "agendamentos: excluir"        on public.agendamentos;
drop policy if exists "agendamentos: gestor exclui"  on public.agendamentos;

create policy "agendamentos: gestor ou owner exclui"
  on public.agendamentos
  for delete
  using (is_gestor_ou_owner(empresa_id));
```
- `is_gestor_ou_owner(uuid)` já existe (migration `003`).
- Cabeçalho da migration deve registrar que as policies de escrita de `agendamentos` não estão
  versionadas e que o usuário deve conferir no painel do Supabase depois de aplicar.

### 3.3 Web

- `web/app/(app)/agenda/page.tsx`:
  - A página passa a ler o **papel do usuário** e o **próprio `user_id`** (expandir o
    `select` de `empresa_membros` que já roda em `useEffect` para `empresa_id, role, user_id`;
    guardar em `meuRole` / `meuUserId`).
  - Repassar `meuRole` para `NovoAgModal`.
- `NovoAgModal` (modo edição): botão de texto **"Excluir agendamento"** no rodapé, à esquerda,
  visível só se `meuRole ∈ {owner, gestor}`. `disabled` + tooltip quando
  `agEditar.status === 'concluido'`.
- Abre `ConfirmDialog`. `onConfirm` → `delete().eq('id', …).select('id')` → em sucesso: fecha
  modal, remove do estado local (`setAgs`), `fetchDia(...)`.
- Opcional (nice-to-have): ícone de lixeira no `AgCard` e no bloco da Timeline, mesma regra de
  papel/estado. **Primário é o rodapé do modal.**

### 3.4 Nativo

- `mobile/app/(empresa)/agendamento/[id].tsx`: botão destrutivo **"Excluir agendamento"** junto
  das ações de status (a tela já tem `atualizarStatus`, `Alert.alert`, `podeCancelar` etc.).
  Escondido/desabilitado quando `ag.status === 'concluido'`.
  `Alert.alert` de confirmação → `delete().eq('id', …).select('id')` → `router.back()` e
  invalidar a query da agenda.
- **Não** entra no grupo `(profissional)` (decisão do usuário: profissional não exclui).

---

## 4. Parte B — Bloqueio

### 4.1 Modelo de dados

#### Migration `067_empresa_membros_tipo_contrato.sql`
```sql
alter table public.empresa_membros
  add column if not exists tipo_contrato text
    check (tipo_contrato in ('pj', 'clt'));
```
- `nullable`, sem default. Rótulos na UI: `pj` → **"PJ / Comissionada"**, `clt` → **"CLT"**,
  vazio → **"—"**.
- Sem policy nova: `empresa_membros` já tem `UPDATE` restrito a gestor/owner (migration `043`),
  e o trigger `bloquear_alteracao_role` (`043`) só olha `role`/`user_id`/`empresa_id` — não
  interfere em `tipo_contrato`.

#### Migration `068_agenda_bloqueios_tipos_motivo_aprovacao.sql`

Colunas novas em `public.agenda_bloqueios`:

| Coluna | Tipo / valores | Default | Observação |
|---|---|---|---|
| `escopo` | `text check (escopo in ('profissional','geral'))` | `'profissional'` | substitui o "profissional_id null = geral" implícito |
| `motivo` | `text check (motivo in ('folga','feriado','almoco','reuniao','manutencao','outro'))` | `null` | obrigatório na aplicação (não no banco, para não quebrar linhas antigas) |
| `situacao` | `text check (situacao in ('aprovado','pendente'))` | `'aprovado'` | pendente só para pedido de profissional |
| `criado_por` | `uuid references public.users(id)` | `null` | quem criou / pediu |
| `revisado_por` | `uuid references public.users(id)` | `null` | quem aprovou |
| `revisado_em` | `timestamptz` | `null` | quando aprovou |

`titulo` continua existindo, vira **"Detalhe (opcional)"** na UI.

**Backfill** (linhas já existentes): com o default `'profissional'`, todas as linhas antigas já
recebem `escopo = 'profissional'` no `add column`; só as gerais precisam de ajuste.
```sql
update public.agenda_bloqueios set escopo = 'geral' where profissional_id is null;
-- situacao já entra 'aprovado' pelo default; criado_por fica null (desconhecido, tudo bem)
```

**Não** há estado `recusado`: **recusar = apagar a linha** pendente (a notificação carrega o
"foi recusado").

#### RLS de `agenda_bloqueios` — reescrita completa

A migration `033` usa `empresa_id = ANY(minha_empresas())`, que é a forma **bugada**
(`minha_empresas()` retorna `SETOF uuid`; `= ANY(set)` não filtra certo — ver branch
`feat/bloqueio-aniversario`). A reescrita usa `IN (SELECT minha_empresas())` em todas.

```sql
drop policy if exists "bloqueios_select" on public.agenda_bloqueios;
drop policy if exists "bloqueios_insert" on public.agenda_bloqueios;
drop policy if exists "bloqueios_update" on public.agenda_bloqueios;
drop policy if exists "bloqueios_delete" on public.agenda_bloqueios;

-- SELECT: aprovados todo membro vê; pendentes só quem criou + gestor/owner
create policy "bloqueios: ver" on public.agenda_bloqueios
  for select using (
    empresa_id in (select minha_empresas())
    and (
      situacao = 'aprovado'
      or criado_por = auth.uid()
      or is_gestor_ou_owner(empresa_id)
    )
  );

-- INSERT: gestor/owner qualquer coisa; profissional só pedido da própria agenda
create policy "bloqueios: criar" on public.agenda_bloqueios
  for insert with check (
    empresa_id in (select minha_empresas())
    and (
      is_gestor_ou_owner(empresa_id)
      or (
        escopo = 'profissional'
        and profissional_id = auth.uid()
        and criado_por = auth.uid()
        and situacao = 'pendente'
        and motivo is not null
      )
    )
  );

-- UPDATE: só gestor/owner (aprovar)
create policy "bloqueios: aprovar" on public.agenda_bloqueios
  for update using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));

-- DELETE: gestor/owner qualquer; profissional só o próprio ainda-pendente (retirar pedido)
create policy "bloqueios: excluir" on public.agenda_bloqueios
  for delete using (
    is_gestor_ou_owner(empresa_id)
    or (criado_por = auth.uid() and situacao = 'pendente')
  );
```

Índice extra para a lista de pendentes:
```sql
create index if not exists idx_bloqueios_pendentes
  on public.agenda_bloqueios (empresa_id, situacao, data_inicio);
```

### 4.2 Notificações — Migration `069_agenda_bloqueios_notificacoes_trigger.sql`

Trigger `AFTER INSERT OR UPDATE OR DELETE ON public.agenda_bloqueios`, `SECURITY DEFINER`
(assim funciona igual para web e nativo, sem duplicar lógica no cliente). `auth.uid()` continua
disponível dentro do trigger.

- **INSERT com `situacao = 'pendente'`** → cria `notificacoes` (`tipo = 'bloqueio_pendente'`)
  para **cada `gestor` ativo + o `owner_id` da empresa** (dedupe por `user_id` — o owner pode
  também ter linha `gestor`):
  - título: `"Bloqueio aguardando aprovação"`
  - mensagem: `"<primeiro nome de criado_por> pediu bloqueio em <DD/MM HH24:MI>–<HH24:MI> (<motivo legível>)"`
    (formatar `data_inicio`/`data_fim` no fuso `America/Sao_Paulo`).
- **UPDATE `situacao` `pendente` → `aprovado`** → `notificacoes` (`tipo = 'bloqueio_aprovado'`)
  para `NEW.criado_por`: `"Seu bloqueio de <DD/MM HH24:MI> foi aprovado."`
- **DELETE de linha com `OLD.situacao = 'pendente'` e `OLD.criado_por <> auth.uid()`**
  (ou seja, recusa por outra pessoa, não retirada pelo próprio) → `notificacoes`
  (`tipo = 'bloqueio_recusado'`) para `OLD.criado_por`:
  `"Seu bloqueio de <DD/MM HH24:MI> foi recusado."`
- Demais casos (gestor cria já `aprovado`; profissional retira o próprio pedido; exclusão de
  bloqueio aprovado) → **sem notificação**.

Verificar se `web/app/(app)/notificacoes/page.tsx` e a tela de notificações do nativo **filtram
por `tipo`**; se filtrarem, incluir os 3 tipos novos (senão aparecem automaticamente).

### 4.3 "Quase-instantâneo" (sem Realtime)

- Web `AgendaPage` (só quando `meuRole ∈ {owner, gestor}`): `setInterval` de **30 s** que
  refaz a query de pendentes, ativo só enquanto `document.visibilityState === 'visible'`;
  também refaz no evento `focus` da janela. Limpar no unmount.
- Nativo `(empresa)/agenda.tsx`: refetch da lista de pendentes no `useFocusEffect` (voltar pra
  tela) + `AppState` `active`. Sem timer permanente.
- A notificação no sino já é o canal principal quando a tela não está aberta.

### 4.4 Web — Agenda (`web/app/(app)/agenda/page.tsx`)

**Carregamento:**
- `meuRole` / `meuUserId` (item 3.3).
- Lista **completa** de membros ativos para o `<select>` do modal de bloqueio
  (`empresa_membros` + `users`, `role in ('owner','gestor','profissional')`, `ativo = true`).
  Hoje o modal recebe `profsUnicos` (só quem tem agendamento no dia) — **trocar** por essa
  lista completa.
- `fetchDia` passa a trazer `situacao, escopo, motivo, criado_por` de `agenda_bloqueios`
  (o `select` atual pega só `id, profissional_id, titulo, data_inicio, data_fim`).
- Nova query `pendentesBloqueio` (só gestor/owner): `agenda_bloqueios` `situacao = 'pendente'`
  de **todas as datas**, ordenado por `data_inicio`, com join no nome de `criado_por`.

**Modal `NovoBloqueioModal`:**
- Props novas: `meuRole`, `meuUserId`, `meuNome`, `profissionais` (lista completa).
- `meuRole ∈ {owner, gestor}`:
  - Controle **Escopo** (segmentado, mesmo visual dos chips do app): **"Um profissional"** |
    **"Toda a agenda"**.
  - `escopo = 'profissional'` → `<select>` de profissional (lista completa; `SearchSelect` se
    passar de ~5). `escopo = 'geral'` → sem select.
  - Grava `situacao = 'aprovado'`, `criado_por = meuUserId`,
    `profissional_id = escopo === 'geral' ? null : profSelecionado`.
- `meuRole === 'profissional'`:
  - Sem controle de escopo. Linha informativa read-only *"Bloqueio para: `<meuNome>`"*.
  - Aviso: *"O bloqueio vai para aprovação da dona ou gestora."*
  - Grava `escopo = 'profissional'`, `profissional_id = meuUserId`, `criado_por = meuUserId`,
    `situacao = 'pendente'`.
- Campo **Motivo** (`<select>`, obrigatório): Folga / Feriado / Almoço / Reunião / Manutenção /
  Outro. Bloqueia submit se vazio.
- Campo **Detalhe (opcional)** = o antigo `titulo`.
- Sucesso: gestor/owner → bloqueio aparece na hora. Profissional → toast *"Pedido de bloqueio
  enviado para aprovação."* e o bloqueio aparece na Timeline dela como pendente.

**Lista de pendentes (só gestor/owner):**
- Pílula **"Pendentes (N)"** ao lado do botão "Bloquear"; some quando `N = 0`.
- Abre um modal com a lista (nome da profissional, data, horário, motivo, detalhe) e, por item,
  **Aprovar** / **Recusar**:
  - Aprovar → `update({ situacao: 'aprovado', revisado_por: meuUserId, revisado_em: now })`.
  - Recusar → confirmação inline → `delete().eq('id', …).select('id')`.
- Recarrega a lista após cada ação e pelo timer de 30 s.

**Timeline (`TimelineView`):**
- `bloqueios` agora inclui `situacao`.
- `aprovado`: render atual (sólido).
- `pendente`: fundo com listras diagonais (`repeating-linear-gradient`, ~0.5 de opacidade) +
  pílula pequena *"aguardando aprovação"*. Ocupa o slot visualmente.
- Botão "X" (remover) do bloco: gestor/owner em qualquer bloqueio; profissional só no próprio
  bloqueio **pendente** (para retirar o pedido).

### 4.5 Web — Equipe (`web/app/(app)/equipe/page.tsx`)

- No modal **"Editar profissional"** (`EditarInfoModal`, que já edita `percentual_comissao`),
  adicionar `<select>` **"Tipo de contrato"**: "PJ / Comissionada" | "CLT" | "—".
- Incluir `tipo_contrato` no `update` de `empresa_membros` e no `select` da listagem
  (linha ~467).
- Exibir o valor como badge/linha discreta no card do profissional (junto do `%` de comissão).

### 4.6 Nativo

`agenda_bloqueios` não existe hoje em `mobile/`. Adicionar:

- **`mobile/app/(profissional)/agenda.tsx`:**
  - Botão **"Bloquear"** no cabeçalho.
  - Modal RN (motivo obrigatório, detalhe opcional, data, início, fim; travado na própria
    profissional; aviso de aprovação). Grava `situacao = 'pendente'`, `criado_por = user.id`.
  - Renderizar os bloqueios dela (próprios pendentes + aprovados) na timeline por hora
    (`agPorHora` já existe; criar `bloqueiosPorHora` análogo). Pendente = listrado + tag.
  - Toast + refetch quando o pedido é aprovado/recusado (via `useFocusEffect`/`AppState`,
    não Realtime).
  - Novo hook em `mobile/hooks/useProfissional.ts` para carregar/ criar bloqueios da profissional.

- **`mobile/app/(empresa)/agenda.tsx`:**
  - Botão **"Bloquear"** + modal RN (escopo "Um profissional" | "Toda a agenda", `<select>` de
    profissional com a equipe toda, motivo, detalhe, data/hora). Grava `situacao = 'aprovado'`.
  - Entrada **"Pendentes (N)"** → tela/modal de lista com **Aprovar** / **Recusar**.
  - Renderizar bloqueios (`aprovado` sólido, `pendente` listrado + tag) na visão do dia.
  - Refetch de pendentes em `useFocusEffect` + `AppState active`.
  - Novo hook em `mobile/hooks/useAgenda.ts` para bloqueios + pendentes + aprovar/recusar.

- **Equipe nativa:** se houver tela de editar membro no `mobile/` (a confirmar na
  implementação), adicionar o mesmo `<select>` de tipo de contrato. Se não houver, fica só no
  web (registrar como pendência).

### 4.7 Helpers puros compartilhados (`shared/`)

Seguindo o padrão de `shared/taxa-reserva.ts`, `shared/despesas.ts` — funções puras testáveis,
consumidas por web e nativo:

**`shared/bloqueios.ts`** (novo):
- `MOTIVOS_BLOQUEIO` — lista `{ key, label }` das 6 opções.
- `motivoBloqueioLabel(motivo: string | null): string`.
- `podeSelecionarEscopoGeral(role: string): boolean` — `role === 'owner' || role === 'gestor'`.
- `situacaoInicialBloqueio(role: string): 'aprovado' | 'pendente'`.
- `montarInsertBloqueio({ role, meuUserId, escopo, profissionalId, motivo, titulo, dataInicio, dataFim, empresaId })`
  → objeto do `insert` já com `escopo`/`profissional_id`/`criado_por`/`situacao` coerentes
  (profissional sempre vira `escopo:'profissional'`, `profissional_id: meuUserId`,
  `situacao:'pendente'`; ignora `profissionalId` recebido).

**`shared/agendamentos.ts`** (novo):
- `podeExcluirAgendamento(status: string, role: string): boolean`
  → `['owner','gestor'].includes(role) && status !== 'concluido'`.
- `motivoBloqueioExclusao(status: string): string | null` — texto do porquê não pode
  (só `concluído` hoje).

---

## 5. Migrations (ordem)

| Nº | Arquivo | Conteúdo |
|---|---|---|
| 066 | `066_agendamentos_delete_gestor_owner.sql` | policy de `DELETE` de `agendamentos` restrita a gestor/owner |
| 067 | `067_empresa_membros_tipo_contrato.sql` | coluna `tipo_contrato` (nullable, check `pj`/`clt`) |
| 068 | `068_agenda_bloqueios_tipos_motivo_aprovacao.sql` | colunas novas + backfill + **reescrita das 4 policies** (`IN (SELECT minha_empresas())`) + índice de pendentes |
| 069 | `069_agenda_bloqueios_notificacoes_trigger.sql` | trigger `SECURITY DEFINER` que grava `notificacoes` nos 3 eventos |

Todas aditivas / idempotentes (`if not exists`, `drop policy if exists` antes de `create`).
**Lembrete do projeto:** migrations não são aplicadas sozinhas — o código quebra em produção
até rodarem `supabase db push`. Registrar no PR junto com as migrations `062` e `063` que
seguem pendentes de aplicar.

---

## 6. Testes

- **`shared/bloqueios.ts`** — unit: `podeSelecionarEscopoGeral` para os 3 papéis;
  `situacaoInicialBloqueio`; `montarInsertBloqueio` força escopo/profissional/situação corretos
  quando `role = 'profissional'` mesmo recebendo `escopo:'geral'` / outro `profissionalId`;
  `motivoBloqueioLabel` cobre as 6 + `null`.
- **`shared/agendamentos.ts`** — unit: `podeExcluirAgendamento` na matriz
  papel × status (inclui `concluído` sempre `false`, `profissional` sempre `false`).
- **Migration tests** (padrão `web/tests/unit/*-migration.test.ts`, ex.
  `retiradas-socia-migration.test.ts`): ler os SQLs e afirmar —
  - `066` cria policy de `DELETE` com `is_gestor_ou_owner`;
  - `068` não usa `= ANY(minha_empresas())` em lugar nenhum e usa `IN (SELECT minha_empresas())`;
    `situacao` só tem `'aprovado'`/`'pendente'`; backfill de `escopo` presente;
  - `069` grava `bloqueio_pendente` para gestor + owner e `bloqueio_recusado` só quando
    `OLD.criado_por <> auth.uid()`.
- **`web` `tsc --noEmit`** zerado. **`mobile` `tsc`**: manter exatamente os ~10 erros
  pré-existentes (capturar baseline antes de começar), zero novos.

---

## 7. Riscos e decisões

- **Policies de escrita de `agendamentos` não versionadas.** Só existe `SELECT` nos arquivos.
  A `066` cria o `DELETE` de forma determinística (`drop if exists` + `create`), mas o
  `INSERT`/`UPDATE` seguem vindo do painel do Supabase — anotar no PR para o usuário conferir.
- **Excluir `cancelado`/`faltou` com taxa paga reduz faturamento retroativo** (Dashboard /
  Financeiro / Relatórios somam `taxas_*` com `paga_em`/`pago`). Aceito pelo usuário (resposta
  5d = B); a confirmação mostra o valor antes de apagar. Só dona/gestora, com confirmação.
- **`tipo_contrato` não ramifica o fluxo hoje** — PJ e CLT caem os dois em aprovação
  (resposta do usuário à pergunta 1). Fica registrado no cadastro para diferenciação futura.
- **Sem Realtime** — atraso de até ~30 s na lista de pendentes com a tela aberta; a notificação
  no sino é imediata. Decisão explícita do usuário.
- **Bloqueio continua só visual** — não impede criar agendamento em cima. Comportamento atual
  mantido de propósito.
- **`escopo = 'geral'` visível a todos** quando `aprovado` (é `situacao='aprovado'`); profissional
  nunca cria um. Ok.
- **Fuso na notificação**: formatar `data_inicio`/`data_fim` em `America/Sao_Paulo` dentro do
  trigger (a coluna é `timestamptz`).

---

## 8. Pendências conhecidas (fora desta entrega)

- Aplicar migrations `062`, `063` (já pendentes) + `066`–`069` desta entrega.
- Push notification (Expo) para o pedido/aprovação de bloqueio.
- Bloqueio impedir efetivamente o agendamento no mesmo horário.
- Desenhar bloqueio nas visões "Semana" e "Mês" do web.
- Tipo de contrato na Equipe do app nativo, caso não exista tela de editar membro lá.

---

## 9. SQL final das migrations (revisado — substitui os esboços acima)

Confirmado com o usuário: nenhuma quebra em dado ou fluxo existente. Único consumidor de
`agenda_bloqueios` é `web/app/(app)/agenda/page.tsx` (nada em `mobile/` ou `shared/`).
`agendamentos` não tem `DELETE` pelo cliente hoje. Todas idempotentes.

### `066_agendamentos_delete_gestor_owner.sql`
```sql
alter table public.agendamentos enable row level security;

drop policy if exists "agendamentos: excluir"                on public.agendamentos;
drop policy if exists "agendamentos: gestor exclui"          on public.agendamentos;
drop policy if exists "agendamentos: membro exclui"          on public.agendamentos;
drop policy if exists "agendamentos: gestor ou owner exclui" on public.agendamentos;

create policy "agendamentos: gestor ou owner exclui"
  on public.agendamentos
  for delete
  using (is_gestor_ou_owner(empresa_id));
```
Cabeçalho deve registrar: policies de INSERT/UPDATE de `agendamentos` não estão versionadas
(painel do Supabase) — conferir se sobrou policy de DELETE com outro nome.

### `067_empresa_membros_tipo_contrato.sql`
```sql
alter table public.empresa_membros
  add column if not exists tipo_contrato text
    check (tipo_contrato in ('pj', 'clt'));

comment on column public.empresa_membros.tipo_contrato is
  'Vínculo: pj (PJ/Comissionada) | clt | NULL. Registro de cadastro; não altera regras de bloqueio.';
```

### `068_agenda_bloqueios_tipos_motivo_aprovacao.sql`
```sql
alter table public.agenda_bloqueios
  add column if not exists escopo       text not null default 'profissional'
    check (escopo in ('profissional', 'geral')),
  add column if not exists motivo       text
    check (motivo in ('folga', 'feriado', 'almoco', 'reuniao', 'manutencao', 'outro')),
  add column if not exists situacao     text not null default 'aprovado'
    check (situacao in ('aprovado', 'pendente')),
  add column if not exists criado_por   uuid references public.users(id) on delete set null,
  add column if not exists revisado_por uuid references public.users(id) on delete set null,
  add column if not exists revisado_em  timestamptz;

update public.agenda_bloqueios set escopo = 'geral' where profissional_id is null;

drop policy if exists "bloqueios_select" on public.agenda_bloqueios;
drop policy if exists "bloqueios_insert" on public.agenda_bloqueios;
drop policy if exists "bloqueios_update" on public.agenda_bloqueios;
drop policy if exists "bloqueios_delete" on public.agenda_bloqueios;

create policy "bloqueios: ver" on public.agenda_bloqueios
  for select using (
    empresa_id in (select minha_empresas())
    and (
      situacao = 'aprovado'
      or criado_por = auth.uid()
      or is_gestor_ou_owner(empresa_id)
    )
  );

create policy "bloqueios: criar" on public.agenda_bloqueios
  for insert with check (
    empresa_id in (select minha_empresas())
    and (
      is_gestor_ou_owner(empresa_id)
      or (
        escopo        = 'profissional'
        and profissional_id = auth.uid()
        and criado_por      = auth.uid()
        and situacao        = 'pendente'
        and motivo is not null
      )
    )
  );

create policy "bloqueios: aprovar" on public.agenda_bloqueios
  for update using      (is_gestor_ou_owner(empresa_id))
             with check (is_gestor_ou_owner(empresa_id));

create policy "bloqueios: excluir" on public.agenda_bloqueios
  for delete using (
    is_gestor_ou_owner(empresa_id)
    or (criado_por = auth.uid() and situacao = 'pendente')
  );

create index if not exists idx_bloqueios_pendentes
  on public.agenda_bloqueios (empresa_id, situacao, data_inicio);
```

### `069_agenda_bloqueios_notificacoes_trigger.sql`
```sql
create or replace function public.notificar_bloqueio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_autor_nome text;
  v_quando     text;
  v_motivo     text;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_quando := to_char(NEW.data_inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  else
    v_quando := to_char(OLD.data_inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  end if;

  -- 1. Pedido novo → avisa a gestão
  if tg_op = 'INSERT' and NEW.situacao = 'pendente' and NEW.criado_por is not null then
    select nome into v_autor_nome from public.users where id = NEW.criado_por;
    v_motivo := coalesce(nullif(NEW.motivo, ''), 'sem motivo');

    insert into public.notificacoes (user_id, empresa_id, tipo, titulo, mensagem)
    select u.uid, NEW.empresa_id, 'bloqueio_pendente',
           'Bloqueio aguardando aprovação',
           coalesce(split_part(v_autor_nome, ' ', 1), 'Profissional')
             || ' pediu bloqueio em ' || v_quando || ' (' || v_motivo || ')'
    from (
      select m.user_id as uid
        from public.empresa_membros m
       where m.empresa_id = NEW.empresa_id and m.ativo = true and m.role = 'gestor'
      union
      select e.owner_id
        from public.empresas e
       where e.id = NEW.empresa_id and e.owner_id is not null
    ) u
    where u.uid is not null and u.uid <> NEW.criado_por;

    return NEW;
  end if;

  -- 2. Aprovado → avisa o autor
  if tg_op = 'UPDATE'
     and OLD.situacao = 'pendente' and NEW.situacao = 'aprovado'
     and NEW.criado_por is not null then
    insert into public.notificacoes (user_id, empresa_id, tipo, titulo, mensagem)
    values (NEW.criado_por, NEW.empresa_id, 'bloqueio_aprovado',
            'Bloqueio aprovado',
            'Seu bloqueio de ' || v_quando || ' foi aprovado.');
    return NEW;
  end if;

  -- 3. Recusado (delete de pendente por terceiro) → avisa o autor
  if tg_op = 'DELETE'
     and OLD.situacao = 'pendente'
     and OLD.criado_por is not null
     and OLD.criado_por <> auth.uid() then
    insert into public.notificacoes (user_id, empresa_id, tipo, titulo, mensagem)
    values (OLD.criado_por, OLD.empresa_id, 'bloqueio_recusado',
            'Bloqueio recusado',
            'Seu bloqueio de ' || v_quando || ' foi recusado.');
    return OLD;
  end if;

  if tg_op = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

drop trigger if exists trg_notificar_bloqueio on public.agenda_bloqueios;
create trigger trg_notificar_bloqueio
  after insert or update or delete on public.agenda_bloqueios
  for each row execute function public.notificar_bloqueio();
```
