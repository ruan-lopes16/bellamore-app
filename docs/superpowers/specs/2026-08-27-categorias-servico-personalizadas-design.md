# Categorias de serviço personalizadas

## Contexto

Hoje as categorias de serviço são um enum fechado de 8 valores
(`cilios`, `sobrancelhas`, `depilacao`, `unhas`, `pele`, `dermaplaning`,
`maquiagem`, `outros`), definido em `shared/categorias.ts` (tipo
`CategoriaServico` + `CATEGORIA_COR` / `CATEGORIA_BG` / `CATEGORIA_LABEL` /
`CATEGORIA_SVG`). A coluna `servicos.categoria` no banco **já é `text`
livre, sem CHECK nem enum** (migration `001_initial_schema.sql`) — a trava
é 100% no front.

Pedido do usuário: no formulário de "Novo serviço", poder cadastrar uma
categoria nova, sem ficar preso às 8 fixas.

### Estado atual do código (para quem for implementar)

O tratamento de categoria está espalhado e já tem duplicação/deriva:

- `shared/categorias.ts` — fonte canônica (tipo + mapas + SVG data-driven).
- `web/components/CategoriaIcon.tsx` — reexporta do shared, monta os ícones.
- `web/app/(app)/servicos/page.tsx` — tem a **sua própria** cópia local
  `CATEGORIAS` (array com key/label/icon/cor/bg) e `CategoriaKey`, não
  importa do shared. Agrupa serviços iterando as 8 fixas e
  `.filter(g => g.items.length > 0)` — um serviço com categoria fora das 8
  **não cai em nenhum grupo e some da tela**.
- `web/app/(app)/agenda/page.tsx` — usa `CATEGORIA_COR/BG/LABEL` do shared
  com acesso direto (`CATEGORIA_COR[c]` → `undefined` para chave
  desconhecida); chips de filtro montados a partir das categorias presentes.
- `web/app/(app)/comissoes/ComissoesGestorView.tsx` — já tem fallback
  (`CATEGORIA_COR[cat] ?? '#6B7280'`, `CategoriaIcon` cai em `IconOutros`).
- `mobile/components/CategoriaIcon.tsx` — reexporta do shared.
- `mobile/hooks/useAgenda.ts` — tem **cópias locais** de `CategoriaServico`
  e um `CATEGORIA_CONFIG` próprio, mais um `resolverCategoria(texto)` que
  **chuta** uma das 8 chaves por match de substring (`'lash'` → `cilios`
  etc.). `mobile/app/(empresa)/servicos.tsx` importa esse `resolverCategoria`
  e agrupa por `s.categoria ?? 'outros'`, exibindo o header sempre com o
  label de uma das 8 fixas.

Este design **não** faz a unificação geral desse tratamento (fora de
escopo). Faz o mínimo para categorias personalizadas funcionarem de forma
coerente, reaproveitando o shared onde já dá.

## Decisão aprovada

Tabela nova `categorias_servico`, uma linha por categoria personalizada,
por empresa. As 8 categorias fixas **continuam no código** (`shared/
categorias.ts`), com os ícones desenhados à mão e cores atuais intactos — a
tabela guarda só as personalizadas.

Uma categoria personalizada guarda **nome + cor + ícone**:
- **cor**: escolhida de uma paleta curada de 10 pares `cor`/`bg`.
- **ícone**: escolhido de um conjunto curado de 12 ícones lucide (nomes
  verificados em `lucide-react@1.17.0` e `lucide-react-native@0.363.0`;
  fallback `Tag` se o nome salvo não resolver).

Gestão:
- **Criar** — inline no formulário de Novo/Editar serviço (web + mobile):
  um chip "+ Nova" abre um mini-form (nome, grade de cores, grade de
  ícones); ao salvar, a categoria é criada e já fica selecionada.
- **Renomear / trocar cor ou ícone / excluir** — mini-gerenciador acessível
  por um botão discreto no header da tela Serviços (web + mobile). Sem tela
  nova no menu.

## 1. Banco — migration `063_categorias_servico.sql`

