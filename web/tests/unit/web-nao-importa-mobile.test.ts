import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// O build do web no Vercel só instala as dependências de `web/`. Se qualquer
// arquivo do web (inclusive testes, que entram no type-check do `next build`)
// IMPORTAR um módulo de `mobile/`, as dependências do app (react-native,
// @tanstack/react-query, expo...) não são encontradas e o deploy falha —
// aconteceu em 2026-10-01 (PR #140). Lógica compartilhada mora em `shared/`.
// Ler o TEXTO de arquivos do mobile (readFileSync) continua permitido.

function arquivos(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === '.next') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivos(p, out);
    else if (/\.(ts|tsx)$/.test(nome)) out.push(p);
  }
  return out;
}

describe('nenhum arquivo do web importa módulos do mobile', () => {
  const raiz = join(__dirname, '..', '..');
  // Este próprio arquivo cita o padrão em comentário/regex — fica fora da varredura.
  const lista = arquivos(raiz).filter((f) => !f.endsWith('web-nao-importa-mobile.test.ts'));

  it('varreu os arquivos do web', () => {
    expect(lista.length).toBeGreaterThan(50);
  });

  it('sem import/export from ".../mobile/..." nem "@mobile/..."', () => {
    const ofensores = lista.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /(?:import|export)[^;]*?from\s+['"](?:[./]*mobile\/|@mobile\/)/.test(src)
        || /import\(\s*['"](?:[./]*mobile\/|@mobile\/)/.test(src);
    });
    expect(ofensores).toEqual([]);
  });
});
