# Cartões configuráveis (maquininhas, bandeiras, taxas por parcela) + Comanda C (vendas avulsas no app)

**Data:** 2026-10-09 · **Branch:** `feat/cartoes-e-vendas-app` (a partir da main com #145 e #146).

## Decisões do dono (2026-10-09)

1. Cadastro de **maquininha e bandeira juntas**: cada maquininha tem suas taxas, que podem variar por bandeira.
2. Crédito parcelado com **uma taxa por número de parcelas**.
3. Taxas por bandeira = **tabela padrão da maquininha + exceções** (só a bandeira que cobra diferente tem tabela própria).
4. **Lista de bandeiras editável** (adicionar, renomear, desativar). Começa com Visa, Master, Elo, Amex, Hipercard.
5. Vendas avulsas no app com **a mesma regra de pagamento da comanda**; o PDV do web passa a usar essa regra.

## Parte 1 — Cartões

### Banco (migration 086, idempotente, termina com `notify pgrst, 'reload schema';`)

- `cartao_bandeiras (id uuid pk, empresa_id fk empresas on delete cascade, chave text not null, nome text not null, ativa bool default true, ordem int default 0, created_at)`;
  `unique (empresa_id, chave)`. `chave` das 5 iniciais = `visa`, `mastercard`, `elo`, `amex`, `hipercard`
  (as mesmas já gravadas em `pagamentos.bandeira`); bandeira nova ganha chave gerada do nome (minúsculas, sem acento,
  hífen; sufixo numérico se repetir), feita no cliente por `chaveBandeira(nome, existentes)` em shared.
- `cartao_maquininhas (id, empresa_id fk cascade, nome text not null, max_parcelas int not null default 12 check 1..18,
  ativa bool default true, padrao bool default false, ordem int default 0, created_at)`;
  índice único parcial `(empresa_id) where padrao and ativa` (uma padrão ativa por empresa).
- `cartao_taxas (id, empresa_id fk cascade, maquininha_id fk cartao_maquininhas on delete cascade,
  bandeira_id fk cartao_bandeiras on delete cascade null, modalidade text check in ('debito','credito'),
  parcelas int not null check 1..18, taxa numeric(6,4) not null check between 0 and 0.2)`;
  CHECK `modalidade = 'credito' or parcelas = 1`; índice único `(maquininha_id, coalesce(bandeira_id, '00000000-0000-0000-0000-000000000000'::uuid), modalidade, parcelas)`.
  `bandeira_id null` = tabela padrão da maquininha.
- `pagamentos.maquininha_id uuid null references cartao_maquininhas on delete set null`.
- RLS nas 3 tabelas: SELECT para membro (`empresa_id in (select minha_empresas())`); INSERT/UPDATE/DELETE com
  `tem_permissao(empresa_id, 'config.taxas')`.
- **Seed na própria migration**, para cada empresa sem maquininha: as 5 bandeiras + maquininha "Maquininha"
  (padrão, máx. 12) com tabela padrão a partir de `empresas.taxa_cartao_*` (084): débito; crédito 1x = à vista;
  2x a 12x = parcelado. Nada muda nos números.
- Trigger `AFTER INSERT ON empresas` (SECURITY DEFINER) faz o mesmo seed com os padrões da 084 para empresa nova.
- As colunas da 084 continuam existindo, mas deixam de ser editadas na tela (a área Cartões as substitui); o seed
  é o único uso delas.
- Rollback no cabeçalho.

### Regras puras (`shared/taxas-cartao.ts`, reescrito; mantém `fmtTaxa`, `valorLiquido`, `taxaParaCampo`,
`mascararPercentual`, `campoParaTaxa`)

```ts
type BandeiraCartao = { id: string; chave: string; nome: string; ativa: boolean; ordem: number };
type TaxaLinha = { bandeiraId: string | null; modalidade: 'debito' | 'credito'; parcelas: number; taxa: number };
type Maquininha = { id: string; nome: string; maxParcelas: number; ativa: boolean; padrao: boolean; ordem: number; taxas: TaxaLinha[] };
type ConfigCartoes = { maquininhas: Maquininha[]; bandeiras: BandeiraCartao[]; legado: boolean };
```

- `configLegada(empresa)`: antes da 086 (tabelas ausentes) devolve uma maquininha virtual (`id: 'legado'`) montada de
  `taxasDaEmpresa` + as 5 bandeiras fixas, `legado: true`. Tela de Cartões mostra "Disponível após a atualização do
  sistema" e não edita.
