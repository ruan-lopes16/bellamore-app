# Modo escuro em todo o app — plano

Spec: `docs/superpowers/specs/2026-11-21-modo-escuro-app-design.md`. Branch: `feat/modo-escuro-app`.

## Regras gerais

- **Escrita:** textos e comentários em pt-BR.
- **Edição:** só com a ferramenta Edit (nunca `sed -i`) e preservando os finais de linha. Nunca tocar em `.superpowers/` nem em `.env*`.
- **Sem commit:** o coordenador faz.
- **Sem mudança de comportamento:** só cor, tema e estilo. Nenhuma lógica, texto ou consulta muda.
- **Exemplo de tela migrada:** `mobile/app/(empresa)/dashboard.tsx` (e `agenda.tsx`, `nova-comanda.tsx`).
- **Verificação:**
  - `cd mobile && npx tsc --noEmit` só pode ter o TS2430 de `hooks/useAgenda.ts`;
  - rodar os testes de varredura que citam os arquivos tocados (`grep -l` em `web/tests/unit`) e ajustar o que for só texto de código antigo.
- **Arquivos exclusivos:** cada task mexe só nos dela. Componente usado por mais de um grupo é da Task 1.

## Task 1 — paleta, contraste, componentes comuns e telas já migradas (rodar primeiro)

- **Paleta:** `mobile/lib/tema.tsx` com as chaves novas e os valores escuros ajustados. Criar `shared/contraste.ts`, o teste de contraste e o teste de varredura `web/tests/unit/modo-escuro-app.test.ts`. A lista de exceções da varredura começa com as telas das Tasks 2 a 5; cada task tira as suas da lista.
- **Componentes de `mobile/components` (raiz e subpastas):** ler `useTema().C` e aplicar a regra de troca. Ficam fora os componentes exclusivos de um grupo, listados nas Tasks 2 a 5.
- **As 12 telas já migradas:** aplicar a regra de troca.

## Task 2 — entrada e equipe

Telas:
- `app/(auth)/*`
- `app/criar-empresa.tsx`
- `app/index.tsx`
- `app/(empresa)/equipe.tsx`
- `app/(empresa)/convidar-profissional.tsx`
- `app/(empresa)/editar-profissional/[id].tsx`

Componentes exclusivos: `EquipeConvites.tsx`, `BannerConvites.tsx`, `PermissoesPanel.tsx`.

## Task 3 — dinheiro

Telas:
- `app/(empresa)/financeiro.tsx`
- `nova-despesa.tsx`
- `nova-retirada.tsx`
- `relatorios.tsx`
- `comissoes.tsx`

Componentes exclusivos: `CalendarioMesFinanceiro.tsx`, `SparkLinha.tsx`.

## Task 4 — catálogo e estoque

Telas:
- `app/(empresa)/estoque.tsx`
- `novo-produto.tsx`
- `editar-produto/[id].tsx`
- `vendas.tsx`
- `servicos.tsx`
- `pacotes.tsx`
- `novo-servico.tsx`, `editar-servico/[id].tsx`, `novo-pacote.tsx`, `editar-pacote/[id].tsx` (as reexportações só se precisarem)

Componentes exclusivos: `components/servicos/*`, `components/pacotes/*`, `UnidadesEstoqueModal.tsx`, `CategoriaPicker.tsx`, `CategoriasManagerModal.tsx`.

## Task 5 — atendimento e clientes

Telas:
- `app/(empresa)/agendamento/[id].tsx`
- `app/(profissional)/agendamento/[id].tsx`
- `app/(empresa)/cliente/[id].tsx`
- `cliente/[id]/anamnese.tsx`
- `cliente/[id]/editar.tsx`
- `novo-cliente.tsx`
- `novo-agendamento.tsx`

Componentes exclusivos: `components/atendimento/*` e `components/agenda/*` exceto `TimelineColunas.tsx`, que fica com a Task 1.

## Task 6 — coordenador

1. Esvaziar a lista de exceções da varredura.
2. Rodar a verificação completa.
3. Fazer uma revisão rápida.
4. Registrar a auditoria no CLAUDE.md.
5. Atualizar o backlog (C1 resolvido).
6. Abrir o PR.
