# Paridade Serviços e Pacotes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Serviços e Pacotes iguais no web e no app. A venda de pacote passa por uma função única no banco, que integra "Cobrar agora" e "Cobrar na comanda" ao faturamento e ao desconto.

**Architecture:**
- **Regras puras:** `shared/pacotes.ts` e `shared/servicos.ts`.
- **Banco (migration 096):** `vender_pacote`, `excluir_pacote_cliente`, `excluir_servico` e `fechar_comanda`, que passa a aceitar pacote pendente.
- **Consultas e chamadas às funções do banco:** `shared/pacotes-consultas.ts` e `shared/pacotes-venda.ts`.

**Spec:** `docs/superpowers/specs/2026-10-23-paridade-servicos-pacotes-design.md`. Leitura obrigatória em todas as tasks.

## Global Constraints

**Projeto**
- Escrever em português.
- O web nunca importa `mobile/`.

**Verificação**
- vitest 100%, tsc do web com 0 erros e tsc do mobile com 8 (a baseline).

**Banco**
- Migrations aplicadas à mão, idempotentes, com rollback e `notify pgrst, 'reload schema';`.
- Nunca executar nada contra o banco.
- Funções:
  - partir sempre do corpo mais recente;
  - nunca mudar a assinatura de uma função que já existe;
  - `security invoker`, com `revoke`/`grant` no padrão da 090;
  - não usar RETURNING; contar as linhas afetadas com `GET DIAGNOSTICS`.

**Código e git**
- Preservar o CRLF dos arquivos.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nunca commitar `.superpowers/`.

**Datas, consultas e erros**
- Datas sempre em Brasília.
- Toda consulta paginada e com o erro conferido.
- Erro de carga mostra "—" e um aviso.

**Textos exatos**
- "Cobrar agora", "Cobrar na comanda", "A cobrar", "Sem validade", "Válido por N dias", "Ilimitado", "Combo", "Com sessões".
- "Este serviço já foi usado. Desative em vez de excluir."
- "Este pacote já tem sessões usadas. Para cancelar, fale com a dona."
- "Pacote {nome} — a cobrar".

---

### Task 1: Regras em shared (pacotes e serviços)

**Files:**
- Modify: `shared/pacotes.ts`
- Create: `shared/servicos.ts`
- Test: `web/tests/unit/pacotes-regras.test.ts`, `web/tests/unit/servicos-regras.test.ts`

**Interfaces que esta task produz:**
```ts
// shared/pacotes.ts (além do que já existe)
export function pacoteValidoEm(dataValidade: string | null, hojeChave: string): boolean;
export function dataValidade(validadeDias: number | null, inicioChave: string): string | null;
export type UsoPacote = { servico_id: string | null };
export type ItemPacote = { servico_id: string; quantidade: number | null; ilimitado?: boolean | null };
export function saldoSessoes(itens: ItemPacote[], usos: UsoPacote[], combo: boolean): { servico_id: string; total: number | null; usadas: number; restantes: number | null }[];
export function statusPacoteCliente(p: { data_validade: string | null; status: string | null; combo: boolean }, saldo: ReturnType<typeof saldoSessoes>, usos: number, hojeChave: string): 'ativo' | 'concluido' | 'expirado';
export function rotuloValidade(validadeDias: number | null): string;   // "Válido por N dias" | "Sem validade"
export function totalSessoes(itens: ItemPacote[]): number | null;       // null se algum ilimitado
export function itensACobrar(pendentes: { id: string; pacote_id: string; nome: string; valor_pago: number }[]): { tipo: 'pacote'; pacote_id: string; pacote_cliente_id: string; descricao: string; valor_unit: number; quantidade: 1 }[];
// shared/servicos.ts
export const DURACOES_PADRAO: number[];
export function duracaoValida(min: number): boolean;       // 5..600
export function validarServico(s: { nome: string; preco: number; duracao: number }): string | null;
```

**Requisitos:**
- Os da spec, seção "Validade e saldo".
- `calcularPacotesAtivosCliente` passa a usar `pacoteValidoEm` (o último dia vale) e continua incluindo os pacotes "a cobrar", porque a cliente pode usar as sessões antes de pagar. Documente isso no JSDoc.
- Para conhecer os campos reais (ilimitado, `controla_sessoes`, `status`), leia as migrations 010, 035, 036 e 037 e as telas atuais. Use os nomes de coluna reais.

- [ ] Steps:
  1. Escrever os testes.
  2. Implementar.
  3. Rodar a suíte e os tsc.
  4. Commit `feat(shared): regras unicas de pacote (validade, saldo, status) e servico`.

