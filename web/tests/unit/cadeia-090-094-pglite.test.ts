// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Revisão final da Paridade Agenda: a 094 roda em cima do banco de produção (090 → 093 aplicadas)
 * e convive com fechar_comanda/editar_comanda (090/093), gerar_comissao (090), o uso de pacote
 * (078) e a exclusão do atendimento. Mesmo esquema da cadeia 090–093 (PGlite, nada de banco real).
 */
const raiz = join(process.cwd(), '..');
const migr = (n: string) => readFileSync(join(raiz, 'supabase', 'migrations', n), 'utf8');
const fixture = (n: string) => readFileSync(join(process.cwd(), 'tests', 'unit', 'fixtures', n), 'utf8');

const id = (pfx: string, n: number) => `00000000-0000-0000-0000-${pfx}${String(n).padStart(12 - pfx.length, '0')}`;
const E = id('e', 1);
const DONA = id('d', 1);
const P1 = id('a', 1);
const CL = id('c', 1);
const SV = id('f', 1);
const ag = (n: number) => id('0', n);
const PADRAO_PROFISSIONAL = 'agenda.ver_equipe,agenda.gerenciar_outras,vendas.acessar,estoque.acessar,financeiro.ver,equipe.gerenciar';

let db: PGlite;

async function como(user: string, negar = '') {
  await db.exec(`reset role;
    select set_config('app.uid', '${user}', false);
    select set_config('app.negar', '${negar}', false);
    select set_config('app.ver_equipe', '', false);
    set role authenticated;`);
}
async function admin<T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  return (await db.query<T>(q, p)).rows;
}
async function q<T = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, p)).rows;
}
async function erro(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); } catch (e) { return (e as Error).message; }
  return '(sem erro)';
}
async function fechar(p: unknown) {
  return (await db.query<{ id: string }>('select public.fechar_comanda($1::jsonb) as id', [JSON.stringify(p)])).rows[0].id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(fixture('schema-comanda-090.sql'));
  await db.exec(fixture('schema-cadeia-090-093.sql'));
  await db.exec(fixture('schema-alinhamentos-093.sql'));
  for (const m of ['090_comanda_tudo_ou_nada.sql', '091_taxa_cancelamento_por_atendimento.sql',
    '092_convites_e_historico_equipe.sql', '093_alinhamentos_finais.sql']) {
    await db.exec(migr(m));
  }
  // Tabelas/colunas de produção que a 094 usa e o esquema resumido da cadeia não tem.
  await db.exec(`
    alter table empresa_membros add column if not exists id uuid default gen_random_uuid();
    create table avaliacoes (id uuid primary key default gen_random_uuid(), empresa_id uuid not null,
      agendamento_id uuid unique references agendamentos(id) on delete cascade, cliente_id uuid not null,
      profissional_id uuid, nota smallint not null, comentario text);
    alter table avaliacoes enable row level security;
    grant all on avaliacoes to authenticated;
  `);
  await db.exec(migr('094_agenda_status_avaliacao_preferencia.sql'));
  // Rodar de novo: idempotente.
  await db.exec(migr('094_agenda_status_avaliacao_preferencia.sql'));
  await db.exec(`
    insert into empresas (id, owner_id, nome) values ('${E}', '${DONA}', 'Bellamore');
    insert into users (id, nome, email) values ('${DONA}', 'Dona', 'dona@x.com'), ('${P1}', 'P1', 'p1@x.com');
    insert into empresa_membros (empresa_id, user_id, percentual_comissao, role, ativo) values
      ('${E}', '${P1}', 40, 'profissional', true);
    insert into clientes values ('${CL}', '${E}');
    insert into servicos values ('${SV}', '${E}', 'Corte');
  `);
  for (let k = 1; k <= 4; k++) {
    await admin(`insert into agendamentos (id, empresa_id, profissional_id, cliente_id, servico_id, valor)
      values ($1, $2, $3, $4, $5, 100)`, [ag(k), E, P1, CL, SV]);
  }
}, 60_000);

