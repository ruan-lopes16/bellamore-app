# Zoom em inputs e estabilidade dos modais (web/PWA)

## Contexto

Reporte do usuário: "nos inputs eu não quero que dê zoom em hipótese alguma, pois estou notando
que vários inputs dão zoom e não voltam para o estado original, portanto, remova, deve ser
estático e também zoom e movimentações sem necessidade em todos os modais."

Esta é a primeira de três specs independentes derivadas do mesmo pedido. As outras duas
(detalhamento do histórico da cliente; sistema de crédito para pacotes) têm specs próprias.

**Escopo: 100% web.** O app mobile é React Native — não tem viewport HTML nem zoom de foco do
iOS. Nenhum arquivo em `mobile/` é tocado.

## Causa raiz (confirmada por leitura do código)

O projeto usa Tailwind v4 (`@import "tailwindcss"` + bloco `@theme` em `web/app/globals.css`).
O token `--text-sm` está definido como `0.8125rem` = **13px** no mobile
(`web/app/globals.css:61`), e é redefinido para `0.875rem` = 14px só a partir de 1024px
(`web/app/globals.css:265`).

Os 8 `inputClass` do projeto usam a classe `text-sm`:

| Arquivo | Linha |
|---|---|
| `web/app/(app)/agenda/page.tsx` | 531 |
| `web/app/(app)/clientes/page.tsx` | 26 |
| `web/app/(app)/clientes/[id]/page.tsx` | 294 |
| `web/app/(app)/equipe/page.tsx` | 57 |
| `web/app/(app)/estoque/page.tsx` | 118 |
| `web/app/(app)/financeiro/page.tsx` | 105 |
| `web/app/(app)/servicos/page.tsx` | 67 |
| `web/app/cadastro/page.tsx` | 64 |

Resultado: os ~142 campos de formulário do web renderizam a **13px no mobile**. O iOS Safari dá
zoom automático ao focar qualquer campo com fonte menor que 16px, e não desfaz esse zoom ao
desfocar — exatamente o sintoma relatado.

Já existe uma regra preventiva em `web/app/globals.css:275-277`:

```css
@media (max-width: 767px) {
  input, select, textarea { font-size: max(16px, var(--text-base)); }
}
```

Ela **nunca teve efeito**: é seletor de elemento (especificidade 0,0,1) e perde para a classe
utilitária `text-sm` (0,1,0) na cascata.

### Verificação que dispensa uma escape hatch

Varredura por `<input|select|textarea` seguido de `text-(base|lg|xl|2xl|3xl)` nos diretórios
`web/app` e `web/components`: **zero ocorrências**. Nenhum campo do projeto quer ser maior que a
base, então forçar 16px não encolhe nada e não é preciso criar uma classe de exceção.

## Garantia de não regressão

- Nenhuma migration, nenhuma tabela, nenhuma política de RLS, nenhuma query é tocada.
- Nenhum campo, botão, texto ou funcionalidade é removido de nenhuma tela.
- As mudanças são de CSS, de configuração de viewport e de um hook novo de ciclo de vida — o
  comportamento de dados do app fica byte a byte igual.
- Os inputs são `h-10` (40px de altura). 16px de fonte cabe folgadamente; a única mudança visual
  é o texto dos campos ficar 3px maior no mobile.

## Parte 1 — Fonte dos campos (correção real do zoom)

Em `web/app/globals.css`, substituir a regra inerte por uma que vença a cascata:

```css
/* ── Mobile: previne zoom automático do iOS ao focar inputs ──
   O iOS Safari dá zoom em qualquer campo com fonte < 16px e não desfaz ao
   desfocar. O !important é necessário: os inputClass do projeto usam a classe
   `text-sm` do Tailwind (13px no mobile), que vence qualquer seletor de
   elemento. Verificado que nenhum campo do projeto usa fonte maior que a base,
   então travar em 16px não encolhe nada. Checkbox e radio ficam de fora — não
   têm texto e o tamanho da fonte afeta a caixa. */
@media (max-width: 767px) {
  input:not([type='checkbox']):not([type='radio']),
  select,
  textarea {
    font-size: 16px !important;
  }
}
```

**Por que `!important` e não especificidade maior:** um seletor como `input[class]` (0,1,1)
venceria `text-sm` hoje, mas quebraria silenciosamente no dia em que alguém escrever um campo com
duas classes de fonte ou uma variante responsiva. Como a regra precisa ser absoluta (requisito do
usuário: "em hipótese alguma"), `!important` expressa a intenção corretamente.

## Parte 2 — Pinch-zoom no PWA instalado

Em `web/app/layout.tsx`, o `viewport` exportado passa a ser:

```ts
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};
```

**Alcance real, documentado para não gerar expectativa errada:** o iOS ignora `maximum-scale` e
`user-scalable` no Safari em aba normal desde o iOS 10 (decisão de acessibilidade da Apple), mas
**respeita** os dois no PWA instalado na tela de início — que é como o usuário usa o app. No
Android/Chrome vale nos dois modos.

