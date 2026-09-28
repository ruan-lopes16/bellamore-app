# Comanda — vincular atendimento a sessão de pacote

**Data:** 2026-09-22
**Branch:** `claude/comanda-vincula-sessao-pacote`
**Escopo:** web (`comanda/page.tsx`) + mobile (`nova-comanda.tsx`), sem migration.

## Problema (reportado)

Usuário relatou três sintomas, na sequência, ao testar o alerta de "comandas não
fechadas" entregue nesta sessão:

1. O alerta acusa comanda "não fechada" em casos que ele considera já fechados.
2. Editar/fechar uma comanda às vezes não deixa salvar — botão fica desabilitado,
   sem nenhuma mensagem de erro.
3. Não existe jeito de vincular um atendimento a uma sessão de pacote já paga; o
   único jeito de "zerar" a cobrança hoje é forçar desconto manual ou usar
   "Cortesia", e isso fica confuso nos relatórios.

## Causa raiz (investigação)

Os três sintomas têm uma origem só. Já existe suporte a pacote-por-sessão no
banco, construído em duas migrations anteriores:

- **`011`/`036`** — trigger `fn_registrar_uso_pacote`: quando um agendamento
  muda para `concluido`, registra automaticamente o uso de uma sessão em
  `pacote_uso`, priorizando o pacote vinculado explicitamente em
  `agendamentos.pacote_cliente_id` (coluna adicionada na `036`) quando presente.
- **`065`** — `gerar_comissao()` ignora agendamento com `pacote_cliente_id`
  preenchido: não gera comissão nova pro profissional (a sessão já foi paga na
  venda do pacote).
- A tela de **Agenda** (web e mobile) já tem um seletor pra escolher qual
  pacote do cliente aquele atendimento consome, gravando `pacote_cliente_id`.

O que nunca foi implementado: **nada zera o valor cobrado**. Ao vincular um
pacote na Agenda, `agendamentos.valor` continua recebendo o preço de tabela do
serviço (`web/app/(app)/agenda/page.tsx:511`, mesmo padrão no mobile). A Comanda
lê esse `valor` direto pra montar os itens — então mesmo um atendimento
corretamente vinculado a um pacote chega na Comanda cobrando o preço cheio.

Isso encadeia os três sintomas:
- Como não existe forma de pagamento real pro valor de uma sessão já paga, o
  usuário tenta zerar via desconto manual, mas o botão de fechar exige pelo
  menos 1 split de pagamento sempre — trava sem erro (sintoma 2).
- Enquanto não fecha, o agendamento nunca ganha `comanda_id` — e é exatamente
  esse campo (`comanda_id IS NULL` + horário já passado) que o alerta desta
  sessão usa pra sinalizar "não fechada" (sintoma 1). Não é falso positivo: o
  agendamento genuinamente nunca foi fechado, porque não dava pra fechar.
- E não existe seletor de pacote na Comanda nem indicação visual de cobertura
  (sintoma 3).

## Decisões (com o usuário)

| Pergunta | Resposta |
|---|---|
| Como o valor aparece na comanda quando coberto por pacote? | **Zera direto** (não fica como desconto separado tipo taxa de reserva) — preço de tabela some, item mostra R$ 0. |
| Isso conta como receita? | **Não.** Entra como split "Cortesia" de **R$ 0** (não R$ do valor cheio) — evita contar de novo uma venda que já contou na compra do pacote. |
| Vínculo é por serviço individual ou pelo atendimento inteiro? | **Pelo atendimento inteiro** — se tiver 2 serviços no mesmo horário, os dois zeram juntos (seguindo a coluna `pacote_cliente_id`, que já é por atendimento). |
| Onde o vínculo pode ser feito? | Agenda (já existe) e Comanda (novo, nesta entrega) — **não** em edição de comanda já fechada (ver "Fora de escopo"). |
| Cliente sem pacote ativo pro serviço? | Oferece vender um pacote novo do catálogo ali mesmo (mesmo padrão que a Agenda já tem), consome a 1ª sessão dele na hora. |

## Abordagem escolhida

**A Comanda passa a ser a única fonte de verdade sobre cobrar ou não** — em vez
de duplicar o cálculo na Agenda. Ela decide olhando pro
`agendamentos.pacote_cliente_id` de cada atendimento, não pro `valor` gravado.

Vantagens sobre corrigir o cálculo na Agenda também: um lugar só decidindo "isso
é grátis ou não" (sem risco de os dois divergirem depois), e os atendimentos que
**já estão vinculados mas travados agora** se resolvem sozinhos assim que a
comanda deles for aberta pela primeira vez — sem precisar de backfill no banco
nem de reeditar nada manualmente.

A Agenda **não muda** — o preço que ela mostra ao vincular um pacote continua
sendo só referência (quanto o serviço custaria), nunca é o que efetivamente é
cobrado.

## Solução

### 1. `web/app/(app)/comanda/page.tsx`

- **Query do dia**: já traz `agendamentos.id`; passa a trazer também
  `pacote_cliente_id`. Precisa de uma segunda query (paralela, no mesmo
  `Promise.all` que já busca taxas de reserva pagas) trazendo, por
  `cliente_id`, os pacotes ativos que cobrem cada serviço do catálogo e ainda
  têm sessão sobrando — mesma regra de elegibilidade que `fn_registrar_uso_pacote`
  usa no banco (status `ativo`, não vencido, sessões usadas < total, ou
  ilimitado).
