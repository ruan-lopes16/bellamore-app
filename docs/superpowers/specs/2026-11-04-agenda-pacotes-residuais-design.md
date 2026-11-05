# Agenda e pacotes — residuais (web × app) — design

**Data:** 2026-11-04 · **Branch:** `feat/agenda-pacotes-residuais` · **Sem migration.**

**Fonte:** residuais da fase 100 e itens C2, C3, C5, C6 de `docs/superpowers/notes/2026-11-03-backlog-pendencias.md`.

## Decisões do dono (2026-11-04)

- **Pacote vinculado vencido, esgotado ou cancelado:** continua valendo como hoje. O atendimento sai pelo pacote e consome a sessão, sem trava no banco.
- **Cancelados nas agendas (C4):** continuam fora da agenda, como hoje.

Ambas entram na seção D do backlog.

## 1. Erro persistente na carga dos pacotes (Comanda web e app)

Quando `estadoPacotes === 'erro'` e há atendimento vinculado, o bloqueio mostra hoje só "Tentar de novo". Passa a mostrar também **"Desvincular e cobrar normal"**, que desvincula todos os atendimentos da comanda que têm vínculo, usando o `desvincularPacote` de cada um. Sem vínculo, `bloqueioCargaPacotes` devolve `null` e a comanda fecha.

Em `shared/pacotes.ts`, nova função `atendimentosVinculados(itens, pacoteLinks): string[]`, que devolve os `agendamento_id` com vínculo (id preenchido) e com linha na comanda. `bloqueioCargaPacotes` passa a usá-la por dentro. O texto do botão fica em `ROTULO_DESVINCULAR_TODOS = 'Desvincular e cobrar normal'`.

Só vale para a comanda nova: em edição, `bloqueioCargaPacotes` já não se aplica.

## 2. Validade nas listas pelo dia do atendimento

Hoje `calcularPacotesAtivosCliente(rows, hojeBRT())` é chamado em 4 pontos. Cada um passa a usar o dia do atendimento:

| Ponto | Dia usado |
|---|---|
| Comanda web | `chaveDiaExibido(dataComanda)` |
| Comanda app | `chaveDiaExibido(dataComanda)` |
| Agenda web (formulário) | `chaveDiaExibido(dataSel)` |
| App `novo-agendamento` | `dataChave` |

O dia entra nas dependências do efeito de carga. Trocar o dia recalcula a lista, e a regra de nunca desvincular em silêncio o pacote original continua como está. É a mesma regra do banco desde a 100: a validade conta pelo dia do atendimento em Brasília.

## 3. Atendimento longo na grade do app (C2)

Em `shared/agenda-grade.ts`, nova função `continuacoesPorHora(ags, dia, horas)`:
- **Entrada:** `ags` do tipo `{ data_hora_inicio, data_hora_fim, status? }`.
- **Saída:** `Record<number, T[]>` com as horas seguintes à hora de início que o atendimento ainda ocupa no dia. Um atendimento das 9:00 às 11:00 dá a hora 10; das 9:30 às 10:15 também dá 10; das 9:00 às 10:00 não dá nenhuma.
- Só considera horas de `horas`. Ignora `cancelado` e `faltou`.

**Telas** (`(empresa)/agenda.tsx` em lista e em colunas, e `(profissional)/agenda.tsx`):
- Nas horas de continuação, a célula mostra um bloco fino "↳ {cliente} · até HH:mm". Tocar nele abre o atendimento.
- Essas horas **não** mostram `SlotVazio`.
- Em colunas, cada coluna calcula as continuações só dos itens dela.

## 4. Avaliação editável no web (C3)

O detalhe do atendimento na agenda web (modal de detalhe) ganha a seção "Avaliação" quando `status === 'concluido'` e há cliente:
- carrega `avaliacoes` por `agendamento_id` (nota e comentário);
- grava com `salvarAvaliacao` (upsert);
- tem estados de carregando, erro com "Tentar de novo" e salvo;
- é o mesmo comportamento do componente `AvaliacaoAtendimento` do app.

A leitura fica numa função de shared, `carregarAvaliacao(db, agendamentoId)` em `shared/agenda-consultas.ts`, usada pelo web e pelo app (o app troca a consulta inline por ela). O modal que abre depois de concluir continua existindo.

## 5. Seletor de dia do web em Brasília (C5)

`web/app/(app)/agenda/page.tsx`:
- o dia inicial vem de `dataDoDia(hojeBRT())`;
- a semana inicial vem de `semanaDoDia(dataDoDia(hojeBRT()))`;
- "Hoje" e os destaques usam `chaveDiaExibido(d) === hojeBRT()` em vez de `isToday`.

O mesmo vale para a data inicial da Comanda web (`dataComanda`).

## 6. Contagem do mês no app (C6)

Em `shared/agenda-consultas.ts`:
- `CHAVES_AGENDA = ['agenda-dia', 'dias-agendados', 'agendamento', 'bloqueios-dia']`, só as chaves que existem; o plano confere cada uma;
- `invalidarAgenda(qc)`.

O app chama `invalidarAgenda` onde hoje invalida só `agenda-dia`: detalhe do atendimento, Comanda e novo agendamento (criar e editar).

## Testes

- **Unitários:** `atendimentosVinculados`, `continuacoesPorHora` (atravessa horas, termina na hora cheia, cruza meia-noite, cancelado/faltou fora, fora da janela), `CHAVES_AGENDA` contra as `queryKey` do app (varredura).
- **Cruzado:** web e app usam `calcularPacotesAtivosCliente` sem `hojeBRT()`, `ROTULO_DESVINCULAR_TODOS`, `carregarAvaliacao` e `continuacoesPorHora` nas duas agendas do app.
- **Verificação:** vitest 100%, tsc do web 0, tsc do mobile só com o erro pré-existente de `useAgenda.ts`, `next build` OK.

## Deploy

Sem migration nem dependência nativa. Basta fazer o merge e recarregar o PWA.
