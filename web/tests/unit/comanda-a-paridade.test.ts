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

describe('comanda app pela regra única', () => {
  const src = ler('mobile/app/(empresa)/nova-comanda.tsx');
  it('usa as mesmas funções do web', () => {
    for (const f of ['calcularDesconto(', 'resumoComanda(', 'montarPagamentos(', 'agruparValoresPorAgendamento(', 'taxasDaEmpresa(']) expect(src).toContain(f);
  });
  it('não fecha sem cobrir o total', () => {
    expect(src).toContain('resumo.podeFechar');
  });
  it('bandeiras e parcelas vindas de shared', () => {
    expect(src).toContain('BANDEIRAS_CARTAO');
    expect(src).toContain('OPCOES_PARCELAS');
  });
  it('confere erro de comanda_itens, vendas e pagamentos', () => {
    expect(src).toMatch(/from\('comanda_itens'\)\.insert\([\s\S]{0,400}?error/);
    expect(src).toMatch(/from\('pagamentos'\)\.insert\([\s\S]{0,200}?error/);
  });
  it('updates de agendamentos filtrados pela empresa', () => {
    const updates = src.match(/from\('agendamentos'\)\s*\.update\([\s\S]{0,300}?;/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) expect(u).toContain(".eq('empresa_id'");
  });
});
