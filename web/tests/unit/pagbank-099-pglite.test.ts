import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Migrations 098 + 099 executadas num Postgres em memória (PGlite, sem rede): tabela padrão até 18x,
 * Diners Club com exceção no crédito e recálculo de TODOS os pagamentos de cartão pela bandeira.
 * Esquema mínimo: só as colunas que as duas migrations tocam.
 */
const EMP = '603fdaa1-be97-46a0-9333-325b30dea2ef';
const OUTRA = '11111111-1111-1111-1111-111111111111';
const ler = (n: string) => readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', n), 'utf8');

let db: PGlite;
const taxaDe = async (id: string) => (await db.query<{ taxa_perc: string | null; valor_liquido: string | null; maquininha_id: string | null }>(
  'select taxa_perc, valor_liquido, maquininha_id from pagamentos where id = $1', [id])).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create type pagamento_metodo as enum ('dinheiro','pix','credito','debito','cortesia');
    create table empresas (id uuid primary key, taxa_cartao_debito numeric, taxa_cartao_credito_avista numeric, taxa_cartao_credito_parcelado numeric);
    create table cartao_bandeiras (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, chave text not null, nome text not null, ativa boolean not null default true, ordem int not null default 0, unique (empresa_id, chave));
    create table cartao_maquininhas (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, nome text not null, max_parcelas int not null default 12, ativa boolean not null default true, padrao boolean not null default false, ordem int not null default 0);
    create table cartao_taxas (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, maquininha_id uuid not null references cartao_maquininhas(id) on delete cascade, bandeira_id uuid references cartao_bandeiras(id) on delete cascade, modalidade text not null, parcelas int not null, taxa numeric(6,4) not null);
    create table pagamentos (id text primary key, empresa_id uuid not null, metodo pagamento_metodo not null, valor numeric(10,2) not null, status text not null default 'pago', bandeira text, parcelas int not null default 1, taxa_perc numeric(5,4), valor_liquido numeric(10,2), maquininha_id uuid, created_at timestamptz not null default now());
    insert into empresas values ('${EMP}', 0.0239, 0.0499, 0.0559), ('${OUTRA}', 0.0239, 0.0499, 0.0559);
    insert into cartao_bandeiras (empresa_id, chave, nome, ordem) values
      ('${EMP}','visa','Visa',1), ('${EMP}','mastercard','Master',2), ('${EMP}','elo','Elo',3),
      ('${OUTRA}','visa','Visa',1);
    insert into cartao_maquininhas (empresa_id, nome, max_parcelas, padrao, ordem) values ('${EMP}','Maquininha',12,true,1), ('${OUTRA}','Maquininha',12,true,1);
    -- tabela padrão da 086: débito, crédito 1x e 2x..12x (as duas empresas)
    insert into cartao_taxas (empresa_id, maquininha_id, bandeira_id, modalidade, parcelas, taxa)
      select m.empresa_id, m.id, null, 'debito', 1, 0.0239 from cartao_maquininhas m;
    insert into cartao_taxas (empresa_id, maquininha_id, bandeira_id, modalidade, parcelas, taxa)
      select m.empresa_id, m.id, null, 'credito', n, case when n = 1 then 0.0499 else 0.0559 end
        from cartao_maquininhas m cross join generate_series(1, 12) n;
    insert into pagamentos (id, empresa_id, metodo, valor, bandeira, parcelas, taxa_perc, valor_liquido) values
      ('deb-visa',   '${EMP}',  'debito',  100, 'visa',       1, 0.0300, 97.00),
      ('cred1-visa', '${EMP}',  'credito', 100, 'visa',       1, 0.0499, 95.01),
      ('cred3-elo',  '${EMP}',  'credito', 200, 'elo',        3, null,   null),
      ('cred1-din',  '${EMP}',  'credito', 100, 'diners-club',1, null,   null),
      ('cred18-din', '${EMP}',  'credito', 100, 'diners-club',18, null,  null),
      ('cred20-visa','${EMP}',  'credito', 100, 'visa',       20, 0.0559, 94.41),
      ('pix',        '${EMP}',  'pix',     100, null,         1, null,   null),
      ('outra-emp',  '${OUTRA}','credito', 100, 'visa',       1, 0.0100, 99.00);
  `);
  await db.exec(ler('098_cartoes_restaurar_taxas_originais.sql'));
  await db.exec(ler('099_pagbank_recalcular_taxas_cartao.sql'));
});

describe('098 + 099: PagBank', () => {
  it('maquininha da empresa vira PagBank com 18x; a de outra empresa não é renomeada', async () => {
    const r = await db.query<{ empresa_id: string; nome: string; max_parcelas: number }>('select empresa_id, nome, max_parcelas from cartao_maquininhas');
    expect(r.rows.find(x => x.empresa_id === EMP)).toMatchObject({ nome: 'PagBank', max_parcelas: 18 });
    expect(r.rows.find(x => x.empresa_id === OUTRA)?.nome).toBe('Maquininha');
  });

  it('débito e crédito pela tabela padrão; líquido recalculado', async () => {
    expect(await taxaDe('deb-visa')).toMatchObject({ taxa_perc: '0.0239', valor_liquido: '97.61' });
    expect(await taxaDe('cred1-visa')).toMatchObject({ taxa_perc: '0.0499', valor_liquido: '95.01' });
    expect(await taxaDe('cred3-elo')).toMatchObject({ taxa_perc: '0.0559', valor_liquido: '188.82' });
  });

  it('Diners Club usa a exceção do crédito (1x e 18x)', async () => {
    expect(await taxaDe('cred1-din')).toMatchObject({ taxa_perc: '0.0319', valor_liquido: '96.81' });
    expect(await taxaDe('cred18-din')).toMatchObject({ taxa_perc: '0.0379', valor_liquido: '96.21' });
  });

  it('o que não tem linha de taxa, Pix e outra empresa ficam intocados', async () => {
    expect(await taxaDe('cred20-visa')).toMatchObject({ taxa_perc: '0.0559', valor_liquido: '94.41' });
    expect(await taxaDe('pix')).toMatchObject({ taxa_perc: null, valor_liquido: null });
    expect(await taxaDe('outra-emp')).toMatchObject({ taxa_perc: '0.0100', valor_liquido: '99.00' });
  });

  it('guarda backup dos valores antigos e vincula a maquininha', async () => {
    const b = await db.query<{ id: string; taxa_perc: string | null }>('select id, taxa_perc from pagamentos_taxas_backup_099 order by id');
    expect(b.rows.find(x => x.id === 'deb-visa')?.taxa_perc).toBe('0.0300');
    expect(b.rows.find(x => x.id === 'pix')).toBeUndefined();
    expect((await taxaDe('deb-visa')).maquininha_id).not.toBeNull();
  });
});
