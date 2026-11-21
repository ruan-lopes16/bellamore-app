/**
 * Achado da verificação visual (2026-11-21): o cabeçalho do cartão da profissional na Equipe era um
 * <button> com outro <button> (lápis) e links dentro — HTML inválido e erro de hidratação no React.
 * O cabeçalho virou div com role="button" (Enter/Espaço também expandem).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const equipe = readFileSync(join(__dirname, '..', '..', 'app', '(app)', 'equipe', 'page.tsx'), 'utf8').replace(/\r\n/g, '\n');

describe('Equipe: cabeçalho do cartão sem botão aninhado', () => {
  it('cabeçalho é div com papel de botão, não <button>', () => {
    expect(equipe).not.toMatch(/<button onClick=\{\(\) => setExpandido/);
    expect(equipe).toMatch(/<div role="button" tabIndex=\{0\} aria-expanded=\{expandido\}/);
  });
  it('Enter e Espaço expandem pelo teclado', () => {
    expect(equipe).toMatch(/e\.key === 'Enter' \|\| e\.key === ' '/);
  });
});
