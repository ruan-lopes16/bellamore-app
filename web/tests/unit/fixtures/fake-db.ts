export type Op = [string, unknown[]];
export type Chamada = { tabela: string; ops: Op[] };
type Resposta = { data: unknown[] | null; error: { code?: string; message: string } | null };

/** Client falso: grava a cadeia; `range` devolve `linhas[tabela]`; `update(...).select()` devolve `respostaUpdate`. */
export function fakeDb(opcoes: {
  linhas?: Record<string, unknown[]>;
  erroEm?: string;
  /** Erro só quando o `select` da tabela contém o texto (ex.: coluna que a migration ainda não criou). */
  erroQuandoSelectContem?: Record<string, string>;
  /** Consultas sem `range`: `await` na cadeia devolve `linhas[tabela]` (ou erro, se `erroEm`). */
  awaitavel?: boolean;
  /** Erro (mensagem) por tabela, em qualquer consulta (range, await ou single). */
  erroTabelas?: Record<string, string>;
  /** Erro com código (PostgREST/Postgres) por tabela; tem prioridade sobre `erroTabelas`. */
  erroTabelasCodigo?: Record<string, { code: string; message: string }>;
  respostaUpdate?: (tabela: string, ids: string[], lote: number) => Resposta;
  /**
   * Resposta de `db.rpc(fn, args)`. Ausente → função inexistente (`PGRST202`), como no banco
   * antes da migration que a cria; os testes antigos seguem pelo caminho sem a função.
   */
  rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { code?: string; message: string } | null };
} = {}) {
  const chamadas: Chamada[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  let lote = 0;
  const erroDe = (tabela: string) => opcoes.erroTabelasCodigo?.[tabela]
    ?? (opcoes.erroTabelas?.[tabela] ? { message: opcoes.erroTabelas[tabela] } : null);
  const db = {
    rpc(fn: string, args: Record<string, unknown> = {}) {
      rpcs.push({ fn, args });
      return Promise.resolve(opcoes.rpc
        ? opcoes.rpc(fn, args)
        : { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}` } });
    },
    from(tabela: string) {
      const chamada: Chamada = { tabela, ops: [] };
      chamadas.push(chamada);
      const builder: Record<string, unknown> = new Proxy({}, {
        get(_a, prop) {
          if (prop === 'then') {
            if (!opcoes.awaitavel || chamada.ops.some(([m]) => m === 'range')) return undefined;
            return (ok: (v: Resposta) => unknown) => ok(erroDe(tabela)
              ? { data: null, error: erroDe(tabela) }
              : tabela === opcoes.erroEm
              ? { data: null, error: { message: `falha em ${tabela}` } }
              : { data: opcoes.linhas?.[tabela] ?? [], error: null });
          }
          return (...args: unknown[]) => {
            chamada.ops.push([String(prop), args]);
            if (prop === 'single') {
              if (erroDe(tabela)) return Promise.resolve({ data: null, error: erroDe(tabela) });
              return Promise.resolve({ data: opcoes.linhas?.[tabela]?.[0] ?? null, error: null });
            }
            if (prop === 'range') {
              if (erroDe(tabela)) return Promise.resolve({ data: null, error: erroDe(tabela) });
              const trecho = opcoes.erroQuandoSelectContem?.[tabela];
              const sel = chamada.ops.find(([m]) => m === 'select')?.[1][0];
              if (trecho && typeof sel === 'string' && sel.includes(trecho)) {
                return Promise.resolve({ data: null, error: { message: `column ${trecho} does not exist` } });
              }
              if (tabela === opcoes.erroEm) return Promise.resolve({ data: null, error: { message: `falha em ${tabela}` } });
              const [de, ate] = args as [number, number];
              return Promise.resolve({ data: (opcoes.linhas?.[tabela] ?? []).slice(de, ate + 1), error: null });
            }
            if (prop === 'select' && chamada.ops.some(([m]) => m === 'update' || m === 'delete')) {
              const em = chamada.ops.find(([m]) => m === 'in');
              const eqId = chamada.ops.find(([m, a]) => m === 'eq' && a[0] === 'id');
              const ids = (em ? em[1][1] : eqId ? [eqId[1][1]] : []) as string[];
              return Promise.resolve(opcoes.respostaUpdate
                ? opcoes.respostaUpdate(tabela, ids, lote++)
                : { data: ids.map(id => ({ id })), error: null });
            }
            return builder;
          };
        },
      });
      return builder;
    },
  };
  return { db, chamadas, rpcs };
}
export const opsDe = (chamadas: Chamada[], tabela: string) => chamadas.filter(c => c.tabela === tabela).map(c => c.ops);

/** Builder que só grava (para os `aplicarFiltro...`). */
export function gravador() {
  const ops: Op[] = [];
  const b: Record<string, unknown> = new Proxy({}, {
    get(_a, prop) { return (...args: unknown[]) => { ops.push([String(prop), args]); return b; }; },
  });
  return { b, ops };
}
