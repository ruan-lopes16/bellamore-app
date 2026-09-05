# Bloqueio de agenda: aviso ao remover + trava real do agendamento

**Data:** 2026-09-05
**Branch:** `claude/bloqueio-agenda-aviso-8c2c40`
**Entrega:** uma branch, um PR.

---

## 1. Contexto e objetivo

Dois defeitos relatados pelo usuário na Agenda, ambos herdados da entrega de
bloqueio de 2026-09-02 (`docs/superpowers/specs/2026-09-02-bloqueio-tipos-aprovacao-e-excluir-agendamento-design.md`):

1. **Remover um bloqueio não pede confirmação.** No web, o `X` no bloco da
   Timeline (`web/app/(app)/agenda/page.tsx`, hoje `onClick` →
   `onDeletarBloqueio(bl.id)` direto) apaga na hora, sem aviso. Excluir um
   *agendamento* passa por confirmação; remover um *bloqueio* nunca ganhou. No
   mobile não existe nem botão de remover bloqueio aprovado na timeline — só
   "recusar" um pendente pela folha de pendentes.

2. **Bloqueio não impede agendar em cima.** A checagem de conflito ao salvar
   agendamento (`page.tsx`, função `salvar` do `NovoAgModal`) só consulta a
   tabela `agendamentos`. Nunca olha `agenda_bloqueios`. O trigger de conflito
   que existia no banco foi removido na migration `020_agendamento_multi_servico.sql`
   (troca deliberada por aviso client-side para o caso agendamento×agendamento).
   Resultado: dá para agendar uma cliente por cima de um bloqueio, aprovado ou
   pendente, tanto pela Timeline quanto pelo formulário.

### Decisões do usuário (deste ciclo de brainstorming)

- **Agendar sobre bloqueio = trava total.** Não é aviso com "agendar mesmo
  assim". O horário bloqueado nem deve ser clicável na Timeline; o formulário
  não deixa salvar. Para agendar, remove-se o bloqueio antes.
- **Bloqueio pendente também trava.** Assim que o profissional pede o bloqueio,
  o horário já fica indisponível para novos agendamentos, antes da aprovação.
- **Cobertura web + mobile.**
- **Aviso ao remover:** modal de confirmação **centralizado** (não `window.confirm`,
  não confirmação inline), com escopo + motivo + intervalo. **No mobile também**
  um modal centralizado custom equivalente ao do web (não `Alert.alert`).

---

## 2. Escopo

### Entra

- **Regra compartilhada** de colisão agendamento × bloqueio em `shared/bloqueios.ts`
  (funções puras, TDD).
- **Migration nova** (`074`): trigger `BEFORE INSERT/UPDATE` em `agendamentos`
  que recusa o horário quando bate em bloqueio. É a trava real (serve web,
  mobile, comanda e qualquer caminho futuro).
- **Web — impedir agendar sobre bloqueio:** clique bloqueado na Timeline +
  faixa vermelha e botão desabilitado no `NovoAgModal` + guarda em `salvar()`.
- **Web — confirmar remoção de bloqueio:** modal centralizado novo.
- **Mobile — remover bloqueio:** hook `useRemoverBloqueio` + `X` no bloco nas
  telas `(empresa)/agenda.tsx` e `(profissional)/agenda.tsx` + modal
  centralizado de confirmação.
- **Mobile — impedir agendar sobre bloqueio:** reforço no `SlotVazio` +
  tratamento amigável do erro do trigger em `novo-agendamento.tsx`.
- **Ajuste de UI (web):** o modal "Bloquear horário" (`NovoBloqueioModal`)
  estoura a borda direita no PWA iOS (falta `min-w-0`/`max-w-full`, ao
  contrário do `NovoAgModal`) e os campos Início/Fim ocupam 50% cada sem
  necessidade. Corrigido no mesmo PR (bug reportado durante o planejamento).
- **Navegação por teclado (web) — Parte C.** Ver §12.

### Não entra

