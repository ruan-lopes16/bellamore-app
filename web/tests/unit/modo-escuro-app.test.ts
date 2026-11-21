import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

/**
 * Varredura do modo escuro do app: toda tela usa o tema do usuário e nenhum arquivo define
 * paleta própria. `PENDENTES` lista o que ainda falta migrar (Tasks 2 a 5 do plano
 * `docs/superpowers/plans/2026-11-21-modo-escuro-app.md`); cada task tira os seus da lista
 * e a Task 6 deixa a lista vazia.
 */
const RAIZ = path.resolve(__dirname, '../../../mobile');

function listar(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = path.join(dir, nome);
    if (nome === 'node_modules') return [];
    return statSync(p).isDirectory() ? listar(p) : /\.tsx?$/.test(nome) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(RAIZ, p).split(path.sep).join('/');

/** Arquivos (relativos a `mobile/`) ainda com paleta própria ou sem `comTemaDoUsuario`. */
const PENDENTES = new Set<string>([
]);

const TELAS = listar(path.join(RAIZ, 'app')).filter((p) => {
  const nome = path.basename(p);
  if (nome === '_layout.tsx') return false;
  const src = readFileSync(p, 'utf8');
  // reexportações (`export { default } from ...`) herdam o tema da tela original
  return !/^\s*export (\{ default \}|\*) from /m.test(src);
});
const ARQUIVOS = [...TELAS, ...listar(path.join(RAIZ, 'components'))];

describe('modo escuro do app', () => {
  it('toda tela usa comTemaDoUsuario(', () => {
    const faltam = TELAS.map(rel).filter((r) => !PENDENTES.has(r) && !readFileSync(path.join(RAIZ, r), 'utf8').includes('comTemaDoUsuario('));
    expect(faltam).toEqual([]);
  });

  it('nenhuma tela nem componente define paleta própria', () => {
    const com = ARQUIVOS.map(rel).filter((r) => {
      if (PENDENTES.has(r) || r === 'lib/tema.tsx') return false;
      const src = readFileSync(path.join(RAIZ, r), 'utf8');
      return /const C = \{(?!\s*\.\.\.)/.test(src) || /bg: '#F4F1EE'/.test(src);
    });
    expect(com).toEqual([]);
  });

  it('a lista de pendentes só tem arquivos que existem', () => {
    for (const r of PENDENTES) expect(() => readFileSync(path.join(RAIZ, r), 'utf8')).not.toThrow();
  });

  it('as 12 telas já migradas usam as chaves *Texto e não mantêm paleta própria', () => {
    for (const r of ['app/(empresa)/dashboard.tsx', 'app/(empresa)/agenda.tsx', 'app/(empresa)/clientes.tsx', 'app/(empresa)/mais.tsx']) {
      const src = readFileSync(path.join(RAIZ, r), 'utf8');
      expect(src).toContain('comTemaDoUsuario(');
      expect(src).not.toMatch(/(?<![A-Za-z])color: C\.(primary|green|amber|red)\b(?!Texto|Soft)/);
    }
  });
});
