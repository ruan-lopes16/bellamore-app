# Agenda e pacotes — residuais — plano

Spec: `docs/superpowers/specs/2026-11-04-agenda-pacotes-residuais-design.md`. Branch `feat/agenda-pacotes-residuais`. Sem migration.

## Regras gerais

- Comentários e textos de tela em pt-BR. Preservar os finais de linha CRLF dos arquivos existentes: não usar `sed -i`, usar a ferramenta Edit.
- Nunca commitar `.superpowers/` nem `.env*`.
- Ao terminar cada task, rodar:
  - `cd web && npx vitest run`, que deve passar inteiro;
  - `cd web && npx tsc --noEmit`, sem erros;
  - `cd mobile && npx tsc --noEmit`, que só pode ter o erro TS2430 pré-existente de `hooks/useAgenda.ts`.
- Os testes ficam em `web/tests/unit/`, com o padrão dos que já existem (importam `@shared/...`).
- Fazer um commit por task, terminado em `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Task 1 — shared + testes

1. **`shared/pacotes.ts`**
   - Criar `export function atendimentosVinculados(itens: { agendamento_id?: string | null }[], pacoteLinks: Record<string, string | null | undefined>): string[]`. Ela devolve os `agendamento_id` com id de pacote preenchido em `pacoteLinks` e com pelo menos uma linha em `itens`.
   - Reescrever `bloqueioCargaPacotes` para usá-la, sem mudar o comportamento.
   - Criar `export const ROTULO_DESVINCULAR_TODOS = 'Desvincular e cobrar normal';`.
   - Escrever o JSDoc em pt-BR.
2. **`shared/agenda-grade.ts`**
   - Criar `continuacoesPorHora<T extends { data_hora_inicio: string; data_hora_fim: string; status?: string | null }>(ags: T[], dia: string, horas: number[]): Record<number, T[]>`.
   - Ela usa `recortarAoDia({ data_inicio, data_fim }, dia)` e devolve as horas `h` com `hIni < h < hFim`. Aqui `hIni = floor(início)` e `hFim = ceil(fim)` são as horas relativas ao início do dia em Brasília, a mesma conta de `bloqueiosPorHora`, mas sem a hora de início.
   - Só entram horas de `horas`. `status` `cancelado` e `faltou` ficam fora.
3. **`shared/agenda-consultas.ts`**
   - Criar `carregarAvaliacao(db, agendamentoId): Promise<{ nota: number; comentario: string | null } | null>`, copiando a consulta que hoje está em `mobile/components/atendimento/AvaliacaoAtendimento.tsx`. Ler o arquivo, usar `maybeSingle` e lançar o erro.
   - Criar `export const CHAVES_AGENDA` com as chaves de topo do React Query do app ligadas à agenda. Achar todas com grep por `queryKey: \['` em `mobile/hooks/useAgenda.ts`, `mobile/hooks/useProfissional.ts` e `mobile/app/(empresa)/agendamento/[id].tsx`. No mínimo `agenda-dia` e `dias-agendados`. Incluir também as chaves de bloqueios do dia, as da agenda da profissional e os dias da profissional, se existirem.
   - Criar `export function invalidarAgenda(qc: { invalidateQueries: (f: { queryKey: unknown[] }) => unknown }): void`, que invalida cada chave.
4. **Testes** (novo `web/tests/unit/agenda-pacotes-residuais.test.ts`):
   - `atendimentosVinculados`: com vínculo e linha; vínculo sem linha; null.
   - `continuacoesPorHora`:
     - 9:00–11:00 dá {10};
     - 9:30–10:15 dá {10};
     - 9:00–10:00 dá {};
     - cancelado e faltou dão {};
     - hora fora da janela não aparece.
     - Usar instantes em ISO com `-03:00`.
   - `CHAVES_AGENDA`: uma varredura confere que toda `queryKey` usada em `mobile/hooks/useAgenda.ts` está na lista.

## Task 2 — web

1. **`web/app/(app)/comanda/page.tsx`**
   - `calcularPacotesAtivosCliente(rows, chaveDiaExibido(dataComanda))`, com `dataComanda` nas dependências do efeito de carga dos pacotes. Calcular `chaveDiaExibido(dataComanda)` fora do efeito e usar a string como dependência.
   - No bloco de bloqueio (perto de "Tentar de novo"), quando `bloqueioCargaPacote && estadoPacotes === 'erro'`, mostrar também um botão `ROTULO_DESVINCULAR_TODOS` que chama `desvincularPacote(id)` para cada `atendimentosVinculados(itens, pacoteLinks)`.
   - `useState<Date>(new Date())` de `dataComanda` passa a `dataDoDia(hojeBRT())` (`@shared/agenda-grade`). Conferir se a tela usa `isToday` e trocar por `chaveDiaExibido(d) === hojeBRT()`.
2. **`web/app/(app)/agenda/page.tsx`**
   - No formulário, a carga de pacotes usa `calcularPacotesAtivosCliente(rows, chaveDiaExibido(dataSel))`, com o dia nas dependências. Atenção: há dois `dataSel`, um no formulário (linha ~361) e outro na página (~2178).
   - Na página, o estado inicial do dia passa a `dataDoDia(hojeBRT())`, e o da semana a `semanaDoDia(dataDoDia(hojeBRT()))`.
   - Todo `isToday(x)` vira `chaveDiaExibido(x) === hojeBRT()`. Remover o import não usado.
3. **Avaliação no detalhe (agenda web)**
   - Achar o modal de detalhe do atendimento (busca por "Ligar" ou "WhatsApp" no arquivo).
   - Quando `status === 'concluido'` e há cliente, criar a seção "Avaliação" como componente local `AvaliacaoDetalhe`:
     - estrelas de 1 a 5 clicáveis e um textarea "Comentário";
     - carrega com `carregarAvaliacao`, mostrando "Carregando…" e, em erro, a mensagem com o botão "Tentar de novo";
     - botão "Salvar avaliação", que chama `salvarAvaliacao` (ver como `AvaliacaoModal` chama) e mostra "Avaliação salva" ou o erro (`mensagemErroBanco`);
     - o botão fica desligado sem nota ou enquanto salva.
   - Usar classes e tokens já usados no arquivo.

## Task 3 — app

1. **`mobile/app/(empresa)/nova-comanda.tsx`:** os mesmos 2 itens da Comanda web (dia da comanda na validade e botão `ROTULO_DESVINCULAR_TODOS` no estado de erro, ao lado de "Tentar de novo" perto da linha ~2186). Trocar `invalidateQueries({ queryKey: ['agenda-dia'] })` por `invalidarAgenda(qc)`.
2. **`mobile/app/(empresa)/novo-agendamento.tsx`:**
   - validade por `dataChave`, que entra nas dependências do efeito;
   - depois de criar ou editar, chamar `invalidarAgenda(qc)` onde hoje invalida a agenda.
   - Conferir se `(profissional)/novo-agendamento.tsx` reexporta essa tela.
3. **`mobile/app/(empresa)/agendamento/[id].tsx`:** trocar as invalidações de `agenda-dia` por `invalidarAgenda(qc)`, mantendo as outras chaves.
4. **`mobile/components/atendimento/AvaliacaoAtendimento.tsx`:** a `queryFn` passa a usar `carregarAvaliacao`.
5. **Grade (C2):**
   - **`(empresa)/agenda.tsx`, visão em lista:** calcular `contPorHora = continuacoesPorHora(agendamentos, dia, horas)`. `renderCelula` ganha o parâmetro `conts: AgendamentoCompleto[]`.
     - Quando há `ags`, o comportamento atual continua.
     - Senão, renderizar cada continuação como um bloco fino com borda tracejada da cor do status: texto "↳ {cliente?.nome ?? 'Atendimento'} · até {horaBRT(data_hora_fim)}", tocável, que abre o mesmo destino do `AgendamentoCard` (conferir no arquivo).
     - Não mostrar `SlotVazio` quando há continuação.
   - **Colunas:** em `TimelineColunas`, `renderCelula` passa a receber também as continuações da coluna. Calcular `continuacoesPorHora(c.itens, dia, horas)` por coluna. O componente ganha a prop `dia`, ou recebe as continuações já calculadas por coluna, o que for mais simples.
   - **`(profissional)/agenda.tsx`:** o mesmo (lista).
   - O tipo dos agendamentos precisa ter `data_hora_fim`. Conferir.

## Task 4 — cruzado + docs

1. **Teste cruzado** (novo `web/tests/unit/paridade-agenda-residuais-cruzada.test.ts`), por leitura dos arquivos:
   - nenhum dos 4 arquivos (comanda web e app, agenda web, novo-agendamento app) chama `calcularPacotesAtivosCliente(rows, hojeBRT())`;
   - as duas comandas usam `ROTULO_DESVINCULAR_TODOS` e `atendimentosVinculados`;
   - a agenda web e o componente do app usam `carregarAvaliacao`;
   - as duas agendas do app usam `continuacoesPorHora`;
   - a agenda web não usa `isToday(`.
2. **`docs/superpowers/notes/2026-11-03-backlog-pendencias.md`:**
   - na seção D, acrescentar as 2 decisões de 04/11 (pacote vencido continua valendo; cancelados fora da agenda);
   - marcar C2, C3, C5 e C6 como resolvidos em 04/11 e tirar C4.
