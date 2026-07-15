import { utils, type WorkBook } from 'xlsx';

export type CnpjImportDespesa = {
  sheetName: string;
  monthKey: string;
  descricao: string;
  categoria: string;
  valor: number;
  status: 'pago';
  recorrente: false;
  data_pagamento: string;
  data_vencimento: string;
};

export type CnpjImportSummaryEntry = {
  count: number;
  total: number;
};

export type CnpjImportPreview = {
  items: CnpjImportDespesa[];
  warnings: string[];
  summary: {
    count: number;
    total: number;
    byMonth: Record<string, CnpjImportSummaryEntry>;
    byCategory: Record<string, CnpjImportSummaryEntry>;
  };
};

type SheetConfig = {
  sheetName: string;
  monthKey: string;
  date: string;
  monthLabel: string;
};

const TARGET_SHEETS: SheetConfig[] = [
  { sheetName: '01-Jan', monthKey: '2026-01', date: '2026-01-01', monthLabel: 'Janeiro' },
  { sheetName: '02-Fev', monthKey: '2026-02', date: '2026-02-01', monthLabel: 'Fevereiro' },
  { sheetName: '03-Mar', monthKey: '2026-03', date: '2026-03-01', monthLabel: 'Marco' },
  { sheetName: '04-Abr', monthKey: '2026-04', date: '2026-04-01', monthLabel: 'Abril' },
  { sheetName: '05-Mai', monthKey: '2026-05', date: '2026-05-01', monthLabel: 'Maio' },
];

const ANA_EXPENSE_CATEGORY_COL = 14;
const ANA_EXPENSE_DESCRIPTION_COL = 15;
const ANA_EXPENSE_VALUE_COL = 16;

const IGNORED_LABELS = [
  'TOTAL',
  'RECEITAS',
  'DESPESAS OPERACIONAIS',
  'LUCRO',
  'RETIRADA',
  'STATUS',
  'TIPO',
  'VALOR',
  'DESCRICAO',
  'CATEGORIA',
];

export function parseCnpjFinanceiroWorkbook(workbook: WorkBook): CnpjImportPreview {
  const rowsBySheet = Object.fromEntries(
    TARGET_SHEETS.map(config => [
      config.sheetName,
      workbook.Sheets[config.sheetName]
        ? utils.sheet_to_json<unknown[]>(workbook.Sheets[config.sheetName], { header: 1, defval: null, raw: true })
        : [],
    ]),
  );

  return parseCnpjFinanceiroRowsBySheet(rowsBySheet);
}

export function parseCnpjFinanceiroRowsBySheet(sheets: Record<string, unknown[][]>): CnpjImportPreview {
  const items: CnpjImportDespesa[] = [];
  const warnings: string[] = [];

  for (const config of TARGET_SHEETS) {
    const rows = sheets[config.sheetName] ?? [];
    if (rows.length === 0) {
      warnings.push(`${config.sheetName}: aba nao encontrada ou vazia.`);
      continue;
    }

    for (const row of rows) {
      const categoria = cleanText(row[ANA_EXPENSE_CATEGORY_COL]);
      const descricaoCell = cleanText(row[ANA_EXPENSE_DESCRIPTION_COL]);
      const valor = parseCurrencyCell(row[ANA_EXPENSE_VALUE_COL]);
      const proLabore = findProLaboreValue(row);

      if (proLabore !== null) {
        items.push(buildDespesa({
          config,
          categoria: 'Comissao',
          descricao: `Comissao - ${config.monthLabel}/2026`,
          valor: proLabore,
        }));
        continue;
      }

      if (!categoria || isIgnoredLabel(categoria)) continue;
      if (valor === null) continue;

      items.push(buildDespesa({
        config,
        categoria,
        descricao: descricaoCell || categoria,
        valor,
      }));
    }
  }

  return {
    items,
    warnings,
    summary: summarize(items),
  };
}

export function buildCnpjDespesaDuplicateKey(item: Pick<CnpjImportDespesa, 'descricao' | 'categoria' | 'valor' | 'data_pagamento' | 'status'>): string {
  return [
    item.descricao.trim(),
    item.categoria.trim(),
    roundMoney(item.valor).toFixed(2),
    item.data_pagamento,
    item.status,
  ].join('|');
}

function buildDespesa({
  config,
  categoria,
  descricao,
  valor,
}: {
  config: SheetConfig;
  categoria: string;
  descricao: string;
  valor: number;
}): CnpjImportDespesa {
  return {
    sheetName: config.sheetName,
    monthKey: config.monthKey,
    descricao: descricao.trim(),
    categoria: categoria.trim(),
    valor: roundMoney(valor),
    status: 'pago',
    recorrente: false,
    data_pagamento: config.date,
    data_vencimento: config.date,
  };
}

function summarize(items: CnpjImportDespesa[]): CnpjImportPreview['summary'] {
  const byMonth: Record<string, CnpjImportSummaryEntry> = {};
  const byCategory: Record<string, CnpjImportSummaryEntry> = {};
  let total = 0;

  for (const item of items) {
    total += item.valor;
    addSummary(byMonth, item.monthKey, item.valor);
    addSummary(byCategory, item.categoria, item.valor);
  }

  return {
    count: items.length,
    total: roundMoney(total),
    byMonth,
    byCategory,
  };
}

function addSummary(target: Record<string, CnpjImportSummaryEntry>, key: string, value: number) {
  target[key] ??= { count: 0, total: 0 };
  target[key].count += 1;
  target[key].total = roundMoney(target[key].total + value);
}

function findProLaboreValue(row: unknown[]): number | null {
  const hasProLabore = row.some(cell => normalize(cleanText(cell)).includes('PRO-LABORE'));
  if (!hasProLabore) return null;
  return parseCurrencyCell(row[ANA_EXPENSE_VALUE_COL]);
}

function isIgnoredLabel(value: string) {
  const normalized = normalize(value);
  return IGNORED_LABELS.some(label => normalized.includes(label));
}

function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function parseCurrencyCell(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? roundMoney(value) : null;
  }

  if (typeof value !== 'string') return null;

  const cleaned = value
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\s/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!cleaned) return null;

  const commaIndex = cleaned.lastIndexOf(',');
  const dotIndex = cleaned.lastIndexOf('.');
  const dotCount = cleaned.match(/\./g)?.length ?? 0;
  let normalized = cleaned;

  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (commaIndex >= 0) {
    normalized = cleaned.replace(',', '.');
  } else if (dotIndex >= 0) {
    const digitsAfterDot = cleaned.length - dotIndex - 1;
    if (dotCount > 1 || digitsAfterDot === 3) {
      normalized = cleaned.replace(/\./g, '');
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? roundMoney(parsed) : null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
