# Paridade Serviços e Pacotes (web × app) — design

**Data:** 2026-10-23 · **Branch:** `feat/paridade-servicos-pacotes` (um PR) · **Migration:** 096.

**Fontes:**
- inventário `docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md` (§ Serviços/Pacotes);
- conferência no código em 23/10 (main `9610385`).

## Decisões do dono (2026-10-23)

1. **Venda de pacote fora da Comanda** (Pacotes, Agenda): quem vende escolhe **"Cobrar agora"** ou **"Cobrar na comanda"**.
2. **Tudo entra no faturamento e conversa entre si.** Uma regra única de venda de pacote vale para todas as telas e evita erro de faturamento ou de desconto.

## Problemas atuais (motivo da fase)

- **Venda pelo catálogo (web):** grava `pacote_clientes` mas **não grava `vendas`**. A receita some do faturamento.
- **Venda pela Agenda (web e app):** grava direto, fora da função da 090. Não aplica desconto, e a venda pode falhar depois do pacote já criado.
- **Excluir serviço no web:** se o serviço nunca foi atendido, o CASCADE em `pacote_servicos` o remove de pacotes **já vendidos**.
- **Excluir pacote vendido:** qualquer membro pode, e a `vendas` correspondente fica órfã no faturamento.
- **App:**
  - não tem insumos, duração livre, pacote Combo, sessões ilimitadas, validade livre/sem validade, venda pelo catálogo nem aba Relatório;
  - editar um pacote "sem validade" grava 90 dias.
- **Validade:** a regra é diferente em 3 lugares. O último dia vale na Comanda e não vale nas Agendas.

## Regras

### Validade e saldo (`shared/pacotes.ts`)

| Função | Regra |
|---|---|
| `pacoteValidoEm(dataValidade, hojeChave)` | `null` = sem validade = sempre válido. O **último dia vale**. Comparação em Brasília |
| `dataValidade(validadeDias, inicioChave)` | `null` quando `validadeDias` é null |
| `saldoSessoes(pacoteCliente, usos)` | Saldo por serviço. Ilimitado = ∞. Combo = utilizado ou não |
| `statusPacoteCliente(...)` | `ativo`, `concluido` ou `expirado` |
| `rotuloValidade(pacote)` | "Válido por N dias" ou "Sem validade" |
| `totalSessoes(pacote)` | Ilimitado não soma |

Agenda, Comanda e Pacotes, nas duas plataformas, usam só essas funções. Saem as cópias inline.

### Venda de pacote: função única no banco (`vender_pacote`, 096)

`vender_pacote(p jsonb)`, `security invoker`, com chave `venda_id` contra repetição (padrão da 090):
- **Entrada:** `empresa`, `cliente`, `pacote`, `quantidade` (1+), `valor_unit`, `desconto` (R$), `cobranca` (`'agora' | 'comanda'`) e `pagamentos[]` (o mesmo formato da venda avulsa v2: método, valor, maquininha, bandeira, parcelas, taxa). Os pagamentos são obrigatórios em "agora".
- **Permissões:**
  - exige `pacotes.vender`;
  - desconto > 0 exige `comanda.desconto`;
  - cliente, pacote e maquininha precisam ser da empresa.
- **"agora":**
  - grava `vendas` (valor_total, desconto, `observacao 'Pacote'`) e `pagamentos` com a mesma regra da venda avulsa: total coberto, troco permitido;
  - grava 1 `pacote_clientes` por unidade, com `valor_pago` líquido rateado em centavos e `venda_id` apontando para a venda;
  - `cobranca = 'paga'`.
- **"comanda":**
  - grava `pacote_clientes` com `cobranca = 'pendente'`, `valor_pago` = o valor combinado e `venda_id` nulo;
  - nada entra no faturamento ainda.
- **Validade:** pela regra única. Sem validade = null.

### Pacote "a cobrar" na Comanda

- Ao abrir a comanda de uma cliente com `pacote_clientes.cobranca = 'pendente'`, a tela adiciona o item **"Pacote X — a cobrar"** (tipo `pacote`, `pacote_cliente_id` do existente, valor combinado). As duas plataformas usam a mesma função de shared.
- `fechar_comanda` (recriada na 096 a partir do corpo atual da 093, com a mesma assinatura) aceita item `pacote` com `pacote_cliente_id`:
  - **não cria** outro `pacote_clientes`;
  - marca o existente como `cobranca = 'paga'`, com `valor_pago` = valor líquido do rateio e `venda_id` = a venda dos pacotes da comanda;
  - inclui o valor na venda de pacotes da comanda. O rateio do desconto da comanda vale para ele como para qualquer item.
- A pessoa pode **tirar** o item "a cobrar" da comanda. Nesse caso o pacote continua pendente para a próxima.
- A cliente pode usar sessões de um pacote pendente. Pacotes e o perfil da cliente mostram o selo **"A cobrar"**.

### Pacotes e vendas

- **Coluna nova:** `pacote_clientes.venda_id` (FK para `vendas`, `on delete set null`).
- **Pacotes antigos:** a migration preenche `cobranca` com `'paga'` em tudo o que já existe.
- A Comanda, pela 090/096, passa a ligar `venda_id`.

### Excluir pacote vendido (`excluir_pacote_cliente`, 096)

- Exige `pacotes.vender` (ou ser gestora/dona) e que o pacote **não tenha nenhuma sessão usada**.
- Na mesma transação:
  - apaga o `pacote_clientes`;
  - se a venda ligada vendeu só esse pacote, apaga a venda e os pagamentos dela;
  - se a venda tem outros pacotes, reduz `valor_total` pelo valor desse pacote.
