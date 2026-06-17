'use client';

/**
 * @file SearchSelect.tsx
 * Dropdown com busca em tempo real — substitui o <select> nativo em todo o projeto.
 *
 * ## Por que não usar <select>?
 * O <select> nativo não permite filtrar opções digitando. Para listas longas
 * (clientes, produtos, serviços) a experiência fica ruim. Este componente
 * abre um input ao ser clicado e filtra as opções em tempo real.
 *
 * ## Comportamento
 * - Clique no campo → muda para modo "busca" (input ativo com ícone 🔍)
 * - Filtro simultâneo por `label` e `sub` (ex: nome + telefone)
 * - `onMouseDown + preventDefault` nas opções: evita que o blur feche o
 *   dropdown antes do clique ser registrado
 * - Input hidden para validação nativa de formulários (`required`)
 * - Fechar: clique fora, Tab, ou Escape (via blur)
 *
 * ## Uso
 * ```tsx
 * <SearchSelect
 *   options={clientes.map(c => ({ value: c.id, label: c.nome, sub: c.telefone }))}
 *   value={clienteId}
 *   onChange={setClienteId}
 *   placeholder="Buscar cliente..."
 *   required
 * />
 * ```
 */

import { useState, useRef, useMemo } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';

/** Formato de cada opção do dropdown */
export type SelectOpt = {
  value: string;
  label: string;
  /** Texto secundário exibido à direita (ex: telefone, categoria, unidade) */
  sub?: string;
};

interface Props {
  options: SelectOpt[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Se true, injeta <input hidden required> para validação nativa de form */
  required?: boolean;
  className?: string;
}

export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = 'Selecionar...',
  required,
  className = '',
}: Props) {
  const [busca,  setBusca]  = useState('');
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  /** Opção atualmente selecionada (para exibir o label no campo fechado) */
  const selecionado = options.find(o => o.value === value);

  /** Filtra opções pelo texto digitado (label e sub) */
  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    if (!q) return options;
    return options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      o.sub?.toLowerCase().includes(q),
    );
  }, [options, busca]);

  /** Abre o dropdown e foca o input de busca */
  function abrir() {
    setBusca('');
    setAberto(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  /**
   * Fecha o dropdown ao perder o foco.
   * Verifica se o novo elemento focado ainda está dentro do container
   * (ex: clique em uma opção) — se sim, não fecha.
   */
  function fechar(e?: React.FocusEvent) {
    if (e && containerRef.current?.contains(e.relatedTarget as Node)) return;
    setAberto(false);
    setBusca('');
  }

  /** Seleciona uma opção e fecha o dropdown */
  function selecionar(opt: SelectOpt) {
    onChange(opt.value);
    setAberto(false);
    setBusca('');
  }

  // Classes base do campo visível
  const base = "w-full h-10 rounded-xl border border-border bg-bg text-sm transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20";

  return (
    <div ref={containerRef} className={`relative ${className}`}>

      {/* ── Campo principal (fechado ou aberto em modo busca) ── */}
      <div
        role="combobox"
        aria-expanded={aberto}
        onClick={abrir}
        className={`${base} flex items-center px-3.5 gap-2 cursor-pointer select-none ${
          aberto ? 'border-accent ring-2 ring-accent/20' : ''
        }`}
      >
        {aberto ? (
          // Modo busca: input ativo
          <>
            <Search size={14} className="text-text-4 flex-shrink-0" strokeWidth={2}/>
            <input
              ref={inputRef}
              value={busca}
              onChange={e => setBusca(e.target.value)}
              onBlur={fechar}
              placeholder="Buscar..."
              className="flex-1 bg-transparent outline-none text-sm text-text placeholder:text-text-4 cursor-text"
              onClick={e => e.stopPropagation()} // evita re-abrir ao clicar no input
            />
          </>
        ) : (
          // Modo exibição: mostra opção selecionada ou placeholder
          <>
            <span className={`flex-1 truncate ${selecionado ? 'text-text' : 'text-text-4'}`}>
              {selecionado ? (
                <>
                  {selecionado.label}
                  {selecionado.sub && (
                    <span className="text-text-4 ml-1.5 text-xs">{selecionado.sub}</span>
                  )}
                </>
              ) : placeholder}
            </span>
            <ChevronDown size={14} className="text-text-4 flex-shrink-0" strokeWidth={2}/>
          </>
        )}
      </div>

      {/*
       * Input hidden para validação nativa de formulário.
       * O <select> nativo pausa o submit se required+vazio.
       * Como usamos um div customizado, precisamos deste workaround.
       */}
      {required && (
        <input
          type="text"
          value={value}
          required
          readOnly
          tabIndex={-1}
          className="sr-only"
          aria-hidden
        />
      )}

      {/* ── Dropdown de opções ── */}
      {aberto && (
        <div className="absolute top-full left-0 right-0 mt-1 z-[60] bg-surface border border-border rounded-xl shadow-xl max-h-52 overflow-y-auto">
          {filtrados.length === 0 ? (
            <p className="px-4 py-3 text-sm text-text-4 text-center">Nenhum resultado</p>
          ) : filtrados.map(opt => {
            const sel = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                /*
                 * onMouseDown + preventDefault: quando o usuário clica em uma opção,
                 * o browser dispara onBlur no input ANTES do onClick.
                 * Sem preventDefault, o dropdown fecharia antes do clique registrar.
                 * Com preventDefault no mousedown, o blur não dispara e a seleção funciona.
                 */
                onMouseDown={e => { e.preventDefault(); selecionar(opt); }}
                className={`w-full text-left px-4 py-2.5 text-sm transition flex items-center gap-2 hover:bg-bg ${
                  sel ? 'text-primary font-semibold' : 'text-text'
                }`}
              >
                <span className="flex-1 truncate">{opt.label}</span>
                {opt.sub && (
                  <span className="text-xs text-text-4 flex-shrink-0">{opt.sub}</span>
                )}
                {/* Check mark na opção atualmente selecionada */}
                {sel && <Check size={12} className="text-primary flex-shrink-0" strokeWidth={2.5}/>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
