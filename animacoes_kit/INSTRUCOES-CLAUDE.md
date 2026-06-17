# Animações Bellamore — Kit de Implementação

> **Para o Claude Code:** este documento é um conjunto de tarefas objetivas.
> Os arquivos de código prontos estão nas pastas `web/` e `mobile/` deste kit —
> é COPIAR e LIGAR, não recriar. Cada tarefa tem critério de aceite.
> O protótipo de referência visual é `Bellamore - Evolução UX-UI.html` (handoff anterior).

## Vocabulário de movimento (não inventar outros valores)

| Token | Valor |
|---|---|
| `ease-spring` | `cubic-bezier(.2,.9,.3,1)` |
| `ease-enter` | `cubic-bezier(.2,.85,.3,1)` |
| `ease-press` | `cubic-bezier(.2,.8,.3,1)` |
| Press | 140ms, scale 0.97 |
| Entrada de tela/lista | 340–450ms |
| Gráficos / sucesso | 500–700ms |
| Stagger entre itens | listas 60–75ms · KPIs 55ms · dias da semana 35ms · grid mensal 8ms |

---

# PARTE 1 — WEB (Next.js 16 + Tailwind 4)

## Tarefa W1 — Instalar o CSS de animações
1. Copie `web/animations.css` para `web/app/animations.css`.
2. Em `web/app/globals.css`, adicione no topo: `@import './animations.css';`

**Aceite:** classes `bm-stagger`, `bm-grow`, `bm-pop`, `bm-press`, `bm-screen` disponíveis em qualquer componente.

## Tarefa W2 — Feedback de toque em todos os elementos clicáveis
Adicione a classe `bm-press` a botões, cards clicáveis, linhas de tabela clicáveis e itens de sidebar.
Não usar em inputs nem em elementos não interativos.

**Aceite:** clicar em qualquer botão dá um "afundar" sutil (scale .97, 140ms).

## Tarefa W3 — Entrada em cascata nas listas
Para cada lista renderizada com `.map((item, i) => ...)`, no elemento raiz de cada item:
```tsx
<div className="bm-stagger" style={{ animationDelay: `${i * 60}ms` }}>
```
Onde aplicar (mínimo): lista de serviços (`web/app/servicos`), produtos do estoque,
despesas do financeiro, linhas de relatórios, cards de clientes.
⚠️ Aplique no elemento INTERNO (visual), não no botão que recebe `bm-press` —
`animation-fill-mode: both` conflita com o transform do press.

**Aceite:** ao navegar para a página, os cards entram um após o outro (fade + sobe 12px).

## Tarefa W4 — KPIs com CountUp
1. Copie `web/CountUp.tsx` para `web/components/CountUp.tsx`.
2. Nos cards de KPI (dashboard, relatórios, financeiro), envolva o número:
```tsx
<CountUp value={4820} prefix="R$ " />
```
Use `format` customizado quando o valor tiver decimais.

**Aceite:** valores monetários animam de 0 ao valor em ~900ms na montagem.

## Tarefa W5 — Tilt 3D no card-herói do dashboard
1. Copie `web/useTilt.ts` para `web/lib/useTilt.ts`.
2. No card principal de receita do dashboard (APENAS nele):
```tsx
const tilt = useTilt(6);
<div ref={tilt.ref} onPointerMove={tilt.onPointerMove}
     onPointerLeave={tilt.onPointerLeave} style={tilt.style} className="...">
```

**Aceite:** o card inclina sutilmente seguindo o mouse e volta suave ao sair.
Nenhum outro card tem tilt.

## Tarefa W6 — Barras de gráfico crescendo
Em gráficos de barras feitos com divs (relatórios/financeiro), no elemento da barra:
```tsx
<div className="bm-grow" style={{ animationDelay: `${i * 70}ms`, height: ... }} />
```
(Se o gráfico for SVG/recharts, ignorar esta tarefa.)

**Aceite:** barras sobem do zero ao entrar na página, em sequência.

