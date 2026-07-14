'use client';

/**
 * @file ExportButton.tsx
 * Botão dropdown de exportação reutilizável.
 *
 * Renderiza um botão "Exportar ▾" que abre um mini-menu com
 * as opções Excel (.xlsx) e PDF (.pdf).
 *
 * @example
 * <ExportButton
 *   filename="clientes"
 *   title="Clientes"
 *   columns={[{ header: 'Nome', accessor: r => r.nome }]}
 *   getData={() => clientes}
 * />
 */

import { useState, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { exportToXLSX, exportToPDF, type ExportColumn } from '@/lib/export';

interface ExportButtonProps<T> {
  filename: string;
  title: string;
  columns: ExportColumn<T>[];
  getData: () => T[];
  /** Ajusta a aparencia do botao quando ele ocupa o canto do cabecalho mobile. */
  variant?: 'default' | 'mobileHeader';
  /** Classes aplicadas ao contêiner, úteis para o posicionamento responsivo. */
  className?: string;
}

export function ExportButton<T>({
  filename,
  title,
  columns,
  getData,
  variant = 'default',
  className,
}: ExportButtonProps<T>) {
  const [open,      setOpen]      = useState(false);
  const [loading,   setLoading]   = useState<'xlsx' | 'pdf' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleExport(tipo: 'xlsx' | 'pdf') {
    setLoading(tipo);
    setOpen(false);
    const data = getData();
    try {
      if (tipo === 'xlsx') {
        await exportToXLSX(filename, title, columns, data);
      } else {
        await exportToPDF(filename, title, columns, data);
      }
    } finally {
      setLoading(null);
    }
  }

  const btnCls = `flex items-center gap-2 h-10 px-4 rounded-xl border border-border bg-surface text-text-2 text-sm font-semibold hover:border-accent hover:text-accent transition ${
    variant === 'mobileHeader' ? 'bm-mobile-header-export-button' : ''
  }`;

  const iconSize = 15;

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <button
        onClick={() => setOpen(v => !v)}
        disabled={!!loading}
        className={btnCls}
      >
        {loading ? (
          <Loader2 size={iconSize} className="animate-spin"/>
        ) : (
          <Download size={iconSize}/>
        )}
        {loading ? 'Exportando...' : 'Exportar'}
        {!loading && (
          <svg width="10" height="10" viewBox="0 0 10 10" className="opacity-50">
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-44 bg-surface border border-border rounded-xl shadow-lg z-20 overflow-hidden">
          <button
            onClick={() => handleExport('xlsx')}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-text-2 hover:bg-bg hover:text-text transition text-left"
          >
            <FileSpreadsheet size={15} className="text-green flex-shrink-0"/>
            Excel (.xlsx)
          </button>
          <div className="h-px bg-border mx-3"/>
          <button
            onClick={() => handleExport('pdf')}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-text-2 hover:bg-bg hover:text-text transition text-left"
          >
            <FileText size={15} className="text-red flex-shrink-0"/>
            PDF (.pdf)
          </button>
        </div>
      )}
    </div>
  );
}
