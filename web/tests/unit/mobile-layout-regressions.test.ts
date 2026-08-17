import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

describe('mobile layout regressions', () => {
  it('reserves the same safe-area space for the page content and bottom navigation', () => {
    const css = read('app/globals.css');
    const layout = read('components/AppLayout.tsx');
    const sidebar = read('components/Sidebar.tsx');

    expect(css).toContain('--bm-mobile-nav-height');
    expect(css).toContain('--bm-mobile-nav-space');
    expect(css).toContain('--bm-mobile-content-bottom');
    expect(layout).toContain('pb-[var(--bm-mobile-content-bottom)]');
    expect(sidebar).toMatch(/minHeight:\s+'var\(--bm-mobile-nav-height\)'/);
  });

  it('keeps the comanda inside the usable mobile viewport', () => {
    const css = read('app/globals.css');
    const comanda = read('app/(app)/comanda/page.tsx');

    expect(comanda).toContain('bm-comanda-shell');
    expect(comanda).not.toContain('-mt-6 -mb-24');
    expect(css).toContain('.bm-comanda-shell');
    expect(css).toContain('100dvh - var(--bm-mobile-nav-space) - 1.5rem');
  });

  it('keeps dense mobile controls reachable without overlapping', () => {
    expect(read('app/globals.css')).toContain('.bm-mobile-actions');
    expect(read('app/(app)/agenda/page.tsx')).toContain('bm-mobile-actions');
    expect(read('app/(app)/comissoes/ComissoesGestorView.tsx')).toContain('flex-col gap-3 p-4 sm:flex-row');
  });

  it('provides reusable mobile header and stock action layout hooks', () => {
    const css = read('app/globals.css');

    expect(css).toContain('.bm-mobile-page-header');
    expect(css).toContain('.bm-mobile-stock-actions');
  });

  it('declara viewport-fit=cover para env(safe-area-inset-*) funcionar no PWA iOS', () => {
    const layout = read('app/layout.tsx');

    expect(layout).toMatch(/export const viewport/);
    expect(layout).toContain("viewportFit: 'cover'");
  });

  it('nao usa overflow-hidden junto de overflow-x-auto na tabela do Estoque (ambiguidade de cascata)', () => {
    const pagina  = read('app/(app)/estoque/page.tsx');
    const loading = read('app/(app)/estoque/loading.tsx');

    expect(pagina).not.toMatch(/overflow-hidden[^"]*overflow-x-auto/);
    expect(pagina).toMatch(/overflow-y-hidden[^"]*overflow-x-auto/);
    expect(pagina).toContain('max-md:shadow-[inset_-12px_0_12px_-12px_rgba(0,0,0,0.15)]');
    expect(loading).not.toMatch(/overflow-hidden[^"]*overflow-x-auto/);
    expect(loading).toMatch(/overflow-y-hidden[^"]*overflow-x-auto/);
  });
});
