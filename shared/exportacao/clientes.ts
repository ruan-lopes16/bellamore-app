import { chaveDiaBRT } from '../periodos';
import { dataBR, type DefinicaoExportacao } from './tipos';

export type LinhaCliente = { nome: string; telefone: string | null; email: string | null; dataNascimento: string | null; criadoEm: string };

/** 'yyyy-MM-dd' → 'dd/MM' (sem ano); vazio → ''. */
function diaMes(d: string | null): string {
  return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '';
}

/** Exportação da lista de clientes. */
export function definicaoClientes(): DefinicaoExportacao<LinhaCliente> {
  return {
    arquivo: 'clientes',
    titulo: 'Clientes',
    colunas: [
      { cabecalho: 'Nome', valor: l => l.nome, largura: 30 },
      { cabecalho: 'Telefone', valor: l => l.telefone ?? '', largura: 18 },
      { cabecalho: 'E-mail', valor: l => l.email ?? '', largura: 28 },
      { cabecalho: 'Nascimento', valor: l => diaMes(l.dataNascimento), largura: 14 },
      { cabecalho: 'Cadastrado em', valor: l => dataBR(chaveDiaBRT(l.criadoEm)), largura: 16 },
    ],
  };
}