describe('094 em cima da 093 (produção)', () => {
  it('comanda fechada pela função trava o status; editar_comanda continua funcionando', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    const C = id('c0', 1);
    await fechar({ comanda_id: C, empresa_id: E, cliente_id: CL, desconto: 0,
      atendimentos: [{ agendamento_id: ag(1), valor: 100 }], itens: [], pagamentos: [{ valor: 100, metodo: 'pix' }] });
    expect(await erro(() => q(`update agendamentos set status = 'agendado' where id = $1`, [ag(1)])))
      .toBe('Já fechado na comanda. Para mudar, edite a comanda.');
    // editar_comanda (093) mexe em valor/desconto_rateado, nunca no status: a trava não atrapalha.
    await db.query('select public.editar_comanda($1::jsonb)', [JSON.stringify({
      comanda_id: C, empresa_id: E, desconto: 10, atendimentos: [{ agendamento_id: ag(1), valor: 100 }], itens: [],
      pagamentos: [{ valor: 90, metodo: 'pix' }],
    })]);
    expect(await admin(`select status::text s, desconto_rateado d from agendamentos where id = $1`, [ag(1)]))
      .toEqual([{ s: 'concluido', d: '10.00' }]);
    // A comissão da comanda ficou (nada da 094 apagou).
    expect(await admin(`select count(*)::int n from comissoes where agendamento_id = $1`, [ag(1)])).toEqual([{ n: 1 }]);
  });

  it('concluir sem comanda → voltar → concluir: uma comissão só; depois de voltar dá para excluir', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    await q(`update agendamentos set status = 'concluido' where id = $1`, [ag(2)]);
    expect(await admin(`select count(*)::int n from comissoes where agendamento_id = $1`, [ag(2)])).toEqual([{ n: 1 }]);
    await como(P1, PADRAO_PROFISSIONAL);
    await q(`update agendamentos set status = 'agendado' where id = $1`, [ag(2)]);
    expect(await admin(`select count(*)::int n from comissoes where agendamento_id = $1`, [ag(2)])).toEqual([{ n: 0 }]);
    await como(P1, PADRAO_PROFISSIONAL);
    await q(`update agendamentos set status = 'concluido' where id = $1`, [ag(2)]);
    expect(await admin(`select count(*)::int n from comissoes where agendamento_id = $1`, [ag(2)])).toEqual([{ n: 1 }]);
    // Fechar a comanda depois do atalho continua possível (concluído → concluído, sem desfazer nada).
    await como(P1, PADRAO_PROFISSIONAL);
    await fechar({ comanda_id: id('c0', 2), empresa_id: E, cliente_id: CL, desconto: 0,
      atendimentos: [{ agendamento_id: ag(2), valor: 100 }], itens: [], pagamentos: [{ valor: 100, metodo: 'pix' }] });
    expect(await admin(`select count(*)::int n from comissoes where agendamento_id = $1`, [ag(2)])).toEqual([{ n: 1 }]);

    // Atendimento que voltou de Concluído não deixa comissão presa: o DELETE passa pela FK.
    await como(P1, PADRAO_PROFISSIONAL);
    await q(`update agendamentos set status = 'concluido' where id = $1`, [ag(3)]);
    await q(`update agendamentos set status = 'cancelado', cobrar_taxa_cancelamento = false where id = $1`, [ag(3)]);
    await admin(`delete from agendamentos where id = $1`, [ag(3)]);
    expect(await admin(`select count(*)::int n from agendamentos where id = $1`, [ag(3)])).toEqual([{ n: 0 }]);
  });

  it('avaliação: profissional_id vira o vínculo da profissional do atendimento', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    await q(`insert into avaliacoes (empresa_id, agendamento_id, cliente_id, profissional_id, nota)
      values ($1, $2, $3, $4, 5)`, [E, ag(4), CL, P1]);
    const [m] = await admin<{ id: string }>(`select id from empresa_membros where user_id = $1`, [P1]);
    expect(await admin(`select profissional_id p from avaliacoes where agendamento_id = $1`, [ag(4)])).toEqual([{ p: m.id }]);
  });
});
