/**
 * Regras da taxa de reserva e da taxa de cancelamento por atendimento (spec
 * docs/superpowers/specs/2026-10-15-taxas-por-atendimento-design.md, migration 091).
 * A chave geral da empresa é o padrão; cada atendimento pode dispensar a taxa.
 */
import type { ClienteDb } from './kpis-financeiros-consultas';

export type ModoTaxa = 'percentual' | 'fixo';

export type ConfigTaxaReserva = { ativa: boolean; modo: ModoTaxa; valor: number };

export type ConfigTaxaCancelamento = {
  ativa: boolean;
  modo: ModoTaxa;
  valor: number;
  aplicaCancelado: boolean;
  aplicaFaltou: boolean;
};

export type ConfigTaxas = { reserva: ConfigTaxaReserva; cancelamento: ConfigTaxaCancelamento };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Arredonda em 2 casas, metade para longe do zero (igual ao `round(x, 2)` do Postgres), sem ruído de ponto flutuante. */
function round2(x: number): number {
  const centavos = Math.round(parseFloat((Math.abs(x) * 100).toPrecision(12)));
  return (Math.sign(x) * centavos) / 100;
}

/** Fixo → valor da configuração; percentual → base × valor / 100 com 2 casas. Nunca negativo. */
function contaTaxa(modo: ModoTaxa, valorCfg: number, base: number): number {
  const v = modo === 'fixo' ? num(valorCfg) : round2(Math.max(num(base), 0) * num(valorCfg) / 100);
  return v > 0 ? v : 0;
}

/**
 * Valor sugerido da taxa de reserva ao criar um agendamento. Chave desligada → 0.
 */
export function valorTaxaReservaSugerida(cfg: ConfigTaxaReserva, preco: number): number {
  if (!cfg.ativa) return 0;
  return contaTaxa(cfg.modo, cfg.valor, preco);
}

/**
 * Valor da taxa de cancelamento — mesma conta do trigger `gerar_taxa_cancelamento`
 * (fixo, ou percentual de `agendamentos.valor` com 2 casas). Chave desligada → 0.
 * Não olha o status: quem decide se o status é coberto é `perguntaTaxaCancelamento`.
 */
export function valorTaxaCancelamento(cfg: ConfigTaxaCancelamento, valorAtendimento: number): number {
  if (!cfg.ativa) return 0;
  return contaTaxa(cfg.modo, cfg.valor, valorAtendimento);
}

/**
 * Se a tela deve perguntar "Cobrar taxa de cancelamento de R$ X?" ao mudar o status:
 * só com a chave ligada, status coberto pela configuração (cancelado/faltou), cliente vinculada
 * e valor > 0 — exatamente os casos em que o trigger criaria a taxa.
 */
export function perguntaTaxaCancelamento(
  cfg: ConfigTaxaCancelamento,
  novoStatus: string,
  clienteId: string | null,
  valorAtendimento: number,
): { perguntar: boolean; valor: number } {
  const coberto = (novoStatus === 'cancelado' && cfg.aplicaCancelado)
    || (novoStatus === 'faltou' && cfg.aplicaFaltou);
  if (!cfg.ativa || !coberto || !clienteId) return { perguntar: false, valor: 0 };
  const valor = valorTaxaCancelamento(cfg, valorAtendimento);
  return valor > 0 ? { perguntar: true, valor } : { perguntar: false, valor: 0 };
}

const COLUNAS_TAXAS = [
  'taxa_reserva_ativa', 'taxa_reserva_modo', 'taxa_reserva_valor',
  'taxa_cancelamento_ativa', 'taxa_cancelamento_modo', 'taxa_cancelamento_valor',
  'taxa_cancelamento_aplica_cancelado', 'taxa_cancelamento_aplica_faltou',
].join(', ');

const modo = (v: unknown): ModoTaxa => (v === 'fixo' ? 'fixo' : 'percentual');

/**
 * Lê de `empresas` a configuração das duas taxas. LANÇA o erro do banco (uma taxa desligada por
 * falha de rede seria cobrança perdida em silêncio). Empresa não encontrada → tudo desligado.
 */
export async function carregarConfigTaxas(db: ClienteDb, empresaId: string): Promise<ConfigTaxas> {
  const { data, error } = await db.from('empresas').select(COLUNAS_TAXAS).eq('id', empresaId).maybeSingle();
  if (error) throw new Error(error.message);
  const e = (data ?? {}) as Record<string, unknown>;
  return {
    reserva: {
      ativa: e.taxa_reserva_ativa === true,
      modo: modo(e.taxa_reserva_modo),
      valor: num(e.taxa_reserva_valor),
    },
    cancelamento: {
      ativa: e.taxa_cancelamento_ativa === true,
      modo: modo(e.taxa_cancelamento_modo),
      valor: num(e.taxa_cancelamento_valor),
      aplicaCancelado: e.taxa_cancelamento_aplica_cancelado !== false,
      aplicaFaltou: e.taxa_cancelamento_aplica_faltou !== false,
    },
  };
}

let cacheColunaCobrar: boolean | null = null;

/**
 * A migration 091 já foi aplicada (`agendamentos.cobrar_taxa_cancelamento` existe)?
 * Resultado definitivo (sucesso, ou erro de coluna inexistente) fica em cache até recarregar o app;
 * qualquer outro erro (rede) devolve false sem guardar, para tentar de novo na próxima vez.
 * Sem a coluna, as telas não perguntam nem enviam o campo (comportamento de antes da 091).
 */
export async function colunaCobrarTaxaExiste(db: ClienteDb): Promise<boolean> {
  if (cacheColunaCobrar !== null) return cacheColunaCobrar;
  const { error } = await db.from('agendamentos').select('cobrar_taxa_cancelamento').limit(1);
  if (!error) {
    cacheColunaCobrar = true;
  } else if (error.code === '42703' || (error.message ?? '').includes('cobrar_taxa_cancelamento')) {
    cacheColunaCobrar = false;
  } else {
    return false;
  }
  return cacheColunaCobrar;
}

/** Só para testes: esquece o resultado guardado por `colunaCobrarTaxaExiste`. */
export function _limparCacheColunaCobrarTaxa(): void {
  cacheColunaCobrar = null;
}
