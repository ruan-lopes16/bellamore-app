# Paridade Clientes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a lista e o perfil de clientes ficam iguais no web e no app: mesmos segmentos, mesmos filtros e o mesmo histórico, tudo a partir de `shared/`.

**Architecture:**
- **Regras puras:** ficam em `shared/clientes-segmentos.ts`.
- **Consultas paginadas:** ficam em `shared/clientes-consultas.ts`.
- **Telas:** só montam a interface.
- **Migration 095:** só versiona `clientes.endereco`, que já existe em produção.

**Tech Stack:** Next.js (web), Expo/React Native + TanStack Query (app), TypeScript em `shared/`, Supabase, Vitest em `web/tests/unit`.

**Spec:** `docs/superpowers/specs/2026-10-22-paridade-clientes-design.md`. Leitura obrigatória em todas as tasks.

## Global Constraints

**Idioma e dependências**
- Português em tudo.
- O web nunca importa `mobile/`.

**Verificação**
- `cd web && npx vitest run`: tudo PASS.
- `cd web && npx tsc --noEmit`: 0 erros.
- `cd mobile && npx tsc --noEmit`: exatamente os 8 erros que já existem.

**Migrations e banco**
- Migrations são aplicadas à mão, são idempotentes, têm rollback e terminam com `notify pgrst, 'reload schema';`.
- Nunca execute nada contra o banco.

**Arquivos e commits**
- Preserve o CRLF.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nunca commite `.superpowers/`.

**Regras de negócio**
- Datas em Brasília (`shared/periodos.ts`).
- Segmentos:
  - **VIP:** gasto ≥ 2000 ou ≥ 8 atendimentos.
  - **Recorrente:** ≥ 5 atendimentos e ≤ 45 dias desde a última visita.
  - **Em risco:** mais de 45 e até 60 dias sem visita.
  - **Sumida:** mais de 60 dias sem visita.
  - **Nova:** cadastrada no mês corrente.
  - **Nunca atendida:** 30 dias ou mais desde o cadastro e 0 atendimentos.
  - **Retornos:** última visita há 30 dias ou menos.
- Arquivada fica fora dos segmentos.
- Atendimento = concluído (inclui sessão de pacote). Total gasto = valor cobrado + extras + vendas avulsas.

**Consultas e erros**
- Toda consulta é paginada (`@shared/paginacao`, desempate por id). Toda gravação usa `.select('id')` com as linhas conferidas.
- Erro de carga mostra "—" mais um aviso, nunca zero.

**Textos exatos**
- Filtros: "Todas", "Novas", "Aniversariantes", "Retornos", "VIP", "Recorrentes", "Em risco", "Sumidas", "Nunca atendidas", "Arquivadas".
- Botões: "Arquivar", "Reativar".
- KPIs: "Atendimentos", "Total gasto", "Última visita", "Serviço favorito".
- Busca: "Buscar por nome, telefone ou e-mail".

---

### Task 1: `shared/clientes-segmentos.ts`

**Files:**
- Create: `shared/clientes-segmentos.ts`
- Modify: `shared/dashboard.ts`, `shared/kpis-financeiros.ts`. Passam a usar as constantes, sem mudar o resultado.
- Test: `web/tests/unit/clientes-segmentos.test.ts`

**Interfaces (produz):**
```ts
export const VIP_GASTO = 2000, VIP_ATENDIMENTOS = 8, RECORRENTE_ATENDIMENTOS = 5,
  DIAS_EM_RISCO = 45, DIAS_SUMIDA = 60, DIAS_RETORNO = 30, DIAS_NUNCA_ATENDIDA = 30;
export type Segmento = 'vip' | 'recorrente' | 'em_risco' | 'sumida' | 'nova' | 'nunca_atendida';
export type FiltroClientes = 'todas' | 'novas' | 'aniversariantes' | 'retornos' | 'arquivadas' | Segmento;
export type ClienteBase = { id: string; nome: string; telefone: string | null; email: string | null; data_nascimento: string | null; ativo: boolean | null; created_at: string };
export type AtendimentoBase = { cliente_id: string | null; data_hora_inicio: string; valor: number | null; desconto_rateado?: number | null; pacote_cliente_id: string | null; servico_id: string | null; servico_nome?: string | null };
export type ExtraBase = { cliente_id: string | null; valor_unit: number; quantidade: number; desconto_rateado?: number | null; fechada_at: string };
export type VendaBase = { cliente_id: string | null; valor_final: number; created_at: string };
export type Agregado = { atendimentos: number; totalGasto: number; ultimaVisita: string | null; servicoFavorito: { id: string; nome: string | null } | null };
export function agregarClientes(atend: AtendimentoBase[], extras: ExtraBase[], vendas: VendaBase[]): Map<string, Agregado>;
export function segmentosDaCliente(c: ClienteBase, a: Agregado | undefined, hojeChave: string): Set<Segmento>;
export function contarSegmentos(clientes: ClienteBase[], ag: Map<string, Agregado>, hojeChave: string): Record<Segmento, number> & { total: number; novasMes: number };
export function filtrarClientes(clientes: ClienteBase[], ag: Map<string, Agregado>, filtro: FiltroClientes, busca: string, hojeChave: string): ClienteBase[];
export function aniversariantesDoMes(clientes: ClienteBase[], hojeChave: string): ClienteBase[];
export function servicoFavorito(atend: AtendimentoBase[]): { id: string; nome: string | null } | null;
export const ROTULO_FILTRO: Record<FiltroClientes, string>;
export const ROTULO_SEGMENTO: Record<Segmento, string>;
```

