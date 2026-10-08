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

describe('ordem e conferência de erros no fechamento (revisão final)', () => {
  const arquivos = ['web/app/(app)/comanda/page.tsx', 'mobile/app/(empresa)/nova-comanda.tsx'];
  for (const arq of arquivos) {
    it(`${arq}: persistirValoresAgendamento grava agendamentos ANTES de agendamento_servicos`, () => {
      const src = ler(arq);
      const corpo = src.match(/async function persistirValoresAgendamento\([\s\S]*?\n {2}\}\r?\n/)?.[0] ?? '';
      expect(corpo).not.toBe('');
      const iAg = corpo.indexOf("from('agendamentos')");
      const iServ = corpo.indexOf("from('agendamento_servicos')");
      expect(iAg).toBeGreaterThan(-1);
      expect(iServ).toBeGreaterThan(iAg);
    });
  }
  it('web confere o error de vendas e venda_itens no fechamento', () => {
    const src = ler('web/app/(app)/comanda/page.tsx');
    for (const tabela of ['vendas', 'venda_itens']) {
      const inserts = src.match(new RegExp(String.raw`from\('${tabela}'\)\.insert\(`, 'g')) ?? [];
      const comErro = src.match(new RegExp(String.raw`\{[^}]*\berror\b[^}]*\}\s*=\s*await supabase\.from\('${tabela}'\)\.insert\(`, 'g')) ?? [];
      expect(inserts.length).toBeGreaterThan(0);
      expect(comErro.length).toBe(inserts.length);
    }
    expect(src).toMatch(/if \(errVenda \|\| !venda\)/);
    expect(src).toMatch(/if \(errVendaItens\)/);
  });
});