- **Comportamento agendamento × agendamento.** Continua como está: aviso
  client-side com "agendar mesmo assim". A migration `074` **não** ressuscita o
  trigger da `020` — só trata o caso bloqueio.
- **Editar um agendamento já existente que passou a colidir com um bloqueio
  criado depois.** O trigger só valida em `INSERT` e em `UPDATE` quando
  `data_hora_inicio`, `data_hora_fim` ou `profissional_id` mudam. Um "concluir"
  / troca de status num agendamento que já estava lá não é travado.
- **Desenhar bloqueio nas visões "Semana"/"Mês" do web** (só a Timeline
  desenha). Sem mudança.
- **Push (Expo) de bloqueio.** Fora, como na entrega anterior.
- **Recorrência de bloqueio.**
- **Navegação por teclado no app nativo (mobile).** React Native não tem
  Tab; o equivalente (`returnKeyType="next"` + refs encadeadas em cada
  `TextInput`) é bem mais invasivo e vira trabalho próprio. A Parte C é
  **só web**.
- **Formulários de página inteira** (`configuracoes` — dados da empresa e
  perfil) e **telas de autenticação** (`login`, `cadastro`, `criar-empresa`,
  `convite/aceitar`). Nesses, Enter-envia é o comportamento esperado. A
  Parte C toca só os `<form>` dentro de `.bm-modal`.
- **`clientes/[id]/page.tsx` (agendamento pelo perfil da cliente) não ganha
  tratamento amigável do erro do trigger.** Diferente da agenda web (faixa
  vermelha) e do `novo-agendamento` mobile (Alert), aqui o erro do trigger 074
  aparece via `setErro(error.message)` — o texto cru do Postgres, que já é
  pt-BR legível ("Horário bloqueado na agenda (folga). Remova o bloqueio...").
  Aceitável; padronizar fica para um follow-up.
- **Guarda de cliente ×  RLS de bloqueio pendente.** A policy `"bloqueios: excluir"`/
  `"bloqueios: ver"` (068) esconde bloqueio `pendente` de quem não é gestão nem
  autor. Então uma profissional criando agendamento pelo web pode não ver a
  faixa vermelha de um pendente de terceiro e levar o erro cru do trigger no
  submit. É o comportamento correto de segurança (o trigger é `SECURITY DEFINER`
  justamente para enxergar o pendente que a RLS esconde do cliente).
- **`SearchSelect` + Enter.** Com o dropdown aberto, Enter no campo de busca
  fecha o dropdown sem selecionar (antes: enviava o formulário — pior). O
  "digito e dou Enter na primeira opção" continua não atendido; o `SearchSelect`
  é dirigido a clique. Follow-up, fora deste PR.

---

## 3. Regra compartilhada — `shared/bloqueios.ts`

Duas funções puras novas, sem dependência de timezone (comparam via
`Date.parse`). São a fonte única que o web, o mobile e o pré-check que espelha
o trigger usam.

```ts
export interface BlocoParaChecagem {
  escopo: EscopoBloqueio;              // 'profissional' | 'geral'
  profissional_id: string | null;
  situacao: SituacaoBloqueio;          // 'aprovado' | 'pendente'
  data_inicio: string;                 // ISO
  data_fim: string;                    // ISO
  motivo?: string | null;
  titulo?: string | null;
}

/**
 * Primeiro bloqueio que colide com o intervalo [inicioISO, fimISO) para o
 * profissional dado, ou null. Considera bloqueio 'geral' e o do próprio
 * profissional; aprovado OU pendente. Sobreposição meia-aberta: encostar
 * (fim de um == início do outro) NÃO é colisão.
 */
export function bloqueioEmConflito(
  blocos: BlocoParaChecagem[],
  profissionalId: string,
  inicioISO: string,
  fimISO: string,
): BlocoParaChecagem | null;

/**
 * Bloqueio que cobre um instante pontual (clique na Timeline). Meia-aberto:
 * data_inicio <= t < data_fim.
 */
export function bloqueioNoInstante(
  blocos: BlocoParaChecagem[],
  profissionalId: string,
  instanteISO: string,
): BlocoParaChecagem | null;
```

