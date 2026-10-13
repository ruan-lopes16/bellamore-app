# Paridade Estoque (web × app)

**Data:** 2026-10-13 · **Fase:** paridade total, bloco "Estoque" do inventário
(`docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md`). Branch `feat/paridade-estoque`.

## Decisões do dono (2026-10-13)

1. **Saída manual conferida no banco** (migration 088, função `movimentar_estoque`): nunca deixa o saldo negativo.
2. **Unidades:** catálogo o mais completo possível, e cada empresa escolhe quais aparecem no seletor.
   Só **pacote (pct)** e **caixa (cx)** perguntam "quantas unidades dentro" (kit não).
3. **Ajuste das unidades** dentro da tela de Estoque (web e app), para quem tem `estoque.acessar`.

## Situação hoje

- Produção: 92 produtos (83 material, 9 venda), categorias todas por chave do web (`cilios`, `sobrancelhas`,
  `outros`, `depilacao`), unidades `un`/`pct`/`cx`, 10 com `qtd_por_unidade > 1`, 1 com saldo negativo;
  151 movimentos (78 entradas, 73 saídas). Nada gravado pelo app.
- App: cadastro grava `tipo` sempre `material` (default), sem `preco_venda` nem `qtd_por_unidade`; categorias por
  rótulo de outra lista (`Cabelo`, `Maquiagem`…); unidades diferentes (`fr`, sem `pct`/`pç`); `parseBRLFloat`
  lê "0.5" como 5; movimentação mostra sucesso com erro (o `insert` não lança); sem aba Movimentações, sem
  filtros material/venda e categoria, sem os 4 cartões, sem exportação de movimentações.
- Web: mês das movimentações no fuso do navegador (`startOfMonth`); cargas sem conferir erro; filtro por produto
  compara **nome** (dois produtos homônimos se misturam); `parseFloat(x.replace(',', '.'))` lê "1.234,56" como
  1,234; saída conferida só contra o saldo da tela (duas saídas simultâneas → negativo); movimentos sem paginação.

## Solução

### 1. Migration 088 (`088_estoque_movimentar_e_unidades.sql`)

**a) `public.movimentar_estoque(p_produto uuid, p_tipo text, p_quantidade numeric, p_motivo text) returns numeric`**
- plpgsql, **security invoker**, uma transação.
- `p_tipo` ∈ {'entrada','saida'}; senão `raise 'Tipo de movimentação inválido.'`. `p_quantidade` > 0; senão
  `'Informe uma quantidade maior que zero.'`.
- Lê `empresa_id, nome, unidade, ativo` do produto; não achou → `'Produto não encontrado.'`.
- `tem_permissao(empresa, 'estoque.acessar')` senão `42501` "Você não tem permissão para movimentar o estoque.".
- `pg_advisory_xact_lock(hashtextextended('venda_estoque:' || p_produto::text, 0))` — **a mesma chave da 087**,
  então venda avulsa e movimentação manual do mesmo produto ficam em fila.
- Saída: relê `estoque_atual` depois da trava; `saldo < p_quantidade` →
  `'Estoque insuficiente: <nome> (restam <saldo> <unidade>)'` (saldo com `trim_scale`).
- `insert into estoque_movimentos (empresa_id, produto_id, tipo, quantidade, motivo)` (sem RETURNING); o trigger
  `atualizar_estoque` muda o saldo.
- Devolve o `estoque_atual` relido depois do insert (o saldo real).
- `revoke all … from public, anon`; `grant execute … to authenticated`.

**b) Tabela `public.estoque_unidades_empresa`**
- `empresa_id uuid primary key references empresas(id) on delete cascade`, `unidades text[] not null check
  (cardinality(unidades) between 1 and 50)`, `atualizado_em timestamptz not null default now()`.
- RLS: SELECT para membro (`empresa_id in (select minha_empresas())`); INSERT e UPDATE com
  `tem_permissao(empresa_id, 'estoque.acessar')`; sem DELETE.
- Sem linha = lista padrão (nada a semear).
- Idempotente (`create … if not exists`, `drop policy if exists`), cabeçalho com rollback,
  `notify pgrst, 'reload schema';`.

