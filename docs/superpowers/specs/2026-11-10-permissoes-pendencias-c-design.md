# Permissões, banco e ajustes (B9, B11, B13, C7, C9–C12) — design

**Data:** 2026-11-10 · **Branch:** `feat/permissoes-pendencias-c` · **Migration:** 101.

**Fonte:** `docs/superpowers/notes/2026-11-03-backlog-pendencias.md`.

O B8 já estava resolvido pela 097: os badges usam `badgesDoMenu`, que respeita a permissão e mostra `null` quando dá erro. Por isso sai da fase.

Nesta fase o dono não tomou decisões novas ("qualquer coisa ajustamos depois"). As escolhas abaixo são o padrão mais conservador.

## B9 — resumo diário da gestora sem `agenda.ver_equipe`

Em `web/lib/push/cron-resumo.ts`, a visão do resumo passa a ser decidida assim:
- **Dona:** `empresa`.
- **Demais pessoas:** `empresa` se `pode('agenda.ver_equipe')`, senão `pessoal`. A permissão é resolvida pelo mesmo `resolverPermissao` que já existe ali.

O teste do cron cobre os casos: gestora sem a chave recebe só os próprios números; profissional com exceção ligada recebe os da empresa.

## B11 — "Excluir" pacote vendido para a gestora

O banco (100) aceita `pacotes.vender` **ou** `is_gestor_ou_owner`.

Em `shared/pacotes.ts`, nova função `podeExcluirPacoteVendido(podeVender: boolean, papel: 'owner' | 'gestor' | 'profissional' | null): boolean`, que segue a mesma regra. As telas de Pacotes (web e app) a usam para mostrar "Excluir". Vender continua só com `pacotes.vender`.

## B13 — conferências no banco (migration 101)

A migration é idempotente, tem cabeçalho (por quê, conferências, rollback) e termina com `notify pgrst`.

1. **`pacote_uso: registra` e `pacote_uso: altera`.** O `with check` de UPDATE passa a exigir o mesmo que o INSERT: o `pacote_cliente_id` é da mesma empresa (`exists pacote_clientes pc where pc.id = pacote_cliente_id and pc.empresa_id = pacote_uso.empresa_id`). Hoje um UPDATE pela API pode apontar o uso para um pacote de outra empresa.
2. **`pagamentos`.** Constraint `pagamentos_comanda_xor_venda check (not (comanda_id is not null and venda_id is not null))` criada como **`not valid`**: vale para linhas novas e não falha com dados antigos. Nenhuma função grava as duas colunas juntas (conferido em 090 e 096). A nota de deploy traz a consulta só de leitura que conta as linhas antigas com as duas preenchidas e o `validate constraint` opcional.
3. **Cartões entre empresas.** Trigger `before insert or update` (função `fn_cartao_mesma_empresa`, security invoker, `search_path = public`) em:
   - `cartao_taxas`: `maquininha_id` e `bandeira_id` (se houver) da mesma `empresa_id`;
   - `pagamentos`: `maquininha_id` (se houver) da mesma `empresa_id`.

   Recusa com "Maquininha ou bandeira de outra empresa." (P0001). Fica como trigger e não como FK composta para não mexer nas FKs existentes.

**Testes em PGlite** sobre a cadeia 090→100: UPDATE do `pacote_uso` para pacote de outra empresa é recusado; o INSERT de pagamento com as duas colunas é recusado; taxa e pagamento com maquininha de outra empresa são recusados; os caminhos normais (`fechar_comanda`, `registrar_venda_avulsa_v2`, `vender_pacote`) continuam passando.

## C7 — "Retornos" com data futura

`filtrarClientes` (`shared/clientes-segmentos.ts`): uma cliente só entra em "Retornos" quando `0 <= dias <= DIAS_RETORNO`. A mesma proteção (`dias >= 0`) vale em `segmentosDaCliente` para "recorrente", "em risco" e "sumida": um atendimento futuro nunca é "última visita".

## C9 — pacote misto exibido como ilimitado

Em `shared/pacotes.ts`, nova função `resumoSaldoPacote(servicos: { servico_id; quantidade: number | null }[], usadas: number): { texto: string; ilimitado: boolean; restantes: number | null }`:
- **Tudo ilimitado:** "Ilimitado".
- **Tudo limitado:** "N de T restantes" (texto atual).
- **Misto:** "N de T restantes + ilimitado em K serviço(s)". As sessões dos serviços limitados são contadas normalmente.

Toda tela que hoje mostra "Ilimitado" para pacote vendido (Pacotes, seletores de pacote da Comanda e da Agenda, perfil da cliente; web e app) passa a usar `resumoSaldoPacote`. A regra de elegibilidade (`calcularPacotesAtivosCliente`) **não muda**: o misto continua sem esgotar.

## C10 — cartões

1. **Exceção que acompanha a padrão.** Ao salvar a tabela padrão de uma maquininha, cada linha de exceção (bandeira × método × parcelas) que **tinha o mesmo valor da padrão antiga** recebe o valor novo. Linhas que já eram diferentes ficam como estão. A regra fica numa função pura em `shared/taxas-cartao.ts` (`propagarPadraoParaExcecoes(padraoAntiga, padraoNova, excecoes)`) e é usada pela gravação nas duas Configurações. A tela avisa: "N exceções acompanharam a tabela padrão."
2. **Seletor de maquininha.**
   - Com uma só maquininha ativa, o seletor continua oculto, e o nome dela aparece como texto ("Maquininha: X").
   - Um pagamento reaberto que usa maquininha **inativa** mostra o nome dela como opção selecionada e marcada "(desativada)". Ela não aparece para pagamentos novos.
   - Vale nas 4 cobranças: comanda web/app, PDV web e Vendas app.

## C11 — painel de permissões

- Trocar de aba (Papéis × Pessoas, ou de pessoa) com rascunho não salvo pede confirmação: "Descartar as alterações não salvas?" (web: `confirm`; app: `Alert` com Descartar/Continuar editando).
- No app, a aba Pessoas sem ninguém escolhido mostra a dica "Escolha uma pessoa para ver e ajustar as permissões dela", igual ao web.

## C12 — paginação

- **Agenda web:** a lista de clientes do formulário passa a ser paginada (`buscarTodasPaginas` com `.order('id')`, ou `carregarBaseClientes` se servir).
- **Insumos do serviço (web e app):** a lista de produtos é paginada da mesma forma.
- **Histórico da Equipe (web e app):** a paginação passa de offset para cursor (`created_at desc, id desc`, com `lt` no par). Assim não pula nem repete itens quando chega evento novo. A função fica em `shared/equipe-consultas.ts` (ou onde o histórico já está).

## Testes

- Unitários para `podeExcluirPacoteVendido`, `resumoSaldoPacote`, `propagarPadraoParaExcecoes`, o filtro "Retornos" com data futura e o cursor do histórico.
- Cron B9 com dados falsos.
- 101 em PGlite.
- Teste cruzado: as duas plataformas usam as funções novas.

**Verificação:** vitest 100%, tsc do web 0, tsc do mobile só com o erro pré-existente, `next build` OK.

## Deploy

1. Rodar a 101. A ordem é livre: sem ela o código funciona, só não tem as travas novas.
2. Fazer as conferências.
3. Fazer o merge e recarregar o PWA.
