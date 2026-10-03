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
    expect(hook).toContain("pode('comissoes.pagar')");
    expect(hook).toContain('ativas');
  });
  it('pagar invalida a aba de comissões', () => {
    expect(CHAVES_FINANCEIRO).toContain('rel-comissoes');
  });
});

describe('app Relatórios: tela com as 7 abas', () => {
  const tela = ler('mobile/app/(empresa)/relatorios.tsx');
  it('abas e blocos', () => {
    for (const t of ['ABAS_RELATORIO', 'cartoesKpiRelatorio(', 'linhasResumoFinanceiro(', '<GraficoBarras', 'Despesas por categoria',
      'Sumidas +60d', 'Taxa retorno', 'Top clientes', 'Insumos consumidos', 'Avaliações recentes', 'textoConfirmarPagamento(',
      'Período inclui mês com fechamento importado', "resumo && !isError ? formatBRL(resumo.faturamento) : '—'"])
      expect(tela).toContain(t);
    expect(tela).not.toContain('iconSize=');
  });
});
