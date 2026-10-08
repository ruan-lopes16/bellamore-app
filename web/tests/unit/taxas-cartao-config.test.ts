import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CATALOGO_PERMISSOES } from '@shared/permissoes';
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('migration 084', () => {
  const sql = ler('supabase/migrations/084_taxas_cartao_empresa.sql');
  it('3 colunas taxa_cartao_* com padrão atual e limite', () => {
    expect(sql).toMatch(/add column if not exists taxa_cartao_debito\s+numeric\(6,4\) not null default 0\.0239/);
    expect(sql).toMatch(/add column if not exists taxa_cartao_credito_avista\s+numeric\(6,4\) not null default 0\.0499/);
    expect(sql).toMatch(/add column if not exists taxa_cartao_credito_parcelado\s+numeric\(6,4\) not null default 0\.0559/);
    expect(sql).toMatch(/between 0 and 0\.2/);
    expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});

describe('Configurações: taxas da maquininha', () => {
  it('permissão config.taxas cita a maquininha', () => {
    const c = CATALOGO_PERMISSOES.find(p => p.chave === 'config.taxas')!;
    expect(c.rotulo).toBe('Editar taxas de reserva, cancelamento e maquininha');
  });
  for (const arq of ['web/app/(app)/configuracoes/page.tsx', 'mobile/app/(empresa)/configuracoes.tsx']) {
    it(`${arq} edita as 3 taxas`, () => {
      const src = ler(arq);
      expect(src).toContain('Taxas da maquininha');
      for (const col of ['taxa_cartao_debito', 'taxa_cartao_credito_avista', 'taxa_cartao_credito_parcelado']) expect(src).toContain(col);
      expect(src).toContain("pode('config.taxas')");
    });
  }
});
