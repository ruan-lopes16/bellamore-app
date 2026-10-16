// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Migration 091 executada de verdade num Postgres em memória (PGlite, sem rede, nada de banco real):
 * dispensa da taxa de cancelamento por atendimento e reset ao reagendar. Esquema mínimo em
 * fixtures/schema-taxa-cancelamento-091.sql (colunas da 047).
 */
const raiz = join(process.cwd(), '..');
const sql091 = readFileSync(join(raiz, 'supabase', 'migrations', '091_taxa_cancelamento_por_atendimento.sql'), 'utf8');
const stub = readFileSync(join(process.cwd(), 'tests', 'unit', 'fixtures', 'schema-taxa-cancelamento-091.sql'), 'utf8');

const E = '00000000-0000-0000-0000-0000000000e1';
const CL = '00000000-0000-0000-0000-0000000000c1';
const ag = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

let db: PGlite;

async function novo(n: number, valor = 100) {
  await db.query(`insert into agendamentos (id, empresa_id, cliente_id, valor) values ($1, $2, $3, $4)`, [ag(n), E, CL, valor]);
}
async function upd(n: number, set: string) {
  await db.query(`update agendamentos set ${set} where id = $1`, [ag(n)]);
}
async function taxa(n: number) {
  return (await db.query<{ status: string; valor: string }>(
    `select status, valor from taxas_cancelamento where agendamento_id = $1`, [ag(n)])).rows;
}
async function cobrar(n: number) {
  return (await db.query<{ c: boolean }>(`select cobrar_taxa_cancelamento as c from agendamentos where id = $1`, [ag(n)])).rows[0].c;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(stub);
  await db.exec(sql091);
  await db.exec(sql091); // idempotente
  await db.exec(`
    insert into empresas values ('${E}', true, 'percentual', 10, true, true);
    insert into clientes values ('${CL}');
  `);
}, 60_000);

describe('migration 091 — comportamento', () => {
  it('cancelar com a cobrança ligada cria a taxa pendente', async () => {
    await novo(1);
    await upd(1, `status = 'cancelado'`);
    expect(await taxa(1)).toEqual([{ status: 'pendente', valor: '10.00' }]);
  });

  it('cancelar já dispensado (false) não cria taxa', async () => {
    await novo(2);
    await upd(2, `status = 'cancelado', cobrar_taxa_cancelamento = false`);
    expect(await taxa(2)).toEqual([]);
  });

  it('dispensar com a taxa pendente marca cancelada; religar com status cancelado reativa', async () => {
    await novo(3);
    await upd(3, `status = 'cancelado'`);
    await upd(3, `cobrar_taxa_cancelamento = false`);
    expect((await taxa(3))[0].status).toBe('cancelada');
    await upd(3, `cobrar_taxa_cancelamento = true`);
    expect(await taxa(3)).toEqual([{ status: 'pendente', valor: '10.00' }]);
  });

  it('taxa já paga nunca é tocada (dispensar nem religar)', async () => {
    await novo(4);
    await upd(4, `status = 'cancelado'`);
    await db.query(`update taxas_cancelamento set status = 'pago', paga_em = now() where agendamento_id = $1`, [ag(4)]);
    await upd(4, `cobrar_taxa_cancelamento = false`);
    expect((await taxa(4))[0].status).toBe('pago');
    await upd(4, `cobrar_taxa_cancelamento = true`);
    expect(await taxa(4)).toEqual([{ status: 'pago', valor: '10.00' }]);
  });

  it('reagendar volta a coluna para true; cancelar de novo mandando só o status gera a taxa', async () => {
    await novo(5);
    await upd(5, `status = 'cancelado', cobrar_taxa_cancelamento = false`);
    expect(await taxa(5)).toEqual([]);
    await upd(5, `status = 'agendado'`);
    expect(await cobrar(5)).toBe(true);
    await upd(5, `status = 'cancelado'`);
    expect(await taxa(5)).toEqual([{ status: 'pendente', valor: '10.00' }]);
  });

  it('dispensa dentro do episódio (cancelado → faltou) é mantida', async () => {
    await novo(6);
    await upd(6, `status = 'cancelado', cobrar_taxa_cancelamento = false`);
    await upd(6, `status = 'faltou'`);
    expect(await cobrar(6)).toBe(false);
    expect(await taxa(6)).toEqual([]);
  });
});
