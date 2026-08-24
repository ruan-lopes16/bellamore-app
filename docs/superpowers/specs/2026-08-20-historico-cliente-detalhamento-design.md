# Histórico real da cliente + detalhamento do atendimento

## Contexto

Pedido do usuário: *"quero que no histórico da cliente mostre o histórico de fato e tenha o
detalhamento ao clicar no horário que já foi finalizado e etc, pra ver como foi pagamento, oq foi
feito etc."*

Segunda de três specs independentes derivadas do mesmo pedido. A primeira (zoom em inputs e
estabilidade dos modais) já foi entregue no PR #107. A terceira (sistema de crédito para pacotes)
tem spec própria.

O pedido tem duas metades, e a investigação mostrou que a primeira é mais grave do que "falta
detalhe": o histórico atual **exibe informação incorreta**, não apenas incompleta.

## Parte A — Defeitos do histórico atual

Quatro defeitos, todos confirmados por leitura do código.

### A1. Agendamento multi-serviço mostra um serviço só, com o valor de todos

*(web e mobile)*

A migration 020 criou `agendamento_servicos` para vários serviços por agendamento. Ao salvar, a
Agenda grava na linha do agendamento (`web/app/(app)/agenda/page.tsx:443`):

```ts
servico_id: filled[0].servico_id,          // só o PRIMEIRO servico
valor:      filled.reduce((s, l) => s + l.valor, 0),  // soma de TODOS
```

A tela da Agenda compensa isso montando `"Serviço A + Serviço B"` a partir de
`agendamento_servicos` (`web/app/(app)/agenda/page.tsx:172-173`). O histórico da cliente **não**:
tanto o web (`web/app/(app)/clientes/[id]/page.tsx:447`) quanto o mobile
(`mobile/hooks/useClientes.ts:215-222`) selecionam apenas `servico:servicos(nome)`.

Efeito: uma cliente que fez sobrancelha + buço + spa dos lábios numa sessão vê
**"Design de sobrancelha · R$ 250"** — o nome de um serviço com o preço dos três. O número está
certo, o rótulo está errado, e não há como a cliente ou a gestão perceberem isso pela tela.

### A2. Serviço lançado direto na comanda não aparece no histórico do mobile

*(só mobile)*

O web inclui, no histórico e nas estatísticas, os serviços lançados direto na comanda para cliente
sem hora marcada (`comanda_itens` com `tipo = 'servico'` — ver
`web/app/(app)/clientes/[id]/page.tsx:484`). O mobile consulta **apenas** `agendamentos`
(`mobile/hooks/useClientes.ts:215-222`), então esses atendimentos somem por completo da ficha da
cliente no celular.

### A3. Histórico do mobile cortado em 20, sem aviso

*(só mobile)*

`mobile/hooks/useClientes.ts:222` termina em `.limit(20)`. O web pagina tudo via
`buscarTodasPaginas` (`web/app/(app)/clientes/[id]/page.tsx:30`), justamente para não truncar o
histórico de clientes antigas. No mobile, a 21ª visita em diante desaparece sem nenhuma indicação.

### A4. "Total gasto" e "total de visitas" subestimados no mobile

*(só mobile)*

Consequência direta de A2 e A3: `mobile/hooks/useClientes.ts:248-249` calcula

```ts
const concluidos = agendamentos.filter((a) => a.status === 'concluido');
const totalGasto = concluidos.reduce((acc, a) => acc + Number(a.valor), 0);
```

sobre a lista já truncada em 20 e já sem os extras de comanda. São os dois números de destaque no
topo do perfil da cliente, e ambos ficam menores que a realidade para qualquer cliente frequente.
As tags calculadas a partir deles (`calcularTags`) herdam o erro.

**Nota de escopo:** A3 e A4 não estavam no pedido do usuário — foram encontrados durante a
investigação de A1 e vivem na mesma query. O usuário aprovou explicitamente corrigi-los junto.

## Parte B — Detalhamento do atendimento

### Onde aparece

