# Comanda B — recursos do web no app + comissão de serviço extra

**Data:** 2026-10-08 · **Fase:** Paridade Comanda/PDV, parte B (A = fechamento correto, PR #145, mergeado;
C = Vendas avulsas no app, fora deste escopo).

## Objetivo

A comanda do app (`mobile/app/(empresa)/nova-comanda.tsx`) passa a fazer tudo o que a do web
(`web/app/(app)/comanda/page.tsx`) faz. Serviço extra lançado com profissional passa a gerar comissão
nas duas plataformas. Abrir comanda fechada passa a abrir a comanda certa nas duas plataformas.

## Decisões do dono (2026-10-08)

1. Serviço extra com profissional **gera comissão** (percentual da profissional, igual ao atendimento).
2. Escolha de dia no app **igual ao web**: faixa da semana com setas, visão do mês, aviso de dias anteriores
   com comanda aberta.
3. Comissão gerada por **trigger no banco** (abordagem A), não pelas telas.

## 1. Comissão do serviço extra (migration 085, web + app)

`supabase/migrations/085_comissao_servico_extra.sql`, idempotente, termina com `notify pgrst, 'reload schema';`:

- `comissoes.comanda_item_id uuid references comanda_itens(id)` (nullable) + índice.
- `comissoes.agendamento_id` passa a aceitar null; CHECK `comissoes_origem` exige
  `agendamento_id is not null or comanda_item_id is not null`.
- `gerar_comissao_item()` SECURITY DEFINER, `AFTER INSERT ON comanda_itens`:
  se `tipo = 'servico'`, `profissional_id is not null`, `valor_unit * quantidade > 0` e o
  `empresa_membros.percentual_comissao` da profissional na empresa for > 0 → insere
  `comissoes (empresa_id, profissional_id, comanda_item_id, valor_servico = valor_unit*quantidade, percentual)`.
- `sincronizar_comissao_item()` SECURITY DEFINER, `AFTER UPDATE ON comanda_itens`:
  - valor/quantidade mudou → `valor_servico` atualizado em comissão **pendente ou paga** (mesma regra da 075
    para atendimento: se já foi repassada, ajusta o repasse);
  - profissional mudou → comissão pendente é apagada e gerada de novo para a nova profissional
    (percentual dela); se a comissão já está paga, `raise exception` 'Comissão deste serviço já foi paga'.
  - profissional removido (null) → apaga a pendente; paga → mesma exceção.
- `BEFORE DELETE ON comanda_itens`: apaga a comissão pendente do item; se houver paga →
  `raise exception` 'Comissão deste serviço já foi paga'.
- Sem backfill: extras antigos com profissional não ganham comissão (decisão de não reescrever histórico).
- Rollback no cabeçalho (drop triggers/funções, drop CHECK, `delete from comissoes where comanda_item_id is not null`,
  drop coluna, `set not null` em `agendamento_id`).

**Ordem de deploy livre:** sem a 085 os itens continuam gravando como hoje (sem comissão); o código não depende dela.

## 2. Edição de comanda fechada sem apagar itens (web + app)

Hoje `editarComanda` apaga e reinsere `comanda_itens`. Com comissão por item isso recriaria comissões
(e quebraria nas pagas). Passa a ser por diferença:

- Ao abrir, cada item extra carrega seu `id` do banco (`item_id`) e se tem comissão paga
  (`comissao_paga: boolean`, de `comissoes` por `comanda_item_id`, status `pago`).
- Ao salvar: itens com `item_id` que continuam → UPDATE (só `valor_unit`, `profissional_id`, com `.select('id')`
  e contagem); itens com `item_id` removidos → DELETE por id (conferido); itens sem `item_id` → INSERT.
- Função pura `diffItensComanda(originais, atuais)` em `shared/comanda-fechamento.ts` →
  `{ inserir, atualizar, apagar }` (testada).
- Na edição, serviço extra com comissão paga: profissional e remover travados, aviso "Comissão já paga".
  Valor continua editável (sincroniza, como no atendimento). Quantidade continua travada (decisão da A).
