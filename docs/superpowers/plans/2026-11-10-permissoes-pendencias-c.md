# Permissões, banco e ajustes — plano

Spec: `docs/superpowers/specs/2026-11-10-permissoes-pendencias-c-design.md`. Branch: `feat/permissoes-pendencias-c`.

## Regras gerais

- Textos e JSDoc em pt-BR.
- Edição só com a ferramenta Edit, nunca `sed -i`. Preservar CRLF/LF.
- Nunca tocar em `.superpowers/` nem em `.env*`.
- **Sem commit:** o coordenador faz.
- As tasks rodam em paralelo e cada uma só mexe nos arquivos dela. Se precisar de arquivo de outra task, avisar no relatório em vez de editar.
- **Verificação:**
  - `cd web && npx tsc --noEmit` deve dar 0 erros;
  - `cd mobile && npx tsc --noEmit` só pode ter o TS2430 de `hooks/useAgenda.ts`;
  - rodar só os testes da área (`npx vitest run tests/unit/<arquivos>`), não o vitest completo.
- Testes novos ficam em `web/tests/unit/`.

## Task 1 — migration 101 (B13)

- **Arquivos:** `supabase/migrations/101_conferencias_banco.sql`, `web/tests/unit/conferencias-101-pglite.test.ts` e `docs/superpowers/notes/2026-11-10-deploy-101.md`.
- Seguir o padrão de `100_pendencias_dinheiro_falhas.sql` e do teste `pendencias-100-pglite.test.ts`, que carrega a cadeia de migrations no PGlite (copiar o carregador).
- **Pré-requisito no topo:** exige a 100 (`to_regprocedure('public.excluir_venda_pacotes(uuid, uuid)')`).
- **Recriar as policies:** recriar `pacote_uso: altera` com o `with check` do INSERT. Antes, copiar o corpo exato da 093 (seção 7) e mudar só o necessário.
- **Nota de deploy:**
  - consulta que conta pagamentos com `comanda_id` e `venda_id` ao mesmo tempo;
  - `validate constraint` opcional;
  - conferências em `pg_policies`, `pg_constraint` e `pg_trigger`;
  - rollback.

## Task 2 — regras de shared + B9, B11, C7, C9

1. **`shared/pacotes.ts`:** criar `podeExcluirPacoteVendido` e `resumoSaldoPacote`, com JSDoc.
2. **`shared/clientes-segmentos.ts`:** fazer a correção do C7.
3. **`web/lib/push/cron-resumo.ts`:** fazer a correção do B9 e ajustar o teste existente do cron (`ls web/tests/unit | grep -i resumo`).
4. **Telas de Pacotes** (`web/app/(app)/pacotes/page.tsx` e `mobile/app/(empresa)/pacotes.tsx`): "Excluir" vendido com `podeExcluirPacoteVendido`. Achar o papel da pessoa no contexto que a tela já usa: web por `useAppContext`/permissões, app por `useAuthStore` ou equivalente.
5. **C9:** achar toda exibição de saldo de pacote vendido com `grep -rn "Ilimitad" web/app mobile/app mobile/components web/components shared` e trocar por `resumoSaldoPacote`. Para isso pode ser preciso trazer `quantidade` por serviço junto com as linhas, e as consultas de shared já trazem `pacote.servicos`.
   - **Não mexer** na comanda (`comanda/page.tsx`, `nova-comanda.tsx`) nem no agendamento (`agenda/page.tsx`, `novo-agendamento.tsx`). Nesses quatro, listar no relatório onde o texto aparece e o coordenador aplica.
6. **Testes:** criar `web/tests/unit/pendencias-c-shared.test.ts`.

## Task 3 — cartões (C10)

- **Regras:** `shared/taxas-cartao.ts` ganha `propagarPadraoParaExcecoes`. A gravação em `shared/taxas-cartao-consultas.ts` (ou onde está a gravação por diferença) passa a usar essa função.
- **Configurações → Cartões (web e app):** mostrar o aviso de quantas exceções acompanharam a padrão.
- **Seletor de maquininha:** achar o componente comum.
  - No web, procurar o bloco de cartão usado pela comanda e pelo PDV. No app, `PagamentosEditor`.
  - Aplicar o item 2 do C10.
  - Se a maquininha só existir dentro das telas grandes de comanda ou vendas, mexer só na parte do seletor.
- **Testes:** `web/tests/unit/cartoes-pendencias-c.test.ts`.

## Task 4 — permissões (C11) + paginação (C12)

- **C11:**
  - painel de permissões web: `grep -rln "alterações não salvas" web/app web/components`;
  - painel de permissões app: `grep -rln "não salvas" mobile`.
- **C12:**
  - agenda web, só a carga das clientes do formulário (não mexer no resto de `agenda/page.tsx`);
  - insumos (telas de serviço, web e app);
  - histórico da Equipe, com a função de cursor em shared.
- **Testes:** `web/tests/unit/permissoes-paginacao-c.test.ts`, com o cursor e uma varredura da paginação.

## Task 5 — coordenador

1. Aplicar o C9 nas 4 telas que a Task 2 apontar.
2. Teste cruzado `web/tests/unit/paridade-pendencias-c-cruzada.test.ts`.
3. Atualizar o backlog: B8 já resolvido (097); B9, B11, B13, C7 e C9–C12 resolvidos em 10/11.
4. Rodar o vitest completo, o tsc e o `next build`.
5. Revisão final (opus) e correções.
6. Auditoria no CLAUDE.md e PR.
