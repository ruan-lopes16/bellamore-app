import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

describe('safe area do topo no PWA', () => {
  it('define a folga do topo espelhando a que ja existe para a bottom nav', () => {
    const css = read('app/globals.css');

    // O projeto ja reservava env(safe-area-inset-bottom) para a bottom nav, mas
    // nunca reservou nada no topo — com viewport-fit=cover e status bar
    // translucida, o conteudo fica embaixo do relogio em todas as paginas.
    expect(css).toContain('--bm-mobile-content-top');
    expect(css).toMatch(/--bm-mobile-content-top:\s*calc\(env\(safe-area-inset-top, 0px\)/);
  });

  it('aplica a folga no conteudo de todas as paginas autenticadas', () => {
    const layout = read('components/AppLayout.tsx');

    expect(layout).toContain('pt-[var(--bm-mobile-content-top)]');
    // py-6 setava o topo em 24px fixos e precisa sair, senao a ordem das
    // classes decide o vencedor e o resultado fica dependente do build.
    expect(layout).not.toContain('py-6');
  });
});

describe('regressao da comanda com a folga nova', () => {
  it('a altura da comanda acompanha a folga do topo em vez de um valor fixo', () => {
    const css = read('app/globals.css');

    // .bm-comanda-shell subtraia 1.5rem porque esse era o padding-top do <main>.
    // Com a safe area reservada, um valor fixo faz a comanda estourar para baixo
    // exatamente a altura da status bar.
    expect(css).toContain('100dvh - var(--bm-mobile-nav-space) - var(--bm-mobile-content-top)');
    expect(css).not.toContain('100dvh - var(--bm-mobile-nav-space) - 1.5rem');
  });
});
