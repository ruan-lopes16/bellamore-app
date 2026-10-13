/**
 * @file comanda-recibo.ts
 * Texto do recibo enviado por WhatsApp — o MESMO no web e no app. Comanda (padrão) ou venda
 * avulsa (`tipo: 'compra'`).
 */
import { formatarMoeda } from './moeda';
import { BANDEIRAS_INICIAIS } from './taxas-cartao';
import { chaveDiaBRT, horaBRT, rotuloDataBR } from './periodos';
import { toWhatsApp } from './mascaras';

const METODOS: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', cortesia: 'Cortesia' };

export type DadosRecibo = {
  nome: string; valor: number; dataIso: string;
  itens: { descricao: string; quantidade: number; valor: number }[];
  splits: { metodo: string; valor: number; bandeira?: string | null; parcelas?: number }[];
  /** Desconto manual em R$ (sem a taxa de reserva). */
  desconto: number;
  /** Taxa de reserva já paga, descontada à parte. */
  descontoReserva: number;
  /** Nome da bandeira pela chave (ex.: `c => nomeBandeira(config, c)`). Ausente → nomes das 5 bandeiras iniciais. */
  nomeBandeira?: (chave: string) => string;
  /**
   * 'atendimento' (padrão, comanda): "Recibo de Atendimento" / "Serviços:".
   * 'compra' (venda avulsa): "Recibo de Compra" / "Itens:".
   */
  tipo?: 'atendimento' | 'compra';
};

const CABECALHO: Record<'atendimento' | 'compra', { titulo: string; itens: string }> = {
  atendimento: { titulo: 'Recibo de Atendimento', itens: 'Serviços:' },
  compra:      { titulo: 'Recibo de Compra',      itens: 'Itens:' },
};

const NOMES_INICIAIS: Record<string, string> = Object.fromEntries(BANDEIRAS_INICIAIS.map(b => [b.chave, b.nome]));

/** Recibo em texto (negrito do WhatsApp com *). Data/hora em Brasília. */
export function gerarTextoRecibo(d: DadosRecibo): string {
  const cab = CABECALHO[d.tipo ?? 'atendimento'];
  return [
    `🌸 *${cab.titulo}*`, '',
    `👤 ${d.nome}`,
    `📅 ${rotuloDataBR(chaveDiaBRT(d.dataIso))} às ${horaBRT(d.dataIso)}`, '',
    `*${cab.itens}*`,
    ...d.itens.map(i => `• ${i.descricao}${i.quantidade > 1 ? ` (${i.quantidade}x)` : ''} — ${formatarMoeda(i.valor * i.quantidade)}`),
    ...(d.descontoReserva > 0 ? [`• Taxa de reserva paga — −${formatarMoeda(d.descontoReserva)}`] : []),
    ...(d.desconto > 0 ? [`• Desconto — −${formatarMoeda(d.desconto)}`] : []),
    '',
    `💰 *Total: ${formatarMoeda(d.valor)}*`, '',
    '*Pagamento:*',
    ...d.splits.map(s => {
      let rotulo = METODOS[s.metodo] ?? s.metodo;
      if (s.bandeira) rotulo += ` ${d.nomeBandeira ? d.nomeBandeira(s.bandeira) : (NOMES_INICIAIS[s.bandeira] ?? s.bandeira)}`;
      if (s.metodo === 'credito' && (s.parcelas ?? 1) > 1) rotulo += ` ${s.parcelas}x`;
      return `• ${rotulo} — ${formatarMoeda(s.valor)}`;
    }),
  ].join('\n');
}

/** Link wa.me com o recibo (telefone com ou sem DDI). */
export function linkWhatsAppRecibo(telefone: string, texto: string): string {
  return `https://wa.me/${toWhatsApp(telefone)}?text=${encodeURIComponent(texto)}`;
}
