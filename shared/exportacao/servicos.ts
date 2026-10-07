import { formatarMoeda } from '../moeda';
import type { DefinicaoExportacao } from './tipos';

/** `categoria` e `duracao` já vêm formatadas pela plataforma. */
export type LinhaServico = { nome: string; categoria: string; duracao: string; preco: number; custo: number; ativo: boolean };

/** Exportação do catálogo de serviços. */
export function definicaoServicos(): DefinicaoExportacao<LinhaServico> {
  return {
    arquivo: 'servicos',
    titulo: 'Catálogo de Serviços',
    colunas: [
      { cabecalho: 'Nome', valor: l => l.nome, largura: 28 },
      { cabecalho: 'Categoria', valor: l => l.categoria, largura: 16 },
      { cabecalho: 'Duração', valor: l => l.duracao, largura: 12 },
      { cabecalho: 'Preço', valor: l => formatarMoeda(l.preco), largura: 14 },
      { cabecalho: 'Custo', valor: l => formatarMoeda(l.custo), largura: 14 },
      { cabecalho: 'Status', valor: l => (l.ativo ? 'Ativo' : 'Inativo'), largura: 10 },
    ],
  };
}