Regra de aplicabilidade (as duas funções):
`bloco.escopo === 'geral' || bloco.profissional_id === profissionalId`, e
`bloco.situacao === 'aprovado' || bloco.situacao === 'pendente'`.

Formatação da mensagem (motivo + `HH:mm–HH:mm`) fica no chamador, com
`date-fns` / `motivoBloqueioLabel` — a função pura devolve o bloco.

### Testes (`web/tests/unit/bloqueios.test.ts`, adicionar ao arquivo existente)

- Bloqueio `geral` colide com qualquer `profissionalId`.
- Bloqueio `profissional` colide só com o `profissional_id` igual; outro profissional passa.
- `situacao='pendente'` colide (não só `aprovado`).
- Sem sobreposição real: `data_fim === inicio` e `data_inicio === fim` → `null` (meia-aberto).
- Sobreposição parcial (começo, fim, engloba, contido) → devolve o bloco.
- Vários blocos colidindo → devolve o de menor `data_inicio`.
- `bloqueioNoInstante`: instante == `data_inicio` → colide; instante == `data_fim` → não.

---

## 4. Banco — `supabase/migrations/074_agendamentos_recusa_bloqueio.sql`

```sql
-- ============================================================
-- MIGRATION 074 — agendamentos: recusa horário coberto por bloqueio
--
-- Contexto: a 020 removeu o trigger de conflito agendamento×agendamento
-- (virou aviso client-side, que permite "agendar mesmo assim"). Bloqueio
-- de agenda ficou SÓ visual — nada no servidor impede um INSERT em
-- agendamentos sobre um bloqueio. Esta migration cria a trava real,
-- apenas para o caso bloqueio; NÃO ressuscita a trava agendamento×
-- agendamento.
--
-- Comportamento:
--   • BEFORE INSERT OR UPDATE ON agendamentos, FOR EACH ROW.
--   • Ignora NEW.status IN ('cancelado','faltou').
--   • Em UPDATE, só valida se data_hora_inicio, data_hora_fim OU
--     profissional_id mudaram (não trava troca de status de um
--     agendamento que já existia).
--   • Colisão = existe agenda_bloqueios na mesma empresa, com
--     situacao IN ('aprovado','pendente'), escopo 'geral' OU
--     profissional_id = NEW.profissional_id, e sobreposição
--     meia-aberta com [NEW.data_hora_inicio, NEW.data_hora_fim).
--   • Colidiu → RAISE EXCEPTION com texto estável começando por
--     'Horário bloqueado na agenda' (os apps casam por substring).
--
-- SECURITY DEFINER + search_path = public: o trigger precisa enxergar
-- bloqueios 'pendente', que a policy "bloqueios: ver" esconde de quem
-- não é gestor/owner nem autor. Mesmo padrão das migrations 069 e 073.
--
-- Aditivo. Nenhuma linha existente é alterada. Só INSERT/UPDATE novos
-- que caiam em bloqueio passam a falhar — que é o pedido.
-- ============================================================

create or replace function public.check_agendamento_bloqueio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_motivo text;
begin
  if NEW.status in ('cancelado', 'faltou') then
    return NEW;
  end if;

  if TG_OP = 'UPDATE'
     and NEW.data_hora_inicio is not distinct from OLD.data_hora_inicio
     and NEW.data_hora_fim    is not distinct from OLD.data_hora_fim
     and NEW.profissional_id  is not distinct from OLD.profissional_id then
    return NEW;
  end if;

  select coalesce(b.motivo, 'bloqueio')
    into v_motivo
  from public.agenda_bloqueios b
  where b.empresa_id = NEW.empresa_id
    and b.situacao in ('aprovado', 'pendente')
    and (b.escopo = 'geral' or b.profissional_id = NEW.profissional_id)
    and b.data_inicio < NEW.data_hora_fim
    and b.data_fim    > NEW.data_hora_inicio
  order by b.data_inicio
  limit 1;

  if found then
    raise exception
      'Horário bloqueado na agenda (%). Remova o bloqueio para agendar nesse período.',
      v_motivo
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_check_agendamento_bloqueio on public.agendamentos;
create trigger trg_check_agendamento_bloqueio
  before insert or update on public.agendamentos
  for each row execute function public.check_agendamento_bloqueio();
```