---

### Task 2: Migration 096 e wrappers

**Files:**
- Create: `supabase/migrations/096_pacotes_venda_unica.sql`, `shared/pacotes-venda.ts`, `shared/pacotes-consultas.ts` (se o arquivo já existir, estenda)
- Test: `web/tests/unit/pacotes-096.test.ts` (texto + PGlite em cima da cadeia, no padrão de `cadeia-090-094-pglite.test.ts`), `web/tests/unit/pacotes-venda.test.ts`

**Interfaces que esta task produz:**
- **Banco:**
  - colunas `pacote_clientes.cobranca text not null default 'paga' check in ('paga','pendente')` e `pacote_clientes.venda_id uuid references vendas on delete set null`;
  - funções `vender_pacote(p jsonb) returns void`, `excluir_pacote_cliente(p_empresa uuid, p_id uuid) returns void` e `excluir_servico(p_empresa uuid, p_id uuid) returns void`;
  - `fechar_comanda(p jsonb)` recriada, aceitando um item `pacote` com `pacote_cliente_id`;
  - policy de DELETE de `pacote_clientes` restrita.
- **`shared/pacotes-venda.ts`:**
  - `venderPacote(db, entrada: { vendaId: string; empresaId; clienteId; pacoteId; quantidade; valorUnit; desconto; cobranca: 'agora' | 'comanda'; pagamentos }): Promise<void>`;
  - `excluirPacoteCliente(db, empresaId, id)`;
  - `excluirServico(db, empresaId, id)`;
  - sem a 096 (`PGRST202`) as três lançam `SemMigration096`, e a tela decide o caminho antigo.
- **`shared/pacotes-consultas.ts`:** `carregarCatalogoPacotes`, `carregarPacotesVendidos` (com usos e `cobranca`), `carregarPendentesCliente(db, empresaId, clienteId)`, `carregarCandidatosVinculo` e `carregarRelatorioUtilizacao`, todas paginadas.

**Requisitos:**
- **Spec:** seções "Venda de pacote", "Pacote a cobrar na Comanda", "Pacotes e vendas", "Excluir pacote vendido" e "Serviços (excluir)".
- **`fechar_comanda`:** antes de recriar, leia o corpo atual na 093, que veio da 090. Mantenha tudo o que já existe. Os pagamentos de "vender agora" seguem a mesma regra e o mesmo formato de `registrar_venda_avulsa_v2` (090/093); reaproveite os trechos de validação de pagamento.
- **Contrato:** documente o formato JSON de `vender_pacote` e do novo campo do item da comanda em `docs/superpowers/notes/2026-10-23-contrato-pacotes.md`. As Tasks 5 a 7 consomem esse contrato.

- [ ] Steps:
  1. Escrever os testes (TDD) cobrindo todos os casos da seção "Testes" da spec.
  2. Escrever o SQL.
  3. Escrever os wrappers.
  4. Rodar a suíte e os tsc.
  5. Commit `feat(banco): venda unica de pacote (agora ou na comanda), exclusoes conferidas (096)`.

---

### Task 3: Web, Serviços

**Files:** `web/app/(app)/servicos/page.tsx`; extraia componentes se precisar. Test: `web/tests/unit/servicos-web.test.ts`.

**Requisitos:**
- Usar `validarServico` e `DURACOES_PADRAO`.
- Excluir por `excluirServico`, com a mensagem exata. Sem a 096, manter o caminho atual, mas com a mesma checagem de uso feita no cliente antes do delete.
- Corrigir as cargas que ignoram erro: serviços, insumos e produtos.

- [ ] Steps: teste → implementar → suíte e tsc → commit `feat(servicos/web): validacao e exclusao conferida pela regra unica`.

---

### Task 4: App, Serviços

**Files:** `mobile/app/(empresa)/servicos.tsx`, `novo-servico.tsx`, `editar-servico/[id].tsx`; componentes em `mobile/components/servicos/`. Test: `web/tests/unit/servicos-app.test.ts`.

**Requisitos:**
- **Duração:** botões e "Personalizada" (horas e minutos).
- **Insumos (`servico_produtos`):** mesmo editor e mesma gravação do web. Leia o web.
- **Excluir:** pela função, com a mensagem exata, mais o botão Desativar.
- **Validação:** usar `validarServico`.
- **"+" do grupo:** abre o cadastro com a categoria do grupo.
- **Cargas:** conferir o erro de cada uma.

- [ ] Steps: teste → implementar → suíte e os dois tsc → commit `feat(servicos/app): insumos, duracao livre, exclusao conferida e validacao unica`.

