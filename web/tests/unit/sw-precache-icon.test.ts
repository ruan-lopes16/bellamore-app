import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('sw.js — pré-cache não referencia uma rota inexistente', () => {
  const sw = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');

  it('usa /icon.png (rota real gerada pelo Next), não /icon (404)', () => {
    const bloco = sw.slice(sw.indexOf('const PRECACHE'), sw.indexOf('];') + 2);
    expect(bloco).toContain("'/icon.png'");
    expect(bloco).not.toContain("'/icon',");
  });

  it('bump de versão do cache para forçar reinstalação em dispositivos travados', () => {
    expect(sw).not.toContain("const CACHE = 'bellamore-v2'");
  });
});
