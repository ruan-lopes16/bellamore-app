# Paridade Fase 2C — exportação no app e formato de dinheiro único

**Data:** 2026-10-07
**Status:** Aprovado pelo dono (desenho); aguardando revisão desta spec

## Contexto

Roteiro de paridade web × app (`docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md`).
As fases 1, 2A e 2B estão na main. A 2C ficou registrada assim no CLAUDE.md: "Exportação no app
(PDF/XLSX nas 9 telas, botões de Download hoje mortos) e formatação monetária única em `shared/`
(Financeiro do app ainda abrevia "k")". Decisão de 2026-10-01 (memória): o app gera os mesmos PDFs e
planilhas do web e abre o compartilhamento nativo.

### Estado atual (levantado no código)

- **Web**: `web/lib/export.ts` (`exportToXLSX` com `xlsx`, `exportToPDF` com `jspdf` + `jspdf-autotable`,
  paisagem A4, título, "Exportado em …", cabeçalho roxo `[124,58,237]`, linhas alternadas `[248,246,255]`) e
  `web/components/ExportButton.tsx` (menu Excel/PDF). Usado em 10 telas, 14 exportações; as colunas são
  escritas dentro de cada página:
  - `agenda/page.tsx` (agenda do dia) · `clientes/page.tsx` · `comissoes/ComissoesGestorView.tsx` ·
    `equipe/page.tsx` · `estoque/page.tsx` (produtos; movimentações do mês) · `financeiro/page.tsx`
    (despesas do mês) · `pacotes/page.tsx` (catálogo; vendidos; relatório de utilização) ·
    `relatorios/page.tsx` (uma por aba) · `servicos/page.tsx` · `vendas/page.tsx` (histórico).
- **App**: só `financeiro.tsx` e `relatorios.tsx` têm ícone de Download, sem ação. As outras telas com
  exportação no web (agenda, clientes, comissões, equipe, estoque, pacotes, serviços) não têm botão. Vendas
  avulsas não existe no app. Nenhum de `expo-print`, `expo-sharing`, `expo-file-system` está instalado.
- **Dinheiro**: ~39 formatações de moeda espalhadas (`Intl.NumberFormat('pt-BR', {style:'currency'})`,
  `toLocaleString('pt-BR', …)`, `fmtBRL` locais, `shared/dominio.ts#formatBRL`). O Hermes do app não tem o
  locale pt-BR completo (bug do gráfico em 2026-09-30). `mobile/app/(empresa)/financeiro.tsx:93` abrevia "k".

## Decisões do dono (2026-10-07)

1. Exportação gerada **no aparelho** (não pelo servidor).
2. Dinheiro **sempre completo** nas duas plataformas ("R$ 9.503,77"), sem "k"; em espaço apertado o
   texto encolhe para caber.
3. As 9 telas do app que têm equivalente no web ganham exportação; Vendas avulsas fica para a fase
   Comanda/PDV.

## Design

### 1. Definições compartilhadas — `shared/exportacao/`

- `tipos.ts`: `ColunaExportacao<T> = { cabecalho: string; valor: (linha: T) => string | number | null | undefined; largura?: number }` e `DefinicaoExportacao<T> = { arquivo: string; titulo: string; colunas: ColunaExportacao<T>[] }`.
- Um arquivo por tela (`agenda.ts`, `clientes.ts`, `comissoes.ts`, `equipe.ts`, `estoque.ts`,
  `financeiro.ts`, `pacotes.ts`, `relatorios.ts`, `servicos.ts`, `vendas.ts`). Cada um exporta:
  - o tipo da **linha padrão** daquela exportação (só os campos que as colunas usam);
  - uma função `definicao<Tela>(params)` → `DefinicaoExportacao<Linha>` com nome de arquivo, título e
    colunas **transcritos das definições atuais do web** (mesmos cabeçalhos, ordem, larguras e formato
    das células), com a moeda passando por `formatarMoeda` e datas por funções de `shared/periodos.ts`/
    `shared/dominio.ts` sem `Intl`.
- `pdf-html.ts`: `montarHtmlTabela(def, linhas, exportadoEm: Date): string` — HTML com o mesmo layout do
  PDF do web (paisagem A4, título 16pt negrito, "Exportado em dd/mm/aaaa hh:mm" em Brasília, cabeçalho
  roxo, linhas alternadas, fonte ~9pt). Escapa HTML das células. Puro e testável.
- `celulas.ts`: `linhasParaCelulas(def, linhas)` → `(string|number)[][]` (mesma regra para XLSX e PDF:
  `null/undefined` → `''`).

Web e app transformam os dados que a tela **já carregou** na linha padrão — não há consulta nova.

