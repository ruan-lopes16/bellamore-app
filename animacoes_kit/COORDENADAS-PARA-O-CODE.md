# Coordenadas para o Claude Code — Finalizar animações Bellamore

> Cole este arquivo inteiro no Claude Code (ou diga "siga COORDENADAS-PARA-O-CODE.md").
> Diagnóstico já feito: **a maior parte das animações JÁ está aplicada e fiel.**
> Faltam apenas os 2 itens abaixo. Não refaça o que já existe.

---

## ✅ O que JÁ está pronto (não mexer)

- **Web** (`web/app/globals.css`): keyframes `bm-stagger`, `bm-pop`, `bm-grow`, `bm-draw`, `bm-screen`, utilitário `.press`, `.bm-tilt` e bloco `prefers-reduced-motion` — tudo presente.
- **Web — páginas com cascata/press/grow já aplicados:** dashboard, agenda, clientes, clientes/[id], equipe, estoque, financeiro (barras `bm-grow`), notificações, pacotes, serviços, configurações, comanda (inclusive o **checkmark desenhado** na tela de sucesso ✓).
- **Web — componentes prontos:** `components/CountUp.tsx`, `components/SparkBars.tsx`, `components/Tilt.tsx`.
- **Mobile:** todas as telas já usam `MotiView` com entrada em cascata (delays 60/120/180ms) — dashboard, agenda, clientes, equipe, estoque, financeiro, etc.

---

## ⛳ GAP 0 — Mobile: ícones autorais de procedimentos (IMPORTANTE)

O `mobile/components/CategoriaIcon.tsx` ainda usa `MaterialCommunityIcons` — ou seja, os
**desenhos genéricos** continuam. As cores (`CATEGORIA_COR`) e bg (`CATEGORIA_BG`) já estão
corretos, mas os ícones em si não são os autorais.

**Ação:** substitua o conteúdo de `mobile/components/CategoriaIcon.tsx` pelo arquivo
`mobile — CategoriaIcon.tsx` da pasta de ícones (`icones/mobile — CategoriaIcon.tsx`),
renomeando para `CategoriaIcon.tsx`. Ele:
- mantém os mesmos exports (`CategoriaServico`, `CATEGORIA_COR`, `CATEGORIA_BG`, `CategoriaIcon`) — nada mais no app precisa mudar;
- desenha os 8 ícones com `react-native-svg` (já instalado), incluindo o dermaplaning opção C (lâmina + brilho).

**Critério de aceite:** na lista de serviços/agenda do app mobile, os ícones de categoria
mostram os desenhos autorais (cílios = pálpebra com fios, etc.), não os do MaterialCommunityIcons.

> O WEB já está correto — `web/app/servicos/page.tsx` já importa `IconCilios`, `IconSobrancelhas`, etc.

---

## ⛳ GAP 1 — Web: ligar o tilt 3D no card-herói do dashboard

O componente `web/components/Tilt.tsx` existe mas **não está sendo usado**. O hero de
receita do dashboard é um `<div>` simples. Basta envolvê-lo.

**Arquivo:** `web/app/dashboard/page.tsx`
**Local:** o bloco com comentário `{/* ── Hero receita ── */}` (por volta da linha 165).

`dashboard/page.tsx` é um Server Component (`async function`). `Tilt` é Client Component
(`'use client'`), então pode ser usado como wrapper em volta do conteúdo renderizado no
servidor — funciona sem tornar a página inteira client.

### Passo a passo
1. No topo do arquivo, adicione o import:
   ```tsx
   import Tilt from '@/components/Tilt';
   ```
2. Envolva APENAS o div do hero de receita. Antes:
   ```tsx
   {/* ── Hero receita ── */}
   <div className="relative overflow-hidden mb-4"
     style={{ background: 'linear-gradient(135deg, #2C1750 0%, #4A2A86 100%)', borderRadius: 24, padding: '22px 28px 24px', boxShadow: '0 12px 36px rgba(44,23,80,0.20), 0 4px 10px rgba(44,23,80,0.12)' }}>
     ... conteúdo ...
   </div>
   ```
   Depois:
   ```tsx
   {/* ── Hero receita ── */}
   <Tilt max={6} className="mb-4" style={{ borderRadius: 24 }}>
     <div className="relative overflow-hidden"
       style={{ background: 'linear-gradient(135deg, #2C1750 0%, #4A2A86 100%)', borderRadius: 24, padding: '22px 28px 24px', boxShadow: '0 12px 36px rgba(44,23,80,0.20), 0 4px 10px rgba(44,23,80,0.12)' }}>
       ... conteúdo (igual) ...
     </div>
   </Tilt>
   ```
   (Movi a margem `mb-4` para o `<Tilt>`; mantenha o resto do div idêntico.)