### 2. `shared/estoque.ts` (regras) e `shared/estoque-consultas.ts` (banco)

**Regras (puras):**
- `CATEGORIAS_PRODUTO`: lista ordenada `{ key, label }` derivada de `ROTULOS_CATEGORIA_PRODUTO` (as 9 do web).
  Cores continuam em cada plataforma.
- `UNIDADES_PRODUTO`: catálogo `{ key, label, grupo }` na ordem de exibição:
  contagem `un` Unidade, `pç` Peça, `par` Par, `kit` Kit; embalagem `pct` Pacote, `cx` Caixa, `fr` Frasco,
  `tb` Tubo, `pote` Pote, `amp` Ampola, `sachê` Sachê, `rolo` Rolo, `folha` Folha; volume `ml` Mililitro,
  `L` Litro; peso `mg` Miligrama, `g` Grama, `kg` Quilo; comprimento `cm` Centímetro, `m` Metro; outras `dose` Dose.
- `UNIDADES_PADRAO = ['un','pct','ml','g','kg','L','cx','pç','par','fr']`.
- `unidadePedeQtdPorUnidade(u)` = `u === 'pct' || u === 'cx'`.
- `unidadesParaSeletor(visiveis: string[] | null, atual?: string | null): string[]` — chaves do catálogo na ordem
  do catálogo que estão em `visiveis ?? UNIDADES_PADRAO`, mais `atual` (a do produto sendo editado) se não estiver,
  mesmo que fora do catálogo (dado legado nunca some).
- `rotuloUnidade(u)` (rótulo do catálogo ou a própria chave).
- `parseQuantidadeBR(texto)` — mesma leitura de `parseValorBR` (`shared/comanda-fechamento.ts`): "0,5", "0.5",
  "1.234,56"; vazio/inválido/negativo → 0.
- `montarProduto(form, ctx) → { payload } | { erro }`: `form` = textos da tela (`nome, tipo, categoria, unidade,
  qtdPorUnidade, estoqueAtual, estoqueMinimo, precoCusto, precoVenda`), `ctx = { empresaId, editando: boolean }`.
  Regras: nome obrigatório (trim); categoria obrigatória e do catálogo; unidade obrigatória; `qtd_por_unidade` só
  para pct/cx (≥ 1, inteiro arredondado; senão 1); `preco_venda` só para `venda` (senão 0) e obrigatório > 0 para
  venda; números pela `parseQuantidadeBR`/`parseValorBR`; `estoque_atual` vai no cadastro e na edição (o web já
  permite corrigir o saldo editando o produto — mantido nas duas plataformas). Mensagens em português.
- `resumoProdutos(produtos)` → `{ materiais, venda, alertas, valorTotal }` (valor = Σ saldo × custo, saldo
  negativo conta 0, centavos).
- `resumoMovimentos(movs)` → `{ entradas, saidas, total, qtdEntradas, qtdSaidas }`.
- `margemVenda(custo, venda)` → % inteiro ou null.

**Consultas (lançam erro, nunca lista vazia em silêncio):**
- `carregarProdutosEstoque(db, empresaId)` — ativos, ordem categoria/nome/id, paginado (`buscarTodasOuLancar`).
- `carregarMovimentosMes(db, empresaId, mesChave)` — `limitesMes(mesChave)` (Brasília), paginado, com
  `produto_id` e `produto:produtos(nome, unidade)`, ordem `created_at desc, id`.
- `movimentarEstoque(db, { empresaId, produto, tipo, quantidade, motivo })` → `{ novoSaldo }`: chama a função;
  `PGRST202` → caminho antigo (checa saldo da tela para saída e faz o insert conferindo erro; devolve saldo da
  tela ± qtd); outro erro → `Error(mensagemErroBanco(…,'movimentar o estoque'))`; erro sem `code` (rede caiu) →
  "Sem resposta do servidor: a movimentação pode ter sido registrada. Confira em Movimentações antes de repetir."
- `carregarUnidadesVisiveis(db, empresaId)` → `string[] | null` (null = sem linha ou tabela inexistente
  `PGRST205`/`42P01`, e então `disponivel: false` para esconder o botão de ajuste); `salvarUnidadesVisiveis(db,
  empresaId, unidades)` (upsert, `.select('empresa_id')`, 0 linhas → erro de permissão).