```sql
create table public.categorias_servico (
  id          uuid primary key default uuid_generate_v4(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  nome        text not null,
  cor         text not null,   -- hex, um dos valores da paleta curada
  icone       text not null,   -- nome do ícone lucide, um da lista curada
  created_at  timestamptz default now()
);

-- Nome único por empresa, case-insensitive
create unique index categorias_servico_empresa_nome_uniq
  on public.categorias_servico (empresa_id, lower(nome));

alter table public.categorias_servico enable row level security;

-- SELECT: qualquer membro da empresa
create policy "categorias_servico: membro ve"
  on public.categorias_servico for select
  using (empresa_id in (select minha_empresas()));

-- INSERT / UPDATE / DELETE: só gestor/owner (espelha despesas, via is_gestor_ou_owner)
create policy "categorias_servico: gestor insere"
  on public.categorias_servico for insert
  with check (is_gestor_ou_owner(empresa_id));
create policy "categorias_servico: gestor atualiza"
  on public.categorias_servico for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));
create policy "categorias_servico: gestor deleta"
  on public.categorias_servico for delete
  using (is_gestor_ou_owner(empresa_id));

-- Vínculo no serviço
alter table public.servicos
  add column categoria_id uuid references public.categorias_servico(id) on delete set null;

-- No máximo um dos dois preenchido (built-in via texto XOR personalizada via FK).
-- Ambos nulos é válido = serviço sem categoria (renderiza como Outros).
alter table public.servicos
  add constraint servicos_categoria_xor
  check (categoria is null or categoria_id is null);
```

- **`categoria_id` × `categoria`**: um serviço tem **ou** `categoria`
  (chave built-in, ex. `'cilios'`) **ou** `categoria_id` (FK para a
  personalizada) — nunca os dois. Ao salvar:
  - categoria built-in → `categoria = '<chave>'`, `categoria_id = null`;
  - categoria personalizada → `categoria = null`, `categoria_id = '<uuid>'`.
- **`on delete set null`**: apagar uma categoria personalizada zera o
  `categoria_id` dos serviços dela → passam a renderizar como *Outros*
  (categoria = null e categoria_id = null → fallback). O mini-gerenciador
  avisa "N serviço(s) usam esta categoria" antes de confirmar a exclusão.
- **Sem backfill.** Serviços existentes já usam `categoria` texto com as 8
  chaves; continuam funcionando sem tocar em nada.
- **RLS de escrita gate para gestor/owner** — mesma linha das `despesas`
  (migration 003). A tabela `servicos` no repositório só tem policy de
  SELECT no arquivo de migration (nenhuma de escrita); isso é um
  descompasso pré-existente, fora do escopo desta feature — anotado na
  seção "Achados fora de escopo".

## 2. Shared — `shared/categorias.ts`

Aditivo, sem alterar nada do que já existe (tipo `CategoriaServico`, mapas
built-in, `CATEGORIA_SVG`).

