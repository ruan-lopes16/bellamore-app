import { describe, expect, it } from 'vitest';
import { linhasParaCelulas } from '@shared/exportacao/tipos';
import type { DefinicaoExportacao } from '@shared/exportacao/tipos';
import { definicaoAgenda } from '@shared/exportacao/agenda';
import { definicaoClientes } from '@shared/exportacao/clientes';
import { definicaoComissoes } from '@shared/exportacao/comissoes';
import { definicaoEquipe } from '@shared/exportacao/equipe';
import { definicaoEstoqueMovimentacoes, definicaoEstoqueProdutos } from '@shared/exportacao/estoque';
import { definicaoDespesas } from '@shared/exportacao/financeiro';
import { definicaoPacotesCatalogo, definicaoPacotesUtilizacao, definicaoPacotesVendidos } from '@shared/exportacao/pacotes';
import { definicaoRelatorio } from '@shared/exportacao/relatorios';
import { definicaoServicos } from '@shared/exportacao/servicos';
import { definicaoVendas } from '@shared/exportacao/vendas';

function conferir<T>(def: DefinicaoExportacao<T>, arquivo: string, titulo: string, cab: string[], larg: number[], linha: T, celulas: (string | number)[]) {
  expect(def.arquivo).toBe(arquivo);
  expect(def.titulo).toBe(titulo);
  expect(def.colunas.map(c => c.cabecalho)).toEqual(cab);
  expect(def.colunas.map(c => c.largura)).toEqual(larg);
  expect(linhasParaCelulas(def, [linha])[0]).toEqual(celulas);
}