**Critério de aceite:** ao passar o mouse sobre o card de receita, ele inclina suavemente
(máx 6°) e volta ao tirar o mouse. Nenhum outro card do dashboard tem tilt.

---

## ⛳ GAP 2 — Mobile: checkmark desenhado + tilt 3D no hero

O mobile usa Moti para entradas, mas falta (a) o **checkmark animado** nas confirmações e
(b) o **tilt 3D** no hero do dashboard. Os dois componentes já estão prontos nesta pasta.

### 2a. SuccessCheck (checkmark desenhado)
1. Copie `mobile/SuccessCheck.tsx` (desta pasta) para `mobile/components/SuccessCheck.tsx`.
   Usa `react-native-svg` + `react-native-reanimated` (ambos já instalados).
2. Use nas telas de sucesso/confirmação. Candidatos no projeto:
   - `mobile/app/(empresa)/novo-agendamento.tsx` (após criar agendamento)
   - `mobile/app/(empresa)/nova-despesa.tsx` (após salvar)
   - `mobile/app/(empresa)/novo-cliente.tsx` (após cadastrar)
   Padrão de uso (dentro de um overlay/modal de sucesso, antes de navegar de volta):
   ```tsx
   import SuccessCheck from '@/components/SuccessCheck';
   // ...
   {sucesso && (
     <View style={{ position:'absolute', inset:0, alignItems:'center', justifyContent:'center', gap:20, backgroundColor: theme.bg }}>
       <SuccessCheck size={84} />
       <Text style={{ fontFamily:'Cormorant', fontSize:28, color: theme.ink }}>Tudo certo!</Text>
       <PressableScale onPress={() => router.back()} style={{ /* botão */ }}>
         <Text>Voltar</Text>
       </PressableScale>
     </View>
   )}
   ```

**Critério de aceite:** ao concluir um cadastro/agendamento, um círculo verde faz "pop" e o ✓
se desenha (stroke), antes de voltar.

### 2b. TiltCard (3D no hero do dashboard) — opcional
1. Copie `mobile/TiltCard.tsx` para `mobile/components/TiltCard.tsx`.
   Requer `react-native-gesture-handler` (padrão em Expo). Confirme que a raiz do app está
   dentro de `<GestureHandlerRootView style={{flex:1}}>` (geralmente já está em `app/_layout.tsx`).
2. Em `mobile/app/(empresa)/dashboard.tsx`, encontre o card de receita (o `MotiView`/`View`
   com `linear-gradient` plum, "Receita · {mês}") e envolva SÓ ele:
   ```tsx
   import TiltCard from '@/components/TiltCard';
   // ...
   <TiltCard>
     {/* card de receita existente, sem alterar o conteúdo */}
   </TiltCard>
   ```

**Critério de aceite:** arrastar o dedo sobre o card de receita inclina em 3D (máx 6°) e ele
volta com mola ao soltar.

---

## Regras (valem para os 2 gaps)
- Não alterar lógica de dados, queries Supabase ou navegação — só apresentação.
- Animar apenas `transform`/`opacity`.
- Respeitar reduced motion: no web o CSS já trata; no mobile, o `anim.ts` (se existir) expõe
  `motionEnabled` — se preferir, cheque `AccessibilityInfo.isReduceMotionEnabled()` antes de
  animar o tilt.
- Tilt 3D: **apenas no hero de receita**, nunca em cards de lista.

## Checklist final
- [ ] **Mobile: ícones autorais aplicados** (CategoriaIcon.tsx com SVG, não MaterialCommunityIcons)
- [ ] Web: hero do dashboard envolto em `<Tilt>` e inclinando no hover
- [ ] Mobile: `SuccessCheck` aparecendo nas confirmações de cadastro/agendamento
- [ ] Mobile: hero do dashboard com `TiltCard` (opcional)
- [ ] `npm run build` (web) sem erros · app mobile sobe sem warning de Reanimated
