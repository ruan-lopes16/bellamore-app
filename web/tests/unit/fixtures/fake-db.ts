export type Op = [string, unknown[]];
export type Chamada = { tabela: string; ops: Op[] };
type Resposta = { data: unknown[] | null; error: { message: string } | null };

/** Client falso: grava a cadeia; `range` devolve `linhas[tabela]`; `update(...).select()` devolve `respostaUpdate`. */
export function fakeDb(opcoes: {
  linhas?: Record<string, unknown[]>;
  erroEm?: string;
  /** Consultas sem `range`: `await` na cadeia devolve `linhas[tabela]` (ou erro, se `erroEm`). */
  awaitavel?: boolean;
  respostaUpdate?: (tabela: string, ids: string[], lote: number) => Resposta;
} = {}) {
  const chamadas: Chamada[] = [];
  let lote = 0;
  const db = {
    from(tabela: string) {
      const chamada: Chamada = { tabela, ops: [] };
      chamadas.push(chamada);
      const builder: Record<string, unknown> = new Proxy({}, {
        get(_a, prop) {
          if (prop === 'then') {
            if (!opcoes.awaitavel || chamada.ops.some(([m]) => m === 'range')) return undefined;
            return (ok: (v: Resposta) => unknown) => ok(tabela === opcoes.erroEm
              ? { data: null, error: { message: `falha em ${tabela}` } }
              : { data: opcoes.linhas?.[tabela] ?? [], error: null });
          }
          return (...args: unknown[]) => {
            chamada.ops.push([String(prop), args]);
            if (prop === 'range') {
              if (tabela === opcoes.erroEm) return Promise.resolve({ data: null, error: { message: `falha em ${tabela}` } });
              const [de, ate] = args as [number, number];
              return Promise.resolve({ data: (opcoes.linhas?.[tabela] ?? []).slice(de, ate + 1), error: null });
            }
            if (prop === 'select' && chamada.ops.some(([m]) => m === 'update')) {
              const em = chamada.ops.find(([m]) => m === 'in');
              const ids = (em ? em[1][1] : []) as string[];
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
  return { db, chamadas };
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