```ts
// Categoria personalizada, como vem do banco
export type CategoriaCustom = {
  id: string;
  empresa_id: string;
  nome: string;
  cor: string;
  icone: string;
};

// Paleta curada — 10 pares. cor = traço/texto forte; bg = fundo suave do chip.
export const CATEGORIA_PALETA: { cor: string; bg: string }[] = [
  { cor: '#4F46E5', bg: '#EEF2FF' }, // índigo
  { cor: '#7C3AED', bg: '#F3EFFE' }, // roxo
  { cor: '#D4608A', bg: '#FDF0F5' }, // rosa
  { cor: '#B45309', bg: '#FEF3E2' }, // âmbar
  { cor: '#0D7E5F', bg: '#EAFAF5' }, // verde
  { cor: '#0891B2', bg: '#ECFEFF' }, // ciano
  { cor: '#C026D3', bg: '#FDF4FF' }, // magenta
  { cor: '#DC2626', bg: '#FEF2F2' }, // vermelho
  { cor: '#2563EB', bg: '#EFF6FF' }, // azul
  { cor: '#6B7280', bg: '#F3F4F6' }, // cinza
];

// Ícones curados — nomes lucide presentes em lucide-react e lucide-react-native.
export const CATEGORIA_ICONES: string[] = [
  'Sparkles', 'Scissors', 'Heart', 'Star', 'Gem', 'Flower',
  'Wand', 'Droplet', 'Sun', 'Hand', 'Smile', 'Leaf',
];

// bg de fallback quando a cor salva não está na paleta (categoria antiga / editada no banco)
export function bgDaCor(cor: string): string {
  return CATEGORIA_PALETA.find(p => p.cor === cor)?.bg ?? '#F3F4F6';
}

export type CategoriaResolvida = {
  chave: string;                    // chave built-in OU id da custom OU 'outros'
  label: string;
  cor: string;
  bg: string;
  tipo: 'builtin' | 'custom' | 'nenhuma';
  iconeBuiltin?: CategoriaServico;  // p/ renderizar via CATEGORIA_SVG
  iconeCustom?: string;             // nome lucide
};

/**
 * Resolve a aparência da categoria de um serviço.
 * Prioridade: categoria_id (custom) → categoria (built-in) → 'outros'.
 */
export function resolverCategoriaServico(
  categoria: string | null | undefined,
  categoriaId: string | null | undefined,
  customs: CategoriaCustom[],
): CategoriaResolvida { /* ... */ }
```

O nome `resolverCategoriaServico` é diferente do `resolverCategoria(texto)`
que já existe em `mobile/hooks/useAgenda.ts` (aquele continua onde está,
sem mudança) — evita colisão e confusão.

Cada plataforma mapeia `iconeCustom` (nome lucide) → componente:
`import * as Lucide` no web, `import * as LucideRN` no mobile, e
`Lucide[nome]` / fallback para um ícone padrão. `iconeBuiltin` continua
sendo renderizado pelo `CategoriaIcon` existente (via `CATEGORIA_SVG`).

## 3. Carregamento das categorias personalizadas

Onde hoje se carrega `servicos`, passa a carregar também
`categorias_servico` da empresa (query paralela, dentro do `Promise.all`
existente — sem waterfall):

- **web**: `servicos/page.tsx`, `agenda/page.tsx`,
  `ComissoesGestorView.tsx`.
- **mobile**: `servicos.tsx` (via `useServicos`), `useAgenda.ts`,
  `novo-servico.tsx`, `editar-servico/[id].tsx`.

As queries de agendamento (web `agenda/page.tsx` linhas ~1584-1585; mobile
`useAgenda.ts`) e de comissões passam a trazer também
`servico:servicos(..., categoria_id)`.

## 4. UI — criar categoria (inline no form de serviço)

Web: `ServicoModal` em `web/app/(app)/servicos/page.tsx`.
Mobile: `novo-servico.tsx` e `editar-servico/[id].tsx`.

Na linha de chips de categoria, depois dos 8 fixos e dos chips das
personalizadas já existentes, um chip **"+ Nova"**. Ao tocar, expande um
mini-form inline:
- input **nome** (obrigatório, trim, checa duplicado case-insensitive
  contra built-ins e customs já carregadas antes de inserir);
- grade das **10 cores** (`CATEGORIA_PALETA`);
- grade dos **12 ícones** (`CATEGORIA_ICONES`).

"Salvar categoria" faz `insert` em `categorias_servico`, adiciona à lista
local e seleciona a nova categoria no formulário. Erro de RLS (papel sem
permissão) ou de unique index é mostrado inline, sem quebrar o fluxo de
cadastro do serviço. "Cancelar" fecha o mini-form sem criar nada.

## 5. UI — gerenciar categorias (mini-gerenciador)

Botão discreto no header da tela Serviços (web + mobile) — ícone de
etiqueta/ajuste ao lado do "Novo serviço". Abre um modal:

- lista as categorias personalizadas da empresa (nome + amostra de
  cor/ícone);
- cada uma: **editar** (nome / cor / ícone, mesma grade do mini-form) e
  **excluir**;