- **Estado novo**: `pacoteLinks: Record<agendamentoId, pacoteClienteId>` —
  vínculos feitos nesta sessão de comanda, ainda não persistidos. Inicializa a
  partir do `pacote_cliente_id` já gravado em cada `AgDia`, se houver.
- **Item de comanda**: `ComandaItem` ganha `coberto?: boolean` (derivado de
  `pacoteLinks[agendamento_id]` presente). Ao montar itens em `abrirComanda`, se
  o atendimento já está vinculado, o item nasce com `valor: 0` e
  `coberto: true`; senão nasce normal (preço de tabela) e SEM vínculo.
- **UI por grupo de atendimento**: abaixo dos itens de cada atendimento sem
  vínculo, um botão "Vincular a pacote" abre um `SearchSelect` com os pacotes
  elegíveis do cliente (rótulo: nome do pacote + sessões restantes). Ao
  escolher: grava em `pacoteLinks`, zera o(s) item(ns) daquele
  `agendamento_id`, mostra badge "Sessão de pacote — {nome}" no lugar do preço
  riscado.
  - Se não houver pacote elegível: mostra "Vender pacote novo" com os pacotes
    do catálogo (`pacotesCat`, já carregado hoje) — ao escolher, insere em
    `pacote_clientes` (mesmo formato que a venda de pacote como item extra já
    faz mais abaixo no arquivo) e insere a venda em `vendas` pelo valor cheio
    (conta como receita — é uma venda nova de verdade). Usa o id resultante
    como o vínculo.
- **`fecharComanda`**: `persistirValoresAgendamento` recebe, além do
  `extraUpdate` uniforme (`status`, `comanda_id`), um `pacote_cliente_id` **por
  grupo** vindo de `pacoteLinks[agendamentoId]` — só entra no `UPDATE` daquele
  agendamento quando há vínculo novo (não sobrescreve com `null` os que não
  foram tocados). Isso garante que o trigger `fn_registrar_uso_pacote` (que
  olha pro `NEW.pacote_cliente_id` na mesma transição de status) já enxerga o
  vínculo.
- **Split automático "Cortesia R$ 0"**: no momento de montar `splitsValidos`
  pra inserir em `pagamentos`, se `splits` estiver vazio e `total <= 0.01`,
  injeta `{ metodo: 'cortesia', valor: 0 }` antes de gravar — dá pra distinguir
  no relatório de formas de pagamento que aquele fechamento não gerou cobrança
  nova.
- **Botão de fechar/salvar**: condição de `disabled` muda de exigir
  `splits.length > 0` sempre, para exigir isso **só quando `total > 0.01`**.
  Com `total` já em zero (por pacote ou por desconto manual de qualquer
  origem), o botão libera sem exigir nenhum split lançado.

### 2. `mobile/app/(empresa)/nova-comanda.tsx`

Mesma coisa, adaptada à tela mobile (que só cobre o primeiro fechamento — não
tem edição de comanda fechada, então não há caso de "fora de escopo" a
considerar aqui): query de pacotes elegíveis, estado `pacoteLinks`, seção de
vínculo por atendimento, split automático de cortesia, e a mesma mudança na
condição de `disabled` do botão de fechar.

### 3. `shared/comanda.ts`

`agruparValoresPorAgendamento` ganha um parâmetro opcional pra receber o mapa
de vínculos e devolver, por grupo, o `pacote_cliente_id` a gravar (quando
houver). Função pura, cobre com teste novo: grupo sem vínculo não inclui o
campo (não sobrescreve); grupo com vínculo inclui o id certo.

## Fora de escopo

- **Vincular pacote editando uma comanda já fechada.** O trigger só dispara na
  transição *para* `concluido` — numa edição o status já está `concluido`, o
  trigger não roda de novo, e forçar o registro de `pacote_uso` manualmente
  pelo app duplicaria a regra que hoje vive só no banco. Pra corrigir um
  fechamento antigo, o caminho continua sendo o manual que já existe em
  Pacotes ("Nova sessão avulsa") — é o "último caso" que o próprio usuário
  descreveu como fallback aceitável.
- **Migration `075`** (RLS de `DELETE` em `pagamentos`/`comanda_itens`,
  necessária pra "Salvar edição" de comanda já fechada funcionar sem duplicar
  splits) pode ainda não estar aplicada no banco de produção — é uma
  pendência de infraestrutura já documentada em sessão anterior
  (`2026-09-06-comanda-persistir-valor-procedimento-design.md`), não faz parte
  desta entrega. Vale o usuário confirmar se já rodou.
- Sem alteração no cálculo de valor da Agenda (decisão consciente, ver
  "Abordagem escolhida").
- Sem mudança em comissão — `065` já cobre isso.

## Verificação

- `cd web && npx tsc --noEmit` / `cd mobile && npx tsc --noEmit` — zero erros
  novos (baseline mobile pré-existente).
- `cd web && npx vitest run` — suíte completa + testes novos de
  `agruparValoresPorAgendamento` com vínculo de pacote.
- Fluxo manual coberto por teste: atendimento sem pacote → vincula → item zera
  → fecha sem split manual → `pagamentos` recebe 1 linha cortesia R$0 →
  `agendamentos.comanda_id` preenchido → alerta de "não fechada" some.
- Visual: sem conta de teste para login local (mesma limitação de sessões
  anteriores).
