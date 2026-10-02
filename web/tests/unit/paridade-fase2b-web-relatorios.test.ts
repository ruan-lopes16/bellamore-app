import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const src = readFileSync(join(__dirname, '..', '..', 'app', '(app)', 'relatorios', 'page.tsx'), 'utf8');

describe('web Relatórios com as regras únicas', () => {
  it('abas, cartões, resumo e rankings de shared', () => {
    for (const t of ['ABAS_RELATORIO', 'cartoesKpiRelatorio(kpis, kpisAnt', 'linhasResumoFinanceiro(', 'rankingDespesasPorCategoria(',
      'comissaoPorProfissional(', 'resumoInsumos(', 'resumoAvaliacoes(', 'carregarSaidasEstoque(', 'carregarAvaliacoes(',
      'carregarComissoesDoPeriodo(', 'normalizarComissoes(', 'comissoesPorProfissional(', 'pagarComissoes(']) expect(src).toContain(t);
    for (const t of ['empresa_membros!avaliacoes_profissional_id_fkey(nome)', "from('estoque_movimentos')", "from('comissoes')",
      "import { buscarTodasPaginas }"]) expect(src).not.toContain(t);
  });
  it('Sumidas +60d e Taxa de retorno (antes só no app)', () => {
    for (const t of ['carregarUltimasVisitas(', 'clientesSumidas(', 'Sumidas +60d', 'Taxa de retorno', 'pctRetorno']) expect(src).toContain(t);
  });
  it('Pagar confirma antes', () => {
    expect(src).toContain('textoConfirmarPagamento(');
  });
});