**Custo aceito conscientemente:** no PWA instalado, a pinça para ampliar texto deixa de
funcionar. O usuário optou por isso explicitamente. A Parte 1 é o que resolve o problema de fato
em todos os contextos; a Parte 2 é reforço.

## Parte 3 — `vh` → `dvh` (modais e áreas roláveis)

`vh` no iOS mede o viewport **grande** (barra de URL escondida). Um modal `max-h-[90vh]` fica mais
alto que a área visível quando a barra está presente — o rodapé do modal (onde ficam os botões de
salvar) some atrás da barra do Safari, e o modal muda de altura sozinho quando a barra
aparece/some durante a rolagem. `dvh` mede o viewport dinâmico e elimina os dois efeitos.

19 ocorrências em 10 arquivos:

| Arquivo | Linha | Atual |
|---|---|---|
| `web/app/(app)/agenda/page.tsx` | 567 | `max-h-[90vh]` |
| `web/app/(app)/agenda/page.tsx` | 1155 | `style={{ maxHeight: '62vh' }}` |
| `web/app/(app)/agenda/page.tsx` | 1336 | `max-h-[85vh]` |
| `web/app/(app)/clientes/page.tsx` | 90 | `max-h-[90vh]` |
| `web/app/(app)/clientes/[id]/page.tsx` | 202 | `max-h-[90vh]` |
| `web/app/(app)/equipe/page.tsx` | 113, 240 | `max-h-[90vh]` |
| `web/app/(app)/estoque/page.tsx` | 205, 484 | `max-h-[90vh]` |
| `web/app/(app)/financeiro/page.tsx` | 189, 351, 473 | `max-h-[90vh]` |
| `web/app/(app)/pacotes/page.tsx` | 189 | `max-h-[94vh]` e `max-h-[90vh]` (ternário, 2 na mesma linha) |
| `web/app/(app)/pacotes/page.tsx` | 382, 497 | `max-h-[90vh]` |
| `web/app/(app)/servicos/page.tsx` | 234 | `max-h-[90vh]` |
| `web/app/(app)/vendas/page.tsx` | 358 | `md:h-[calc(100vh-220px)]` |
| `web/app/(app)/vendas/page.tsx` | 361 | `max-h-[50vh]` |

Todas viram o equivalente em `dvh`. `web/app/(app)/vendas/page.tsx:358` está atrás do prefixo
`md:` (só desktop, onde `vh` e `dvh` são idênticos) — converte junto por consistência, sem efeito
prático.

**Não confundir com bug:** `web/app/(app)/pacotes/page.tsx:189` tem `transition-all duration-200`
no container do modal, que anima a mudança de largura/altura ao abrir o sub-formulário de
serviço. Isso é intencional e **fica como está** — não é uma das "movimentações desnecessárias".

## Parte 4 — Layout shift de 5px no desktop

`web/app/globals.css:281` trava o scroll de fundo com `html:has(.bm-modal) { overflow: hidden }`.
Como o projeto define uma scrollbar visível de 5px (`web/app/globals.css:147`), esconder o
overflow remove a scrollbar e **a página inteira desloca 5px para a direita** no instante em que
qualquer modal abre — e volta ao fechar. Isso acontece em todo desktop com scrollbar clássica.

Correção em `web/app/globals.css`, na regra base `html, body`:

```css
html { scrollbar-gutter: stable; }
```

Reserva a calha permanentemente, então esconder a scrollbar não reflui nada.

## Parte 5 — Trava de scroll com restauração determinística

### O problema

A trava atual delega ao browser: `overflow: hidden` no `html` impede a rolagem, mas **não garante**
que a posição de rolagem seja preservada e restaurada. O comportamento varia por versão de iOS.

### Design

Hook novo em `web/lib/useScrollLock.ts`:

```ts
/**
 * Trava a rolagem da pagina de fundo enquanto um modal esta aberto e restaura a
 * posicao exata ao fechar.
 *
 * Usa a tecnica `position: fixed` + offset negativo no body (em vez de so
 * `overflow: hidden`), que e a unica que garante a restauracao da posicao no
 * iOS em vez de depender do comportamento do browser.
 *
 * Mantem um contador de referencia em nivel de modulo: com dois modais abertos
 * ao mesmo tempo (ex.: ConfirmDialog por cima de um formulario), fechar o de
 * cima nao destrava a pagina enquanto o de baixo continuar aberto.
 *
 * @param ativo Se false, o hook nao faz nada — necessario para componentes que
 *              usam `if (!open) return null`, onde o hook precisa rodar sempre
 *              (regras dos hooks) mas so deve agir quando o modal esta visivel.
 */
export function useScrollLock(ativo: boolean = true): void
```

Comportamento:

