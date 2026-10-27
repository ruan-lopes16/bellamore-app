'use client';

/**
 * @file BlocoPagamento.tsx
 * Bloco de pagamento da Venda avulsa (web/app/(app)/vendas/page.tsx), em componente: chips de método
 * (podem se repetir), valor por pagamento, maquininha, bandeira, parcelas e taxa/líquido da
 * configuração (shared/taxas-cartao.ts). Taxa nunca inventada: sem linha cadastrada, avisa e o
 * pagamento é gravado sem taxa. Usado pela venda de pacote ("Cobrar agora").
 */
import { Banknote, Zap, CreditCard, Gift, X, AlertCircle } from 'lucide-react';
import {
  fmtTaxa, valorLiquido, maquininhasAtivas, maquininhaPadrao, bandeirasAtivas, parcelasDisponiveis, type ConfigCartoes,
} from '@shared/taxas-cartao';
import { taxaDoSplit, parseValorBR } from '@shared/comanda-fechamento';
import { formatarMoeda as fmtBRL } from '@shared/moeda';

/** Pagamento na tela (valor como texto). */
export type SplitTela = { metodo: string; valor: string; bandeira?: string; parcelas?: number; maquininhaId?: string | null };

export const METODOS_PAG = [
  { id: 'pix',      label: 'PIX',      icon: Zap        },
  { id: 'dinheiro', label: 'Dinheiro', icon: Banknote   },
  { id: 'credito',  label: 'Crédito',  icon: CreditCard },
  { id: 'debito',   label: 'Débito',   icon: CreditCard },
  { id: 'cortesia', label: 'Cortesia', icon: Gift       },
];

/** Converte os pagamentos da tela para valores numéricos (entrada de resumoComanda/montarPagamentos). */
export function splitsNumericos(splits: SplitTela[]) {
  return splits.map(s => ({ ...s, valor: parseValorBR(s.valor) }));
}

export function BlocoPagamento({
  splits, onChange, config, falta, permitirCortesia, desabilitado = false,
}: {
  splits: SplitTela[];
  onChange: (s: SplitTela[]) => void;
  config: ConfigCartoes;
  /** Quanto ainda falta cobrir: o novo pagamento já vem com esse valor. */
  falta: number;
  /** Chip Cortesia (só com comanda.desconto, igual à comanda). */
  permitirCortesia: boolean;
  desabilitado?: boolean;
}) {
  const maquininhaDoSplit = (s: SplitTela) =>
    config.maquininhas.find(m => m.id === s.maquininhaId) ?? maquininhaPadrao(config);
  const alterar = (idx: number, mudar: (s: SplitTela) => SplitTela) => onChange(splits.map((s, i) => (i === idx ? mudar(s) : s)));

  function adicionar(metodo: string) {
    const cartao = metodo === 'credito' || metodo === 'debito';
    onChange([...splits, {
      metodo,
      valor: falta > 0 ? falta.toFixed(2).replace('.', ',') : '',
      ...(cartao ? { maquininhaId: maquininhaPadrao(config)?.id ?? null } : {}),
    }]);
  }
  /** Troca a maquininha; se ela aceita menos parcelas que as escolhidas, ajusta para o máximo dela. */
  function trocarMaquininha(idx: number, maquininhaId: string) {
    const maq = config.maquininhas.find(m => m.id === maquininhaId);
    alterar(idx, s => ({ ...s, maquininhaId, parcelas: maq && (s.parcelas ?? 1) > maq.maxParcelas ? maq.maxParcelas : s.parcelas }));
  }

  return (
    <fieldset disabled={desabilitado} className="min-w-0 m-0 p-0 border-0 flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap">
        {METODOS_PAG.filter(m => permitirCortesia || m.id !== 'cortesia').map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => adicionar(id)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-semibold border transition bg-surface border-border text-text-2 hover:border-accent/60 disabled:opacity-40">
            <Icon size={12}/> {label}
          </button>
        ))}
      </div>

      {splits.length > 0 && (
        <div className="flex flex-col gap-2">
          {splits.map((sp, i) => {
            const m = METODOS_PAG.find(x => x.id === sp.metodo) ?? METODOS_PAG[0];
            const Icon = m.icon;
            const isCard = sp.metodo === 'credito' || sp.metodo === 'debito';
            return (
              <div key={i} className="flex flex-col gap-2 rounded-xl px-3 py-2.5 border border-border bg-bg">
                <div className="flex items-center gap-2">
                  <Icon size={13} className="text-text-3 flex-shrink-0"/>
                  <span className="text-xs font-semibold text-text-2 flex-1">{m.label}</span>
                  <span className="text-xs text-text-3">R$</span>
                  <input value={sp.valor} onChange={e => alterar(i, s => ({ ...s, valor: e.target.value }))}
                    inputMode="decimal" placeholder="0,00"
                    className="w-24 h-8 px-2 text-sm text-right rounded-lg border border-border bg-surface text-text focus:outline-none focus:border-accent transition font-semibold"/>
                  <button type="button" onClick={() => onChange(splits.filter((_, j) => j !== i))}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition flex-shrink-0">
                    <X size={12}/>
                  </button>
                </div>
                {isCard && maquininhasAtivas(config).length >= 2 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-3 flex-shrink-0">Maquininha:</span>
                    <select value={maquininhaDoSplit(sp)?.id ?? ''} onChange={e => trocarMaquininha(i, e.target.value)}
                      className="h-7 px-2 rounded-lg border border-border/60 bg-surface text-xs font-semibold text-text-2 focus:outline-none focus:border-accent transition">
                      {maquininhasAtivas(config).map(mq => <option key={mq.id} value={mq.id}>{mq.nome}</option>)}
                    </select>
                  </div>
                )}
                {isCard && (
                  <div className="flex gap-1.5 flex-wrap">
                    {bandeirasAtivas(config).map(b => (
                      <button key={b.chave} type="button" onClick={() => alterar(i, s => ({ ...s, bandeira: b.chave }))}
                        className={`px-2 py-0.5 rounded-lg text-xs font-semibold border transition ${
                          sp.bandeira === b.chave
                            ? 'bg-accent/10 border-accent text-accent'
                            : 'border-border/60 text-text-3 hover:border-accent/50 hover:text-text-2'
                        }`}>
                        {b.nome}
                      </button>
                    ))}
                  </div>
                )}
                {sp.metodo === 'credito' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-3 flex-shrink-0">Parcelas:</span>
                    <select value={sp.parcelas ?? 1} onChange={e => alterar(i, s => ({ ...s, parcelas: Number(e.target.value) }))}
                      className="h-7 px-2 rounded-lg border border-border/60 bg-surface text-xs font-semibold text-text-2 focus:outline-none focus:border-accent transition">
                      {(() => {
                        const maq = maquininhaDoSplit(sp);
                        return (maq ? parcelasDisponiveis(maq) : [1]).map(n => (
                          <option key={n} value={n}>{n}x{n === 1 ? ' (à vista)' : ''}</option>
                        ));
                      })()}
                    </select>
                  </div>
                )}
                {isCard && (() => {
                  const valorN = parseValorBR(sp.valor);
                  const taxa = taxaDoSplit(sp, config);
                  if (taxa === null) {
                    return (
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber">
                        <AlertCircle size={12}/>
                        <span>Taxa não cadastrada para esta combinação</span>
                      </div>
                    );
                  }
                  if (!valorN) return null;
                  return (
                    <div className="flex items-center justify-between text-xs text-text-3">
                      <span>Taxa {fmtTaxa(taxa)}</span>
                      <span>Líquido {fmtBRL(valorLiquido(valorN, taxa))}</span>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
