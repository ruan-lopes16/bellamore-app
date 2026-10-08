import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('comanda web pela regra única', () => {
  const src = ler('web/app/(app)/comanda/page.tsx');
  it('usa calcularDesconto, resumoComanda e montarPagamentos', () => {
    for (const f of ['calcularDesconto(', 'resumoComanda(', 'montarPagamentos(']) expect(src).toContain(f);
    expect(src).toContain("from '@shared/comanda-fechamento'");
  });
  it('desconto com seletor % / R$', () => {
    expect(src).toContain("'percentual'");
    expect(src).toContain("'valor'");
  });
  it('botão Fechar depende de resumo.podeFechar', () => {
    expect(src).toContain('resumo.podeFechar');
  });
  it('edição só da comanda escolhida', () => {
    expect(src).toMatch(/comanda_id === comandaId/);
  });
  it('taxas vêm de shared (arquivo antigo removido)', () => {
    expect(existsSync(join(root, 'web/lib/taxas-cartao.ts'))).toBe(false);
    expect(src).toContain("from '@shared/taxas-cartao'");
  });
});
