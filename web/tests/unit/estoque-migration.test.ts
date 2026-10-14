import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', '088_estoque_movimentar_e_unidades.sql'), 'utf8')
  .toLowerCase().replace(/\r\n/g, '\n');
const corpo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const sql087 = readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', '087_registrar_venda_avulsa.sql'), 'utf8').toLowerCase();

describe('migration 088 — movimentar_estoque', () => {
  it('assinatura e retorno numeric', () => {
    expect(corpo).toMatch(/create or replace function public\.movimentar_estoque\(\s*p_produto uuid,\s*p_tipo text,\s*p_quantidade numeric,\s*p_motivo text\s*\)\s*returns numeric/);
  });
  it('security invoker, nunca definer', () => {
    expect(corpo).toContain('security invoker');
    expect(corpo).not.toContain('security definer');
  });
  it('exige estoque.acessar com 42501', () => {
    expect(corpo).toContain("tem_permissao(v_empresa, 'estoque.acessar')");
    expect(corpo).toContain("errcode = '42501'");
  });
  it('mesma chave de trava da 087 (venda avulsa e movimentação em fila)', () => {
    const chave = "hashtextextended('venda_estoque:' || ";
    expect(sql087).toContain(chave);
    expect(corpo).toContain(chave);
    expect(corpo).toContain('pg_advisory_xact_lock');
    expect(corpo).not.toMatch(/from public.produtos[^;]*for update/);
  });
  it('recusa saída maior que o saldo e valida tipo e quantidade', () => {
    expect(corpo).toContain('estoque insuficiente');
    expect(corpo).toContain('tipo de movimentação inválido.');
    expect(corpo).toContain('informe uma quantidade maior que zero.');
  });
  it('grava o movimento sem returning e devolve o saldo relido', () => {
    expect(corpo).toContain('insert into public.estoque_movimentos');
    expect(corpo).not.toMatch(/returning/);
    expect(corpo).toMatch(/return coalesce\(v_saldo, 0\)/);
  });
  it('ordem: permissão, trava, releitura do saldo, insert, releitura final', () => {
    const iPerm = corpo.indexOf("tem_permissao(v_empresa, 'estoque.acessar')");
    const iTrava = corpo.indexOf('pg_advisory_xact_lock');
    const iRel = corpo.indexOf('pr.estoque_atual, pr.ativo into');
    const iIns = corpo.indexOf('insert into public.estoque_movimentos');
    const iFinal = corpo.indexOf('select pr.estoque_atual into v_saldo');
    for (const i of [iPerm, iTrava, iRel, iIns, iFinal]) expect(i).toBeGreaterThan(-1);
    expect(iPerm).toBeLessThan(iTrava);
    expect(iTrava).toBeLessThan(iRel);
    expect(iRel).toBeLessThan(iIns);
    expect(iIns).toBeLessThan(iFinal);
  });
  it('arredonda a quantidade a 3 casas, com teto, e usa o valor arredondado', () => {
    expect(corpo).toContain('v_qtd := round(p_quantidade, 3)');
    expect(corpo).toContain('v_qtd > 9999999.999');
    expect(corpo).toContain('quantidade grande demais.');
    expect(corpo).toContain('< v_qtd');
    expect(corpo).toMatch(/p_tipo::movimento_tipo, v_qtd,/);
  });
  it('saldo na mensagem com vírgula', () => {
    expect(corpo).toContain("replace(trim_scale(coalesce(v_saldo, 0))::text, '.', ',')");
  });
  it('recusa produto inativo depois da trava', () => {
    const iAtivo = corpo.indexOf('coalesce(v_ativo, true) = false');
    expect(iAtivo).toBeGreaterThan(corpo.indexOf('pg_advisory_xact_lock'));
    expect(iAtivo).toBeLessThan(corpo.indexOf('insert into public.estoque_movimentos'));
    expect(corpo).toContain("'produto inativo: %.'");
  });
  it('execução só para authenticated', () => {
    expect(corpo).toMatch(/revoke all on function public\.movimentar_estoque\(uuid, text, numeric, text\) from public, anon/);
    expect(corpo).toMatch(/grant execute on function public\.movimentar_estoque\(uuid, text, numeric, text\) to authenticated/);
  });
});

describe('migration 088 — estoque_unidades_empresa', () => {
  it('tabela com chave por empresa, lista não vazia e cascade', () => {
    expect(corpo).toContain('create table if not exists public.estoque_unidades_empresa');
    expect(corpo).toMatch(/empresa_id\s+uuid primary key references public\.empresas\(id\) on delete cascade/);
    expect(corpo).toMatch(/check \(cardinality\(unidades\) between 1 and 50 and array_position\(unidades, null\) is null\)/);
  });
  it('rls: leitura de membro, escrita com estoque.acessar, sem delete', () => {
    expect(corpo).toContain('alter table public.estoque_unidades_empresa enable row level security');
    expect(corpo).toMatch(/for select\s+using \(empresa_id in \(select minha_empresas\(\)\)\)/);
    expect(corpo).toMatch(/for insert\s+with check \(tem_permissao\(empresa_id, 'estoque\.acessar'\)\)/);
    expect(corpo).toMatch(/for update\s+using \(tem_permissao\(empresa_id, 'estoque\.acessar'\)\)\s+with check \(tem_permissao\(empresa_id, 'estoque\.acessar'\)\)/);
    expect(corpo).not.toMatch(/for delete/);
  });
  it('idempotente e recarrega o schema', () => {
    expect(corpo.match(/drop policy if exists/g)?.length).toBe(3);
    expect(corpo).toContain("notify pgrst, 'reload schema'");
  });
});
