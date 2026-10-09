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

  it('montarPagamentos omite maquininha_id no legado (coluna só existe depois da 086)', () => {
    const src = ler('shared/comanda-fechamento.ts');
    const corpo = src.slice(src.indexOf('export function montarPagamentos('));
    // Toda atribuição de maquininha_id no INSERT fica atrás do "legado ? {} : { ... }"
    const atribuicoes = corpo.match(/maquininha_id:/g) ?? [];
    const guardadas = corpo.match(/config\.legado \? \{\} : \{ maquininha_id:/g) ?? [];
    expect(atribuicoes.length).toBeGreaterThan(0);
    expect(guardadas.length).toBe(atribuicoes.length);
    expect(src).toContain('maquininha_id?: string | null');
  });

  it('comanda web: seletor de maquininha, bandeiras e parcelas da configuração, aviso de taxa ausente', () => {
    const src = ler('web/app/(app)/comanda/page.tsx');
    for (const f of ['maquininhasAtivas(', 'bandeirasAtivas(', 'parcelasDisponiveis(', 'maquininhaPadrao(', 'nomeBandeira(']) expect(src).toContain(f);
    expect(src).toContain('Taxa não cadastrada para esta combinação');
    expect(src).toContain('maquininha_id');
    expect(src).toContain('maquininhaGravada');
    expect(src).toContain('bandeiraGravada');
  });
  it('comanda app: maquininha em chips (2+ ativas), bandeiras e parcelas da configuração, aviso e reabertura', () => {
    const src = ler('mobile/app/(empresa)/nova-comanda.tsx');
    for (const f of ['maquininhasAtivas(', 'bandeirasAtivas(', 'parcelasDisponiveis(', 'maquininhaPadrao(', 'nomeBandeira(', 'atualizarSplitMaquininha(']) expect(src).toContain(f);
    expect(src).toContain('maquininhasAtivas(config).length >= 2');
    expect(src).toContain('Taxa não cadastrada para esta combinação');
    expect(src).toContain('maquininha_id');
    expect(src).toContain('maquininhaGravada');
    expect(src).toContain('bandeiraGravada');
    expect(src).not.toContain('BANDEIRAS_CARTAO');
  });
});
