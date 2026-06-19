'use client';

import { AlertTriangle, Trash2, X } from 'lucide-react';

interface ConfirmDialogProps {
  open:           boolean;
  title:          string;
  message:        string;
  confirmLabel?:  string;
  variant?:       'danger' | 'warning';
  loading?:       boolean;
  onConfirm:      () => void;
  onCancel:       () => void;
}

export function ConfirmDialog({
  open, title, message,
  confirmLabel = 'Confirmar',
  variant = 'danger',
  loading = false,
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  const isDanger  = variant === 'danger';
  const iconBg    = isDanger ? 'var(--color-rose-soft)'  : 'var(--color-amber-soft)';
  const iconColor = isDanger ? 'var(--color-rose)'       : 'var(--color-amber)';
  const btnBg     = isDanger ? 'var(--color-rose)'       : 'var(--color-amber)';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div
        className="relative rounded-2xl shadow-xl w-full max-w-sm"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        {/* Header */}
        <div className="flex items-start gap-4 p-6 pb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: iconBg }}
          >
            {isDanger
              ? <Trash2 size={18} style={{ color: iconColor }} strokeWidth={2} />
              : <AlertTriangle size={18} style={{ color: iconColor }} strokeWidth={2} />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold" style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-sans)' }}>
              {title}
            </h3>
            <p className="text-sm mt-1" style={{ color: 'var(--color-ink3)', fontFamily: 'var(--font-sans)' }}>
              {message}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition flex-shrink-0"
            style={{ color: 'var(--color-ink4)' }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Ações */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 h-10 rounded-xl text-sm font-semibold transition disabled:opacity-50"
            style={{
              background: 'var(--color-bg2)',
              border:     '1px solid var(--color-border)',
              color:      'var(--color-ink2)',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 h-10 rounded-xl text-sm font-bold text-white transition disabled:opacity-50"
            style={{ background: btnBg }}
          >
            {loading ? 'Aguarde...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
