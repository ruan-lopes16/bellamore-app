import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), '..', 'supabase', 'migrations', '069_comandas_insert_rls_fix.sql'),
  'utf8',
).toLowerCase();

describe('Migration 069 — RLS de comandas garantida (INSERT falhava em produção)', () => {
  it('recria a policy de INSERT liberando qualquer membro da empresa', () => {
    expect(sql).toMatch(/create policy "comandas: membro insere"\s+on public\.comandas for insert/);
    expect(sql).toContain('with check (empresa_id in (select minha_empresas()))');
  });
  it('remove todos os nomes de policy possivelmente conflitantes antes de recriar', () => {
    expect(sql).toContain('drop policy if exists "comandas: membro gerencia"');
    expect(sql).toContain('drop policy if exists "comandas: membro insere"');
  });
  it('recria select/update/delete restritos a profissional dono ou gestor/owner', () => {
    expect(sql).toContain('comandas: profissional ou gestor ve');
    expect(sql).toContain('comandas: profissional ou gestor atualiza');
    expect(sql).toContain('comandas: profissional ou gestor deleta');
  });
});
