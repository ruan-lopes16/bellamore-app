/** Acesso ao banco de Pacotes compartilhado por web e app. */
import type { ClienteDb } from './kpis-financeiros-consultas';

/** Aviso quando o vínculo foi trocado, a sessão falhou e nem o desfazer deu certo. */
export const MENSAGEM_VINCULO_SEM_SESSAO = 'O vínculo foi trocado, mas a sessão não foi lançada; confira o atendimento.';

/**
 * Desfaz o vínculo de um atendimento a um pacote depois que o lançamento da sessão falhou, voltando ao
 * `pacote_cliente_id` que ele tinha ANTES (um atendimento de combo continua no combo; gravar `null` o
 * faria contar como faturamento). Confere erro e linhas afetadas: devolve `null` se desfez, ou a mensagem
 * a mostrar se não conseguiu.
 */
export async function desfazerVinculoPacote(
  db: ClienteDb,
  empresaId: string,
  agendamentoId: string,
  pacoteAnterior: string | null,
): Promise<string | null> {
  try {
    const { data, error } = await db.from('agendamentos')
      .update({ pacote_cliente_id: pacoteAnterior })
      .eq('id', agendamentoId).eq('empresa_id', empresaId)
      .select('id');
    if (error || !data || data.length === 0) return MENSAGEM_VINCULO_SEM_SESSAO;
    return null;
  } catch {
    return MENSAGEM_VINCULO_SEM_SESSAO;
  }
}