| Plataforma | Hoje | Depois |
|---|---|---|
| Web | Linhas do histórico não são clicáveis | Clique abre modal de detalhe |
| Mobile | Linha navega para `agendamento/[id]`, que mostra serviço, profissional, valor, duração e observação | Mesma tela ganha as seções de comanda, fechamento e pagamento |

O conteúdo é idêntico nas duas plataformas.

### Conteúdo

1. **Atendimento** — início, fim, duração real, profissional, status, observação do agendamento.
2. **O que foi feito** — cada item da comanda: descrição, quantidade, valor unitário, valor da
   linha e profissional executante. Cobre os três tipos de item (`servico`, `produto`, `pacote`).
3. **Fechamento** — subtotal → desconto manual → desconto de taxa de reserva já paga → total.
   Os três valores vêm de `comandas.valor_total`, `comandas.desconto` e
   `comandas.desconto_reserva` (migration 057), com o total em `comandas.valor_final` (coluna
   gerada).
4. **Como foi pago** — uma linha por pagamento: método, valor, bandeira, número de parcelas e taxa
   da maquininha (`pagamentos.taxa_perc` / `valor_liquido`, migrations 021 e 026). Pagamento
   dividido (ex.: metade PIX, metade crédito 3×) aparece como várias linhas.
5. **Pacote e taxas** — se a sessão consumiu sessão de pacote (`pacote_uso.agendamento_id`), e a
   taxa de reserva ou de cancelamento vinculada àquele horário.

### Comanda que cobre vários atendimentos

Uma comanda fecha todos os agendamentos do dia daquela cliente de uma vez
(`web/app/(app)/comanda/page.tsx:647` atualiza `comanda_id` em lote). Então clicar num horário
mostra o pagamento da visita inteira, não daquele horário.

