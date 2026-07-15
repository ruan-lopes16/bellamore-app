'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  buildCnpjDespesaDuplicateKey,
  parseCnpjFinanceiroWorkbook,
  type CnpjImportDespesa,
  type CnpjImportPreview,
} from '@/lib/import/cnpj-financeiro';

type ImportItem = CnpjImportDespesa & { duplicate: boolean };
type ImportPreview = Omit<CnpjImportPreview, 'items'> & { items: ImportItem[] };
type ExistingDespesaRow = {
  descricao: string | null;
  categoria: string | null;
  valor: number | string | null;
  data_pagamento: string | null;
};

const supabase = createClient();

function fmtBRL(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value);
}

export function CnpjFinanceiroImporter({
  empresaId,
  onClose,
  onImported,
}: {
  empresaId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [doneMessage, setDoneMessage] = useState('');

  const novos = useMemo(
    () => preview?.items.filter(item => !item.duplicate) ?? [],
    [preview],
  );
  const duplicados = useMemo(
    () => preview?.items.filter(item => item.duplicate) ?? [],
    [preview],
  );

  async function handleFile(file: File | null) {
    setError('');
    setDoneMessage('');
    setPreview(null);
    if (!file) return;

    try {
      setLoading(true);
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const parsed = parseCnpjFinanceiroWorkbook(workbook);
      const existingKeys = await loadExistingKeys();

      setPreview({
        ...parsed,
        items: parsed.items.map(item => ({
          ...item,
          duplicate: existingKeys.has(buildCnpjDespesaDuplicateKey(item)),
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel ler a planilha.');
    } finally {
      setLoading(false);
    }
  }

  async function loadExistingKeys() {
    const { data, error: queryError } = await supabase
      .from('despesas')
      .select('descricao,categoria,valor,data_pagamento,status')
      .eq('empresa_id', empresaId)
      .eq('status', 'pago')
      .gte('data_pagamento', '2026-01-01')
      .lte('data_pagamento', '2026-05-31');

    if (queryError) throw queryError;

    return new Set(((data ?? []) as ExistingDespesaRow[]).map(row => buildCnpjDespesaDuplicateKey({
      descricao: String(row.descricao ?? ''),
      categoria: String(row.categoria ?? ''),
      valor: Number(row.valor),
      data_pagamento: String(row.data_pagamento ?? ''),
      status: 'pago',
    })));
  }

  async function confirmarImportacao() {
    if (novos.length === 0) return;

    setError('');
    setDoneMessage('');
    setImporting(true);

    const payload = novos.map(item => ({
      empresa_id: empresaId,
      descricao: item.descricao,
      categoria: item.categoria,
      valor: item.valor,
      recorrente: false,
      periodicidade: null,
      data_vencimento: item.data_vencimento,
      data_pagamento: item.data_pagamento,
      status: 'pago' as const,
    }));

    const { error: insertError } = await supabase.from('despesas').insert(payload);
    setImporting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setDoneMessage(`${payload.length} despesas importadas.`);
    onImported();
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div>
            <p className="text-xs text-text-4 uppercase tracking-wide font-semibold">Financeiro</p>
            <h2 className="font-serif text-xl text-text">Importar CNPJ</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
          <label className="flex items-center justify-center gap-3 min-h-24 border border-dashed border-border rounded-2xl bg-bg cursor-pointer hover:border-accent transition">
            <FileSpreadsheet size={20} className="text-accent"/>
            <span className="text-sm font-semibold text-text-2">
              {loading ? 'Lendo planilha...' : 'Selecionar planilha .xlsx'}
            </span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="sr-only"
              onChange={event => handleFile(event.target.files?.[0] ?? null)}
              disabled={loading || importing}
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red/20 bg-red-soft px-4 py-3 text-sm text-red">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0"/>
              <p>{error}</p>
            </div>
          )}

          {doneMessage && (
            <div className="flex items-start gap-2 rounded-xl border border-green/20 bg-green-soft px-4 py-3 text-sm text-green">
              <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0"/>
              <p>{doneMessage}</p>
            </div>
          )}

          {preview && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SummaryCard label="Novas" value={String(novos.length)} sub={fmtBRL(novos.reduce((sum, item) => sum + item.valor, 0))}/>
                <SummaryCard label="Duplicadas" value={String(duplicados.length)} sub="Nao serao reinseridas"/>
                <SummaryCard label="Total lido" value={String(preview.summary.count)} sub={fmtBRL(preview.summary.total)}/>
              </div>

              {preview.warnings.length > 0 && (
                <div className="rounded-xl border border-amber/20 bg-amber-soft px-4 py-3 text-xs text-amber">
                  {preview.warnings.map(warning => <p key={warning}>{warning}</p>)}
                </div>
              )}

              <div className="border border-border rounded-2xl overflow-hidden">
                <div className="grid grid-cols-[1fr_120px_110px] gap-3 px-4 py-2 bg-bg text-[10px] font-bold text-text-4 uppercase tracking-wide">
                  <span>Despesa</span>
                  <span>Mes</span>
                  <span className="text-right">Valor</span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {preview.items.map((item, index) => (
                    <div key={`${item.sheetName}-${item.descricao}-${index}`}
                      className={`grid grid-cols-[1fr_120px_110px] gap-3 px-4 py-3 text-xs border-t border-border ${item.duplicate ? 'opacity-50' : ''}`}>
                      <div className="min-w-0">
                        <p className="font-semibold text-text truncate">{item.descricao}</p>
                        <p className="text-text-4 truncate">{item.categoria}{item.duplicate ? ' - duplicada' : ''}</p>
                      </div>
                      <span className="text-text-3">{item.data_pagamento.slice(5, 7)}/2026</span>
                      <span className="text-right font-bold text-red">{fmtBRL(item.valor)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-5 border-t border-border flex-shrink-0">
          <button onClick={onClose}
            className="h-10 px-4 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
            Fechar
          </button>
          <button onClick={confirmarImportacao} disabled={novos.length === 0 || importing || loading}
            className="h-10 px-4 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50 flex items-center gap-2">
            {importing ? <Loader2 size={14} className="animate-spin"/> : <Upload size={14}/>}
            {importing ? 'Importando...' : `Importar ${novos.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-border bg-bg px-4 py-3">
      <p className="text-[10px] font-bold text-text-4 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-text mt-1">{value}</p>
      <p className="text-xs text-text-3 mt-0.5">{sub}</p>
    </div>
  );
}
