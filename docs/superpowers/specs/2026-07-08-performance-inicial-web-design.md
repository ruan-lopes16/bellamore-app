# Otimizacao Inicial Web Design

## Objetivo

Reduzir o tempo inicial de resposta e carregamento percebido do app web, com foco em TTFB, FCP e LCP das rotas protegidas.

## Diagnostico

O painel de Real Experience Score aponta TTFB perto de 4s e LCP acima de 4s. No codigo atual, `web/proxy.ts` chama Supabase Auth antes de quase toda rota renderizar. Depois disso, `AppLayout`, paginas server-side e `Sidebar` repetem chamadas de usuario e empresa.

## Decisao

Aplicar uma otimizacao incremental:

1. Tornar o Proxy uma checagem otimista por cookie, sem `getUser()` remoto em toda requisicao.
2. Preservar refresh de sessao com `getSession()` apenas quando ja existe cookie Supabase.
3. Manter validacao segura no server, via `AppLayout` e rotas/API que acessam dados sensiveis.
4. Centralizar contexto server de usuario/empresa para deduplicar chamadas dentro do mesmo render pass.
5. Passar `empresaId` do layout para a `Sidebar`, evitando que ela recalcule usuario e empresa no browser.

## Fora de Escopo

- Reescrever todas as paginas client-side para consumir um provider global.
- Trocar arquitetura de dashboard por streaming granular.
- Alterar RLS, migrations ou modelo de dados.

## Verificacao

- Testes unitarios para as regras do Proxy.
- `npm.cmd test`
- `npx.cmd tsc --noEmit`
- Auditoria final seguindo AGENTS.md.
