import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

// Decisão do dono (2026-09-29): a cliente final não tem login nem acesso.
describe('sem área nem papel de cliente final', () => {
  it('pasta mobile/app/(cliente) e hook useCliente não existem', () => {
    expect(existsSync(join(root, 'mobile/app/(cliente)'))).toBe(false);
    expect(existsSync(join(root, 'mobile/hooks/useCliente.ts'))).toBe(false);
  });

  for (const arq of ['shared/dominio.ts', 'web/types/index.ts', 'mobile/types/index.ts']) {
    it(`${arq}: PerfilRole sem 'cliente'`, () => {
      const linha = ler(arq).split('\n').find(l => l.includes('export type PerfilRole'))!;
      expect(linha).toBeDefined();
      expect(linha).not.toContain("'cliente'");
    });
  }

  for (const arq of ['web/lib/permissions.ts', 'mobile/lib/permissions.ts']) {
    it(`${arq}: sem papel nem rota de cliente`, () => {
      const src = ler(arq);
      expect(src).not.toMatch(/cliente:\s*\[\]/);
      expect(src).not.toMatch(/case 'cliente'/);
    });
  }

  it.todo("nenhum código do mobile grava empresa_membros com role 'cliente' (ativado na Task 7)");
});