- Desvincula os agendamentos ligados.
- Sem pacote_uso, a exclusão é limpa. Com sessão usada, a mensagem é "Este pacote já tem sessões usadas. Para cancelar, fale com a dona."
- A policy de DELETE de `pacote_clientes` deixa de valer para qualquer membro. O delete direto só fica com `is_gestor_ou_owner`; as telas usam a função.

### Serviços

- **Excluir:** só é permitido se o serviço **nunca foi usado** (nenhum atendimento, `agendamento_servicos`, item de comanda, pacote ou `pacote_uso`). Senão, a mensagem é "Este serviço já foi usado. Desative em vez de excluir." e o botão Desativar fica disponível.
  - Função `excluir_servico` na 096 confere tudo isso e apaga numa transação.
  - O CASCADE de `pacote_servicos` deixa de ser alcançável por esse caminho.
- **Duração:** botões, mais "Personalizada" em horas e minutos, nas duas plataformas (`shared/servicos.ts`: `DURACOES_PADRAO`, `duracaoValida`).
- **Insumos (`servico_produtos`):** o app ganha o mesmo editor do web (produto, quantidade, unidade).
- **Validação única do cadastro** (`shared/servicos.ts`: `validarServico`): nome ≥ 2 caracteres, preço > 0, duração 5–600 min.
- Ao criar um serviço pelo "+" de um grupo, a categoria do grupo vem preenchida (web; o app ganha o mesmo).

### Pacotes (cadastro)

- As duas plataformas oferecem:
  - tipo "Com sessões" ou "Combo";
  - serviços, cada um com quantidade ou ∞ (ilimitado);
  - preço;
  - validade em dias livres, ou "Sem validade".
- Editar um pacote sem validade **mantém sem validade**. O default da coluna continua no banco, mas a tela sempre envia o valor explícito.
- A composição dos serviços é sincronizada por diferença (remove o que saiu e faz upsert do resto), com erro conferido, nas duas plataformas.
- Se a contagem de "já vendido" der erro, a composição fica bloqueada até recarregar. Nunca é tratado como "não vendido".

### Tela de Pacotes (web e app)

- **Abas:** Catálogo, Vendidos (filtros Todos, Ativos, Concluídos, Expirados, **A cobrar**) e **Relatório** (de utilização).
- **Vender pelo catálogo** nas duas plataformas, com o modal único:
  - cliente, quantidade, valor, desconto %/R$;
  - "Cobrar agora" (com o bloco de pagamento da Venda avulsa) ou "Cobrar na comanda".
- **Gerenciar sessões:** mesma regra e mesmos textos nas duas plataformas. Excluir uma sessão pede confirmação também no web.
- **Excluir venda:** pela função, com confirmação.
- **Permissões:**
  - gerenciar sessões exige `pacotes.vender` (ou sessão da própria agenda / `agenda.gerenciar_outras`, igual à RLS da 093);
  - vender exige `pacotes.vender`;
  - cadastrar exige `pacotes.gerenciar`.

### Agenda (web e app)

O "vender pacote" da Agenda passa a usar o mesmo modal e a mesma função. O padrão é "Cobrar na comanda", porque o atendimento ainda vai acontecer; a pessoa pode trocar para "Cobrar agora".

## Consultas e erros

- Todas as consultas paginadas (`@shared/paginacao`) e com erro conferido.
- Erro de carga mostra "—" e um aviso.
- Gravações por função, ou com `.select('id')`.
- `shared/pacotes-consultas.ts` centraliza a carga do catálogo, dos vendidos (com usos), dos candidatos a vínculo e do relatório.

## Faturamento

- A venda "agora" entra pela `vendas.valor_final` no dia da venda.
- O pacote "a cobrar" entra pela venda da comanda no `fechada_at`.
- Não há nenhum caminho que crie `pacote_clientes` cobrado sem a venda correspondente. Um teste encadeado em PGlite trava isso.
- O relatório de Pacotes soma `valor_pago` só dos pacotes com `cobranca = 'paga'` e confere com o Financeiro.

## Testes

- Unitários de `shared/pacotes.ts` e `shared/servicos.ts`: validade no último dia, sem validade, ilimitado, combo, duração e validação.
- 096 em PGlite (em cima da cadeia 090–095):
  - vender agora: venda, pagamentos e pacote batem, e a repetição não duplica;
  - cobrar na comanda e depois fechar a comanda: uma venda, pacote pago e desconto rateado;
  - tirar o item "a cobrar" mantém o pacote pendente;
  - excluir pacote sem uso apaga a venda; com uso, a exclusão é recusada;
  - excluir serviço usado é recusado;
  - permissões e empresa conferidas.
- Varredura cruzada:
  - as telas usam as funções de shared e as RPCs;
  - nenhum INSERT direto em `pacote_clientes` nas telas, exceto o caminho antigo sem a 096;
  - não sobra `validade_dias ?? 90`, `isPast(parseISO(validade))` nem `new Date(validade) >= hoje`.
- Fechamento: vitest 100%, `tsc` web 0, `tsc` mobile 8 e `next build`.

## Deploy

As telas detectam a 096 (`PGRST202`) e, sem ela, usam o caminho atual. **Rode a 096 junto com o deploy** (revisão das Tasks 1–2): a 096 trava a gravação direta em `pacote_clientes` (nenhum pacote cobrado sem venda), então a tela antiga deixa de vender pacote assim que ela roda — com mensagem, sem gravar nada.

## Fora do escopo

- Pacote compartilhado entre clientes.
- Reembolso parcial de pacote com sessões usadas (fica com a dona, por suporte).
