/**
 * Gravações de Pacotes pelas funções da migration 096 (web e app usam estas, nunca o banco direto):
 * - `venderPacote` → `vender_pacote(p jsonb)`: venda única de pacote, "Cobrar agora" ou "Cobrar na comanda";
 * - `excluirPacoteCliente` → `excluir_pacote_cliente(p_empresa, p_id)`;
 * - `excluirServico` → `excluir_servico(p_empresa, p_id)`.
 * Contrato: docs/superpowers/notes/2026-10-23-contrato-pacotes.md.
 *
 * Sem a 096 no banco (PostgREST devolve `PGRST202`) as três lançam `SemMigration096`, e a tela decide o
 * caminho antigo. Qualquer outro erro vira `ErroPacote` com a mensagem pronta para a tela.
 */
import { mensagemErroBanco } from './erros';
import type { LinhaPagamento } from './comanda-fechamento';

/** O mínimo do client supabase-js usado aqui: só `rpc`. Estrutural (shared não depende do @supabase/*). */
export interface ClienteDbRpc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
}

/** A função ainda não existe no banco (a 096 não foi rodada). A tela usa o caminho antigo. */
export class SemMigration096 extends Error {
  constructor() {
    super('A migration 096 ainda não foi aplicada.');
    this.name = 'SemMigration096';
  }
}

/**
 * Erro de uma gravação de Pacotes, com a mensagem pronta para a tela. `semResposta` = a rede caiu na
 * chamada: a venda PODE ter sido gravada (a nova tentativa com a mesma `vendaId` não duplica).
 */
export class ErroPacote extends Error {
  constructor(mensagem: string, readonly semResposta = false) {
    super(mensagem);
    this.name = 'ErroPacote';
  }
}

/**
 * Pagamento da venda "agora", no formato de `registrar_venda_avulsa_v2`. Uma `LinhaPagamento` de
 * `montarPagamentos` (shared/comanda-fechamento.ts) serve como está: as outras chaves são descartadas.
 */
export type PagamentoPacote = Pick<LinhaPagamento, 'valor' | 'metodo' | 'bandeira' | 'parcelas' | 'taxa_perc'>
  & { maquininha_id?: string | null };

/** Entrada de `venderPacote`. `desconto` em R$ (já convertido de %). */
export type EntradaVendaPacote = {
  /** Chave da venda (uuid gerado uma vez por modal): a nova tentativa com a mesma chave não duplica. */
  vendaId: string;
  empresaId: string;
  clienteId: string;
  pacoteId: string;
  /** Unidades (inteiro, 1 a 100): um pacote_clientes por unidade. */
  quantidade: number;
  valorUnit: number;
  desconto: number;
  /** 'agora' = venda e pagamentos já; 'comanda' = pacote "a cobrar", cobrado ao fechar a comanda. */
  cobranca: 'agora' | 'comanda';
  /** Obrigatórios em 'agora'; ignorados (enviados vazios) em 'comanda'. */
  pagamentos: PagamentoPacote[];
};

const centavos = (v: number) => Math.round(v * 100) / 100;

/** O JSON `p` de `vender_pacote` (contrato). Exportado para a tela montar a assinatura da tentativa. */
export function argumentosVendaPacote(e: EntradaVendaPacote): Record<string, unknown> {
  return {
    venda_id: e.vendaId,
    empresa_id: e.empresaId,
    cliente_id: e.clienteId,
    pacote_id: e.pacoteId,
    quantidade: e.quantidade,
    valor_unit: centavos(e.valorUnit),
    desconto: centavos(e.desconto),
    cobranca: e.cobranca,
    pagamentos: e.cobranca === 'agora'
      ? e.pagamentos.map(p => ({
          valor: centavos(p.valor), metodo: p.metodo, bandeira: p.bandeira ?? null, parcelas: p.parcelas ?? 1,
          taxa_perc: p.taxa_perc ?? null, maquininha_id: p.maquininha_id ?? null,
        }))
      : [],
  };
}

type ErroRpc = { code?: string | null; message?: string | null } | null | undefined;

/** Chama a função; PGRST202 → SemMigration096; sem código (rede) → semResposta; resto → ErroPacote. */
async function chamar(db: ClienteDbRpc, fn: string, args: Record<string, unknown>, acao: string): Promise<void> {
  let error: ErroRpc;
  try {
    ({ error } = await db.rpc(fn, args));
  } catch {
    throw new ErroPacote(`Sem resposta do servidor ao ${acao}. Confira antes de tentar de novo.`, true);
  }
  if (!error) return;
  if (error.code === 'PGRST202') throw new SemMigration096();
  if (!error.code) throw new ErroPacote(`Sem resposta do servidor ao ${acao}. Confira antes de tentar de novo.`, true);
  throw new ErroPacote(mensagemErroBanco(error, acao));
}

/**
 * Vende um pacote (`vender_pacote`, 096) numa transação só: em 'agora' grava venda, pacotes e
 * pagamentos; em 'comanda' grava os pacotes "a cobrar". Lança `SemMigration096` ou `ErroPacote`.
 */
export async function venderPacote(db: ClienteDbRpc, entrada: EntradaVendaPacote): Promise<void> {
  if (entrada.cobranca === 'agora' && entrada.pagamentos.length === 0) {
    throw new ErroPacote('Pagamento não informado.');
  }
  await chamar(db, 'vender_pacote', { p: argumentosVendaPacote(entrada) }, 'vender o pacote');
}

/**
 * Exclui um pacote vendido sem sessão usada e acerta a venda ligada (`excluir_pacote_cliente`, 096).
 * Lança `SemMigration096` ou `ErroPacote` (ex.: "Este pacote já tem sessões usadas...").
 */
export async function excluirPacoteCliente(db: ClienteDbRpc, empresaId: string, id: string): Promise<void> {
  await chamar(db, 'excluir_pacote_cliente', { p_empresa: empresaId, p_id: id }, 'excluir o pacote vendido');
}

/**
 * Exclui um serviço que nunca foi usado (`excluir_servico`, 096). Usado → `ErroPacote` com
 * "Este serviço já foi usado. Desative em vez de excluir.". Lança `SemMigration096` sem a 096.
 */
export async function excluirServico(db: ClienteDbRpc, empresaId: string, id: string): Promise<void> {
  await chamar(db, 'excluir_servico', { p_empresa: empresaId, p_id: id }, 'excluir o serviço');
}
