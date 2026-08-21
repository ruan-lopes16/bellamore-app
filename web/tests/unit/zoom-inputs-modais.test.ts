import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

describe('bloqueio de zoom em inputs (web/PWA)', () => {
  it('trava a fonte dos campos em 16px no mobile, vencendo as classes do Tailwind', () => {
    const css = read('app/globals.css');

    // O seletor precisa excluir checkbox/radio (fonte altera o tamanho da caixa)
    // e a declaracao precisa ser !important para vencer `text-sm` (13px no mobile).
    expect(css).toMatch(
      /input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\),[\s\S]{0,120}font-size:\s*16px\s*!important/,
    );

    // A regra antiga era inerte (perdia para a classe do Tailwind na cascata)
    // e nao pode sobreviver ao lado da nova.
    expect(css).not.toContain('font-size: max(16px, var(--text-base))');
  });

  it('desliga o pinch-zoom no PWA instalado sem perder o viewport-fit', () => {
    const layout = read('app/layout.tsx');

    expect(layout).toMatch(/maximumScale:\s*1/);
    expect(layout).toMatch(/userScalable:\s*false/);
    // viewportFit sustenta todos os env(safe-area-inset-*) do app — nao pode sumir.
    expect(layout).toContain("viewportFit: 'cover'");
  });

  it('reserva a calha da scrollbar para o modal nao deslocar a pagina no desktop', () => {
    expect(read('app/globals.css')).toMatch(/scrollbar-gutter:\s*stable/);
  });
});

describe('modais ancorados no viewport dinamico', () => {
  const arquivos = [
    'app/(app)/agenda/page.tsx',
    'app/(app)/clientes/page.tsx',
    'app/(app)/clientes/[id]/page.tsx',
    'app/(app)/equipe/page.tsx',
    'app/(app)/estoque/page.tsx',
    'app/(app)/financeiro/page.tsx',
    'app/(app)/pacotes/page.tsx',
    'app/(app)/servicos/page.tsx',
    'app/(app)/vendas/page.tsx',
  ];

  // `vh` mede o viewport grande no iOS (barra de URL escondida): o modal fica
  // mais alto que a area visivel e muda de altura sozinho quando a barra
  // aparece/some. O padrao \dvh casa "90vh" (digito antes de "vh") mas nao
  // casa "90dvh" (o caractere antes de "vh" e o "d").
  it.each(arquivos)('%s nao usa mais unidades vh', (arquivo) => {
    expect(read(arquivo)).not.toMatch(/\dvh/);
  });

  it('preserva as alturas originais, agora em dvh', () => {
    const agenda = read('app/(app)/agenda/page.tsx');
    expect(agenda).toContain('max-h-[90dvh]');
    expect(agenda).toContain('max-h-[85dvh]');
    expect(agenda).toContain("maxHeight: '62dvh'");

    expect(read('app/(app)/financeiro/page.tsx')).toContain('max-h-[90dvh]');
    expect(read('app/(app)/pacotes/page.tsx')).toContain('max-h-[94dvh]');

    const vendas = read('app/(app)/vendas/page.tsx');
    expect(vendas).toContain('max-h-[50dvh]');
    expect(vendas).toContain('md:h-[calc(100dvh-220px)]');
  });
});