---

### Task 5: Web, Pacotes

**Files:** `web/app/(app)/pacotes/page.tsx`; extraia os componentes `VenderPacoteModal`, `GerenciarSessoes`, `RelatorioPacotes` e `PacoteForm`. Test: `web/tests/unit/pacotes-web.test.ts`.

**Requisitos:**
- **Cadastro:**
  - tipo, serviços com quantidade ou ∞, preço e validade livre ou "Sem validade";
  - sincronização por diferença, com o erro conferido.
- **Vender** (`VenderPacoteModal`, reaproveitável pela Agenda):
  - campos: cliente (paginada), quantidade, valor, desconto %/R$;
  - "Cobrar agora", com o bloco de pagamento da Venda avulsa: maquininha, bandeira e parcelas via as funções de `shared/taxas-cartao*` e `shared/venda.ts`;
  - "Cobrar na comanda";
  - grava por `venderPacote`, com a chave `vendaId` gerada uma vez por modal.
- **Vendidos:**
  - filtro "A cobrar" e selo;
  - excluir por `excluirPacoteCliente`, com confirmação;
  - `marcarComboUtilizado` com `.select` e linhas conferidas.
- **Gerenciar sessões:** pedir confirmação ao excluir uma sessão; as permissões seguem a spec.
- **Relatório:** usar `carregarRelatorioUtilizacao`.
- **Sem a 096:**
  - venda: caminho atual, mas gravando também `vendas` quando for "Cobrar agora";
  - "Cobrar na comanda" fica escondido.

- [ ] Steps: teste → implementar → suíte e tsc → commit `feat(pacotes/web): venda unica (agora ou na comanda), a cobrar, exclusao conferida e cadastro completo`.

---

### Task 6: App, Pacotes

**Files:** `mobile/app/(empresa)/pacotes.tsx`, `novo-pacote.tsx`, `editar-pacote/[id].tsx`, `mobile/hooks/usePacotes.ts`; componentes em `mobile/components/pacotes/` (inclusive `VenderPacoteSheet`, reaproveitável pela Agenda). Test: `web/tests/unit/pacotes-app.test.ts`.

**Requisitos:** os mesmos da Task 5, com os mesmos textos.
- Combo, ilimitado e validade livre ou sem validade. Some o `?? 90`.
- Aba Relatório, com exportação (`definicaoPacotesUtilizacao`).
- Vender pelo catálogo.
- Filtro "A cobrar".
- Se a contagem de "já vendido" der erro, a composição fica bloqueada.
- Saldo e status pela função de shared (some a cópia em `usePacotes.ts`).

- [ ] Steps: teste → implementar → suíte e os dois tsc → commit `feat(pacotes/app): cadastro completo, venda unica, a cobrar e relatorio`.

---

### Task 7: Agenda e Comanda (web e app)

**Files:**
- Agenda: web `agenda/page.tsx` (venda de pacote) e app `novo-agendamento.tsx`.
- Comanda: web `comanda/page.tsx` e app `nova-comanda.tsx`.
- Test: `web/tests/unit/pacotes-agenda-comanda.test.ts`.

**Requisitos:**
- **Agenda:**
  - a venda de pacote usa o `VenderPacoteModal` (web) e o `VenderPacoteSheet` (app), com o padrão em "Cobrar na comanda";
  - a validade e a elegibilidade usam `pacoteValidoEm` e `calcularPacotesAtivosCliente`, e somem as cópias inline.
- **Comanda:**
  - ao abrir a comanda de uma cliente, carregar `carregarPendentesCliente` e adicionar os itens de `itensACobrar` ("Pacote X — a cobrar"), removíveis;
  - montar o payload com `pacote_cliente_id` conforme o contrato.
  - **Sem a 096:** os itens não aparecem, porque não existe pendente.

- [ ] Steps: teste → implementar → suíte e os dois tsc → commit `feat(pacotes): agenda e comanda pela venda unica e cobranca de pacote pendente`.

---

### Task 8: Teste cruzado

**Files:** `web/tests/unit/paridade-servicos-pacotes-cruzada.test.ts`.

**Requisitos:** varredura que confere que:
- as telas usam as funções de shared e as RPCs;
- nenhum INSERT direto em `pacote_clientes` fora do caminho antigo sem a 096;
- não restam cópias de validade nem `?? 90`;
- os textos exatos são iguais nas duas plataformas;
- web e app têm as mesmas abas e os mesmos filtros.

- [ ] Steps: teste → suíte e os dois tsc → commit `test(pacotes): teste cruzado de servicos e pacotes`.