### 3. Web — `web/app/(app)/estoque/page.tsx`
- Constantes `CATS`/`UNIDADES` passam a vir de shared (cores ficam locais por chave).
- Carga de produtos e movimentos pelas consultas de shared, com erro em banner e contador de requisição no mês.
- Mês das movimentações em Brasília (`chaveMesBRT`/`somarMeses`/`limitesMes`).
- Filtro e KPIs por produto pelo `produto_id`.
- `ProdutoModal` pela `montarProduto`; seletor de unidade pelo `unidadesParaSeletor`; pergunta de qtd por
  unidade só para pct/cx.
- `MovModal` pela `movimentarEstoque`; o card mostra `novoSaldo` devolvido.
- Botão "Unidades" (com `estoque.acessar`; escondido se a tabela não existir): modal com chips por grupo do
  catálogo, liga/desliga, pelo menos 1 ligada, "Restaurar padrão", Salvar.
- Cartões de resumo pelo `resumoProdutos`; KPIs do mês pelo `resumoMovimentos`.

### 4. App
- `mobile/hooks/useEstoque.ts`: produtos e unidades por `carregarProdutosEstoque`/`carregarUnidadesVisiveis`;
  movimentos do mês (`carregarMovimentosMes`, chave `['estoque-movimentos', empresaId, mes]`, só com a aba
  aberta); `movimentar` pela `movimentarEstoque` (lança erro de verdade); invalida `['estoque']` e
  `['estoque-movimentos']`.
- `novo-produto.tsx` e `editar-produto/[id].tsx`: mesmos campos do web (tipo Material/Venda, nome, categoria por
  chave, unidade do seletor, qtd por unidade em pct/cx, estoque atual (cadastro e edição, igual ao web), mínimo, custo, preço de
  venda e margem quando venda) pela `montarProduto`.
- `estoque.tsx`:
  - 4 cartões (Materiais / Insumos, Para venda (PDV), Precisam de reposição, Valor total em estoque);
  - abas Produtos | Movimentações;
  - Produtos: busca, filtros Todos/Materiais/Venda, Todos/Alertas e categoria (só as que têm produto);
    modal de movimentação com erro real e saldo novo; "Histórico" do produto abre Movimentações filtrado;
  - Movimentações: mês navegável (Brasília), filtros por tipo e por produto, 3 cartões do mês, lista,
    exportação pela `definicaoEstoqueMovimentacoes`;
  - botão "Unidades" com a mesma regra do web.
- Comanda e Vendas do app invalidam `['estoque']` depois de gravar (o saldo dos cards não fica velho).

## Fora do escopo
- Movimento do tipo "ajuste" (nenhuma tela usa; o trigger aceita).
- Trava na baixa automática da comanda (a comanda não bloqueia sem estoque — decisão de 29/09).
- Categorias de produto personalizadas.

## Testes
- SQL da 088 lido como texto (assinatura, security invoker, `tem_permissao`, chave de trava igual à 087, checagem
  de saldo, sem RETURNING, RLS da tabela, grant/revoke, notify).
- `shared/estoque.ts`: catálogo, padrão, `unidadesParaSeletor`, `parseQuantidadeBR`, `montarProduto` (todos os
  erros, venda×material, pct/cx), resumos e margem.
- `shared/estoque-consultas.ts` com `fakeDb`: paginação e erro, limites do mês em Brasília, rpc ok/erro/`PGRST202`
  /sem `code`, unidades (sem linha, tabela inexistente, upsert com 0 linhas).
- Varredura das telas (texto): web e app usam as funções de shared; sem `parseFloat`/`parseBRLFloat` no estoque;
  sem `startOfMonth` no estoque do web; app sem a lista antiga de categorias.

## Produção
Rodar `088_estoque_movimentar_e_unidades.sql` no SQL Editor
(https://supabase.com/dashboard/project/qpiepxolyqmoankeyeva/sql/new). Ordem livre: sem a 088, a movimentação usa o
caminho antigo e o botão "Unidades" fica escondido (lista padrão).