- Erro de banco com a mensagem do trigger aparece em português via `mensagemErroBanco`.

## 3. Abrir a comanda certa (web + app)

Hoje `abrirComandaFechada` pega a 1ª `comanda_id` dos atendimentos da cliente no dia.

- A lista do dia passa a mostrar **um cartão por comanda fechada** (agrupado por `comanda_id`) e um cartão
  para os atendimentos ainda abertos da cliente. Função pura `cartoesComandaDoDia(agendamentos, comandasSoExtras)`
  em `shared/comanda.ts` (testada).
- Comandas fechadas **só com extras** (sem atendimento) do dia também viram cartão e podem ser reabertas:
  consulta de `comandas` do dia (`fechada_at` dentro dos limites do dia em Brasília, `shared/periodos.ts`)
  sem nenhum agendamento vinculado. Resolve a limitação registrada na A.

## 4. App: o que entra (paridade com o web)

1. **Dias:** faixa da semana (domingo a sábado) com setas de dia, botão "Hoje", visão do mês com contagem de
   atendimentos por dia (toque abre o dia), aviso "N dia(s) com comanda aberta" que leva ao dia mais antigo.
   Mesma consulta de backlog do web (`comanda_id is null`, não cancelado/faltou, já terminou, até 500) — extraída
   para `shared/comanda-consultas.ts` e usada pelas duas telas.
2. **Editar comanda fechada:** mesmas travas do web (produtos/pacote só leitura, quantidade travada, pagamento
   reaberto mantém taxa e data via `taxaGravada`/`criadoEm`, desconto reabre em R$).
3. **Tirar atendimento da comanda:** lixeira também em item `agendamento` (só no fechamento novo); o agendamento
   continua aberto e volta para a lista.
4. **Profissional no serviço extra:** seletor (lista de membros ativos), opcional.
5. **Valor e quantidade:** campo de valor por item (`parseValorBR`; só leitura com pacote vinculado ou em
   produto/pacote na edição) e quantidade (+/−; travada na edição).
6. **Recibo por WhatsApp:** botão na tela de sucesso quando a cliente tem telefone; `Linking.openURL` com
   `https://wa.me/55<tel>?text=...`. Texto de `gerarTextoRecibo` movido para `shared/comanda-recibo.ts`
   (web e app usam o mesmo).

Permissões: as mesmas da A (`comanda.fechar`, `agenda.gerenciar_outras` via `podeMexerNoAgendamento`).
Nada novo na área `(profissional)` do app.

## 5. Comissões nas telas (web + app)

`COLUNAS_COMISSAO_DETALHE` ganha `comanda_item_id` e
`item:comanda_itens(descricao, comanda:comandas(fechada_at, cliente:clientes!comandas_clientes_id_fkey(nome)))`.
`normalizarComissao` (`shared/comissoes.ts`): sem agendamento → data = `fechada_at`, cliente da comanda,
serviço = `descricao + ' (extra)'`, valor = `valor_servico`. Telas e exportações (Comissões, Relatórios, Equipe,
área da profissional) já consomem a forma normalizada — nenhuma tela lê `agendamento` direto (conferir por varredura).
Antes da 085, a coluna não existe: a consulta detecta a ausência (mesmo padrão `temColunasCartao` da A) e usa
as colunas antigas.

## Testes

- `diffItensComanda`, `cartoesComandaDoDia`, `gerarTextoRecibo` (shared), `normalizarComissao` com comissão de extra.
- Texto da migration 085: colunas, CHECK, 3 triggers SECURITY DEFINER, exceção de paga, idempotência, rollback.
- Varredura de paridade: app usa `diffItensComanda`, `gerarTextoRecibo` de shared, consulta de backlog de shared;
  web não faz mais `delete().eq('comanda_id'` em `comanda_itens`.
- `tsc` web zerado; mobile com os 6 erros pré-existentes.

## Fora de escopo

- Vendas avulsas (PDV) no app — Comanda C.
- Fechamento atômico no banco (RPC).
- Estoque ao editar produtos de comanda fechada (produtos continuam só leitura).
- Backfill de comissão de extras antigos.
