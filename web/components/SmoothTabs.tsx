'use client';

import { useEffect, useRef, useState } from 'react';

export type SmoothTabItem = {
  key: string;
  label: React.ReactNode;
  icon?: React.ComponentType<{ size?: number }>;
  /** Cor do indicador quando esta aba está ativa (default: var(--color-primary) / var(--color-accent)) */
  activeColor?: string;
};

/**
 * SmoothTabs — barra de abas com indicador que desliza suavemente até a
 * aba ativa (em vez de só trocar cor/borda instantaneamente).
 *
 * variant 'pill'      — indicador preenchido atrás do texto (filtros)
 * variant 'underline' — indicador fino embaixo do texto (abas principais)
 */
export function SmoothTabs({
  tabs, active, onChange, variant = 'pill', className = '', fundo = 'branco',
}: {
  tabs: SmoothTabItem[];
  active: string;
  onChange: (key: string) => void;
  variant?: 'pill' | 'underline';
  /** Pílula: 'branco' (filtros, padrão) ou 'neutro' (seletor de visão como o Semana/Mês da Comanda, visual antigo). */
  fundo?: 'branco' | 'neutro';
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const btn = btnRefs.current[active];
    const container = containerRef.current;
    if (btn && container) {
      const cRect = container.getBoundingClientRect();
      const bRect = btn.getBoundingClientRect();
      setIndicator({ left: bRect.left - cRect.left, width: bRect.width });
    }
  }, [active, tabs]);

  const isPill = variant === 'pill';
  const activeItem = tabs.find(t => t.key === active);
  const indicatorColor = activeItem?.activeColor ?? (isPill ? 'var(--color-primary)' : 'var(--color-accent)');

  return (
    <div className={`overflow-x-auto no-scrollbar w-full ${className}`} style={{ touchAction: 'pan-x', overscrollBehaviorX: 'contain' }}>
      <div ref={containerRef}
        className={`relative flex gap-1 whitespace-nowrap w-fit ${isPill ? `p-1 rounded-full border border-border ${fundo === 'neutro' ? 'bg-bg' : 'bg-surface'}` : 'border-b border-border'}`}>
        {indicator && (
          <div
            className={isPill ? 'absolute rounded-full shadow-sm' : 'absolute rounded-full'}
            style={{
              left: indicator.left,
              width: indicator.width,
              top: isPill ? 4 : undefined,
              bottom: isPill ? 4 : -1,
              height: isPill ? undefined : 2,
              background: indicatorColor,
              transition: 'left 300ms cubic-bezier(.2,.9,.3,1), width 300ms cubic-bezier(.2,.9,.3,1), background-color 200ms',
            }}
          />
        )}
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            ref={el => { btnRefs.current[t.key] = el; }}
            onClick={() => onChange(t.key)}
            style={active === t.key && !isPill ? { color: t.activeColor ?? 'var(--color-accent)' } : undefined}
            className={
              isPill
                ? `relative z-10 flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors duration-200 ${active === t.key ? 'text-white' : `${fundo === 'neutro' ? 'text-text-3' : 'text-text-2'} hover:text-text`}`
                :`relative z-10 flex-shrink-0 flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold transition-colors duration-200 ${active === t.key ? '' : 'text-text-3 hover:text-text'}`
            }
          >
            {t.icon && <t.icon size={14} />}
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
