# Responsividade mobile do web app

## Objetivo

Corrigir as telas web em largura de telefone (390 px), preservando todos os comandos visíveis e impedindo que a navegação inferior fixa cubra conteúdo ou CTAs.

## Decisão de interface

Os comandos continuam explícitos: em vez de um menu de overflow, os grupos de ação passam a ocupar no máximo duas linhas no mobile. A ação primária permanece evidente, sem remover exportação, bloqueio, filtros ou criação.

## Status — Parte 1 já entregue (sessão de 13/07)

As causas e o design técnico abaixo (itens 1-5) **já foram implementados e mergeados** em commits anteriores
(`Corrige responsividade mobile`, `testa acoes de cabecalho mobile`, `corrige acoes e timeline no mobile`) —
os tokens `--bm-mobile-nav-*` e `.bm-comanda-shell`/`.bm-mobile-actions` já existem em `web/app/globals.css`,
e `Sidebar.tsx`/`AppLayout.tsx`/Agenda/Estoque/Pacotes/Comissões já os consomem. Este arquivo de spec e o
plano irmão nunca tinham sido commitados (ficaram como untracked), por isso pareciam pendentes — na prática
só a documentação estava atrasada em relação ao código.

### Causas confirmadas (parte 1 — já corrigidas)

- A navegação inferior tem altura variável por `safe-area-inset-bottom`, mas o conteúdo reserva um `pb-24` estático.
- A Comanda ocupa `100dvh` e usa margens negativas no mobile; isso coloca o cabeçalho sob o navegador e o footer interno sob a navegação.
- Alguns grupos de ações e filtros ainda usam o breakpoint `sm` como primeira adaptação; em 390 px eles comprimem cartões, tabs e botões.

### Design técnico (parte 1 — já implementado)

1. Definir tokens de altura/espaço da navegação móvel em `globals.css` e reservar esse espaço no `AppLayout`.
2. Tornar a navegação inferior e a Comanda consumidores do mesmo token, incluindo a safe area iOS.
3. Adicionar primitivas de grupo de ações mobile para Agenda, Estoque e Pacotes. Ações são distribuídas em duas linhas, com botões de pelo menos 44 px de altura.
4. Manter tabs longas navegáveis por rolagem horizontal e trazer a aba ativa para a área visível.
5. Reorganizar o resumo de cada profissional em Comissões: informações resumidas em uma linha e a ação de pagamento em uma linha própria no mobile.

## Parte 2 — Achados novos (sessão de 14/08, com screenshots do PWA no iPhone)

Apesar da parte 1 estar implementada, o usuário reportou com screenshots reais que a barra inferior ainda
fica cortada pela home indicator do iPhone, entre outros pontos novos. Investigação encontrou uma causa raiz
que **neutraliza silenciosamente** o trabalho da parte 1, mais 4 pontos fora do escopo original.

### Causas confirmadas (parte 2)

- **`env(safe-area-inset-*)` sempre resolve para `0px`** porque `web/app/layout.tsx` nunca declara
  `viewport-fit=cover` (nem via `<meta>` manual, nem via `export const viewport` do Next.js). O app já é um
  Apple Web App instalável (`appleWebApp.statusBarStyle: 'black-translucent'` em `layout.tsx:28-32`), o que
  faz o conteúdo desenhar sob a status bar/home indicator — mas sem `viewport-fit=cover` o navegador nunca
  calcula os insets, então todo o `paddingBottom: env(safe-area-inset-bottom)` já escrito em `Sidebar.tsx:219`
  e o token `--bm-mobile-nav-space` (que depende do mesmo `env()`) não têm efeito nenhum em produção. Uma
  linha faltando neutraliza um token inteiro de CSS já correto.
- O painel "Detalhes" do agendamento no mobile (`web/app/(app)/agenda/page.tsx:1335-1349`) é uma folha
  ancorada perto do rodapé, limitada a `max-h-[50vh] overflow-y-auto` — o dropdown de status e o restante do
  `AgCard` ficam espremidos numa faixa baixa da tela em vez de usar o espaço vertical disponível.
- A tabela de itens do Estoque (`web/app/(app)/estoque/page.tsx:1013-1032`, `min-w-[720px]` dentro de
  `overflow-x-auto`) é mais larga que qualquer viewport de celular por design — mas o gesto de arrastar
  horizontalmente não está revelando as colunas cortadas (nomes truncados, valores como "13 pct (65..."
  cortados na borda). Esta tabela é uma seção diferente da fileira de ações já corrigida na parte 1.
