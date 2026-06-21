'use client';

/**
 * Primitivos visuais Bellamore — usados em todas as páginas.
 * Espelha os componentes do design handoff (tokens.jsx).
 */

import React from 'react';

// ── Avatar com gradiente por hue ─────────────────────────────
export function BmAvatar({
  initials, hue = 0, size = 44, ring = false,
}: { initials: string; hue?: number; size?: number; ring?: boolean }) {
  const c1 = `oklch(0.55 0.16 ${hue})`;
  const c2 = `oklch(0.42 0.17 ${hue})`;
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.32, flexShrink: 0,
      background: `linear-gradient(140deg, ${c1}, ${c2})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 700,
      fontSize: size * 0.34, letterSpacing: 0.2,
      boxShadow: ring
        ? '0 0 0 3px var(--color-surface), 0 0 0 6px var(--color-accent-soft)'
        : '0 1px 2px rgba(44,23,80,0.05)',
    }}>
      {initials}
    </div>
  );
}

// ── Avatar hue a partir do nome ──────────────────────────────
export function hueFromName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
export function initialsFromName(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

// ── Status chip ───────────────────────────────────────────────
const STATUS_TONE: Record<string, [string, string]> = {
  confirmado: ['var(--color-green)',   'var(--color-green-soft)'],
  agendado:   ['var(--color-accent)',  'var(--color-accent-soft)'],
  concluido:  ['var(--color-primary)', 'var(--color-primary-soft)'],
  cancelado:  ['var(--color-rose)',    'var(--color-rose-soft)'],
  faltou:     ['var(--color-amber)',   'var(--color-amber-soft)'],
  pendente:   ['var(--color-amber)',   'var(--color-amber-soft)'],
  pago:       ['var(--color-green)',   'var(--color-green-soft)'],
};
const STATUS_LABEL: Record<string, string> = {
  confirmado: 'Confirmado', agendado: 'Agendado', concluido: 'Concluído',
  cancelado: 'Cancelado', faltou: 'Faltou', pendente: 'Pendente', pago: 'Pago',
};

export function BmStatusChip({ status }: { status: string }) {
  const [color, bg] = STATUS_TONE[status] ?? ['var(--color-ink3)', 'var(--color-bg2)'];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, letterSpacing: 0.2,
      padding: '4px 9px', borderRadius: 999,
      color, background: bg, lineHeight: 1, whiteSpace: 'nowrap',
    }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ── Chip genérico ─────────────────────────────────────────────
type Tone = 'primary' | 'accent' | 'green' | 'amber' | 'rose' | 'neutral';
const TONE_MAP: Record<Tone, [string, string]> = {
  primary: ['var(--color-primary)', 'var(--color-primary-soft)'],
  accent:  ['var(--color-accent)',  'var(--color-accent-soft)'],
  green:   ['var(--color-green)',   'var(--color-green-soft)'],
  amber:   ['var(--color-amber)',   'var(--color-amber-soft)'],
  rose:    ['var(--color-rose)',    'var(--color-rose-soft)'],
  neutral: ['var(--color-ink2)',    'var(--color-bg2)'],
};
export function BmChip({ children, tone = 'neutral', solid = false }: {
  children: React.ReactNode; tone?: Tone; solid?: boolean;
}) {
  const [fg, bg] = TONE_MAP[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 11,
      letterSpacing: 0.2, padding: '4px 9px', borderRadius: 999,
      color: solid ? '#fff' : fg, background: solid ? fg : bg,
      lineHeight: 1, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

// ── Cabeçalho de página ───────────────────────────────────────
export function BmPageHeader({ label, title, children }: {
  label?: string; title: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
      <div>
        {label && (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>
            {label}
          </p>
        )}
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>
          {title}
        </h1>
      </div>
      {children && <div className="flex flex-wrap gap-2 sm:pt-1">{children}</div>}
    </div>
  );
}

// ── Label de seção ────────────────────────────────────────────
export function BmSectionLabel({ children, action, onAction }: {
  children: React.ReactNode; action?: string; onAction?: () => void;
}) {
  return (
    <div className="flex items-baseline justify-between pb-3">
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        {children}
      </span>
      {action && (
        <button onClick={onAction} style={{ fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 700, color: 'var(--color-accent)' }}>
          {action}
        </button>
      )}
    </div>
  );
}

// ── Card base ─────────────────────────────────────────────────
export function BmCard({ children, pad = 16, style = {}, onClick, staggerIdx }: {
  children: React.ReactNode; pad?: number; style?: React.CSSProperties;
  onClick?: () => void; staggerIdx?: number;
}) {
  const base: React.CSSProperties = {
    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    borderRadius: 20, boxShadow: '0 2px 6px rgba(44,23,80,0.06)',
    padding: pad, boxSizing: 'border-box', ...style,
  };
  const staggerStyle: React.CSSProperties = staggerIdx !== undefined
    ? { '--bm-i': staggerIdx, '--bm-step': '65ms' } as React.CSSProperties
    : {};

  if (onClick) return (
    <button onClick={onClick} className={staggerIdx !== undefined ? 'bm-stagger w-full text-left' : 'w-full text-left'} style={base}>
      {children}
    </button>
  );
  return (
    <div className={staggerIdx !== undefined ? 'bm-stagger' : undefined} style={{ ...base, ...staggerStyle }}>
      {children}
    </div>
  );
}

// ── Botão icon (surface / primary / accent) ───────────────────
export function BmIconBtn({ icon: Icon, onClick, tone = 'surface', badge = false, size = 44 }: {
  icon: React.ElementType; onClick?: () => void; tone?: 'surface' | 'primary' | 'accent';
  badge?: boolean; size?: number;
}) {
  const bg = tone === 'surface' ? 'var(--color-surface)' : tone === 'accent' ? 'var(--color-accent)' : 'var(--color-primary)';
  const fg = tone === 'surface' ? 'var(--color-ink2)' : '#fff';
  return (
    <button onClick={onClick} className="press flex-shrink-0 relative flex items-center justify-center"
      style={{ width: size, height: size, borderRadius: 16, background: bg, boxShadow: tone === 'surface' ? '0 2px 6px rgba(44,23,80,0.06)' : '0 6px 20px rgba(44,23,80,0.15)', border: tone === 'surface' ? '1px solid var(--color-border)' : 'none' }}>
      <Icon size={size * 0.44} style={{ color: fg }} strokeWidth={2} />
      {badge && <span className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ background: 'var(--color-rose)', border: `2px solid ${bg}` }} />}
    </button>
  );
}

// ── Botão primário ────────────────────────────────────────────
export function BmPrimaryBtn({ children, onClick, tone = 'primary', disabled = false }: {
  children: React.ReactNode; onClick?: () => void; tone?: 'primary' | 'green' | 'rose' | 'accent'; disabled?: boolean;
}) {
  const bg = tone === 'green' ? 'var(--color-green)' : tone === 'rose' ? 'var(--color-rose)' : tone === 'accent' ? 'var(--color-accent)' : 'var(--color-primary)';
  return (
    <button onClick={onClick} disabled={disabled} className="press w-full"
      style={{ background: bg, color: '#fff', borderRadius: 16, padding: '14px 16px', fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, boxShadow: `0 6px 20px rgba(44,23,80,0.15)`, opacity: disabled ? 0.6 : 1, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      {children}
    </button>
  );
}

// ── Toggle switch ─────────────────────────────────────────────
export function BmToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="press flex-shrink-0"
      style={{ width: 50, height: 28, borderRadius: 999, background: value ? 'var(--color-accent)' : 'var(--color-bg2)', position: 'relative', transition: 'background .2s ease', border: 'none', cursor: 'pointer', boxShadow: '0 1px 2px rgba(44,23,80,0.05)' }}>
      <div style={{ position: 'absolute', top: 3, left: value ? 24 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', boxShadow: '0 2px 6px rgba(44,23,80,0.2)', transition: 'left .25s cubic-bezier(.2,.9,.3,1)' }} />
    </button>
  );
}

// ── Input de texto ────────────────────────────────────────────
export function BmInput({ label, value, onChange, placeholder, type = 'text', mask }: {
  label?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; mask?: (v: string) => string;
}) {
  return (
    <div>
      {label && <label style={{ display: 'block', fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{label}</label>}
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(mask ? mask(e.target.value) : e.target.value)}
        style={{ display: 'block', width: '100%', height: 50, padding: '0 14px', borderRadius: 16, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--color-ink)', outline: 'none', boxSizing: 'border-box' }}
        onFocus={e => { e.target.style.borderColor = 'var(--color-accent)'; e.target.style.boxShadow = '0 0 0 3px var(--color-accent-soft)'; }}
        onBlur={e => { e.target.style.borderColor = 'var(--color-border)'; e.target.style.boxShadow = 'none'; }}
      />
    </div>
  );
}

// ── Row de item de lista (padrão Mais/Configurações) ──────────
export function BmListRow({ icon: Icon, fg, bg, title, sub, chevron = true, onClick, last = false, right }: {
  icon: React.ElementType; fg: string; bg: string; title: string; sub?: string;
  chevron?: boolean; onClick?: () => void; last?: boolean; right?: React.ReactNode;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={onClick ? 'press w-full text-left' : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 14px', borderBottom: last ? 'none' : '1px solid var(--color-border-soft)', width: '100%', border: last ? 'none' : undefined, borderBottomWidth: last ? undefined : 1, borderBottomStyle: last ? undefined : 'solid', borderBottomColor: last ? undefined : 'var(--color-border-soft)', background: 'transparent', cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ width: 38, height: 38, borderRadius: 12, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={19} style={{ color: fg }} strokeWidth={1.9} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: 'var(--color-ink)' }}>{title}</div>
        {sub && <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11.5, color: 'var(--color-ink3)', marginTop: 1 }}>{sub}</div>}
      </div>
      {right}
      {chevron && !right && <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink4)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>}
    </Tag>
  );
}

// ── Toast simples (client-side) ───────────────────────────────
export function BmToast({ message, tone = 'green' }: { message: string; tone?: 'green' | 'rose' | 'primary' }) {
  const dot = tone === 'green' ? 'var(--color-green)' : tone === 'rose' ? 'var(--color-rose)' : 'var(--color-primary)';
  return (
    <div style={{
      position: 'fixed', left: 16, right: 16, bottom: 96, zIndex: 300,
      display: 'flex', alignItems: 'center', gap: 10,
      background: '#221A30', color: '#fff', borderRadius: 16,
      padding: '13px 16px', boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
      fontFamily: 'var(--font-sans)', fontSize: 13.5, fontWeight: 600,
      animation: 'bm-toast .3s cubic-bezier(.2,.9,.3,1)',
    }}>
      <span style={{ width: 22, height: 22, borderRadius: 999, background: dot, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      </span>
      {message}
    </div>
  );
}