- `taxaDoCartao(config, { maquininhaId, bandeiraChave, metodo, parcelas })`: só `debito`/`credito`; procura a linha
  da bandeira (exceção), senão a da tabela padrão; sem linha → `null` (tela avisa "Taxa não cadastrada para esta
  combinação" e o pagamento grava sem taxa — `taxa_perc` e `valor_liquido` null — nunca inventa).
- `maquininhaPadrao(config)`, `maquininhasAtivas`, `bandeirasAtivas`, `parcelasDisponiveis(maquininha)` (1..max).
- `validarTabela(maquininha)`: a tabela padrão precisa ter débito e crédito de 1x até `maxParcelas`, todas entre
  0 e 20%; exceção pode ser parcial (o que faltar cai na padrão).
- `chaveBandeira(nome, chavesExistentes)`.
- `calcTaxa`, `TaxasCartao`, `taxasDaEmpresa`, `TAXAS_PADRAO`, `OPCOES_PARCELAS` saem do uso das telas (ficam só para
  `configLegada`; `OPCOES_PARCELAS` é removido).

Consulta única `carregarConfigCartoes(db, empresaId): Promise<ConfigCartoes>` em `shared/taxas-cartao-consultas.ts`
(tabela ausente → `configLegada` com a linha da empresa).

### Pagamentos (`shared/comanda-fechamento.ts`)

- `SplitPagamento` ganha `maquininhaId?: string | null` e `maquininhaGravada?: string | null`,
  `bandeiraGravada?: string | null`.
- `montarPagamentos(splits, { empresaId, comandaId?, vendaId?, config, total })` — `config: ConfigCartoes` substitui
  `taxas`; grava `maquininha_id` (null se `legado` ou não cartão); `comanda_id` ou `venda_id`.
- `taxaDoSplit`: split reaberto mantém `taxaGravada` só se método, parcelas, maquininha e bandeira não mudaram.

### Telas (web e app)

**Configurações → Cartões** (substitui o bloco "Taxas da maquininha"; edição com `config.taxas`, leitura para todos):
- Lista de maquininhas: nome, "Padrão", máx. de parcelas, ações Editar / Remover (desativar) / Tornar padrão;
  botão "Adicionar maquininha" (nasce com a tabela da padrão copiada). Não deixa remover a última ativa nem a padrão
  sem escolher outra.
- Editar maquininha: nome, máx. de parcelas, **tabela padrão** (débito + crédito 1x..máx, campos de %),
  **exceções por bandeira** ("Adicionar exceção" → escolhe bandeira → tabela pré-preenchida com a padrão; remover
  exceção). Salvar valida com `validarTabela` e grava por diferença (insert/update/delete das linhas, `.select('id')`
  + contagem).
- Bandeiras: lista com renomear, desativar/ativar e "Adicionar bandeira".

**Cobrança no cartão** (comanda web/app, vendas web/app): seletor de maquininha (só aparece com 2+ ativas; inicia na
padrão), bandeira (ativas), parcelas (`parcelasDisponiveis`), taxa e líquido exibidos; aviso quando a taxa não está
cadastrada. Recibo e tela de sucesso mostram a bandeira pelo nome cadastrado (`nome` da bandeira; chave desconhecida
→ a própria chave).

## Parte 2 — Comanda C (vendas avulsas)

- Regra única `shared/venda.ts`: carrinho de produtos de venda (`produtos.tipo = 'venda'`, ativos) com limite de
  estoque (`quantidade <= estoque_atual`, produto sem estoque não entra), desconto em % ou R$ (`calcularDesconto`),
  resumo com `resumoComanda` (sem reserva), pagamentos com `montarPagamentos({ vendaId })`.
- Gravação (web e app, mesma ordem e conferência): `vendas` (cliente opcional, `valor_total`, `desconto`) →
  `venda_itens` → `estoque_movimentos` (saída; falha avisa e segue, como na comanda) → `pagamentos` (`venda_id`).
  Erro em `vendas`/`venda_itens`/`pagamentos` para e mostra a etapa (`mensagemErroBanco`). Trava contra duplo toque.
- **Web (PDV)**: troca o desconto só em % e os métodos sem repetição pela regra única; cobrança com maquininha.
- **App**: nova tela `mobile/app/(empresa)/vendas.tsx` (item "Vendas" em "Mais", permissão `vendas.acessar`):
  aba Nova venda (busca de produto, carrinho, cliente opcional, desconto, pagamentos, tela de sucesso com recibo por
  WhatsApp quando houver cliente com telefone) e aba Histórico (vendas do dia selecionado, mesmo conteúdo do
  histórico do web). Invalida as chaves financeiras após a venda.
- Nada novo em `mobile/app/(profissional)`.

## Testes

- Migration 086 (texto): tabelas, checks, índices únicos, RLS com `config.taxas`, seed, trigger de empresa nova,
  `pagamentos.maquininha_id`, idempotência.
- `taxaDoCartao` (exceção, padrão, sem linha → null, pix → 0), `validarTabela`, `chaveBandeira`, `configLegada`,
  `montarPagamentos` com maquininha (nova, reaberta inalterada, reaberta com outra maquininha), `shared/venda.ts`.
- Varredura de paridade: telas usam `carregarConfigCartoes`/`taxaDoCartao`; nenhuma usa `calcTaxa`; app tem Vendas.
- `tsc` web zerado; mobile com os 6 erros pré-existentes.

## Fora de escopo

Rateio de desconto; cancelar/estornar venda; taxa em pix/dinheiro; antecipação de recebíveis; relatório por
maquininha (o dado `maquininha_id` passa a existir para isso).