**Requisitos:**
- **Total gasto:** use `valorCobradoAtendimento` de `shared/kpis-financeiros.ts` para o valor do atendimento. A sessão de pacote conta como atendimento, mas não como gasto.
- **Busca:** compara nome sem acento e sem diferenciar maiúsculas, telefone só pelos dígitos, e e-mail.
- **"Todas":** mostra só as ativas. "Arquivadas" mostra só as arquivadas.
- **Ordem da lista:** "Aniversariantes" ordena por dia; os outros filtros ordenam por nome.
- **Dashboard:** `DIAS_RECONQUISTA` e `clientesSumidas` passam a usar `DIAS_EM_RISCO` e `DIAS_SUMIDA`, e os testes deles continuam passando.

- [ ] Steps:
  1. Escreva os testes: todos os limites da spec, mais aniversário em 29/02, empate no favorito e busca.
  2. Confira que falham.
  3. Implemente.
  4. Rode a suíte e o tsc.
  5. Commit `feat(shared): segmentos e filtros unicos de clientes`.

---

### Task 2: Consultas, migration 095 e contatos

**Files:**
- Create: `shared/clientes-consultas.ts`, `supabase/migrations/095_clientes_endereco.sql`
- Modify: `shared/clientes.ts` (recebe `contatosCliente` e corrige o comentário do endereço), `shared/agenda.ts` (reexporta `contatosCliente` de `./clientes`)
- Test: `web/tests/unit/clientes-consultas.test.ts`, `web/tests/unit/clientes-095.test.ts`

**Interfaces (produz):**
```ts
export type BaseClientes = { clientes: ClienteBase[]; atendimentos: AtendimentoBase[]; extras: ExtraBase[]; vendas: VendaBase[] };
export async function carregarBaseClientes(db, empresaId: string): Promise<BaseClientes>;
export type ItemHistorico =
  | { tipo: 'atendimento'; id: string; data: string; servicos: string; profissional: string | null; valor: number; status: string; comandaId: string | null; pacote: boolean }
  | { tipo: 'extra'; id: string; data: string; descricao: string; valor: number; comandaId: string }
  | { tipo: 'venda'; id: string; data: string; itens: { nome: string; quantidade: number }[]; valor: number }
  | { tipo: 'taxa_reserva' | 'taxa_cancelamento'; id: string; data: string; valor: number; status: string; metodo: string | null };
export async function carregarHistoricoCliente(db, empresaId: string, clienteId: string): Promise<{ itens: ItemHistorico[]; agregado: Agregado }>;
export async function arquivarCliente(db, empresaId: string, id: string): Promise<void>;
export async function reativarCliente(db, empresaId: string, id: string): Promise<void>;
```

**Requisitos:**
- **Paginação:** tudo paginado e com o erro conferido. Leia os perfis atuais (web `clientes/[id]/page.tsx` e app `hooks/useClientes.ts` `useClienteDetalhe`) para ver as consultas e os embeds que funcionam hoje: serviços, profissional, comanda, itens da venda, taxas.
- **Ordem do histórico:** por data, da mais recente para a mais antiga.
- **Agregado:** vem de `agregarClientes` da Task 1, aplicado só a esta cliente.
- **Arquivar e reativar:**
  - fazem `update({ ativo })` com `.eq('empresa_id')` e `.select('id')`;
  - 0 linhas viram o erro "Você não tem permissão para arquivar ou reativar esta cliente.";
  - os demais erros passam por `mensagemErroBanco`.
- **Migration 095:**
  - `alter table public.clientes add column if not exists endereco text;`;
  - cabeçalho explicando que a coluna já existe em produção sem migration;
  - rollback como comentário: não remover, porque é dado;
  - termina com `notify`.
- **`contatosCliente`:** vai para `shared/clientes.ts` e mantém o reexport em `shared/agenda.ts`. O link `tel:` usa só os dígitos.

- [ ] Steps:
  1. Escreva os testes: paginação acima de 1000, erro, ordem do histórico, texto da migration, 0 linhas no arquivar.
  2. Implemente.
  3. Rode a suíte e o tsc.
  4. Commit `feat(clientes): consultas unicas, endereco versionado (095) e contatos em shared`.

---

### Task 3: Web, lista de clientes

**Files:**
- Modify: `web/app/(app)/clientes/page.tsx`. Extraia componentes para `web/app/(app)/clientes/` se ajudar.
- Test: `web/tests/unit/clientes-web-lista.test.ts`

