# Paridade Fase 2C — Exportação no app e moeda única — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o app exporta Excel e PDF nas 9 telas que o web exporta, com as mesmas colunas, e as duas plataformas mostram dinheiro sempre completo por uma função única.

**Architecture:** as definições de exportação (arquivo, título, colunas) saem das páginas do web para `shared/exportacao/`, uma por tela, alimentadas por uma "linha padrão" que cada plataforma monta a partir dos dados que a tela já carregou. O web continua gerando com `xlsx`/`jsPDF`; o app gera com `xlsx` + `expo-print` (HTML montado em `shared/`) e abre o compartilhar com `expo-sharing`. `shared/moeda.ts#formatarMoeda` (sem `Intl`) substitui toda formatação de moeda.

**Tech Stack:** Next.js (web, ver `web/AGENTS.md`), Expo SDK 51 / React Native 0.74 (mobile), Vitest (testes em `web/tests/unit`, também leem `shared/` e fontes do `mobile/` como texto), `xlsx`, `jspdf`, `jspdf-autotable`, `expo-print`, `expo-sharing`, `expo-file-system`.

**Spec:** `docs/superpowers/specs/2026-10-07-paridade-fase2c-exportacao-design.md`

## Global Constraints

- Português em código novo, comentários, JSDoc, mensagens de commit e textos de tela.
- Dinheiro exibido SEMPRE completo: `formatarMoeda(9503.77) === 'R$ 9.503,77'`; negativo `'-R$ 10,00'`; sem `Intl`; sem abreviação "k". Inputs mascarados (`maskMoeda`/`formatMoeda` de `shared/mascaras.ts`) não mudam.
- Datas de exportação em horário de Brasília via `shared/periodos.ts` (sem `Intl`, sem `toLocaleString`).
- Colunas, cabeçalhos, ordem e larguras das exportações = exatamente as do web atual (transcritas no plano).
- Paridade web/mobile; a área `mobile/app/(profissional)` NÃO ganha telas, abas nem botões novos.
- Verificação por task: `cd web && npx tsc --noEmit` zerado; `cd web && npx vitest run` verde; `cd mobile && npx tsc --noEmit` com EXATAMENTE os 6 erros pré-existentes (configuracoes.tsx ×2, estoque.tsx, useAgenda.ts, useNotificacoes.ts ×2).
- Worktree: `npm ci` falha; usar `npm install` em `web/`/`mobile/` e `git checkout -- package-lock.json` depois — EXCETO na Task 6, em que o lock do mobile muda de propósito (deps novas) e deve ser commitado. Não commitar `.superpowers/`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `shared/moeda.ts` (novo) | `formatarMoeda` |
| `shared/dominio.ts` | `formatBRL` delega a `formatarMoeda` |
| `shared/exportacao/tipos.ts` (novo) | Tipos, `nomeArquivoSeguro`, `linhasParaCelulas`, formatos de data |
| `shared/exportacao/pdf-html.ts` (novo) | `montarHtmlTabela` (PDF do app) |
| `shared/exportacao/<tela>.ts` (10 novos) | Definições por tela |
| `web/lib/export.ts`, `web/components/ExportButton.tsx` | Geradores web aceitando definição |
| 10 páginas do web | Usam as definições |
| `mobile/lib/exportar.ts`, `mobile/components/BotaoExportar.tsx` (novos) | Geração e compartilhamento no app |
| 9 telas do app | Botão Exportar |

---

### Task 1: Moeda única

**Files:**
- Create: `shared/moeda.ts`
- Modify: `shared/dominio.ts` (função `formatBRL`)
- Test: `web/tests/unit/moeda.test.ts`

**Interfaces:**
- Produces: `formatarMoeda(valor: number): string`; `formatBRL` (shared/dominio) passa a retornar o mesmo que `formatarMoeda`.

- [ ] **Step 1: Teste que falha**

```ts
// web/tests/unit/moeda.test.ts
import { describe, expect, it } from 'vitest';
import { formatarMoeda } from '@shared/moeda';
import { formatBRL } from '@shared/dominio';

describe('formatarMoeda', () => {
  it.each([
    [0, 'R$ 0,00'],
    [5, 'R$ 5,00'],
    [9.5, 'R$ 9,50'],
    [1000, 'R$ 1.000,00'],
    [9503.77, 'R$ 9.503,77'],
    [1234567.8, 'R$ 1.234.567,80'],
    [-10, '-R$ 10,00'],
    [-1234.5, '-R$ 1.234,50'],
    [0.005, 'R$ 0,01'],
    [2.675, 'R$ 2,68'],
    [-0.001, 'R$ 0,00'],
  ])('%s → %s', (v, esperado) => {
    expect(formatarMoeda(v)).toBe(esperado);
  });

  it('não finito vira R$ 0,00', () => {
    expect(formatarMoeda(NaN)).toBe('R$ 0,00');
    expect(formatarMoeda(Infinity)).toBe('R$ 0,00');
  });

  it('formatBRL de shared/dominio delega', () => {
    expect(formatBRL(9503.77)).toBe('R$ 9.503,77');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd web && npx vitest run tests/unit/moeda.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

```ts
// shared/moeda.ts
/**
 * Formato único de dinheiro do Bellamore (web e app): "R$ 9.503,77", negativo "-R$ 10,00".
 * Sem Intl — o Hermes do app não tem o locale pt-BR completo. Arredonda para centavos
 * em inteiros (evita 2,675 → 2,67 do ponto flutuante). Não finito vira "R$ 0,00".
 */