Notas:

- `is not distinct from` cobre `NULL` sem ruído.
- O trigger roda **antes** dos triggers `AFTER UPDATE` de taxa
  (`trg_reter_taxa_reserva`, `trg_gerar_taxa_cancelamento`) — não interfere.
- Mensagem: PostgREST devolve `error.message` = o texto do `RAISE`, verbatim.
  Substring estável para os apps casarem: **`'Horário bloqueado'`** (com acento,
  exatamente como no `RAISE`). Só o mobile precisa casar (§8.2); no web os
  guards de cliente barram antes de chegar ao trigger, e `salvar()` ainda
  mostra a `error.message` crua como fallback.

---

## 5. Web — impedir agendar sobre bloqueio

Arquivo: `web/app/(app)/agenda/page.tsx`.

### 5.1 Timeline (componente `Timeline`, já recebe `bloqueios`, `dataSel`, `meuRole`, `meuUserId`, `onNovo`)

- No `onClick` da coluna do profissional: montar o instante clicado
  (`new Date(dataSel)` + a hora de `calcHoraTimeline`) e chamar
  `bloqueioNoInstante(bloqueios, prof.id, instante.toISOString())`.
  Se devolver um bloco → **não** chama `onNovo`; em vez disso dispara o toast de
  erro que já existe (`showErro`, via um callback novo `onHorarioBloqueado`
  passado pelo pai, ou movendo o toast — decidir no plano) com
  *"Horário bloqueado — remova o bloqueio para agendar aqui."*
- O `<div>` de cada bloco (hoje só o botão `X` faz `stopPropagation`) ganha
  `onClick={e => e.stopPropagation()}` no container, para clique no corpo do
  bloco não borbulhar para o `onClick` da coluna.

### 5.2 `NovoAgModal`

- Adicionar `agenda_bloqueios` ao `Promise.all` de carga (mesmas colunas que a
  página usa: `id, escopo, profissional_id, situacao, motivo, titulo, data_inicio, data_fim`),
  filtrando pelo dia de `dataSel`. Reexecutar quando `dataSel` muda (a data é
  editável dentro do modal).
- Derivar reativamente: com `profId`, `hora` e `totalDuracao` definidos, montar
  `inicio`/`fim` e chamar `bloqueioEmConflito(blocos, profId, inicio, fim)`.
- Se colidir:
  - Renderizar uma faixa **vermelha** (não a amber de conflito) acima do form:
    *"Horário bloqueado · {motivoLabel} · {HH:mm}–{HH:mm}. Remova o bloqueio
    para agendar nesse horário."*
  - **Desabilitar** o botão de salvar (`disabled`), sem opção de forçar.
- `salvar()`: revalidar `bloqueioEmConflito` no começo; se colidir, `setErro(...)`
  e `return` antes de qualquer insert (defesa em profundidade além do trigger).
- Vale tanto para novo quanto para edição (`agEditar`): a data/hora/serviços são
  editáveis e o intervalo pode passar a colidir.

### 5.3 Não muda

- O aviso amber de **conflito de horário** (agendamento×agendamento) e o botão
  "Agendar mesmo assim" continuam iguais.

---

## 6. Web — confirmar remoção de bloqueio

Arquivo: `web/app/(app)/agenda/page.tsx`.

### 6.1 Componente novo `ConfirmarRemoverBloqueioModal`

- Portalizado para `document.body`, mesmo esqueleto visual dos outros modais do
  arquivo (`bm-modal`, card central `max-w-sm`, backdrop com blur).