**Interfaces (consome):** da Task 1, `contarSegmentos`, `filtrarClientes`, `segmentosDaCliente`, `ROTULO_*`; da Task 2, `carregarBaseClientes`.

**Requisitos:** os da spec, seção "Lista".
- Cartões clicáveis: Total, Novas no mês, VIP, Em risco, Sumidas e Nunca atendidas.
- Filtros com os textos exatos.
- Cada linha mostra as tags de segmento, o total gasto (com `Secret` onde o web já esconde valores) e a última visita.
- Placeholder da busca: "Buscar por nome, telefone ou e-mail".
- A aba "Segmentos" e o `.limit(5000)` saem.
- O modal de cadastro ganha os campos de endereço, iguais aos da edição do perfil.
- O erro de carga aparece num aviso.
- Permissão de ver clientes: mantenha as chaves atuais (`clientes.ver_todas` etc.).

- [ ] Steps:
  1. Escreva o teste.
  2. Implemente.
  3. Rode a suíte e o tsc.
  4. Commit `feat(clientes/web): lista com segmentos unicos, cartoes clicaveis, tags, total gasto e arquivadas`.

---

### Task 4: App, lista de clientes

**Files:**
- Modify: `mobile/app/(empresa)/clientes.tsx`, `mobile/hooks/useClientes.ts`
- Test: `web/tests/unit/clientes-app-lista.test.ts`

**Interfaces (consome):** as mesmas da Task 3.

**Requisitos:** os mesmos da Task 3, com os mesmos textos.
- `useClientes` carrega a base uma vez, por `carregarBaseClientes`. A busca e os filtros rodam no cliente, então `busca` sai do `queryKey`.
- `useClientesStats` sai.
- O banner de aniversariantes passa a ser o filtro "Aniversariantes" do mês.
- Os cartões são `Pressable`.

- [ ] Steps:
  1. Escreva o teste.
  2. Implemente.
  3. Rode a suíte e os dois tsc.
  4. Commit `feat(clientes/app): lista com segmentos unicos, cartoes clicaveis, aniversariantes do mes e arquivadas`.

---

### Task 5: Web, perfil da cliente

**Files:**
- Modify: `web/app/(app)/clientes/[id]/page.tsx`. Extraia o histórico para um componente.
- Test: `web/tests/unit/clientes-web-perfil.test.ts`

**Interfaces (consome):** da Task 2, `carregarHistoricoCliente`, `arquivarCliente`, `reativarCliente` e `contatosCliente`.

**Requisitos:** os da spec, seção "Perfil".
- 4 KPIs a partir do `agregado`.
- Histórico único com atendimentos, extras, vendas e taxas com método. Mantenha o modal de detalhe da comanda que já existe.
- Arquivar e Reativar.
- Contatos por `contatosCliente`.
- O card de anamnese com restrições continua.

- [ ] Steps:
  1. Escreva o teste.
  2. Implemente.
  3. Rode a suíte e o tsc.
  4. Commit `feat(clientes/web): perfil pelo historico unico, reativar e contatos em shared`.

---

### Task 6: App, perfil da cliente

**Files:**
- Modify: `mobile/app/(empresa)/cliente/[id].tsx`, `mobile/app/(empresa)/cliente/[id]/editar.tsx`, `mobile/hooks/useClientes.ts` (`useClienteDetalhe`)
- Test: `web/tests/unit/clientes-app-perfil.test.ts`

**Interfaces (consome):** as mesmas da Task 5.

**Requisitos:** os mesmos da Task 5.
- 4 KPIs, incluindo Serviço favorito.
- Histórico com vendas avulsas e com a forma de pagamento das taxas.
- Reativar.
- A aba "Fotos" sai.
- `tel:` usa só os dígitos.
- Na edição, o rótulo do telefone ganha "*".
- Arquivar e reativar invalidam `['clientes']` e o detalhe.

- [ ] Steps:
  1. Escreva o teste.
  2. Implemente.
  3. Rode a suíte e os dois tsc.
  4. Commit `feat(clientes/app): perfil com historico unico, servico favorito, vendas, metodo das taxas e reativar`.

---

### Task 7: Teste cruzado de Clientes

**Files:**
- Create: `web/tests/unit/paridade-clientes-cruzada.test.ts`

**Requisitos:** uma varredura que confere:
- as duas listas e os dois perfis importam as funções de `@shared/clientes-segmentos` e `@shared/clientes-consultas`;
- não sobra nenhuma regra local de VIP, Sumida ou Em risco: nenhum `2000`, `>= 8`, `45` ou `60` hardcoded nas telas;
- não sobra `.limit(5000)`, aba "Fotos" nem `useClientesStats`;
- os textos exatos aparecem nas duas plataformas.

- [ ] Steps:
  1. Escreva o teste.
  2. Rode a suíte e os dois tsc.
  3. Commit `test(clientes): teste cruzado de paridade de clientes`.