export function formatarMoeda(valor: number): string {
  if (!Number.isFinite(valor)) return 'R$ 0,00';
  const centavos = Math.round(Math.abs(valor) * 100 + 1e-7);
  const negativo = valor < 0 && centavos > 0;
  const inteiro = Math.floor(centavos / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resto = String(centavos % 100).padStart(2, '0');
  return `${negativo ? '-' : ''}R$ ${inteiro},${resto}`;
}
```

Em `shared/dominio.ts`, `formatBRL` vira:

```ts
import { formatarMoeda } from './moeda';

/** Mantido por compatibilidade de importação — use `formatarMoeda` (shared/moeda). */
export function formatBRL(value: number): string {
  return formatarMoeda(value);
}
```

- [ ] **Step 4: Rodar e ver passar** — `cd web && npx vitest run tests/unit/moeda.test.ts` → PASS. Depois `cd web && npx tsc --noEmit` e `cd web && npx vitest run` (testes antigos que dependiam do espaço não separável ` ` do Intl via `formatBRL` devem ser ajustados para o espaço normal — sem afrouxar o que verificam).

- [ ] **Step 5: Commit** — `git add shared/moeda.ts shared/dominio.ts web/tests/unit` ; `git commit -m "feat(moeda): formatarMoeda unico em shared, sem Intl"`.

---

### Task 2: Base das exportações (tipos, células, PDF em HTML)

**Files:**
- Create: `shared/exportacao/tipos.ts`, `shared/exportacao/pdf-html.ts`
- Test: `web/tests/unit/exportacao-base.test.ts`

**Interfaces:**
- Produces:
  - `type ColunaExportacao<T> = { cabecalho: string; valor: (linha: T) => string | number | null | undefined; largura?: number }`
  - `type DefinicaoExportacao<T> = { arquivo: string; titulo: string; colunas: ColunaExportacao<T>[] }`
  - `nomeArquivoSeguro(s: string): string` — minúsculas, sem acento, só `[a-z0-9-]`, hífens colapsados.
  - `linhasParaCelulas<T>(def, linhas: T[]): (string | number)[][]` — `null/undefined` → `''`.
  - `dataBR(dia: string | null | undefined): string` — `'yyyy-MM-dd…'` → `'dd/MM/yyyy'`, vazio → `''`.
  - `dataHoraBR(ts: string): string` — instante → `'dd/MM/yyyy HH:mm'` em Brasília.
  - `montarHtmlTabela<T>(def, linhas: T[], exportadoEm: Date): string`

- [ ] **Step 1: Teste que falha**

```ts
// web/tests/unit/exportacao-base.test.ts
import { describe, expect, it } from 'vitest';
import { nomeArquivoSeguro, linhasParaCelulas, dataBR, dataHoraBR, type DefinicaoExportacao } from '@shared/exportacao/tipos';
import { montarHtmlTabela } from '@shared/exportacao/pdf-html';

type L = { a: string; n: number | null };
const def: DefinicaoExportacao<L> = {
  arquivo: 'teste', titulo: 'Título & <Cia>',
  colunas: [{ cabecalho: 'A', valor: l => l.a, largura: 10 }, { cabecalho: 'N', valor: l => l.n }],
};

describe('base das exportações', () => {
  it('nomeArquivoSeguro', () => {
    expect(nomeArquivoSeguro('Relatório Março 2026')).toBe('relatorio-marco-2026');
    expect(nomeArquivoSeguro('comissoes--1º  Trimestre')).toBe('comissoes-1-trimestre');
  });
  it('linhasParaCelulas: null/undefined viram vazio, números ficam números', () => {
    expect(linhasParaCelulas(def, [{ a: 'x', n: null }, { a: 'y', n: 3 }])).toEqual([['x', ''], ['y', 3]]);
  });
  it('dataBR e dataHoraBR (Brasília)', () => {
    expect(dataBR('2026-09-05')).toBe('05/09/2026');
    expect(dataBR(null)).toBe('');
    expect(dataHoraBR('2026-10-01T02:30:00Z')).toBe('30/09/2026 23:30');
  });
  it('montarHtmlTabela: título escapado, data em Brasília, cabeçalhos, linhas', () => {
    const html = montarHtmlTabela(def, [{ a: '<b>', n: 1 }], new Date('2026-10-07T15:04:00Z'));
    expect(html).toContain('Título &amp; &lt;Cia&gt;');
    expect(html).toContain('Exportado em 07/10/2026 12:04');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>&lt;b&gt;</td>');
    expect(html).toContain('size: A4 landscape');
    expect(html).toContain('#7c3aed');
  });
  it('lista vazia gera só o cabeçalho', () => {
    const html = montarHtmlTabela(def, [], new Date('2026-10-07T15:04:00Z'));
    expect(html).toContain('<th>N</th>');
    expect(html).not.toContain('<td>');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd web && npx vitest run tests/unit/exportacao-base.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// shared/exportacao/tipos.ts
/**
 * Exportações (Excel/PDF) compartilhadas entre web e app
 * (spec docs/superpowers/specs/2026-10-07-paridade-fase2c-exportacao-design.md).
 * Cada tela monta uma "linha padrão" a partir do que já carregou e entrega a uma
 * definição de shared/exportacao/<tela>.ts — mesmas colunas nas duas plataformas.
 */
import { chaveDiaBRT, horaBRT, rotuloDataBR } from '../periodos';

export type ColunaExportacao<T> = {
  cabecalho: string;
  valor: (linha: T) => string | number | null | undefined;
  /** Largura no Excel (caracteres). */
  largura?: number;
};

export type DefinicaoExportacao<T> = { arquivo: string; titulo: string; colunas: ColunaExportacao<T>[] };

/** 'Relatório Março 2026' → 'relatorio-marco-2026'. */
export function nomeArquivoSeguro(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Mesma regra de célula para Excel e PDF: null/undefined → ''. */
export function linhasParaCelulas<T>(def: DefinicaoExportacao<T>, linhas: T[]): (string | number)[][] {
  return linhas.map(l => def.colunas.map(c => c.valor(l) ?? ''));
}

/** 'yyyy-MM-dd' (ou ISO) → 'dd/MM/yyyy'; vazio → ''. */
export function dataBR(dia: string | null | undefined): string {
  return dia ? rotuloDataBR(dia.slice(0, 10)) : '';
}

/** Instante → 'dd/MM/yyyy HH:mm' em Brasília. */
export function dataHoraBR(ts: string): string {
  return `${rotuloDataBR(chaveDiaBRT(ts))} ${horaBRT(ts)}`;
}
```

```ts
// shared/exportacao/pdf-html.ts
import { dataHoraBR, linhasParaCelulas, type DefinicaoExportacao } from './tipos';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * HTML da tabela para o PDF do app (expo-print), no mesmo layout do PDF do web
 * (web/lib/export.ts): A4 paisagem, título 16pt, "Exportado em …" em Brasília,
 * cabeçalho roxo #7c3aed, linhas alternadas #f8f6ff, fonte 9pt.
 */
export function montarHtmlTabela<T>(def: DefinicaoExportacao<T>, linhas: T[], exportadoEm: Date): string {
  const cab = def.colunas.map(c => `<th>${esc(c.cabecalho)}</th>`).join('');
  const corpo = linhasParaCelulas(def, linhas)
    .map(cel => `<tr>${cel.map(v => `<td>${esc(String(v))}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4 landscape; margin: 14mm; }
body { font-family: Helvetica, Arial, sans-serif; color: #000; }
h1 { font-size: 16pt; margin: 0 0 4px; }
.data { font-size: 9pt; color: #787878; margin: 0 0 10px; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; }
th { background: #7c3aed; color: #fff; text-align: left; padding: 3mm; font-weight: bold; }
td { padding: 3mm; }
tr:nth-child(even) td { background: #f8f6ff; }
</style></head><body>
<h1>${esc(def.titulo)}</h1>
<p class="data">Exportado em ${dataHoraBR(exportadoEm.toISOString())}</p>
<table><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table>
</body></html>`;
}
```

- [ ] **Step 4: Rodar e ver passar** — o teste novo, `cd web && npx tsc --noEmit`.

- [ ] **Step 5: Commit** — `feat(exportacao): tipos, celulas e HTML do PDF em shared`.

---

### Task 3: Definições por tela (10 arquivos, 14 exportações)

**Files:**
- Create: `shared/exportacao/{agenda,clientes,comissoes,equipe,estoque,financeiro,pacotes,relatorios,servicos,vendas}.ts`
- Test: `web/tests/unit/exportacao-definicoes.test.ts`

**Interfaces:**
- Consumes: Task 1 (`formatarMoeda`), Task 2 (tipos, `nomeArquivoSeguro`, `dataBR`, `dataHoraBR`); `horaBRT`, `rotuloMesAno`, `chaveDiaBRT` de `shared/periodos.ts`.
- Produces (cada linha padrão traz rótulos já resolvidos pela plataforma — status, categoria — para não duplicar mapas):

```ts
// agenda.ts
export type LinhaAgenda = { inicio: string; cliente: string | null; servico: string | null; profissional: string | null; valor: number; status: string };
export function definicaoAgenda(dia: string /* 'yyyy-MM-dd' */): DefinicaoExportacao<LinhaAgenda>;
// arquivo `agenda-${dia}`; título `Agenda — ${rotuloDiaExtenso(dia)}` (ex.: 'Agenda — 7 de outubro de 2026')
// colunas: Horário(horaBRT(inicio),10) | Cliente(?? '—',26) | Serviço(?? '—',26) | Profissional(?? '—',20) | Valor(formatarMoeda,14) | Status(12)

// clientes.ts
export type LinhaCliente = { nome: string; telefone: string | null; email: string | null; dataNascimento: string | null; criadoEm: string };
export function definicaoClientes(): DefinicaoExportacao<LinhaCliente>;
// arquivo 'clientes'; título 'Clientes'
// Nome(30) | Telefone(?? '',18) | E-mail(?? '',28) | Nascimento('dd/MM' de dataNascimento ou '',14) | Cadastrado em(dataBR(chaveDiaBRT(criadoEm)),16)

// comissoes.ts
export type LinhaComissao = { profissional: string; dia: string; servico: string; valorServico: number | null; percentual: number; comissao: number; pago: boolean };
export function definicaoComissoes(rotuloPeriodo: string): DefinicaoExportacao<LinhaComissao>;
// arquivo nomeArquivoSeguro(`comissoes-${rotuloPeriodo}`); título `Comissões — ${rotuloPeriodo}`
// Profissional(22) | Data(dataBR(dia),12) | Serviço(24) | Valor serviço(formatarMoeda ou '—',14) | % Comissão(`${percentual}%`,12) | Comissão(formatarMoeda,12) | Status('Pago'|'Pendente',10)

// equipe.ts
export type LinhaEquipe = { nome: string; telefone: string | null; percentual: number; atendimentosMes: number; totalMes: number; ativo: boolean };
export function definicaoEquipe(mes: string /* 'yyyy-MM' */): DefinicaoExportacao<LinhaEquipe>;
// arquivo `equipe-${mes}`; título `Equipe — ${rotuloMesAno(mes)}`
// Nome(28) | Telefone(?? '',18) | Comissão (%)(`${percentual}%`,14) | Atend./mês(14) | Total/mês(formatarMoeda,16) | Status('Ativo'|'Inativo',10)

// estoque.ts
export type LinhaProduto = { nome: string; categoria: string; unidade: string; estoqueAtual: number; estoqueMinimo: number; precoCusto: number; status: string };
export function definicaoEstoqueProdutos(): DefinicaoExportacao<LinhaProduto>;
// arquivo 'estoque-produtos'; título 'Estoque — Produtos'
// Nome(30) | Categoria(16) | Unidade(10) | Estoque Atual(14) | Estoque Mín.(14) | Custo Unit.(precoCusto>0 ? formatarMoeda : '',14) | Status(10)
export type LinhaMovimentacao = { criadoEm: string; produto: string; tipo: string; quantidade: number; unidade: string; motivo: string | null };
export function definicaoEstoqueMovimentacoes(mes: string /* 'yyyy-MM' */): DefinicaoExportacao<LinhaMovimentacao>;
// arquivo 'estoque-movimentacoes'; título `Movimentações — ${rotuloMesAno(mes)}`
// Data(dataHoraBR(criadoEm),18) | Produto(28) | Tipo(10) | Qtd(`${quantidade} ${unidade}`,10) | Motivo(?? '',28)

// financeiro.ts
export type LinhaDespesa = { descricao: string; categoria: string | null; valor: number; vencimento: string | null; pagamento: string | null; pago: boolean; recorrente: boolean };
export function definicaoDespesas(mes: string /* 'yyyy-MM' */): DefinicaoExportacao<LinhaDespesa>;
// arquivo `financeiro-despesas-${mes}`; título `Despesas — ${rotuloMesAno(mes)}`
// Descrição(30) | Categoria(?? '',18) | Valor(formatarMoeda,14) | Vencimento(?? '',14) | Pagamento(?? '',14) | Status('Pago'|'Pendente',12) | Recorrente('Sim'|'Não',12)

// pacotes.ts
export type LinhaPacoteCatalogo = { nome: string; preco: number; validadeDias: number | null; servicos: { nome: string; quantidade: number | null }[]; ativo: boolean };
export function definicaoPacotesCatalogo(): DefinicaoExportacao<LinhaPacoteCatalogo>;
// 'pacotes-catalogo' / 'Catálogo de Pacotes'
// Nome(28) | Preço(formatarMoeda,14) | Validade (dias)(?? 'Sem validade',14) | Serviços(`${nome} ×${quantidade ?? '∞'}` juntos por ', ',40) | Status('Ativo'|'Inativo',10)
export type LinhaPacoteVendido = { cliente: string; pacote: string; usadas: number; totalSessoes: number | null; valorPago: number | null; inicio: string | null; validade: string | null; status: string };
export function definicaoPacotesVendidos(): DefinicaoExportacao<LinhaPacoteVendido>;
// 'pacotes-vendidos' / 'Pacotes Vendidos'
// Cliente(26) | Pacote(26) | Sessões usadas(`${usadas}/${totalSessoes ?? '∞'}`,14) | Valor pago(formatarMoeda ou '—',14) | Início(dataBR,12) | Válido até(dataBR ou 'Sem validade',12) | Status(12)
export type LinhaUtilizacaoPacote = { nome: string; vendas: number; totalSessoes: number; sessoesUsadas: number; receita: number };
export function definicaoPacotesUtilizacao(): DefinicaoExportacao<LinhaUtilizacaoPacote>;
// 'pacotes-relatorio' / 'Relatório de Utilização de Pacotes'
// Pacote(28) | Vendas(10) | Sessões totais(14) | Sessões usadas(14) | Aproveitamento(`${totalSessoes>0 ? round(usadas/total*100) : 0}%`,14) | Receita(formatarMoeda,16)

// relatorios.ts — uma definição por aba
export type AbaRelatorio = 'financeiro' | 'servicos' | 'equipe' | 'clientes' | 'estoque' | 'comissoes' | 'avaliacoes';
export type LinhaRanking = { nome: string; quantidade: number; valor: number; comissao?: number };
export type LinhaInsumo = { nome: string; quantidade: number; custo: number };
export type LinhaAtendimento = { inicio: string; cliente: string | null; servico: string | null; valor: number; status: string };
export type LinhaComissaoRelatorio = { profissional: string; dia: string; cliente: string; servico: string; valorAtendimento: number | null; percentual: number; comissao: number; pago: boolean };
export function definicaoRelatorio(aba: AbaRelatorio, rotuloAba: string, rotuloPeriodo: string): DefinicaoExportacao<any>;
// arquivo nomeArquivoSeguro(`relatorio-${aba}-${rotuloPeriodo}`); título `Relatório ${rotuloAba} — ${rotuloPeriodo}`
// servicos:  Serviço(30) | Atendimentos(14) | Receita(16)
// equipe:    Profissional(28) | Atendimentos(14) | Receita gerada(16) | Comissão(formatarMoeda(comissao ?? 0),16)
// clientes:  Cliente(28) | Atendimentos(14) | Total gasto(16)
// estoque:   Produto(28) | Qtd consumida(14) | Custo estimado(16)
// comissoes: Profissional(22) | Data(dataBR(dia),12) | Cliente(22) | Serviço(22) | Vlr atend.(formatarMoeda ou '—',12) | %(`${percentual}%`,6) | Comissão(12) | Status('Pago'|'Pendente',10)
// financeiro: Data(dataHoraBR(inicio),18) | Cliente(?? '—',26) | Serviço(?? '—',26) | Valor(formatarMoeda,14) | Status(12)
// avaliacoes: o web não exporta essa aba hoje — definicaoRelatorio('avaliacoes', …) lança Error('Aba sem exportação'); telas escondem o botão nessa aba.

// servicos.ts
export type LinhaServico = { nome: string; categoria: string; duracao: string; preco: number; custo: number; ativo: boolean };
export function definicaoServicos(): DefinicaoExportacao<LinhaServico>;
// 'servicos' / 'Catálogo de Serviços'
// Nome(28) | Categoria(16) | Duração(12) | Preço(formatarMoeda,14) | Custo(formatarMoeda,14) | Status('Ativo'|'Inativo',10)

// vendas.ts
export type LinhaVenda = { criadoEm: string; cliente: string | null; itens: { produto: string; quantidade: number }[]; total: number; pagamentos: { metodo: string; valor: number }[] };
export function definicaoVendas(): DefinicaoExportacao<LinhaVenda>;
// 'vendas-historico' / 'Histórico de Vendas'
// Data(dataHoraBR,18) | Cliente(?? 'Avulso',24) | Itens(`${produto} ×${quantidade}` por ', ',40) | Total(formatarMoeda,14) | Pagamentos(`${metodo} ${formatarMoeda(valor)}` por ' + ',30)
```

Fonte de verdade de cada coluna (transcrever, trocando `Intl`/`format` pelos helpers acima): `agenda/page.tsx` ~2331, `clientes/page.tsx` ~284, `comissoes/ComissoesGestorView.tsx` ~180, `equipe/page.tsx` ~779, `estoque/page.tsx` ~781 e ~801, `financeiro/page.tsx` ~1243, `pacotes/page.tsx` ~975/~991/~1009, `relatorios/page.tsx` ~610, `servicos/page.tsx` ~694, `vendas/page.tsx` ~644 (todos em `web/app/(app)/`). Diferença deliberada: datas em Brasília pelos helpers (o web usava o fuso do navegador, que na prática é Brasília).

- [ ] **Step 1: Teste que falha** — `web/tests/unit/exportacao-definicoes.test.ts`, um `it` por definição: monta 1 linha de exemplo e confere `arquivo`, `titulo`, a lista de cabeçalhos (na ordem acima) e `linhasParaCelulas(def, [linha])[0]` (ex.: agenda com `inicio '2026-10-07T13:30:00Z'`, `valor 120` → `['10:30', 'Ana', 'Corte', 'Bia', 'R$ 120,00', 'Concluído']`; cliente sem nome → '—'). Inclua `definicaoRelatorio('avaliacoes', …)` lançando erro e `nomeArquivoSeguro` no arquivo de comissões (`'comissoes-1o-trimestre-2026'` para `'1º Trimestre 2026'`).
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar os 10 arquivos com JSDoc pt-BR curto em cada função.
- [ ] **Step 4:** rodar o teste + `cd web && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(exportacao): definicoes das 14 exportacoes em shared`.

---

### Task 4: Web usa as definições compartilhadas

**Files:**
- Modify: `web/lib/export.ts`, `web/components/ExportButton.tsx`, as 10 páginas listadas na Task 3
- Test: `web/tests/unit/exportacao-paridade.test.ts` (novo; parte web)

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces: `exportToXLSX<T>(def: DefinicaoExportacao<T>, linhas: T[])`, `exportToPDF<T>(def, linhas)` (mesmo visual de hoje), `<ExportButton definicao={def} getLinhas={() => linhas} variant? className? />`.

- [ ] **Step 1: Teste que falha**

```ts
// web/tests/unit/exportacao-paridade.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

const WEB: [string, string][] = [
  ['web/app/(app)/agenda/page.tsx', 'definicaoAgenda'],
  ['web/app/(app)/clientes/page.tsx', 'definicaoClientes'],
  ['web/app/(app)/comissoes/ComissoesGestorView.tsx', 'definicaoComissoes'],
  ['web/app/(app)/equipe/page.tsx', 'definicaoEquipe'],
  ['web/app/(app)/estoque/page.tsx', 'definicaoEstoqueProdutos'],
  ['web/app/(app)/estoque/page.tsx', 'definicaoEstoqueMovimentacoes'],
  ['web/app/(app)/financeiro/page.tsx', 'definicaoDespesas'],
  ['web/app/(app)/pacotes/page.tsx', 'definicaoPacotesCatalogo'],
  ['web/app/(app)/pacotes/page.tsx', 'definicaoPacotesVendidos'],
  ['web/app/(app)/pacotes/page.tsx', 'definicaoPacotesUtilizacao'],
  ['web/app/(app)/relatorios/page.tsx', 'definicaoRelatorio'],
  ['web/app/(app)/servicos/page.tsx', 'definicaoServicos'],
  ['web/app/(app)/vendas/page.tsx', 'definicaoVendas'],
];

describe('web exporta pelas definições compartilhadas', () => {
  for (const [arq, fn] of WEB) {
    it(`${arq} usa ${fn}`, () => {
      const src = ler(arq);
      expect(src).toContain(`${fn}(`);
      expect(src).not.toMatch(/columns=\{\[/);
    });
  }
});
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** reescrever `web/lib/export.ts` mantendo o visual (jsPDF: título, "Exportado em" via `dataHoraBR(new Date().toISOString())`, autoTable com `head: [def.colunas.map(c => c.cabecalho)]`, `body: linhasParaCelulas(...).map(r => r.map(String))`, mesmas cores; XLSX: `aoa_to_sheet([cabecalhos, ...linhasParaCelulas])`, `!cols` por `largura ?? 20`, aba `def.titulo.slice(0,31)`, arquivo `${def.arquivo}.xlsx`). `ExportButton` troca `filename/title/columns/getData` por `definicao`/`getLinhas`. Em cada página, montar a linha padrão a partir do array que já era passado em `getData` (mesmo array, mesmos filtros) e chamar a definição.
- [ ] **Step 4:** teste novo + `cd web && npx tsc --noEmit` + `cd web && npx vitest run`.
- [ ] **Step 5: Commit** — `refactor(exportacao/web): paginas usam definicoes de shared`.

---

### Task 5: Web — moeda única em todas as telas

**Files:**
- Modify: todo arquivo de `web/app`, `web/components`, `web/lib` que formata moeda (`grep -rn "style: 'currency'\|currency: 'BRL'\|fmtBRL\|formatBRL" web/app web/components web/lib`)
- Test: acrescentar a `web/tests/unit/exportacao-paridade.test.ts`

- [ ] **Step 1: Teste que falha** (acrescentar):

```ts
import { readdirSync, statSync } from 'fs';
function arquivos(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap(n => {
    const p = `${dir}/${n}`;
    return statSync(join(root, p)).isDirectory() ? arquivos(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
  });
}
describe('moeda única', () => {
  it('web não formata moeda com Intl/toLocaleString', () => {
    const ruins = ['web/app', 'web/components', 'web/lib'].flatMap(arquivos)
      .filter(a => /style:\s*'currency'|currency:\s*'BRL'/.test(ler(a)));
    expect(ruins).toEqual([]);
  });
});
```

- [ ] **Step 2:** rodar → FAIL (lista os arquivos).
- [ ] **Step 3:** trocar cada formatação por `formatarMoeda` de `@shared/moeda`; remover `fmtBRL` locais redundantes (ou fazê-los apontar para `formatarMoeda` quando o nome é usado em muitos pontos do mesmo arquivo). Onde um KPI possa estourar com o valor completo, garantir `whitespace-nowrap` e fonte responsiva (padrão já usado nos KPIs do Financeiro).
- [ ] **Step 4:** `cd web && npx tsc --noEmit` + `cd web && npx vitest run` (testes antigos que esperavam o ` ` do Intl: ajustar a expectativa para o espaço normal).
- [ ] **Step 5: Commit** — `refactor(moeda/web): formatarMoeda em todas as telas`.

---

### Task 6: App — geração e compartilhamento

**Files:**
- Modify: `mobile/package.json`, `mobile/package-lock.json` (deps novas)
- Create: `mobile/lib/exportar.ts`, `mobile/components/BotaoExportar.tsx`
- Test: `web/tests/unit/exportacao-app.test.ts`

**Interfaces:**
- Consumes: Task 2 (`montarHtmlTabela`, `linhasParaCelulas`, `DefinicaoExportacao`).
- Produces:
  - `exportarExcel<T>(def: DefinicaoExportacao<T>, linhas: T[]): Promise<void>`
  - `exportarPdf<T>(def, linhas): Promise<void>`
  - `<BotaoExportar definicao={def | null} getLinhas={() => T[]} cor?={string} />` — `definicao` nula esconde o botão.

- [ ] **Step 1: Dependências** — `cd mobile && npx expo install expo-print expo-sharing expo-file-system && npm install xlsx@^0.18.5`. Confirmar em `mobile/package.json` as versões compatíveis com o SDK 51 escolhidas pelo `expo install`. Este lock É commitado.

- [ ] **Step 2: Teste que falha**

```ts
// web/tests/unit/exportacao-app.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('app: geração de exportação', () => {
  const lib = ler('mobile/lib/exportar.ts');
  it('Excel com xlsx em base64 e compartilhar', () => {
    expect(lib).toMatch(/XLSX\.write\([^)]*type:\s*'base64'/);
    expect(lib).toContain('EncodingType.Base64');
    expect(lib).toContain('Sharing.shareAsync');
    expect(lib).toContain('linhasParaCelulas(');
  });
  it('PDF pelo HTML compartilhado e expo-print', () => {
    expect(lib).toContain('montarHtmlTabela(');
    expect(lib).toContain('Print.printToFileAsync');
  });
  it('avisa em português quando não dá para compartilhar', () => {
    expect(lib).toContain('Sharing.isAvailableAsync');
    expect(lib).toMatch(/Alert\.alert\(/);
  });
  it('botão pergunta Excel ou PDF', () => {
    const b = ler('mobile/components/BotaoExportar.tsx');
    expect(b).toContain("'Excel'");
    expect(b).toContain("'PDF'");
    expect(b).toContain('exportarExcel(');
    expect(b).toContain('exportarPdf(');
  });
});
```

- [ ] **Step 3:** rodar → FAIL.

- [ ] **Step 4: Implementar**

```ts
// mobile/lib/exportar.ts
import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { linhasParaCelulas, type DefinicaoExportacao } from '@shared/exportacao/tipos';
import { montarHtmlTabela } from '@shared/exportacao/pdf-html';

async function compartilhar(uri: string, mimeType: string, titulo: string) {
  if (!(await Sharing.isAvailableAsync())) {
    Alert.alert('Exportar', 'Este aparelho não permite compartilhar arquivos.');
    return;
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: titulo });
}

/** Gera a planilha (mesmas colunas do web) e abre o compartilhar. */
export async function exportarExcel<T>(def: DefinicaoExportacao<T>, linhas: T[]): Promise<void> {
  try {
    const ws = XLSX.utils.aoa_to_sheet([def.colunas.map(c => c.cabecalho), ...linhasParaCelulas(def, linhas)]);
    ws['!cols'] = def.colunas.map(c => ({ wch: c.largura ?? 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, def.titulo.slice(0, 31));
    const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const uri = `${FileSystem.cacheDirectory}${def.arquivo}.xlsx`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
    await compartilhar(uri, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', def.titulo);
  } catch (e) {
    Alert.alert('Exportar', `Não foi possível gerar a planilha: ${(e as Error).message}`);
  }
}

/** Gera o PDF (layout do web, via HTML compartilhado) e abre o compartilhar. */
export async function exportarPdf<T>(def: DefinicaoExportacao<T>, linhas: T[]): Promise<void> {
  try {
    const { uri } = await Print.printToFileAsync({ html: montarHtmlTabela(def, linhas, new Date()), width: 842, height: 595 });
    const destino = `${FileSystem.cacheDirectory}${def.arquivo}.pdf`;
    await FileSystem.deleteAsync(destino, { idempotent: true });
    await FileSystem.moveAsync({ from: uri, to: destino });
    await compartilhar(destino, 'application/pdf', def.titulo);
  } catch (e) {
    Alert.alert('Exportar', `Não foi possível gerar o PDF: ${(e as Error).message}`);
  }
}
```

```tsx
// mobile/components/BotaoExportar.tsx
import { useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, TouchableOpacity } from 'react-native';
import { Download } from 'lucide-react-native';
import type { DefinicaoExportacao } from '@shared/exportacao/tipos';
import { exportarExcel, exportarPdf } from '@/lib/exportar';

/**
 * Ícone de Download do cabeçalho: pergunta Excel ou PDF, gera com o que a tela
 * mostra (getLinhas) e abre o compartilhar. `definicao` nula esconde o botão.
 */
export function BotaoExportar<T>({ definicao, getLinhas, cor = '#6B7280' }: {
  definicao: DefinicaoExportacao<T> | null;
  getLinhas: () => T[];
  cor?: string;
}) {
  const [gerando, setGerando] = useState(false);
  if (!definicao) return null;

  async function gerar(tipo: 'Excel' | 'PDF') {
    setGerando(true);
    try {
      if (tipo === 'Excel') await exportarExcel(definicao!, getLinhas());
      else await exportarPdf(definicao!, getLinhas());
    } finally {
      setGerando(false);
    }
  }

  function escolher() {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancelar', 'Excel', 'PDF'], cancelButtonIndex: 0, title: 'Exportar' },
        i => { if (i === 1) gerar('Excel'); if (i === 2) gerar('PDF'); },
      );
    } else {
      Alert.alert('Exportar', 'Escolha o formato', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excel', onPress: () => gerar('Excel') },
        { text: 'PDF', onPress: () => gerar('PDF') },
      ]);
    }
  }

  return (
    <TouchableOpacity onPress={escolher} disabled={gerando} accessibilityLabel="Exportar"
      style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
      {gerando ? <ActivityIndicator size="small" color={cor} /> : <Download size={16} color={cor} strokeWidth={1.8} />}
    </TouchableOpacity>
  );
}
```

(Se o pacote de ícones do app tiver outro nome que não `lucide-react-native`, usar o mesmo import de `Download` que `mobile/app/(empresa)/financeiro.tsx` já usa.)

- [ ] **Step 5:** teste + `cd mobile && npx tsc --noEmit` (6 erros da baseline) + `cd web && npx vitest run`.
- [ ] **Step 6: Commit** — `git add mobile/package.json mobile/package-lock.json mobile/lib/exportar.ts mobile/components/BotaoExportar.tsx web/tests/unit/exportacao-app.test.ts`; `feat(exportacao/app): gerar Excel/PDF no aparelho e compartilhar`.

---

### Task 7: App — botão Exportar nas 9 telas

**Files:**
- Modify: `mobile/app/(empresa)/{agenda,clientes,comissoes,equipe,estoque,financeiro,pacotes,relatorios,servicos}.tsx`
- Test: acrescentar a `web/tests/unit/exportacao-paridade.test.ts`

**Interfaces:**
- Consumes: Task 3 (definições e tipos de linha), Task 6 (`BotaoExportar`).

Regras por tela (montar a linha padrão a partir do array que a tela JÁ RENDERIZA, com os mesmos filtros/período/aba; resolver rótulos de status/categoria com os mapas que a própria tela já usa):

| Tela | Definição | Observação |
|---|---|---|
| agenda.tsx | `definicaoAgenda(dia exibido 'yyyy-MM-dd')` | lista do dia sem cancelados (igual ao web `agsVisiveis`) |
| clientes.tsx | `definicaoClientes()` | lista filtrada visível |
| comissoes.tsx | `definicaoComissoes(rótulo do período)` | só na visão de quem vê todas (`comissoes.ver_todas`); linhas = comissões do período |
| equipe.tsx | `definicaoEquipe(mês atual 'yyyy-MM')` | |
| estoque.tsx | produtos → `definicaoEstoqueProdutos()`; movimentações → `definicaoEstoqueMovimentacoes(mês)` | conforme a aba visível; se a tela não tiver aba de movimentações, só produtos |
| financeiro.tsx | `definicaoDespesas(mês exibido)` | substitui o `Download` sem ação existente (~linha 1477) |
| pacotes.tsx | catálogo / vendidos / utilização | conforme a aba; aba sem equivalente → `definicao={null}` |
| relatorios.tsx | `definicaoRelatorio(aba, rótulo da aba, rótulo do período)` | substitui o `Download` existente (~336); aba `avaliacoes` → `definicao={null}` |
| servicos.tsx | `definicaoServicos()` | |

- [ ] **Step 1: Teste que falha** (acrescentar):

```ts
const APP: [string, string][] = [
  ['mobile/app/(empresa)/agenda.tsx', 'definicaoAgenda'],
  ['mobile/app/(empresa)/clientes.tsx', 'definicaoClientes'],
  ['mobile/app/(empresa)/comissoes.tsx', 'definicaoComissoes'],
  ['mobile/app/(empresa)/equipe.tsx', 'definicaoEquipe'],
  ['mobile/app/(empresa)/estoque.tsx', 'definicaoEstoqueProdutos'],
  ['mobile/app/(empresa)/financeiro.tsx', 'definicaoDespesas'],
  ['mobile/app/(empresa)/pacotes.tsx', 'definicaoPacotesCatalogo'],
  ['mobile/app/(empresa)/relatorios.tsx', 'definicaoRelatorio'],
  ['mobile/app/(empresa)/servicos.tsx', 'definicaoServicos'],
];
describe('app exporta pelas mesmas definições', () => {
  for (const [arq, fn] of APP) {
    it(`${arq} usa ${fn} e BotaoExportar`, () => {
      const src = ler(arq);
      expect(src).toContain(`${fn}(`);
      expect(src).toContain('<BotaoExportar');
    });
  }
  it('área da profissional não ganhou exportação', () => {
    for (const n of ['agenda.tsx', 'comissoes.tsx', 'inicio.tsx', 'pacotes.tsx', 'servicos.tsx']) {
      expect(ler(`mobile/app/(profissional)/${n}`)).not.toContain('BotaoExportar');
    }
  });
});
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** ligar as 9 telas (botão no cabeçalho, mesmo lugar/visual do ícone que já existe em Financeiro/Relatórios).
- [ ] **Step 4:** teste + `cd mobile && npx tsc --noEmit` (baseline) + `cd web && npx vitest run`.
- [ ] **Step 5: Commit** — `feat(exportacao/app): botao Exportar nas 9 telas`.

---

### Task 8: App — moeda única

**Files:**
- Modify: todo arquivo de `mobile/app`, `mobile/components`, `mobile/lib`, `mobile/hooks` com formatação de moeda própria ou "k" (`grep -rn "style: 'currency'\|currency: 'BRL'\|formatBRL\|fmtBRL\|}k\`" mobile/app mobile/components mobile/lib mobile/hooks`)
- Test: acrescentar a `web/tests/unit/exportacao-paridade.test.ts`

- [ ] **Step 1: Teste que falha** (acrescentar):

```ts
describe('moeda única no app', () => {
  it('app não formata moeda com Intl nem abrevia "k"', () => {
    const ruins = ['mobile/app', 'mobile/components', 'mobile/lib', 'mobile/hooks'].flatMap(arquivos)
      .filter(a => /style:\s*'currency'|currency:\s*'BRL'|\}k`/.test(ler(a)));
    expect(ruins).toEqual([]);
  });
});
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** trocar por `formatarMoeda` (`@shared/moeda`); remover a abreviação de `mobile/app/(empresa)/financeiro.tsx` (~93) e funções `formatBRL`/`fmtBRL` locais. Nos `Text` de valores em cartões/KPIs, `numberOfLines={1}` + `adjustsFontSizeToFit` + `minimumFontScale={0.6}`.
- [ ] **Step 4:** teste + `cd mobile && npx tsc --noEmit` (baseline) + `cd web && npx vitest run`.
- [ ] **Step 5: Commit** — `refactor(moeda/app): formatarMoeda em todas as telas, sem abreviar`.

---

### Task 9: Documentação e revisão final

**Files:** `CLAUDE.md`, `docs/superpowers/specs/2026-10-07-paridade-fase2c-exportacao-design.md` (status)

- [ ] **Step 1:** varredura: `grep -rn "style: 'currency'\|currency: 'BRL'" web/app web/components web/lib mobile/app mobile/components mobile/lib mobile/hooks` → vazio.
- [ ] **Step 2:** `cd web && npx tsc --noEmit && npx vitest run`; `cd mobile && npx tsc --noEmit` (baseline).
- [ ] **Step 3:** revisão final de branch (opus) focada em: colunas idênticas web × app × versão antiga do web; montagem das linhas padrão em cada tela (mesmo array/filtro que a tela mostra); geração e limpeza de arquivos temporários no app; nenhum valor de dinheiro cortado/abreviado.
- [ ] **Step 4:** CLAUDE.md — sessão "2026-10-07 — Paridade Fase 2C" no formato das anteriores; pendência: testar Excel/PDF/compartilhar num aparelho real no próximo build (deps nativas novas: `expo-print`, `expo-sharing`, `expo-file-system`).
- [ ] **Step 5: Commit** — `docs: auditoria da paridade fase 2C`.