- excluir pede confirmação e mostra "N serviço(s) usam esta categoria"
  (contagem local sobre a lista de serviços já carregada) — ao confirmar,
  `delete` na linha; os serviços afetados caem para *Outros* via
  `on delete set null`.
- vazio: texto "Nenhuma categoria personalizada. Crie uma ao cadastrar um
  serviço." (as 8 fixas **não** aparecem aqui — não são editáveis).

## 6. Consumo / renderização

- **`servicos` (web + mobile)** — card e agrupamento passam por
  `resolverCategoriaServico`. O agrupamento monta a lista de grupos como
  `[...8 built-ins, ...customs carregadas]` e distribui cada serviço pela
  `chave` resolvida; grupo sem itens continua oculto. Serviço com
  `categoria_id` de categoria já apagada (→ `categoria_id` null,
  `categoria` null) entra no grupo *Outros*. **Corrige o bug atual** de
  serviço com categoria desconhecida sumir da tela.
- **`agenda` (web + mobile)** — chips de filtro e cores das barras/cards
  resolvem via a função; um serviço de categoria personalizada mostra o
  nome e a cor da categoria.
- **`comissões` (web)** — o donut/lista por categoria resolve via a função
  (a query já dá join com `servico`); sem isso, serviço de categoria
  personalizada apareceria como *Outros* cinza.

## 7. Tipos

- `web/types/index.ts` — `Servico` ganha `categoria_id?: string | null`;
  novo `CategoriaCustom` (ou reexport do shared).
- `mobile/types` — mesmo ajuste no `Servico`.
- `mobile/hooks/useAgenda.ts` — `AgendamentoCompleto.servico` ganha
  `categoria_id?: string | null`.

## Fora de escopo

- **Unificar** o tratamento de categoria (cópia local `CATEGORIAS` no
  `servicos/page.tsx` web, `CATEGORIA_CONFIG` + `resolverCategoria` locais
  no `mobile/hooks/useAgenda.ts`). Fica a duplicação atual; só se adiciona
  o caminho das personalizadas.
- Cor/ícone **livres** (color picker RGB, upload de ícone) — só as grades
  curadas.
- Categoria personalizada em **produtos** (`produtos.categoria`, usado em
  vendas/estoque) e em **despesas** (`despesas.categoria`, texto livre já) —
  são outros domínios, não fazem parte do pedido.
- Reordenar categorias / definir ordem de exibição — built-ins primeiro
  (ordem do `ALL_CATEGORIAS`), depois personalizadas por `nome`.
- Mudar a RLS de escrita de `servicos` — descompasso pré-existente,
  anotado abaixo.
- Migrar/normalizar serviços que hoje têm `categoria` texto fora das 8
  chaves (se existirem em produção) — continuam caindo em *Outros* como já
  caem hoje.

## Achados fora de escopo (a reportar ao usuário, não corrigir aqui)

- `public.servicos` tem RLS habilitada mas **só** policy de SELECT nos
  arquivos de migration — nenhuma de INSERT/UPDATE/DELETE. Ou o banco de
  produção tem policies aplicadas fora de migration (deriva de schema), ou
  escrita de serviço depende de algo não versionado. A feature nova segue o
  padrão seguro (`is_gestor_ou_owner`) e não depende de resolver isso.

## Verificação

- Teste unitário de `resolverCategoriaServico` (`shared/categorias.ts`):
  built-in conhecida; `categoria_id` presente com custom na lista;
  `categoria_id` presente mas custom **ausente** da lista (categoria
  apagada) → *Outros*; ambos nulos → *Outros*; `categoria` com string
  desconhecida e sem `categoria_id` → *Outros*.
- Teste de `bgDaCor`: cor da paleta → bg correspondente; cor fora da
  paleta → cinza.
- `npx tsc --noEmit` no web (zero erros) e no mobile (baseline de 10 erros
  pré-existentes, nenhum novo).
- Verificação visual no navegador local não é possível nesta sessão (sem
  conta de teste) — como registrado nas sessões anteriores.
