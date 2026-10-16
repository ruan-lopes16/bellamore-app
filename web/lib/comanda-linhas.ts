/**
 * @file comanda-linhas.ts
 * Linhas de atendimento multi-serviço (`agendamento_servicos`) na Comanda do web — correção do M7
 * (revisão da Task 2 da comanda "tudo ou nada"):
 *
 * - No fechamento, uma linha tirada da comanda (o web remove por linha) ficava com o valor antigo
 *   no banco. Ao reabrir, ela voltava a aparecer e a edição a somava em `agendamentos.valor`
 *   (receita e comissão de um serviço que não foi cobrado). `completarLinhasTiradas` manda essa
 *   linha com R$ 0 para a função: o banco fica coerente (soma das linhas = valor do atendimento).
 * - Comandas antigas já gravadas com essa incoerência: `linhasConferemComValor` detecta (soma das
 *   linhas ≠ valor do atendimento) e a tela reabre o atendimento como UMA linha com o valor gravado.
 */
import type { ItemComandaTela } from '@shared/comanda-gravacao';

type Valor = number | string | null | undefined;

/** Atendimento do dia como a tela o carrega (só o que importa aqui). */
export type AtendimentoComLinhas = {
  id: string;
  valor: Valor;
  agendamento_servicos?: { id: string; valor: Valor; ordem?: number; servico?: { id: string; nome: string } | null }[] | null;
};

const num = (v: Valor) => Number(v ?? 0) || 0;
const emCentavos = (v: number) => Math.round(v * 100);

/**
 * Itens da comanda + as linhas de multi-serviço tiradas de um atendimento que CONTINUA na comanda,
 * com valor R$ 0. Atendimento tirado inteiro não volta (fica aberto). Atendimento que está na tela
 * sem linhas (valor único) não ganha linhas.
 */
export function completarLinhasTiradas<T extends ItemComandaTela>(itens: T[], atendimentos: AtendimentoComLinhas[]): (T | ItemComandaTela)[] {
  const presentes = new Map<string, Set<string>>();
  for (const i of itens) {
    if (i.tipo !== 'agendamento' || !i.agendamento_id || !i.ag_servico_id) continue;
    const s = presentes.get(i.agendamento_id) ?? new Set<string>();
    s.add(i.ag_servico_id);
    presentes.set(i.agendamento_id, s);
  }
  const tiradas: ItemComandaTela[] = [];
  for (const ag of atendimentos) {
    const naTela = presentes.get(ag.id);
    if (!naTela) continue;
    for (const l of ag.agendamento_servicos ?? []) {
      if (naTela.has(l.id)) continue;
      tiradas.push({
        tipo: 'agendamento', descricao: l.servico?.nome ?? 'Serviço', valor: 0, quantidade: 1,
        agendamento_id: ag.id, ag_servico_id: l.id, servico_id: l.servico?.id,
      });
    }
  }
  return tiradas.length === 0 ? itens : [...itens, ...tiradas];
}

/** Soma das linhas de multi-serviço = valor gravado do atendimento (em centavos). Sem linhas = false. */
export function linhasConferemComValor(ag: AtendimentoComLinhas): boolean {
  const linhas = ag.agendamento_servicos ?? [];
  if (linhas.length === 0) return false;
  const soma = linhas.reduce((s, l) => s + emCentavos(num(l.valor)), 0);
  return soma === emCentavos(num(ag.valor));
}
