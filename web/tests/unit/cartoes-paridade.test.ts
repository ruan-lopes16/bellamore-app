import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

/** Todos os .ts/.tsx de uma pasta (recursivo, sem node_modules). */
function arquivos(dir: string): string[] {
  const abs = join(root, dir);
  const out: string[] = [];
  for (const nome of readdirSync(abs)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const rel = `${dir}/${nome}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...arquivos(rel));
    else if (/\.tsx?$/.test(nome)) out.push(rel);
  }
  return out;
}

describe('cobrança pela configuração de cartões (maquininhas)', () => {
  const telas = ['web/app/(app)/comanda/page.tsx', 'web/app/(app)/vendas/page.tsx', 'mobile/app/(empresa)/nova-comanda.tsx'];
  for (const t of telas) {
    it(`${t} carrega a configuração com carregarConfigCartoes`, () => {
      const src = ler(t);
      expect(src).toContain('carregarConfigCartoes(');
      expect(src).not.toContain('taxasDaEmpresa(');
    });
  }

  it('ninguém usa mais calcTaxa nem OPCOES_PARCELAS', () => {
    const lista = [...arquivos('web/app'), ...arquivos('mobile/app'), 'shared/comanda-fechamento.ts'];
    expect(lista.length).toBeGreaterThan(10);
    for (const arq of lista) {
      const src = ler(arq);
      expect(src, arq).not.toContain('calcTaxa(');
      expect(src, arq).not.toContain('OPCOES_PARCELAS');
    }
  });

  it('comanda web: seletor de maquininha, bandeiras e parcelas da configuração, aviso de taxa ausente', () => {
    const src = ler('web/app/(app)/comanda/page.tsx');
    for (const f of ['maquininhasAtivas(', 'bandeirasAtivas(', 'parcelasDisponiveis(', 'maquininhaPadrao(', 'nomeBandeira(']) expect(src).toContain(f);
    expect(src).toContain('Taxa não cadastrada para esta combinação');
    expect(src).toContain('maquininha_id');
    expect(src).toContain('maquininhaGravada');
    expect(src).toContain('bandeiraGravada');
  });
});
