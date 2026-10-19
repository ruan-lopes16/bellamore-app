# Paridade Agenda (web × app) — design

**Data:** 2026-10-19 · **Branch:** `feat/paridade-agenda` (um PR, 4 entregas) · **Migration:** 094.

**Fontes:**
- inventário `docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md` (§ Agenda), conferido no código de 19/10 (merge do #152). Dos 34 itens, 24 continuam valendo, 6 já estão resolvidos e 4 estão parciais;
- pendências "Agenda" registradas no CLAUDE.md.

## Decisões do dono (2026-10-19)

1. **Filtro "Todas as profissionais":** passa a existir nas duas plataformas para quem tem `agenda.ver_equipe`. A agenda abre na própria pessoa. Cada pessoa pode trocar a abertura em Configurações → Perfil ("Minha agenda abre em: Minha agenda / Todas as profissionais"). A preferência vale por pessoa e por empresa.
2. **Data passada:** agendar no passado é permitido, mas pede a confirmação "Esse horário já passou. Registrar mesmo assim?" (web e app).
3. **Status:** a troca é livre, com duas travas:
   - atendimento com comanda fechada não sai de Concluído (a tela avisa e o banco recusa);
   - Cancelado ou Faltou só volta a Agendado ou Confirmado depois de confirmação.
4. **Horários:**
   - a janela padrão vai das 7h às 21h e se estica para incluir qualquer atendimento ou bloqueio do dia;
   - os horários oferecidos vão de 15 em 15 minutos;
   - dá para digitar um horário exato.
5. **Semana:** começa no domingo nas duas plataformas (decisão 6 da Fase 2A, que valia só para os números e agora vale também para a agenda).

## Arquitetura

As regras ficam em `shared/` e as duas plataformas chamam as mesmas funções. As travas que envolvem dinheiro ficam também no banco. A gravação do agendamento continua em passos (agendamento e depois `agendamento_servicos`), com cada erro conferido; não há função de gravação nova.

### `shared/agenda.ts` (novo)

| Função | Regra |
|---|---|
| `janelaDoDia(itens, padrao = {ini: 7, fim: 21})` | Devolve `{ini, fim}` em horas inteiras. Estica a janela para cobrir o início e o fim de cada atendimento e de cada bloqueio do dia, em Brasília. Limites: 0 e 24 |
| `horariosDoDia(janela, passoMin = 15)` | Lista "HH:MM" de 15 em 15 minutos dentro da janela |
| `inicioDaSemana(chaveDia)` / `diasDaSemana(chaveDia)` | Semana de domingo a sábado em Brasília, a partir de `periodos.ts` |
| `instanteNoPassado(iso, agora)` | Indica se o horário escolhido já passou |
| `statusPermitidos(atual, comandaFechada)` | Tabela abaixo |
| `precisaConfirmarStatus(atual, novo)` | Devolve a pergunta quando precisa confirmar: cancelar, marcar falta ou reabrir |
| `montarAgendamento(entrada)` | Ver "Agendar e editar" |
| `conflitosDeHorario(novo, existentes, ignorarId?)` | Atendimentos da mesma profissional que se sobrepõem, ignorando os cancelados e as faltas |
| `linhasIniciaisEdicao(ag, linhas)` | Atendimento sem linhas em `agendamento_servicos` começa com uma linha montada a partir de `servico_id`, `valor` e da duração do serviço principal |
| `colunasPorProfissional(ags, profissionais)` | Agrupa por profissional para a timeline em "Todas" |

**Status:**

| Atual | Pode ir para |
|---|---|
| agendado | confirmado, concluido, cancelado, faltou |
| confirmado | agendado, concluido, cancelado, faltou |
| cancelado / faltou | agendado, confirmado (com confirmação "Reabrir este atendimento?") |
| concluido sem comanda | agendado, confirmado, cancelado, faltou |
| concluido com comanda fechada (`comanda_id` preenchido) | nenhum. Mensagem: "Já fechado na comanda. Para mudar, edite a comanda." |

- Cancelar e marcar falta sempre pedem confirmação. Quando a taxa de cancelamento se aplica, a confirmação é a própria pergunta da taxa ("Cobrar taxa de cancelamento de R$ X?", da 091); não aparecem duas perguntas seguidas.
- Concluir pela agenda continua como hoje: não abre a comanda. O alerta de "comandas não fechadas" cobre esse caso.

**Agendar e editar (`montarAgendamento`):**
- Recebe as linhas (serviço, profissional, valor, duração), o início, a cliente, a duração editada (opcional) e a configuração de taxa.
- O valor total é a soma das linhas. Campo de valor vazio vira o preço do serviço; **0 digitado continua 0** (cortesia).
- A duração é a soma das linhas; a duração editada substitui essa soma. O fim é o início mais a duração.
- A taxa de reserva sugerida é `valorTaxaReservaSugerida(cfg, valorTotal)`, recalculada quando o total muda, até a pessoa digitar um valor próprio.
- Devolve `{ agendamento, linhas, avisos }`. Os avisos são o conflito e o horário passado, e a tela pergunta cada um antes de salvar. O bloqueio volta como erro e não deixa salvar; a mensagem é a mesma do trigger 074.

### Migration 094 (`094_agenda_status_avaliacao_preferencia.sql`)

1. **Trava de Concluído:** trigger `BEFORE UPDATE OF status` em `agendamentos` que recusa `old.status = 'concluido' and old.comanda_id is not null and new.status <> 'concluido'`, com a mensagem "Já fechado na comanda. Para mudar, edite a comanda." (P0001). Antes de escrever, confira que `editar_comanda` (090/093) nunca muda o status.
2. **Avaliação:**
   - trigger `BEFORE INSERT OR UPDATE` em `avaliacoes` (security definer, `search_path` fixo) que preenche `profissional_id` com o `empresa_membros.id` da profissional do atendimento, procurado por `empresa_id` e `user_id`, e ignora o valor que vier da tela;
   - confere também que `empresa_id` e `cliente_id` batem com os do atendimento;
   - a policy `empresa_all_avaliacoes` é derrubada e substituída por:
     - SELECT para membro ativo;
     - INSERT e UPDATE para quem pode mexer no atendimento (o próprio atendimento, ou `agenda.gerenciar_outras`, ou `is_gestor_ou_owner`);
     - DELETE só para `is_gestor_ou_owner`.
3. **Preferência:**
   - coluna `empresa_membros.agenda_abre_em text not null default 'propria' check (agenda_abre_em in ('propria','todas'))`;
   - função `salvar_preferencia_agenda(p_empresa uuid, p_valor text)`, security definer, `search_path` fixo, que confere `auth.uid()`. Ela altera só a linha da própria pessoa (`user_id = auth.uid()`, `ativo`) e só aceita `todas` com `tem_permissao(..., 'agenda.ver_equipe')`. Sem RETURNING; confere a linha com `GET DIAGNOSTICS`;
   - antes de escrever, confirme que os triggers da 043/083 em `empresa_membros` deixam essa coluna passar (eles bloqueiam a troca de papel feita pela própria pessoa) e documente.
4. Idempotente, com cabeçalho, rollback e `notify pgrst, 'reload schema';`. Ordem de deploy livre: as telas detectam a coluna e a função (`PGRST202` / coluna ausente) e, sem a 094, continuam abrindo na própria pessoa.

## Entregas

### E1 — Regras e banco
- `shared/agenda.ts` com testes.
- Migration 094 com testes de texto e PGlite.
- Bugs do web:
  - edição de atendimento antigo sem serviços (`linhasIniciaisEdicao`);
  - taxa de reserva calculada sobre a última linha (passa a usar `montarAgendamento`);
  - erros ignorados em `avaliacoes` e em `fetchDia`;
  - id errado na avaliação (a tela para de mandar `profissional_id`).

### E2 — Agendar e editar no app igual ao web
- `mobile/app/(empresa)/novo-agendamento.tsx` vira uma tela de criar **e** editar (`?id=`):
  - vários serviços, cada um com profissional, valor e duração;
  - duração total editável;
  - horários de `horariosDoDia` com campo livre;
  - avisos de conflito e de horário passado;
  - checagem de bloqueio antes de salvar;
  - grava `agendamento_servicos` como o web.
- Profissionais = todos os membros ativos (dona, gestora e profissional), igual ao web.
- Correção das regras de hooks (`return null` antes de hooks; `setState` dentro de `useMemo`).
- Rota `(profissional)/novo-agendamento`, que reaproveita a mesma tela travada na própria profissional. A agenda da profissional passa a mandar a data e a hora no formato que a tela espera.
- Botão "Editar" no detalhe (`agendamento/[id]`), para quem pode mexer no atendimento.

### E3 — Visões
- **App:**
  - as setas da faixa de semana mudam a semana de verdade;
  - semana de domingo a sábado;
  - nova visão Mês, com contagem por dia e toque que abre o dia;
  - janela dinâmica nas agendas da empresa e da profissional;
  - os bloqueios passam a ser filtrados pela profissional escolhida (o bloqueio de outra profissional não esconde o horário vazio);
  - em "Todas", a timeline mostra uma coluna por profissional, com rolagem horizontal.
- **Web:**
  - opção "Todas as profissionais" no seletor, que em "Todas" mostra uma coluna por profissional na Timeline;
  - janela dinâmica na Timeline (nada fica cortado);
  - bloqueios desenhados também nas visões Semana e Mês.
- **Preferência de abertura:**
  - fica em Configurações → Perfil (web e app), só para quem tem `agenda.ver_equipe`;
  - as duas agendas abrem pela preferência e, sem ela, na própria pessoa.

### E4 — Detalhe do atendimento
- **App (`agendamento/[id]`):**
  - status por `statusPermitidos`, com as confirmações;
  - avaliação de 1 a 5 com comentário (só para concluído, uma por atendimento, editável);
  - ao excluir, o aviso de taxa consulta a taxa paga e mostra o valor, como o web.
- **Web:**
  - o detalhe do atendimento na agenda ganha comanda e pagamentos (`montarDetalheAtendimento`, como no perfil da cliente);
  - botões Ligar, WhatsApp e Perfil da cliente;
  - resumo do dia com os mesmos 4 números do app (Agendamentos, Receita prevista, Profissionais, Pendentes), a partir de uma função em `shared/` usada pelas duas plataformas;
  - status por `statusPermitidos`, com confirmação antes de cancelar.

## Erros
- Toda gravação usa `.select('id')` e confere as linhas afetadas.
- Mensagens em português por `mensagemErroBanco`, inclusive as mensagens P0001 da 094.
- Erro de carga mostra "—" ou um aviso, nunca zero nem lista vazia.

## Testes
- Unitários de `shared/agenda.ts`: janela, horários, semana no domingo, status, montagem (cortesia 0, taxa sobre o total, atendimento antigo sem linhas), conflitos.
- 094 por texto e em PGlite:
  - trava de Concluído;
  - avaliação gravada com `profissional_id` certo e empresa conferida;
  - preferência: só a própria linha, e `todas` só com permissão;
  - a policy ampla derrubada.
- Teste cruzado por varredura: as duas plataformas usam as mesmas funções de `shared/agenda.ts`; nenhum `weekStartsOn: 1` sobra na agenda; nenhuma lista fixa de 7h a 19h; `parseFloat(valor) || preco` sai.
- Ao final: vitest 100%, `tsc` do web 0, `tsc` do mobile 8 (baseline).

## Fora do escopo
- Função de gravação de agendamento tudo ou nada.
- Push de bloqueio pendente.
- Avaliação pela própria cliente (não há área da cliente).
- Horário de funcionamento configurável.
