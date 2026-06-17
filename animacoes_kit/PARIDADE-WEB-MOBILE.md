# Paridade Web ⇄ Mobile — Bellamore

> Objetivo: **nenhum traço se perde entre web e mobile**. Este documento é a fonte
> única de verdade. Toda tela/feature aparece aqui com status nos dois lados.
> Para o Claude Code: trate divergências como bugs. Ao mexer numa tela de um lado,
> atualize o outro e marque aqui.

---

## Princípio de fonte única — IMPLEMENTADO ✅

`shared/` na raiz do repo contém dados puros (sem JSX):

- `shared/tokens.ts` — cores, radius, sombras, durações/curvas de animação, tipografia.
- `shared/categorias.ts` — `CategoriaServico`, `CATEGORIA_COR`, `CATEGORIA_BG`, labels, paths SVG (`SvgElement[]`).
- `shared/dominio.ts` — tipos de status, labels PT-BR, formatadores (BRL, data, telefone, CNPJ).

Web importa via `@shared/*` (webpack alias + tsconfig paths).
Mobile importa via `@shared/*` (tsconfig paths).
Os **ícones SVG** ficam como paths em `shared/categorias.ts`; web embrulha em `<svg>`, mobile em `<Svg>`.

> Resultado: trocar uma cor, um status ou um ícone = editar 1 arquivo, reflete nos 2 apps.

---

## Matriz de telas (empresa)

| Tela | Web | Mobile | Paridade |
|---|---|---|---|
| Dashboard | `app/dashboard/page.tsx` | `(empresa)/dashboard.tsx` | ✅ Tilt 3D nos dois heros |
| Agenda (semana+mês) | `app/agenda/page.tsx` | `(empresa)/agenda.tsx` | ✅ |
| Clientes (lista) | `app/clientes/page.tsx` | `(empresa)/clientes.tsx` | ✅ |
| Cliente (perfil) | inline em clientes | `(empresa)/cliente/[id].tsx` | ⚠️ web não tem rota dedicada de perfil |
| Comanda / Venda | `app/comanda/page.tsx` + `app/vendas/page.tsx` | `(empresa)/nova-comanda.tsx` | ✅ |
| Serviços | `app/servicos/page.tsx` | `(empresa)/servicos.tsx` + `novo-servico` + `editar-servico/[id]` | ✅ |
| Equipe | `app/equipe/page.tsx` | `(empresa)/equipe.tsx` + `convidar-profissional` | ✅ |
| Comissões | `app/comissoes/page.tsx` | `(empresa)/comissoes.tsx` | ✅ |
| Estoque | `app/estoque/page.tsx` | `(empresa)/estoque.tsx` + `novo-produto` | ✅ |
| Financeiro | `app/financeiro/page.tsx` | `(empresa)/financeiro.tsx` + `nova-despesa` | ✅ |
| Pacotes | `app/pacotes/page.tsx` | `(empresa)/pacotes.tsx` + `novo/editar-pacote` | ✅ |
| Relatórios | `app/relatorios/page.tsx` | `(empresa)/relatorios.tsx` | ✅ |
| Notificações | `app/notificacoes/page.tsx` | `(empresa)/notificacoes.tsx` | ✅ |
| Configurações (+ dark mode) | `app/configuracoes/page.tsx` | `(empresa)/configuracoes.tsx` | ✅ conferir toggle dark nos 2 |
| Navegação | Sidebar (`components/Sidebar.tsx`) | Tab bar + `mais.tsx` | ✅ (padrões diferentes por plataforma — ok) |

Legenda: ✅ paridade · ⚠️ existe nos dois mas com detalhe faltando.

---

## Gaps resolvidos (2026-06-16)

### Gap 0 — Ícones autorais mobile ✅
`mobile/components/CategoriaIcon.tsx` reescrito com `react-native-svg`, importando paths de `@shared/categorias`.
MaterialCommunityIcons removido das categorias.

### Gap A — Comanda mobile ✅
`mobile/app/(empresa)/nova-comanda.tsx` criado espelhando `web/app/comanda/page.tsx`:
- Lista de clientes do dia com status
- Itens de serviço + extras (serviços e produtos)
- Desconto, resumo de valores
- Formas de pagamento (5 métodos, splits)
- Tela de sucesso com `SuccessCheck` animado

### Gap B — Comissões web ✅
`web/app/comissoes/page.tsx` criado espelhando `mobile/(empresa)/comissoes.tsx`:
- Seletor de mês, 3 cards resumo (Total/Pendente/Pago)
- Filtros (Todas/Pendentes/Pagas)
- Cards por profissional com lista de comissões, ícone de categoria, status
- Modal de confirmação de pagamento
- Exportação PDF/XLSX
- Item `/comissoes` adicionado na Sidebar com badge de pendentes

### Animações ✅
- **Tilt 3D web**: `web/components/Tilt.tsx` envolve o hero do dashboard
- **TiltCard mobile**: `mobile/components/TiltCard.tsx` envolve o hero do dashboard
- **SuccessCheck mobile**: `mobile/components/SuccessCheck.tsx` usado na tela de sucesso da comanda

---

## Rotina para manter paridade (daqui pra frente)
1. Toda nova tela/feature entra na matriz acima ANTES de codar — nos dois lados.
2. Dado puro (cor, status, ícone, formato) só pode nascer em `shared/`.
3. PR que muda um lado sem o outro = incompleto. Atualize a matriz no mesmo PR.
4. Checklist de revisão visual: mesma hierarquia, mesmos status chips, mesmas animações
   (cascata, press, countup, checkmark), mesmo dark mode.

## Checklist de fechamento
- [x] `shared/` criado e consumido pelos dois apps (tokens, categorias, domínio)
- [x] Gap A: `nova-comanda.tsx` criado no mobile e funcionando
- [x] Gap B: Comissões criada no web (`app/comissoes/page.tsx`) + Sidebar
- [x] Ícones autorais no mobile (SVG via react-native-svg)
- [x] Tilt 3D nos dois heros (web: `Tilt.tsx`, mobile: `TiltCard.tsx`)
- [x] SuccessCheck nas confirmações mobile
- [x] Matriz acima 100% ✅ (exceto perfil dedicado web — decisão consciente)
