import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) return n === 'node_modules' || n === '.next' ? [] : arquivos(f);
    return /\.(ts|tsx)$/.test(n) ? [f] : [];
  });
}

describe('aniversário nos formulários de cliente', () => {
  for (const arq of [
    'web/app/(app)/clientes/page.tsx',
    'web/app/(app)/clientes/[id]/page.tsx',
    'mobile/app/(empresa)/novo-cliente.tsx',
    'mobile/app/(empresa)/cliente/[id]/editar.tsx',
  ]) {
    it(`${arq}: bloqueia aniversário pela metade`, () => {
      expect(ler(arq)).toContain('Escolha o mês e o dia do aniversário');
    });
  }
  it('nenhum arquivo de web/app monta a data com o template 1900-', () => {
    for (const f of arquivos(join(root, 'web', 'app'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/`1900-/);
    }
  });
  it('cadastro rápido do mobile exige nome com mais de 1 caractere', () => {
    expect(ler('mobile/app/(empresa)/novo-agendamento.tsx')).toMatch(/novoClienteNome\.trim\(\)\.length\s*>\s*1/);
  });
});