1. Ao ativar com o contador em zero: guarda `window.scrollY`; aplica no `body`
   `position: fixed`, `top: -{scrollY}px`, `left: 0`, `right: 0`, `width: 100%`.
2. Incrementa o contador.
3. Ao desativar/desmontar: decrementa. Quando o contador chega a zero, remove os estilos e chama
   `window.scrollTo(0, scrollYSalvo)`.

O `scrollY` salvo vive no módulo (junto com o contador), não no componente — senão o modal de cima
restauraria a posição errada ao fechar.

### Onde é chamado

Uma chamada por **componente** de modal — não por ocorrência da classe. As 26 ocorrências de
`.bm-modal` / `.bm-modal-mobile` mapeiam para um conjunto menor de componentes, porque alguns
renderizam a classe em mais de um `return` (ex.: `web/app/(app)/clientes/page.tsx` linhas 67 e 88
são o estado de sucesso e o formulário do **mesmo** `NovoClienteModal` — 2 ocorrências, 1 chamada
do hook). O plano de implementação enumera os componentes exatos; a distribuição das ocorrências
por arquivo é:

| Arquivo | Ocorrências da classe |
|---|---|
| `web/app/(app)/agenda/page.tsx` | 5 (uma delas é `bm-modal-mobile`) |
| `web/app/(app)/pacotes/page.tsx` | 4 |
| `web/app/(app)/estoque/page.tsx` | 3 |
| `web/app/(app)/financeiro/page.tsx` | 3 |
| `web/app/(app)/clientes/page.tsx` | 2 |
| `web/app/(app)/clientes/[id]/page.tsx` | 2 |
| `web/app/(app)/equipe/page.tsx` | 2 |
| `web/app/(app)/servicos/page.tsx` | 2 |
| `web/app/(app)/comissoes/ComissoesGestorView.tsx` | 1 |
| `web/components/ConfirmDialog.tsx` | 1 |
| `web/components/Sidebar.tsx` | 1 |

`ConfirmDialog` faz `if (!open) return null` antes do corpo — nele o hook é chamado como
`useScrollLock(open)`, acima do early return, para não violar as regras dos hooks. Nos modais que
o pai monta/desmonta condicionalmente, `useScrollLock()` sem argumento basta.

### As regras CSS ficam

`html:has(.bm-modal) { overflow: hidden }` e a variante `.bm-modal-mobile` **não são removidas**.
Servem de rede de segurança para qualquer modal futuro que esqueça o hook, e não conflitam com o
`position: fixed` do body. O deslocamento de 5px que elas causavam some com a Parte 4.

## Honestidade de diagnóstico

Seguindo a lição registrada no `CLAUDE.md` da sessão de responsividade (duas causas-raiz
documentadas que não se sustentaram sob inspeção mais profunda), esta spec separa o que foi
provado do que não foi:

**Provado por leitura do código — mecanismo verificável:**

- Parte 1: `text-sm` = 13px vencendo a regra de elemento na cascata. Causa direta e suficiente do
  zoom relatado.
- Parte 3: `vh` mede o viewport grande no iOS; o modal excede a área visível.
- Parte 4: a scrollbar de 5px some quando `overflow: hidden` é aplicado, deslocando o conteúdo.

**Não verificado em device real:**

- Parte 5. Não consigo confirmar, sem um iPhone físico, que `overflow: hidden` no `html` hoje
  perde a posição de rolagem no iOS 16+ — pode já estar funcionando. A mudança entra assim mesmo
  porque troca "depender do comportamento do browser" por uma garantia determinística, mas o
  ganho concreto sobre o estado atual fica **pendente de validação num iPhone real**.
- O sintoma "tela desloca ao focar um input e não volta" deve desaparecer com a Parte 1 (era o
  zoom que não voltava). O deslocamento residual causado pelo teclado é comportamento esperado do
  iOS e não é alvo desta spec.

## Critérios de aceite

1. `npx tsc --noEmit` no `web` sem erros. O `mobile` mantém os ~10 erros pré-existentes de
   baseline, sem nenhum erro novo.
2. Inspeção do CSS compilado confirmando que a regra de 16px vence `text-sm` na cascata para
   `input`, `select` e `textarea` abaixo de 768px.
3. Nenhuma ocorrência de `vh` restante nos 10 arquivos listados na Parte 3 (busca por
   `[0-9]vh]` e `'[0-9]*vh'` retorna vazio nesses arquivos).
4. Todo componente que renderiza `.bm-modal` ou `.bm-modal-mobile` chama `useScrollLock` — nenhum
   dos 11 arquivos listados na Parte 5 fica de fora.
5. Checkbox e radio continuam com o tamanho de caixa atual (não afetados pela regra de fonte).
6. *(pendente de iPhone real)* Focar qualquer campo no PWA instalado não aplica zoom.
7. *(pendente de iPhone real)* Abrir e fechar um modal no meio de uma lista longa devolve a
   página à mesma posição de rolagem.