- Conteúdo:
  - Título: *"Remover bloqueio?"*
  - Escopo: *"Toda a agenda"* quando `escopo === 'geral'`, senão o nome do
    profissional (resolver por `profissionaisEmpresa` já disponível na página).
  - Motivo (`motivoBloqueioLabel`) e intervalo `dd/MM · HH:mm–HH:mm`.
  - Se `situacao === 'pendente'`: linha *"Este pedido ainda está aguardando
    aprovação."*
  - Botões: **Cancelar** (secundário) / **Remover** (vermelho,
    `var(--color-rose)` / `bg-red`).
- Props: `bloqueio: Bloqueio`, `profNome: string | null`, `onCancelar`, `onConfirmar`.

### 6.2 Ligação

- Estado novo na página: `bloqueioParaRemover: Bloqueio | null`.
- Na Timeline, o `X` deixa de chamar `onDeletarBloqueio(bl.id)` e passa a chamar
  `onPedirRemover(bl)` (novo callback) → a página seta `bloqueioParaRemover`.
- O modal, ao confirmar, chama o `deletarBloqueio(id)` atual (mantém o
  optimistic update + a guarda de zero-linhas que já existe) e limpa o estado.
- `podeRemover` (regra de papel já existente na Timeline: gestor/owner sempre;
  profissional só o próprio pendente) continua decidindo se o `X` aparece.

---

## 7. Mobile — remover bloqueio

### 7.1 Hook `useRemoverBloqueio` (`mobile/hooks/useAgenda.ts`)

Espelha `useRecusarBloqueio` (já existe), mas semanticamente é "remover"
(inclui bloqueio aprovado):

```ts
export function useRemoverBloqueio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('agenda_bloqueios')
        .delete()
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Sem permissão para remover este bloqueio.');
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bloqueios-dia'] });
      qc.invalidateQueries({ queryKey: ['bloqueios-pendentes'] });
    },
  });
}
```

A RLS de DELETE (`"bloqueios: excluir"`, migration 068) já permite
gestor/owner apagar qualquer bloqueio e profissional apagar o próprio
pendente — o hook não precisa de regra extra, só reportar zero-linhas.

### 7.2 Componente novo `ConfirmarRemoverBloqueio` (`mobile/components/`)

- RN `Modal` (`transparent`, `animationType="fade"`), card central sobre
  backdrop escuro — mesmo padrão visual dos modais mobile do projeto
  (ex.: `MarcarPagoModal`).
- Conteúdo equivalente ao web (§6.1): título, escopo, motivo, intervalo, aviso
  de pendente, botões Cancelar / Remover.
- Props: `visible`, `bloqueio: BloqueioAgenda | null`, `profNome`, `onCancelar`, `onConfirmar`.

### 7.3 Ligação nas telas

**`mobile/app/(empresa)/agenda.tsx`** (tem `meuRole`, `user`, `bloqueios` do dia):

- No bloco renderizado (hoje `View` com título + horário), adicionar um `X`
  (`TouchableOpacity`, ícone `lucide` `X`) quando
  `podeRemover = meuRole === 'owner' || meuRole === 'gestor' || (b.situacao === 'pendente' && b.criado_por === user?.id)`.
- Toque → seta `bloqueioParaRemover` → abre `ConfirmarRemoverBloqueio`.
- Confirmar → `useRemoverBloqueio().mutate(id, { onError: e => Alert.alert('Erro', e.message) })`.
- Guarda de duplo-toque: desabilitar o `X`/botão Remover enquanto `isPending`.

**`mobile/app/(profissional)/agenda.tsx`** (role sempre `profissional`):

- `X` só aparece quando `b.situacao === 'pendente' && b.criado_por === user?.id`.
- Mesmo modal e mesmo hook.

---

## 8. Mobile — impedir agendar sobre bloqueio

### 8.1 `SlotVazio` nas duas telas de agenda

Hoje o slot vazio já é escondido quando a hora tem qualquer item em
`bloqueiosPorHora[hora]`. Reforço:

- Passar para `SlotVazio` a informação de que a hora está coberta por bloqueio
  (reusando `bloqueioNoInstante` / `bloqueioEmConflito` sobre os `bloqueios` do
  dia para aquela hora e, na `(empresa)`, o profissional em foco).
