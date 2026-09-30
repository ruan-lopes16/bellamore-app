import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('observações internas da cliente (paridade com o mobile)', () => {
  it('web cria com observacoes no insert', () => {
    expect(ler('web/app/(app)/clientes/page.tsx')).toMatch(/observacoes: obs\.trim\(\) \|\| null/);
  });
  it('web edita observacoes no update e confere linhas afetadas', () => {
    const src = ler('web/app/(app)/clientes/[id]/page.tsx');
    expect(src).toMatch(/observacoes,\s*\n\s*\}\)\.eq\('id', id\)\.select\('id'\)/);
    expect(src).toContain('Observações internas');
  });
  it('perfil web usa só os helpers compartilhados de endereço', () => {
    expect(ler('web/app/(app)/clientes/[id]/page.tsx')).not.toMatch(/^function parseEndereco/m);
  });
});