## Tarefa W7 — Confirmações com checkmark desenhado
1. Copie `web/SuccessCheck.tsx` para `web/components/SuccessCheck.tsx`.
2. Use em telas/modais de sucesso (ex: venda concluída, comanda fechada):
```tsx
<SuccessCheck size={84} />
```

**Aceite:** círculo verde faz "pop" e o ✓ se desenha (stroke) logo depois.

---

# PARTE 2 — MOBILE (Expo 51 · Reanimated 3 · Moti já instalados)

## Tarefa M1 — Presets de animação
Copie `mobile/anim.ts` para `mobile/lib/anim.ts`.

## Tarefa M2 — Entrada em cascata nas listas
Em FlatList/FlashList/map de cards (agenda, serviços, clientes, pacotes, estoque):
```tsx
import Animated from 'react-native-reanimated';
import { enterStagger } from '@/lib/anim';

renderItem={({ item, index }) => (
  <Animated.View entering={enterStagger(index)}>
    <CardDoItem ... />
  </Animated.View>
)}
```
Para grades densas (calendário mensal): `enterStagger(index, 8)`.
Para o strip de dias da semana: `enterStagger(index, 35)`.

**Aceite:** listas entram em cascata (fade + sobe), 60ms entre itens.

## Tarefa M3 — Feedback de toque
1. Copie `mobile/PressableScale.tsx` para `mobile/components/PressableScale.tsx`.
2. Substitua `TouchableOpacity`/`Pressable` dos cards e botões principais por
   `PressableScale` (API compatível: `onPress`, `style`, `children`).

**Aceite:** tocar em qualquer card/botão dá scale 0.97 com retorno suave.

## Tarefa M4 — CountUp nos KPIs
1. Copie `mobile/CountUp.tsx` para `mobile/components/CountUp.tsx`.
2. Use nos KPIs do dashboard/relatórios:
```tsx
<CountUp value={4820} prefix="R$ " style={styles.kpiValor} />
```

## Tarefa M5 — Checkmark de sucesso
1. Copie `mobile/SuccessCheck.tsx` para `mobile/components/SuccessCheck.tsx`
   (usa `react-native-svg`, já instalado).
2. Use nas confirmações (agendamento criado, comanda fechada, despesa salva).

**Aceite:** círculo faz pop (spring) e o ✓ se desenha em ~550ms.

## Tarefa M6 — Tilt no hero do dashboard (opcional, só se pedir 3D)
Copie `mobile/TiltCard.tsx` para `mobile/components/TiltCard.tsx` e envolva
SOMENTE o card de receita:
```tsx
<TiltCard><HeroReceita /></TiltCard>
```
Usa gesto de toque (gesture-handler) com rotateX/rotateY máx 6° e perspective 700.

## Tarefa M7 — Barras de gráfico
Barras feitas com View: anime a entrada com
```tsx
<Animated.View entering={growBar(index)} style={{ height, ... }} />
```
(`growBar` está em `anim.ts`.)

---

# Regras gerais (web e mobile)

1. **Nunca** animar em loop infinito elementos de conteúdo.
2. **Reduced motion:** o CSS web já respeita `prefers-reduced-motion`;
   no mobile, `anim.ts` expõe `motionEnabled` — respeite se o usuário desligar animações do sistema (`AccessibilityInfo.isReduceMotionEnabled`).
3. Animação de entrada roda UMA vez por montagem — não re-disparar em re-render
   (no web a classe já garante; no mobile `entering` só roda na montagem).
4. Não alterar lógica de negócio, queries ou navegação — apenas apresentação.
5. Performance: animar apenas `transform` e `opacity` (nunca `width`/`height`/`top` no mobile).

# Checklist final de aceite

- [ ] Press feedback em todos os clicáveis (web + mobile)
- [ ] Cascata nas listas principais (serviços, clientes, agenda, estoque, despesas)
- [ ] CountUp nos KPIs monetários
- [ ] Tilt 3D APENAS no hero do dashboard (web; mobile opcional)
- [ ] Barras de gráfico crescem na entrada
- [ ] Checkmark desenhado nas confirmações
- [ ] Nada quebra com reduced-motion ativado
- [ ] Nenhuma animação em loop infinito
