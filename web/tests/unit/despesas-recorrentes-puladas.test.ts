import { describe, expect, it } from 'vitest';
import { pularMesRecorrente } from '@shared/despesas-consultas';

/**
 * "Pular este mês" (PR #157): a escrita em `despesas_recorrentes_puladas` confere as linhas, como
 * toda escrita do projeto (permissoes-matriz). Com `ignoreDuplicates`, 0 linhas devolvidas é
 * legítimo só se o mês JÁ estava pulado — senão a gravação não aconteceu e a tela tem que avisar.
 */
type Resp = { data: unknown; error: { message: string } | null };

function stub(upsertResp: Resp, leituraResp: Resp) {
  const ops: [string, unknown[]][] = [];
  const db = {
    from(t: string) {
      ops.push(['from', [t]]);
      let escrita = false;
      const b: Record<string, unknown> = new Proxy({}, {
        get(_a, prop) {
          if (prop === 'then') {
            if (escrita) return undefined;
            return (ok: (v: Resp) => unknown) => ok(leituraResp);
          }
          return (...args: unknown[]) => {
            ops.push([String(prop), args]);
            if (prop === 'upsert') escrita = true;
            if (prop === 'select' && escrita) return Promise.resolve(upsertResp);
            return b;
          };
        },
      });
      return b;
    },
  };
  return { db, ops };
}

describe('pularMesRecorrente', () => {
  it('grava com .select e aceita a linha devolvida', async () => {
    const { db, ops } = stub({ data: [{ id: 'x' }], error: null }, { data: [], error: null });
    await pularMesRecorrente(db, 'e1', 'aluguel|fixa', '2026-10-01');
    const iUp = ops.findIndex(([m]) => m === 'upsert');
    expect(iUp).toBeGreaterThan(-1);
    expect(ops[iUp + 1]?.[0]).toBe('select');
  });

  it('0 linhas e o mês já estava pulado: tudo certo (idempotente)', async () => {
    const { db } = stub({ data: [], error: null }, { data: [{ chave: 'aluguel|fixa' }], error: null });
    await expect(pularMesRecorrente(db, 'e1', 'aluguel|fixa', '2026-10-15')).resolves.toBeUndefined();
  });

  it('0 linhas e o mês não ficou pulado: lança (nunca sucesso falso)', async () => {
    const { db } = stub({ data: [], error: null }, { data: [], error: null });
    await expect(pularMesRecorrente(db, 'e1', 'aluguel|fixa', '2026-10-01')).rejects.toThrow(/permissão/);
  });

  it('erro do banco lança', async () => {
    const { db } = stub({ data: null, error: { message: 'boom' } }, { data: [], error: null });
    await expect(pularMesRecorrente(db, 'e1', 'aluguel|fixa', '2026-10-01')).rejects.toThrow('boom');
  });
});
