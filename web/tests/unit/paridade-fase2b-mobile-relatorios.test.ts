// web/tests/unit/paridade-fase2b-mobile-relatorios.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CHAVES_FINANCEIRO } from '@shared/invalidacao-financeira';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const hook = ler('mobile/hooks/useRelatorios.ts');

describe('app Relatórios: dados das abas pelas funções do web', () => {
  it('hook', () => {
    for (const t of ['serieFaturamento(', 'rankingDespesasPorCategoria(', 'comissaoPorProfissional(', 'resumoInsumos(',
      'resumoAvaliacoes(', 'carregarSaidasEstoque(', 'carregarAvaliacoes(', 'carregarComissoesDoPeriodo(',
      'comissoesPorProfissional(', 'pagarComissoes(', 'invalidarFinanceiro(qc)', 'carregarUltimasVisitas(',
      'carregarRetiradas(', "'rel-comissoes'", "aba === 'estoque'", "aba === 'avaliacoes'", "aba === 'comissoes'"])
      expect(hook).toContain(t);
  });
  it('erro e refetch só das consultas ativas; pagar só com permissão', () => {
    expect(hook).toContain("temPermissao(role, 'ver_comissoes_todas')");
    expect(hook).toContain('ativas');
  });
  it('pagar invalida a aba de comissões', () => {
    expect(CHAVES_FINANCEIRO).toContain('rel-comissoes');
  });
});