- Quando bloqueada: não renderizar o `SlotVazio` (ou renderizar desabilitado,
  sem `onPress`). Cobre o caso de bloco de hora parcial em que a linha da hora
  ainda mostraria o slot.

### 8.2 `mobile/app/(empresa)/novo-agendamento.tsx`

- O formulário não tem timeline; a trava efetiva é o trigger.
- Estender o tratamento de erro que já existe
  (`if (error.message.includes('Conflito'))`) com um ramo
  `else if (error.message.includes('Horário bloqueado'))` que mostra
  `Alert.alert('Horário bloqueado', 'Esse horário está bloqueado na agenda. Remova o bloqueio para agendar nesse período.')`.
- (Opcional, decidir no plano) pré-check reativo: buscar bloqueios do dia +
  profissional escolhidos e desabilitar "Salvar" com aviso, para não depender
  só do erro pós-submit. Só se couber sem inflar o escopo.

---

## 9. Papéis / RLS — sem novidade

- Remoção de bloqueio: coberta pela policy `"bloqueios: excluir"` (068). Nada a
  mudar.
- Trigger de agendamento: `SECURITY DEFINER` para enxergar pendentes; não altera
  quem pode inserir agendamento (isso é policy à parte, hoje no painel).

---

## 10. Pendências para produção

- Aplicar **só a migration `074`** — a sonda de schema no banco de produção
  (2026-09-05) confirmou que `062`, `063`, `066`–`073` **já estão aplicadas**;
  as "pendências" citadas nas sessões anteriores do CLAUDE.md estavam
  desatualizadas. Sem a `074`, a trava do servidor não existe (mas os guards
  de cliente já barram os caminhos normais).
- **NÃO usar `supabase db push`.** A tabela `supabase_migrations.schema_migrations`
  de produção só tem 4 linhas de um template antigo (`schema`, `rls`,
  `auth_seed`, `recurring`) — nunca acompanhou as 77 migrations reais do repo,
  que foram todas aplicadas à mão pelo SQL editor. Um `db push` tentaria rodar
  tudo do zero e quebraria. Aplicar `074` colando o SQL no editor; para saber o
  que falta, sondar o schema (`to_regclass`, `information_schema.columns`,
  `pg_trigger`, …), não o CLI.
- **Depois de aplicar a `074`:** bloqueios com `situacao = 'pendente'`
  esquecidos no banco passam a barrar agendamentos naquele horário. Rodar
  `select ... from agenda_bloqueios where situacao = 'pendente'` e revisar.
- `mobile/` mantém os ~10 erros de `tsc` pré-existentes (baseline); nenhum novo.

---

## 11. Arquivos tocados (previsão)

| Arquivo | Mudança |
|---|---|
| `shared/bloqueios.ts` | `bloqueioEmConflito`, `bloqueioNoInstante`, `BlocoParaChecagem` |
| `web/tests/unit/bloqueios.test.ts` | casos das 2 funções novas |
| `supabase/migrations/074_agendamentos_recusa_bloqueio.sql` | trigger novo |
| `web/app/(app)/agenda/page.tsx` | alinhamento + Início/Fim do `NovoBloqueioModal`; clique bloqueado na Timeline; faixa/guarda no `NovoAgModal`; confirmação de remoção via `ConfirmDialog`; `onKeyDown` da Parte C nos 2 modais |
| `web/lib/formNav.ts` + `web/tests/unit/form-nav.test.tsx` | helper `avancarComEnter` + teste jsdom (Parte C) |
| `web/app/(app)/clientes/page.tsx`, `clientes/[id]/page.tsx`, `equipe/page.tsx`, `financeiro/page.tsx`, `pacotes/page.tsx` | `onKeyDown={avancarComEnter}` nos `<form>` de modal (Parte C) |
| `mobile/hooks/useAgenda.ts` | `useRemoverBloqueio` |
| `mobile/components/ConfirmarRemoverBloqueio.tsx` | modal novo |
| `mobile/app/(empresa)/agenda.tsx` | `X` no bloco + modal + `SlotVazio` reforçado |
| `mobile/app/(profissional)/agenda.tsx` | `X` no bloco (só próprio pendente) + modal + `SlotVazio` reforçado |
| `mobile/app/(empresa)/novo-agendamento.tsx` | trata mensagem do trigger |

