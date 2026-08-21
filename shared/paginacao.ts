/**
 * Busca todas as paginas de uma consulta PostgREST.
 *
 * O PostgREST limita a 1000 linhas por requisicao por padrao, e a truncagem e
 * silenciosa: nao ha erro nem aviso. Sem paginar, o historico de uma cliente
 * antiga aparece cortado sem que ninguem perceba.
 *
 * @param montarQuery Recebe o intervalo (from, to) e devolve a consulta pronta.
 * @param tamanhoPagina Linhas por requisicao. O padrao 1000 e o teto do PostgREST.
 */
export async function buscarTodasPaginas<T>(
  montarQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tamanhoPagina = 1000,
): Promise<T[]> {
  const todas: T[] = [];
  let from = 0;
  for (;;) {
    const { data } = await montarQuery(from, from + tamanhoPagina - 1);
    const linhas = data ?? [];
    todas.push(...linhas);
    if (linhas.length < tamanhoPagina) break;
    from += tamanhoPagina;
  }
  return todas;
}
