'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { PRIVACY_KEY, SMEAR_STYLE, readPrivacyPref, writePrivacyPref } from '@/lib/privacy';

type PrivacyCtx = { hidden: boolean; toggle: () => void };
const Ctx = createContext<PrivacyCtx>({ hidden: false, toggle: () => {} });

/** Script inline: roda ANTES da hidratação, marca <html data-privacy> a partir
 *  do localStorage. Evita o flash de valores reais ao abrir com o modo ligado. */
export const PRIVACY_NOFLASH_SCRIPT =
  `try{if(localStorage.getItem('${PRIVACY_KEY}')==='1')document.documentElement.dataset.privacy='on'}catch(e){}`;

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  // Começa a partir do que o script inline já marcou no <html> (sem flash);
  // no SSR não há document, então cai para false e o efeito abaixo ajusta.
  const [hidden, setHidden] = useState<boolean>(() => {
    if (typeof document !== 'undefined') return document.documentElement.dataset.privacy === 'on';
    return false;
  });

  useEffect(() => {
    setHidden(readPrivacyPref());
  }, []);

  const toggle = useCallback(() => {
    setHidden(prev => {
      const next = !prev;
      writePrivacyPref(next);
      if (typeof document !== 'undefined') {
        if (next) document.documentElement.dataset.privacy = 'on';
        else delete document.documentElement.dataset.privacy;
      }
      return next;
    });
  }, []);

  return <Ctx.Provider value={{ hidden, toggle }}>{children}</Ctx.Provider>;
}

export function usePrivacy() {
  return useContext(Ctx);
}

/**
 * Embrulha um valor sensível. Modo privado desligado → mostra o filho normal.
 * Ligado → rabisco ilegível (texto transparente + sombra borrada) mantendo a
 * largura, sem permitir seleção/cópia.
 */
export function Secret({ children }: { children: React.ReactNode }) {
  const { hidden } = usePrivacy();
  if (!hidden) return <>{children}</>;
  return (
    <span aria-hidden style={{ ...SMEAR_STYLE, whiteSpace: 'nowrap' }}>{children}</span>
  );
}

/** Botão de olho para o cabeçalho de cada tela. */
export function PrivacyToggle({ className = '', size = 16 }: { className?: string; size?: number }) {
  const { hidden, toggle } = usePrivacy();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      title={hidden ? 'Mostrar valores' : 'Ocultar valores'}
      className={`inline-flex items-center justify-center rounded-xl border border-border text-text-3 hover:text-text hover:bg-bg transition ${className}`}
      style={{ width: 34, height: 34 }}
    >
      {hidden ? <EyeOff size={size} strokeWidth={2} /> : <Eye size={size} strokeWidth={2} />}
    </button>
  );
}