- O seletor Semana/Mês/Timeline da Agenda (`web/app/(app)/agenda/page.tsx:1660-1666`, classe
  `bm-mobile-action-wide`) renderiza mais alto que o necessário no mobile — os botões não têm nenhuma
  restrição de padding/altura própria além do `min-height: 44px` genérico herdado de `.bm-mobile-actions`.
- No card "Comissões" do Dashboard (`web/app/(app)/dashboard/page.tsx:357`), o valor grande é o total do mês
  (`totalComMes`) e o texto pequeno abaixo é só a parte pendente (`comPendenteMes`) — funciona como
  esperado, mas a relação entre os dois números não é explícita no texto atual ("R$ 1.444,50 pend." sem
  dizer "de quanto").

### Design técnico (parte 2)

6. Adicionar `export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }`
   em `web/app/layout.tsx`. Corrige de uma vez a base de todo `env(safe-area-inset-*)` usado no app,
   incluindo o trabalho da parte 1 que já dependia dele sem efeito.
7. No mobile, trocar o painel "Detalhes" do agendamento de folha ancorada no rodapé para modal centralizado
   (`fixed inset-0 flex items-center justify-center p-4`, backdrop, conteúdo até `max-h-[85vh] overflow-y-auto`),
   no mesmo padrão visual já usado pelos modais de despesa (`NovaDespesaModal`/`EditarDespesaModal`). O
   painel de desktop (`hidden md:block`) não muda.
8. Investigar e corrigir a rolagem horizontal por toque na tabela de Estoque — confirmar se é conflito de
   gesto com o scroll vertical da página, `touch-action` herdado incorretamente, ou outra causa; adicionar
   também uma pista visual sutil (ex: sombra/gradiente na borda direita) indicando que há mais colunas.
9. Reduzir o padding/altura dos botões do seletor Semana/Mês/Timeline no mobile (escopo local a esse
   controle — não mexe em `.bm-mobile-actions` genérico, usado por outras telas).
10. No card Comissões do Dashboard, trocar o texto do valor pendente para deixar a relação explícita, ex:
    `"{fmt(comPendenteMes)} de {fmt(totalComMes)} pendente"` em vez de só `"{fmt(comPendenteMes)} pend."`.

### Fora de escopo (parte 2)

- A barra de navegação "aparecendo no meio da tela" num dos screenshots do Estoque não foi reproduzida como
  bug real — como a barra é `position: fixed`, ela não pode fisicamente renderizar no meio do conteúdo em
  uso normal. Hipótese mais provável: captura de tela "de rolagem completa" do iOS, que tira múltiplas fotos
  durante o scroll e cola tudo numa imagem só, duplicando elementos fixos a cada trecho capturado. Sem
  reprodução confirmada, nenhuma correção de código é proposta para este ponto — a verificação em viewport
  móvel real (item de Validação abaixo) serve como checagem final.
- Reestruturar a tabela de Estoque para um layout de cartões empilhados no mobile (alternativa mais invasiva
  à rolagem horizontal) — não escolhido porque a tabela já é compartilhada com o desktop e o objetivo é
  restaurar a rolagem que já deveria funcionar, não redesenhar a tela.

## Critérios de aceite

- Nenhum CTA, item final de lista ou card fica inacessível atrás da bottom nav em 390 px.
- O cabeçalho e o footer da Comanda permanecem inteiramente no viewport móvel.
- Agenda, Estoque e Pacotes mostram todos os comandos sem corte horizontal.
- Os filtros/tabs longos continuam acessíveis por gesto horizontal e exibem a aba ativa.
- O card de Comissões não sobrepõe nome, percentual, valor e botão Pagar.
- Desktop preserva o espaçamento e o comportamento atuais.
- `env(safe-area-inset-bottom)` resolve para um valor real (não `0px`) no PWA instalado em iPhone, e a bottom
  nav não fica cortada pela home indicator.
- O painel "Detalhes" do agendamento no mobile mostra todo o conteúdo (incluindo o dropdown de status) sem
  cortar, centralizado na tela.
- A tabela de Estoque permite ver as colunas cortadas por gesto horizontal em toque real (não só com mouse).
- O seletor Semana/Mês/Timeline ocupa uma altura proporcional ao restante dos controles da Agenda no mobile.
- O card Comissões do Dashboard deixa explícito que o valor pendente é uma parte do valor total.

## Validação

Cobrir os contratos de layout com Vitest, executar TypeScript, lint e build; depois capturar as rotas afetadas em viewport móvel.
Validar especificamente em dispositivo/simulador iOS real (não apenas DevTools) os pontos 6-9, já que
`env(safe-area-inset-*)` e o comportamento de toque para rolagem horizontal não são fielmente simulados por
um redimensionamento de janela de desktop.
