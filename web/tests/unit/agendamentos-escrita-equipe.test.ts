import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const sql = readFileSync(join(root, 'supabase/migrations/082_agendamentos_escrita_profissional_gestora.sql'), 'utf8');

describe('migration 082 — profissional e gestora gravam agendamentos', () => {
  it('INSERT: membro da empresa, sendo gestor/owner ou o próprio profissional do agendamento', () => {
    expect(sql).toMatch(
      /for insert\s+with check \(\s*empresa_id in \(select minha_empresas\(\)\)\s+and \(is_gestor_ou_owner\(empresa_id\) or profissional_id = auth\.uid\(\)\)\s*\)/,
    );
  });

  it('UPDATE: mesma regra no USING e no WITH CHECK (profissional não repassa o agendamento a outra)', () => {
    expect(sql).toMatch(
      /for update\s+using \(\s*empresa_id in \(select minha_empresas\(\)\)\s+and \(is_gestor_ou_owner\(empresa_id\) or profissional_id = auth\.uid\(\)\)\s*\)\s+with check \(\s*empresa_id in \(select minha_empresas\(\)\)\s+and \(is_gestor_ou_owner\(empresa_id\) or profissional_id = auth\.uid\(\)\)\s*\)/,
    );
  });

  it('é idempotente e não mexe em DELETE nem na policy antiga da dona', () => {
    expect(sql).toMatch(/drop policy if exists "agendamentos: equipe insere"/);
    expect(sql).toMatch(/drop policy if exists "agendamentos: equipe atualiza"/);
    expect(sql).not.toMatch(/drop policy[^;]*exclui/);
    expect(sql).not.toMatch(/drop policy[^;]*gestor pode gerenciar agendamentos/);
    expect(sql).toMatch(/notify pgrst, 'reload schema';/);
  });
});
