import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', '086_cartoes_maquininhas_bandeiras.sql'), 'utf8').toLowerCase();

describe('Migration 086: cartões', () => {
  it('três tabelas com checks', () => {
    expect(sql).toMatch(/create table if not exists public\.cartao_bandeiras/);
    expect(sql).toMatch(/create table if not exists public\.cartao_maquininhas/);
    expect(sql).toMatch(/create table if not exists public\.cartao_taxas/);
    expect(sql).toMatch(/max_parcelas int not null default 12 check \(max_parcelas between 1 and 18\)/);
    expect(sql).toMatch(/taxa numeric\(6,4\) not null check \(taxa between 0 and 0\.2\)/);
    expect(sql).toMatch(/check \(modalidade in \('debito', ?'credito'\)\)/);
    expect(sql).toMatch(/check \(modalidade = 'credito' or parcelas = 1\)/);
  });
  it('unicidades', () => {
    expect(sql).toMatch(/unique \(empresa_id, chave\)/);
    expect(sql).toMatch(/create unique index if not exists uq_cartao_maquininha_padrao\s+on public\.cartao_maquininhas \(empresa_id\) where padrao and ativa/);
    expect(sql).toMatch(/create unique index if not exists uq_cartao_taxas_linha/);
  });
  it('rls: leitura de membro, escrita com config.taxas', () => {
    for (const t of ['cartao_bandeiras', 'cartao_maquininhas', 'cartao_taxas']) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
    }
    expect(sql.match(/tem_permissao\(empresa_id, 'config\.taxas'\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toMatch(/empresa_id in \(select minha_empresas\(\)\)/);
  });
  it('seed das empresas existentes e de empresa nova; maquininha no pagamento', () => {
    expect(sql).toContain('create or replace function public.semear_cartoes_empresa(p_empresa_id uuid)');
    expect(sql).toMatch(/after insert on public\.empresas/);
    expect(sql).toMatch(/add column if not exists maquininha_id uuid references public\.cartao_maquininhas\(id\) on delete set null/);
    expect(sql).toContain('taxa_cartao_credito_parcelado');
  });
  it('idempotente e recarrega o schema', () => {
    expect(sql).toMatch(/drop trigger if exists trg_semear_cartoes_empresa/);
    expect(sql.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
  it('vendas.acessar libera leitura de vendas/venda_itens/pagamentos da venda e o desfazer (I1)', () => {
    const s1 = sql.replace(/\s+/g, ' ');
    expect(s1).toContain(`drop policy if exists "vendas: vendas.acessar ve" on public.vendas; create policy "vendas: vendas.acessar ve" on public.vendas for select using (tem_permissao(empresa_id, 'vendas.acessar'));`);
    expect(s1).toContain(`drop policy if exists "vendas: vendas.acessar deleta" on public.vendas; create policy "vendas: vendas.acessar deleta" on public.vendas for delete using (tem_permissao(empresa_id, 'vendas.acessar'));`);
    expect(s1).toContain(`drop policy if exists "venda_itens: vendas.acessar ve" on public.venda_itens; create policy "venda_itens: vendas.acessar ve" on public.venda_itens for select using (tem_permissao(empresa_id, 'vendas.acessar'));`);
    // pagamentos: a policy da 083 inteira (sem alteração) + o ramo da venda
    const m083 = readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', '083_permissoes_configuraveis.sql'), 'utf8').toLowerCase().replace(/\r\n/g, '\n');
    const corpo = (s: string) => {
      const i = s.lastIndexOf('create policy "pagamentos: profissional ou gestor ve"');
      return s.slice(i, s.indexOf(');', i));
    };
    const de083 = corpo(m083);
    const de086 = corpo(sql);
    expect(de083.length).toBeGreaterThan(50);
    expect(de086.startsWith(de083.trimEnd())).toBe(true);
    expect(de086).toContain("or (venda_id is not null and tem_permissao(empresa_id, 'vendas.acessar'))");
    expect(sql).toContain('drop policy if exists "pagamentos: profissional ou gestor ve" on public.pagamentos');
  });
  it('funções de seed fora do alcance da API', () => {
    expect(sql).toContain('revoke execute on function public.semear_cartoes_empresa(uuid) from public, anon, authenticated');
    expect(sql).toContain('revoke execute on function public.trg_fn_semear_cartoes_empresa() from public, anon, authenticated');
  });
});
