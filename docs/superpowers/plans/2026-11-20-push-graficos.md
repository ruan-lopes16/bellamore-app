# Push de bloqueio, recibos e ajustes de tela — plano

Spec: `docs/superpowers/specs/2026-11-20-push-graficos-design.md`. Branch: `feat/push-graficos`.

## Regras gerais

- Todo texto e JSDoc em pt-BR.
- Edite só com a ferramenta Edit (nunca `sed -i`) e preserve os finais de linha.
- Nunca toque em `.superpowers/` nem em `.env*`.
- Não faça commit: o coordenador faz.
- As duas tasks rodam em paralelo. Cada uma mexe só nos próprios arquivos.
- Verificação de cada task:
  - `cd web && npx tsc --noEmit`: 0 erros;
  - `cd mobile && npx tsc --noEmit`: só o TS2430 de `hooks/useAgenda.ts`;
  - só os testes da área (sem o vitest completo).
- **Nunca rode nada contra o banco real.** Use PGlite, copiando o carregador de `web/tests/unit/conferencias-101-pglite.test.ts`.

## Task 1 — migration 102 + push de bloqueio + recibos (C14, B14)

**Arquivos que esta task cria ou altera:**
- `supabase/migrations/102_push_bloqueio_e_recibos.sql`
- `web/lib/push/expo.ts`
- `web/lib/push/cron-lembretes.ts` (ou um módulo novo, `web/lib/push/cron-notificacoes.ts`, chamado pela rota `/api/cron/lembretes`)
- `web/app/api/cron/lembretes/route.ts`, se preciso
- os testes `web/tests/unit/push-bloqueio-recibos.test.ts` e `web/tests/unit/push-102-pglite.test.ts`
- a nota `docs/superpowers/notes/2026-11-20-deploy-102.md`

**O que fazer:**
- Leia o trigger da 097 sobre `notificacoes` (o que só deixa mudar `lida`). Confira se ele barra o service role e faça como a spec manda.
- Os testes do cron existentes (`push-crons.test.ts`) têm que continuar passando.

## Task 2 — ajustes de tela (C13)

**Arquivos:**
- `mobile/app/(empresa)/dashboard.tsx` (sparkline)
- `mobile/app/(empresa)/relatorios.tsx` (gráfico do mês e erros duplicados)
- `web/app/(app)/relatorios/page.tsx` (erros duplicados)
- os pontos de lançamento de recorrentes, no web (`financeiro/page.tsx`) e no app (`financeiro.tsx`)
- `mobile/app/(empresa)/vendas.tsx` (spinner)
- os helpers em shared: `rotulosEixoVisiveis`, em `shared/relatorios.ts` ou onde ficam as séries, e a constante do "já estavam lançadas"
- o teste `web/tests/unit/graficos-avisos-c13.test.ts`

Antes de mexer, confirme cada problema no código. Se um item já estiver resolvido, diga no relatório.

## Task 3 — coordenador

1. Teste cruzado.
2. Atualizar o backlog: C13, C14 e B14 resolvidos em 20/11.
3. Rodar a verificação completa.
4. Fazer uma revisão rápida.
5. Registrar a auditoria no CLAUDE.md.
6. Abrir o PR.