Decisão: **a lista continua por horário** (é o modelo que o usuário descreveu — "clicar no
horário") e o detalhe mostra a comanda completa, dizendo em texto quando ela cobriu mais de um
atendimento e listando quais. Nada fica escondido e nenhum total parece errado.

A alternativa — agrupar a lista por visita — foi considerada e descartada: mudaria a cara do
histórico e faria o horário individual sumir da lista. Ratear o pagamento por atendimento também
foi descartado, por ser impossível de fazer honestamente: metade PIX / metade crédito não se
divide entre serviços.

## Parte C — Arquitetura

### Busca sob demanda

A comanda só é consultada quando o usuário abre o detalhe. O carregamento do histórico continua
exatamente como é hoje, respeitando o princípio de *lazy tab loading* que o `CLAUDE.md` registra
como padrão do projeto. Carregar todas as comandas junto com o histórico tornaria a aba muito mais
pesada para dados que, na maioria das linhas, nunca serão abertos.

### Lógica pura compartilhada

Módulo novo `shared/atendimento-detalhe.ts`, no mesmo padrão de `shared/despesas.ts` e
`shared/taxa-reserva.ts`. As queries ficam em cada plataforma (clientes Supabase diferentes), mas
o cálculo é um só e testável:

```ts
/**
 * Nome legivel dos servicos de um agendamento: junta agendamento_servicos por
 * `ordem` com " + ". Cai no servico legado (`servico.nome`) quando o
 * agendamento nao tem linhas em agendamento_servicos — o caso da maioria dos
 * agendamentos antigos. Retorna null quando nao ha nome nenhum.
 */
export function descreverServicos(ag: AgendamentoComServicos): string | null

/**
 * Monta o modelo de exibicao do detalhe a partir das linhas cruas da comanda.
 * Calcula subtotal, descontos e total, e detecta quando a comanda cobriu mais
 * de um agendamento.
 */
export function montarDetalheAtendimento(entrada: EntradaDetalhe): DetalheAtendimento
```

`descreverServicos` é a correção de A1 num lugar só, consumida pela lista do histórico nas duas
plataformas — e também disponível para a Agenda, que hoje repete essa lógica inline.

### Rota do detalhe no mobile

Corrigir A2 traz um efeito colateral que precisa de tratamento explícito: as linhas de serviço
lançado direto na comanda **não têm agendamento**, e a lista do mobile navega hoje para
`/(empresa)/agendamento/${ag.id}` (`mobile/app/(empresa)/cliente/[id].tsx:519`). Passar um id de
`comanda_itens` para essa rota abriria uma tela quebrada.

Solução: a tela de detalhe passa a aceitar um parâmetro `tipo`. Com `tipo=comanda`, o `id` é lido
como id de comanda, a consulta do agendamento é pulada e só as seções de comanda, fechamento e
pagamento são renderizadas. Sem o parâmetro, o comportamento é exatamente o de hoje.

No web o mesmo problema não existe: o modal recebe `{ agendamentoId }` ou `{ comandaId }` como
propriedade.

## Parte D — Degradação honesta sob RLS

A migration 045 restringe `SELECT` em `comandas`, `comanda_itens` e `pagamentos` a gestor/owner ou
à profissional que atendeu (via `comanda_pertence_ao_profissional`). A permissão
`ver_todos_clientes` existe em `web/lib/permissions.ts:15` mas **não é usada para bloquear nenhuma
rota** — verificado: as únicas referências a ela estão na própria definição e no teste. Ou seja,
uma profissional consegue abrir o perfil de qualquer cliente hoje.

Consequência: ao abrir o detalhe do atendimento de uma colega, a consulta da comanda volta vazia
**sem erro** — o mesmo padrão de falha silenciosa que a sessão da taxa de reserva encontrou
(registrado no `CLAUDE.md`).

A distinção é limpa e verificável no cliente, sem consulta extra:

| Situação | Como identificar | O que mostrar |
|---|---|---|
| Atendimento não concluído | `agendamento.comanda_id` é nulo | Só a seção "Atendimento". Não é erro. |
| RLS bloqueou | `comanda_id` preenchido **e** comanda voltou vazia | "Detalhes financeiros disponíveis apenas para quem atendeu ou para a gestão." |
| Normal | comanda encontrada | Todas as seções |

Esta spec **não** implementa controle de acesso por role — é a feature planejada separada no
`CLAUDE.md`. Aqui só trata a consequência dela no que está sendo construído.

## Garantia de não regressão

- **Nenhuma migration.** Nenhuma tabela, coluna, política de RLS ou índice é criado ou alterado —
  todos os dados já existem no banco.
- **Nada é removido de nenhuma tela.** As correções da Parte A trocam informação errada por
  informação correta; a Parte B é 100% aditiva.
- O carregamento do histórico não fica mais pesado: a única consulta nova é sob demanda, ao abrir
  um detalhe.
- A correção de A3 (limite de 20 no mobile) adota a mesma paginação que o web já usa em produção,
  não uma abordagem nova.

## Critérios de aceite

1. `npx tsc --noEmit` no `web` zerado; `mobile` mantém os ~10 erros pré-existentes de baseline, sem
   nenhum erro novo.
2. `npm test` verde, incluindo os testes já existentes.
3. Agendamento com 3 serviços aparece como `"A + B + C"` no histórico das duas plataformas;
   agendamento antigo, sem linhas em `agendamento_servicos`, continua mostrando o serviço legado.
4. Serviço lançado direto na comanda aparece no histórico do mobile, como já aparece no web.
5. Histórico do mobile não trunca em 20; "total gasto" e "total de visitas" batem com os do web
   para a mesma cliente.
6. Clicar num atendimento concluído abre o detalhe com as 5 seções preenchidas, nas duas
   plataformas.
7. Comanda que cobriu mais de um atendimento é identificada como tal no detalhe, com a lista dos
   atendimentos cobertos.
8. Atendimento não concluído abre o detalhe sem seção financeira e **sem** mensagem de erro.
9. Comanda bloqueada por RLS mostra a mensagem explícita, nunca um modal vazio.
10. Linha de serviço avulso da comanda, no mobile, abre o detalhe pela rota `tipo=comanda` sem
    quebrar.