describe('definições de exportação', () => {
  it('agenda', () => {
    const d = definicaoAgenda('2026-10-07');
    conferir(d, 'agenda-2026-10-07', 'Agenda — 7 de outubro de 2026',
      ['Horário', 'Cliente', 'Serviço', 'Profissional', 'Valor', 'Status'], [10, 26, 26, 20, 14, 12],
      { inicio: '2026-10-07T13:30:00Z', cliente: 'Ana', servico: 'Corte', profissional: 'Bia', valor: 120, status: 'Concluído' },
      ['10:30', 'Ana', 'Corte', 'Bia', 'R$ 120,00', 'Concluído']);
    expect(linhasParaCelulas(d, [{ inicio: '2026-10-07T13:30:00Z', cliente: null, servico: null, profissional: null, valor: 0, status: 'x' }])[0].slice(1, 4))
      .toEqual(['—', '—', '—']);
  });

  it('clientes', () => {
    conferir(definicaoClientes(), 'clientes', 'Clientes',
      ['Nome', 'Telefone', 'E-mail', 'Nascimento', 'Cadastrado em'], [30, 18, 28, 14, 16],
      { nome: 'Ana', telefone: null, email: 'a@b.c', dataNascimento: '1990-03-25', criadoEm: '2026-10-08T01:00:00Z' },
      ['Ana', '', 'a@b.c', '25/03', '07/10/2026']);
  });

  it('comissoes', () => {
    conferir(definicaoComissoes('1º Trimestre 2026'), 'comissoes-1-trimestre-2026', 'Comissões — 1º Trimestre 2026',
      ['Profissional', 'Data', 'Serviço', 'Valor serviço', '% Comissão', 'Comissão', 'Status'], [22, 12, 24, 14, 12, 12, 10],
      { profissional: 'Bia', dia: '2026-03-05', servico: 'Corte', valorServico: null, percentual: 40, comissao: 48, pago: false },
      ['Bia', '05/03/2026', 'Corte', '—', '40%', 'R$ 48,00', 'Pendente']);
  });

  it('equipe', () => {
    conferir(definicaoEquipe('2026-10'), 'equipe-2026-10', 'Equipe — Outubro 2026',
      ['Nome', 'Telefone', 'Comissão (%)', 'Atend./mês', 'Total/mês', 'Status'], [28, 18, 14, 14, 16, 10],
      { nome: 'Bia', telefone: '11999', percentual: 40, atendimentosMes: 12, totalMes: 1500.5, ativo: false },
      ['Bia', '11999', '40%', 12, 'R$ 1.500,50', 'Inativo']);
  });

  it('estoque produtos', () => {
    conferir(definicaoEstoqueProdutos(), 'estoque-produtos', 'Estoque — Produtos',
      ['Nome', 'Categoria', 'Unidade', 'Estoque Atual', 'Estoque Mín.', 'Custo Unit.', 'Status'], [30, 16, 10, 14, 14, 14, 10],
      { nome: 'Luva', categoria: 'Descartáveis', unidade: 'cx', estoqueAtual: 3, estoqueMinimo: 5, precoCusto: 0, status: 'Baixo' },
      ['Luva', 'Descartáveis', 'cx', 3, 5, '', 'Baixo']);
  });

  it('estoque movimentações', () => {
    conferir(definicaoEstoqueMovimentacoes('2026-10'), 'estoque-movimentacoes', 'Movimentações — Outubro 2026',
      ['Data', 'Produto', 'Tipo', 'Qtd', 'Motivo'], [18, 28, 10, 10, 28],
      { criadoEm: '2026-10-07T13:30:00Z', produto: 'Luva', tipo: 'Saída', quantidade: 2, unidade: 'cx', motivo: null },
      ['07/10/2026 10:30', 'Luva', 'Saída', '2 cx', '']);
  });

  it('despesas', () => {
    conferir(definicaoDespesas('2026-10'), 'financeiro-despesas-2026-10', 'Despesas — Outubro 2026',
      ['Descrição', 'Categoria', 'Valor', 'Vencimento', 'Pagamento', 'Status', 'Recorrente'], [30, 18, 14, 14, 14, 12, 12],
      { descricao: 'Aluguel', categoria: null, valor: 2000, vencimento: '2026-10-10', pagamento: null, pago: false, recorrente: true },
      ['Aluguel', '', 'R$ 2.000,00', '10/10/2026', '', 'Pendente', 'Sim']);
  });

  it('pacotes catálogo', () => {
    conferir(definicaoPacotesCatalogo(), 'pacotes-catalogo', 'Catálogo de Pacotes',
      ['Nome', 'Preço', 'Validade (dias)', 'Serviços', 'Status'], [28, 14, 14, 40, 10],
      { nome: 'Depil', preco: 300, validadeDias: null, servicos: [{ nome: 'Axila', quantidade: 5 }, { nome: 'Virilha', quantidade: null }], ativo: true },
      ['Depil', 'R$ 300,00', 'Sem validade', 'Axila ×5, Virilha ×∞', 'Ativo']);
  });

  it('pacotes vendidos', () => {
    conferir(definicaoPacotesVendidos(), 'pacotes-vendidos', 'Pacotes Vendidos',
      ['Cliente', 'Pacote', 'Sessões usadas', 'Valor pago', 'Início', 'Válido até', 'Status'], [26, 26, 14, 14, 12, 12, 12],
      { cliente: 'Ana', pacote: 'Depil', usadas: 2, totalSessoes: null, valorPago: null, inicio: '2026-10-01', validade: null, status: 'Ativo' },
      ['Ana', 'Depil', '2/∞', '—', '01/10/2026', 'Sem validade', 'Ativo']);
  });

  it('pacotes utilização', () => {
    conferir(definicaoPacotesUtilizacao(), 'pacotes-relatorio', 'Relatório de Utilização de Pacotes',
      ['Pacote', 'Vendas', 'Sessões totais', 'Sessões usadas', 'Aproveitamento', 'Receita'], [28, 10, 14, 14, 14, 16],
      { nome: 'Depil', vendas: 2, totalSessoes: 10, sessoesUsadas: 3, receita: 600 },
      ['Depil', 2, 10, 3, '30%', 'R$ 600,00']);
    expect(linhasParaCelulas(definicaoPacotesUtilizacao(), [{ nome: 'x', vendas: 0, totalSessoes: 0, sessoesUsadas: 0, receita: 0 }])[0][4]).toBe('0%');
  });

  it('relatório: abas', () => {
    const t = (aba: Parameters<typeof definicaoRelatorio>[0], rotulo: string) => definicaoRelatorio(aba, rotulo, 'Outubro 2026');
    conferir(t('servicos', 'Serviços'), 'relatorio-servicos-outubro-2026', 'Relatório Serviços — Outubro 2026',
      ['Serviço', 'Atendimentos', 'Receita'], [30, 14, 16], { nome: 'Corte', quantidade: 4, valor: 400 }, ['Corte', 4, 'R$ 400,00']);
    conferir(t('equipe', 'Equipe'), 'relatorio-equipe-outubro-2026', 'Relatório Equipe — Outubro 2026',
      ['Profissional', 'Atendimentos', 'Receita gerada', 'Comissão'], [28, 14, 16, 16], { nome: 'Bia', quantidade: 4, valor: 400 }, ['Bia', 4, 'R$ 400,00', 'R$ 0,00']);
    conferir(t('clientes', 'Clientes'), 'relatorio-clientes-outubro-2026', 'Relatório Clientes — Outubro 2026',
      ['Cliente', 'Atendimentos', 'Total gasto'], [28, 14, 16], { nome: 'Ana', quantidade: 2, valor: 250 }, ['Ana', 2, 'R$ 250,00']);
    conferir(t('estoque', 'Estoque'), 'relatorio-estoque-outubro-2026', 'Relatório Estoque — Outubro 2026',
      ['Produto', 'Qtd consumida', 'Custo estimado'], [28, 14, 16], { nome: 'Luva', quantidade: 3, custo: 12.5 }, ['Luva', 3, 'R$ 12,50']);
    conferir(t('comissoes', 'Comissões'), 'relatorio-comissoes-outubro-2026', 'Relatório Comissões — Outubro 2026',
      ['Profissional', 'Data', 'Cliente', 'Serviço', 'Vlr atend.', '%', 'Comissão', 'Status'], [22, 12, 22, 22, 12, 6, 12, 10],
      { profissional: 'Bia', dia: '2026-10-05', cliente: 'Ana', servico: 'Corte', valorAtendimento: 100, percentual: 40, comissao: 40, pago: true },
      ['Bia', '05/10/2026', 'Ana', 'Corte', 'R$ 100,00', '40%', 'R$ 40,00', 'Pago']);
    conferir(t('financeiro', 'Financeiro'), 'relatorio-financeiro-outubro-2026', 'Relatório Financeiro — Outubro 2026',
      ['Data', 'Cliente', 'Serviço', 'Valor', 'Status'], [18, 26, 26, 14, 12],
      { inicio: '2026-10-07T13:30:00Z', cliente: null, servico: 'Corte', valor: 90, status: 'Concluído' },
      ['07/10/2026 10:30', '—', 'Corte', 'R$ 90,00', 'Concluído']);
  });

  it('relatório: avaliações não exporta', () => {
    expect(() => definicaoRelatorio('avaliacoes', 'Avaliações', 'Outubro 2026')).toThrow('Aba sem exportação');
  });

  it('serviços', () => {
    conferir(definicaoServicos(), 'servicos', 'Catálogo de Serviços',
      ['Nome', 'Categoria', 'Duração', 'Preço', 'Custo', 'Status'], [28, 16, 12, 14, 14, 10],
      { nome: 'Corte', categoria: 'Cabelo', duracao: '1h', preco: 80, custo: 10, ativo: true },
      ['Corte', 'Cabelo', '1h', 'R$ 80,00', 'R$ 10,00', 'Ativo']);
  });

  it('vendas', () => {
    conferir(definicaoVendas(), 'vendas-historico', 'Histórico de Vendas',
      ['Data', 'Cliente', 'Itens', 'Total', 'Pagamentos'], [18, 24, 40, 14, 30],
      { criadoEm: '2026-10-07T13:30:00Z', cliente: null, itens: [{ produto: 'Creme', quantidade: 2 }, { produto: 'Gel', quantidade: 1 }], total: 90,
        pagamentos: [{ metodo: 'PIX', valor: 50 }, { metodo: 'Dinheiro', valor: 40 }] },
      ['07/10/2026 10:30', 'Avulso', 'Creme ×2, Gel ×1', 'R$ 90,00', 'PIX R$ 50,00 + Dinheiro R$ 40,00']);
  });
});
