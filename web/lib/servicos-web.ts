/**
 * Exclusão de serviço no web: usa a função `excluir_servico` da migration 096 (regra única com o app)
 * e, sem a 096, o caminho antigo com a mesma checagem de uso feita aqui antes do delete.
 */
import { excluirServico, SemMigration096, ErroPacote, type ClienteDbRpc } from '@shared/pacotes-venda';
import { mensagemErroBanco } from '@shared/erros';

export const MSG_SERVICO_USADO = 'Este serviço já foi usado. Desative em vez de excluir.';

/** Cliente mínimo: `rpc` + `from` (supabase-js serve). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClienteDbServicos = ClienteDbRpc & { from(tabela: string): any };

/** Tabelas que referenciam o serviço (mesma lista da `excluir_servico`). */
const TABELAS_USO = ['agendamentos', 'agendamento_servicos', 'comanda_itens', 'pacote_servicos', 'pacote_uso'] as const;

/**
 * Exclui o serviço. Lança `Error` com mensagem pronta para a tela (uso, permissão ou falha).
 */
export async function excluirServicoConferido(db: ClienteDbServicos, empresaId: string, servicoId: string): Promise<void> {
  try {
    await excluirServico(db, empresaId, servicoId);
    return;
  } catch (e) {
    if (!(e instanceof SemMigration096)) {
      if (e instanceof ErroPacote) throw e;
      throw new Error(mensagemErroBanco(e as { code?: string; message?: string }, 'excluir o serviço'));
    }
  }
  // Sem a 096: confere o uso no cliente e apaga conferindo as linhas afetadas.
  for (const tabela of TABELAS_USO) {
    const { count, error } = await db.from(tabela).select('id', { count: 'exact', head: true }).eq('servico_id', servicoId);
    if (error) throw new Error(mensagemErroBanco(error, 'conferir o uso do serviço'));
    if ((count ?? 0) > 0) throw new Error(MSG_SERVICO_USADO);
  }
  const { data, error } = await db.from('servicos').delete().eq('id', servicoId).eq('empresa_id', empresaId).select('id');
  if (error) throw new Error(mensagemErroBanco(error, 'excluir o serviço'));
  if (!data || data.length === 0) throw new Error('Você não tem permissão para excluir serviços.');
}