### 2. Web

- `web/lib/export.ts` passa a receber `DefinicaoExportacao` + linhas e usa `linhasParaCelulas`; o layout
  do PDF continua com jsPDF (não muda visualmente).
- `ExportButton` recebe `definicao` e `getLinhas`. As 10 páginas trocam as colunas inline pela definição
  compartilhada. Comportamento idêntico para o usuário.

### 3. App

- Pacotes: `expo-print`, `expo-sharing`, `expo-file-system` (instalados com `npx expo install` para
  casar com a versão do Expo do projeto); `xlsx` também no app.
- `mobile/lib/exportar.ts`:
  - `exportarExcel(def, linhas)`: `xlsx` → base64 → arquivo em `cacheDirectory` com o nome
    `<arquivo>.xlsx` → `Sharing.shareAsync` (mimeType de planilha).
  - `exportarPdf(def, linhas)`: `montarHtmlTabela` → `Print.printToFileAsync({ html, width/height de A4
    paisagem })` → renomear para `<arquivo>.pdf` → `Sharing.shareAsync`.
  - Se `Sharing.isAvailableAsync()` for falso ou der erro: `Alert` em português.
- `mobile/components/BotaoExportar.tsx`: ícone Download no cabeçalho (mesmo visual do ícone que já
  existe em Financeiro/Relatórios); ao tocar, escolha "Excel" / "PDF" (ActionSheet no iOS, Alert com
  botões no Android); mostra carregando enquanto gera; lista vazia exporta arquivo só com cabeçalho (ver §5); o botão some só em carregamento/erro onde a tela tem esse estado.
- Telas: `agenda.tsx`, `clientes.tsx`, `comissoes.tsx`, `equipe.tsx`, `estoque.tsx` (produtos e
  movimentações, conforme a aba visível), `financeiro.tsx` (despesas do mês exibido), `pacotes.tsx`
  (catálogo / vendidos / utilização, conforme a aba), `relatorios.tsx` (aba atual), `servicos.tsx`.
  O arquivo contém **o que a tela mostra**: mesmo período, filtros e aba. Quem não vê a tela (permissão)
  não chega ao botão. Área `(profissional)`: nenhuma tela nova (decisão de 2026-10-02).

### 4. Dinheiro único

- `shared/moeda.ts`: `formatarMoeda(valor: number): string` sem `Intl` — "R$ 9.503,77"; negativos
  "-R$ 10,00"; arredondamento para centavos; `NaN`/não finito → "R$ 0,00". `shared/dominio.ts#formatBRL`
  passa a delegar a ela (mantém o nome para não quebrar importações).
- Substituir todas as formatações de moeda locais no web e no app por `formatarMoeda`; remover o "k" de
  `mobile/app/(empresa)/financeiro.tsx`. Inputs mascarados (`formatMoeda`/`maskMoeda` de
  `shared/mascaras.ts`) **não** mudam — são campos de digitação, não exibição.
- Onde o valor completo não couber (cartões do app): `adjustsFontSizeToFit` + `numberOfLines={1}` no
  React Native; `whitespace-nowrap` + fonte responsiva no web (padrão já usado nos KPIs do Financeiro).

### 5. Erros e bordas

- Lista vazia: hoje o web exporta um arquivo só com o cabeçalho (o botão só fica desabilitado enquanto
  gera). Mantém-se isso nas duas plataformas — o arquivo vazio é válido e comunica "nada no período".
- Células com `&`, `<`, `>`: escapadas no HTML do PDF.
- Nome de arquivo: só `[a-z0-9-]` (normalizar acentos e espaços), igual nas duas plataformas
  (`nomeArquivoSeguro` em `shared/exportacao/tipos.ts`).
- Sem compartilhamento disponível: aviso em português; nada é perdido.

## Testes

- `formatarMoeda`: inteiros, centavos, milhares, milhões, negativos, arredondamento (0,005), `NaN`.
- `montarHtmlTabela`: título, data em Brasília, cabeçalhos, escape, lista vazia (só cabeçalho).
- Cada definição: uma linha de exemplo → células esperadas (iguais às do web atual).
- Paridade (varredura de código): as 10 páginas do web e as 9 telas do app importam de
  `@shared/exportacao/*`; nenhum arquivo de `web/app`, `web/components`, `mobile/app`,
  `mobile/components` contém `style: 'currency'` nem o "k" de abreviação.
- `tsc` web zerado; mobile com os mesmos 6 erros pré-existentes.

## Fora de escopo

- Vendas avulsas no app (fase Comanda/PDV).
- Exportações novas que o web não tem.
- Verificação no aparelho real (app não publicado): fica para o dono no próximo build.
