import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', '087_registrar_venda_avulsa.sql'), 'utf8').toLowerCase();
// Corpo sem comentários: as checagens não podem passar por causa de um texto no cabeçalho.
const corpo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

describe('migration 087 — registrar_venda_avulsa', () => {
  it('cria a função com a assinatura combinada e devolve uuid', () => {
    expect(corpo).toMatch(/create or replace function public\.registrar_venda_avulsa\(\s*p_empresa uuid,\s*p_cliente uuid,\s*p_desconto numeric,\s*p_itens jsonb,\s*p_pagamentos jsonb\s*\)\s*returns uuid/);
  });
  it('roda com as permissões de quem chama (RLS vale), nunca security definer', () => {
    expect(corpo).not.toContain('security definer');
    expect(corpo).toContain('security invoker');
  });
  it('exige vendas.acessar e comanda.desconto para desconto/cortesia', () => {
    expect(corpo).toContain("tem_permissao(p_empresa, 'vendas.acessar')");
    expect(corpo).toContain("tem_permissao(p_empresa, 'comanda.desconto')");
    expect(corpo).toContain("errcode = '42501'");
  });
  it('calcula o valor_total na função (soma dos itens), não recebe da tela', () => {
    expect(corpo).not.toMatch(/p_valor_total/);
    expect(corpo).toMatch(/sum\(round\(i\.preco_unitario, 2\) \* i\.quantidade\)/);
  });
  it('trava o estoque por produto e recusa saldo insuficiente', () => {
    expect(corpo).toContain('pg_advisory_xact_lock');
    expect(corpo).toContain('estoque insuficiente');
    expect(corpo).not.toMatch(/for update/);
  });
  it('gera o id da venda na função (sem returning, que exigiria a policy de select)', () => {
    expect(corpo).toContain('v_venda := gen_random_uuid()');
    expect(corpo).not.toMatch(/returning id into/);
  });
  it('grava venda, itens, saída de estoque e pagamentos', () => {
    expect(corpo).toContain('insert into public.vendas');
    expect(corpo).toContain('insert into public.venda_itens');
    expect(corpo).toContain('insert into public.estoque_movimentos');
    expect(corpo).toContain('insert into public.pagamentos');
    expect(corpo).toContain("'venda avulsa'");
  });
  it('baixa de estoque na mesma ordem das travas (order by produto_id no loop e nos 2 inserts)', () => {
    expect(corpo.match(/order by i.produto_id/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
  it('separa desconto inválido de desconto maior que o subtotal', () => {
    expect(corpo).toContain("'desconto inválido.'");
    expect(corpo).toContain("'o desconto não pode ser maior que o subtotal.'");
  });
  it('diz qual produto está indisponível para venda', () => {
    expect(corpo).toContain("'produto indisponível para venda: %.'");
  });
  it('execução só para authenticated e recarrega o schema', () => {
    expect(corpo).toMatch(/revoke all on function public\.registrar_venda_avulsa\(uuid, uuid, numeric, jsonb, jsonb\) from public, anon/);
    expect(corpo).toMatch(/grant execute on function public\.registrar_venda_avulsa\(uuid, uuid, numeric, jsonb, jsonb\) to authenticated/);
    expect(corpo).toContain("notify pgrst, 'reload schema'");
  });
});