---

## 12. Parte C — navegação por teclado nos modais (web)

**Pedido:** no modal, **Enter** avança para o próximo campo da cadeia (em vez
de enviar o formulário) e **Tab** percorre os campos limpo. Vale para **todos
os `<form>` dentro de `.bm-modal`** do app web.

### 12.1 Helper `web/lib/formNav.ts`

```ts
import type React from 'react';

/**
 * Handler de `onKeyDown` para <form> de modal: Enter move o foco para o
 * próximo campo focável (input/select/textarea visível e habilitado) em
 * vez de enviar. No último campo, foca o botão `type="submit"` — não
 * envia; exige um Enter/clique explícito nele. Tab continua nativo.
 * Enter em <textarea> e em <button> mantém o comportamento padrão
 * (quebra de linha / clique).
 */
export function avancarComEnter(e: React.KeyboardEvent<HTMLFormElement>): void {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  const alvo = e.target as HTMLElement;
  if (alvo.tagName === 'TEXTAREA' || alvo.tagName === 'BUTTON') return;
  e.preventDefault();
  const campos = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>('input, select, textarea'),
  ).filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.tabIndex >= 0 &&
      !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
  );
  const prox = campos[campos.indexOf(alvo) + 1];
  if (prox) {
    prox.focus();
    (prox as HTMLInputElement).select?.();
  } else {
    e.currentTarget.querySelector<HTMLElement>('button[type="submit"]')?.focus();
  }
}
```

- **Tab:** nada a fazer — a ordem nativa já segue o DOM. Sem focus-trap
  (não foi pedido).
- **`<select>`:** Enter avança (não abre); o usuário escolhe com as setas ou
  o clique nativo. Aceitável.
- **`SearchSelect` (componente custom):** quando fechado, renderiza um
  `<div role="combobox">` (não um `<input>` no chain) — a navegação por Enter
  **pula** esses campos. É por design: o `SearchSelect` é dirigido a clique
  e não tem "Enter para selecionar" hoje. Fora de escopo mudar isso. O único
  efeito colateral positivo: quando o dropdown está aberto, o Enter no input
  de busca deixa de enviar o formulário (hoje envia) e passa a avançar.

### 12.2 Aplicação

Acrescentar `onKeyDown={avancarComEnter}` ao `<form>` de cada modal:

| Arquivo | `<form>` (aprox.) |
|---|---|
| `web/app/(app)/agenda/page.tsx` | `NovoAgModal` (~782), `NovoBloqueioModal` (~1246) |
| `web/app/(app)/clientes/page.tsx` | ~97 |
| `web/app/(app)/clientes/[id]/page.tsx` | ~223 |
| `web/app/(app)/equipe/page.tsx` | ~124, ~254 |
| `web/app/(app)/financeiro/page.tsx` | ~204, ~403, ~871 |
| `web/app/(app)/pacotes/page.tsx` | ~206, ~418 |

**Fora:** `configuracoes` (formulários de página inteira) e telas de
autenticação — ver §2 "Não entra".

### 12.3 Teste (`web/tests/unit/form-nav.test.tsx`, jsdom)

- Monta um `<form>` com 3 inputs + `<button type="submit">`; foca o 1º;
  dispara `keydown` Enter → foco vai para o 2º, `preventDefault` chamado.
- Enter no último input → foco vai para o `button[type="submit"]`; o form
  **não** dispara `submit`.
- Enter com `shiftKey` → ignorado (não faz `preventDefault`).
- Campo `disabled` no meio é pulado.
- Enter em `<textarea>` → não faz `preventDefault` (quebra de linha normal).
