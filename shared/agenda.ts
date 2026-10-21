/**
 * Regras puras da Agenda, compartilhadas por web e app.
 * Datas e horas sempre em Brasília (UTC−3) via `periodos.ts`.
 */
import { chaveDiaBRT, diaDaSemana, horaBRT, instanteMs, somarDias } from './periodos';
import { parseValorBR } from './comanda-fechamento';
import { faturamentoPrevistoDia } from './kpis-financeiros';
import { MOTIVOS_BLOQUEIO } from './bloqueios';
import { toWhatsApp } from './mascaras';

/** Janela visível da timeline, em horas inteiras (0..24). */
export type Janela = { ini: number; fim: number };

/**
 * Janela do dia: parte da padrão e estica para cobrir início (floor) e fim (ceil) de cada item,
 * em Brasília. Item que termina em outro dia vai até 24. Limites 0 e 24.
 */
export function janelaDoDia(itens: { inicio: string; fim: string }[], padrao: Janela = { ini: 7, fim: 21 }): Janela {
  let ini = padrao.ini;
  let fim = padrao.fim;
  for (const it of itens) {
    const [hi] = horaBRT(it.inicio).split(':').map(Number);
    const [hf, mf] = horaBRT(it.fim).split(':').map(Number);
    const viraDia = chaveDiaBRT(it.fim) > chaveDiaBRT(it.inicio);
    const fimH = viraDia ? 24 : mf > 0 ? hf + 1 : hf;
    ini = Math.min(ini, hi);
    fim = Math.max(fim, fimH);
  }
  return { ini: Math.max(0, ini), fim: Math.min(24, fim) };
}

/** Horários "HH:MM" da janela, de `passoMin` em `passoMin` (padrão 15). O fim da janela não entra. */
export function horariosDoDia(janela: Janela, passoMin = 15): string[] {
  const out: string[] = [];
  for (let m = janela.ini * 60; m < janela.fim * 60; m += passoMin) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

/** As 7 chaves "AAAA-MM-DD" da semana (domingo primeiro) que contém `chaveDia`. */
export function diasDaSemana(chaveDia: string): string[] {
  const inicio = somarDias(chaveDia, -diaDaSemana(chaveDia));
  return Array.from({ length: 7 }, (_, i) => somarDias(inicio, i));
}

/** Mesma posição na semana `delta` semanas à frente (ou atrás, se negativo). */
export function semanaVizinha(chaveDia: string, delta: number): string {
  return somarDias(chaveDia, 7 * delta);
}

/** Indica se o instante já passou em relação a `agoraMs`. */
export function instanteNoPassado(iso: string, agoraMs: number): boolean {
  return instanteMs(iso) < agoraMs;
}

export type StatusAg = 'agendado' | 'confirmado' | 'concluido' | 'cancelado' | 'faltou';

export const MSG_CONCLUIDO_COM_COMANDA = 'Já fechado na comanda. Para mudar, edite a comanda.';
export const MSG_HORARIO_PASSADO = 'Esse horário já passou. Registrar mesmo assim?';
export const MSG_REABRIR = 'Reabrir este atendimento?';

/** Aviso de conflito de horário da mesma profissional. */
export function msgConflito(nome: string, hhmm: string): string {
  return `Já existe atendimento de ${nome} às ${hhmm}. Agendar mesmo assim?`;
}

/**
 * Mensagem de horário bloqueado: mesmo texto do trigger 074 (`check_agendamento_bloqueio`),
 * com o rótulo do motivo ("Folga") em vez da chave crua. Sem motivo → "bloqueio".
 */
export function msgBloqueio(motivo: string | null | undefined): string {
  const rotulo = !motivo ? 'bloqueio' : (MOTIVOS_BLOQUEIO.find((m) => m.key === motivo)?.label ?? motivo);
  return `Horário bloqueado na agenda (${rotulo}). Remova o bloqueio para agendar nesse período.`;
}

/**
 * O texto do valor de uma linha é aceitável? Vazio (usa o preço), zero escrito ("0", "0,00",
 * "R$ 0" — cortesia) ou um número positivo. `parseValorBR` devolve 0 para texto inválido, então
 * sem esta checagem um erro de digitação viraria cortesia sem aviso.
 */
export function valorDigitadoValido(texto: string): boolean {
  const t = texto.trim();
  if (t === '') return true;
  if (/^(R\$\s*)?0+([.,]0+)?$/i.test(t)) return true;
  return parseValorBR(t) > 0;
}

/** Status para os quais o atendimento pode ir, conforme o atual e se a comanda já foi fechada. */
export function statusPermitidos(atual: StatusAg, comandaFechada: boolean): StatusAg[] {
  switch (atual) {
    case 'agendado': return ['confirmado', 'concluido', 'cancelado', 'faltou'];
    case 'confirmado': return ['agendado', 'concluido', 'cancelado', 'faltou'];
    case 'cancelado':
    case 'faltou': return ['agendado', 'confirmado'];
    case 'concluido':
      return comandaFechada ? [] : ['agendado', 'confirmado', 'cancelado', 'faltou'];
  }
}

/** Pergunta de confirmação para a troca de status (cancelar, faltar ou reabrir), ou null se não precisa. */
export function precisaConfirmarStatus(atual: StatusAg, novo: StatusAg): string | null {
  if ((atual === 'cancelado' || atual === 'faltou') && novo !== atual) return MSG_REABRIR;
  if (novo === 'cancelado') return 'Cancelar este atendimento?';
  if (novo === 'faltou') return 'Marcar falta neste atendimento?';
  return null;
}

export type LinhaAgendamento = {
  servico_id: string; profissional_id: string;
  /** Texto digitado; vazio usa `preco`, "0" é cortesia. */
  valor: string; duracao_min: number; preco: number;
};
export type EntradaAgendamento = { linhas: LinhaAgendamento[]; inicioIso: string; duracaoEditadaMin?: number | null };

/**
 * Monta valor total, duração e fim do atendimento a partir das linhas.
 * Campo de valor vazio vira o preço do serviço; "0" continua 0. A duração editada (> 0) substitui a soma.
 */
export function montarAgendamento(e: EntradaAgendamento): {
  valorTotal: number; duracaoMin: number; fimIso: string;
  linhas: { servico_id: string; profissional_id: string; valor: number; duracao_min: number }[];
} {
  const linhas = e.linhas.map((l) => ({
    servico_id: l.servico_id,
    profissional_id: l.profissional_id,
    valor: l.valor.trim() === '' ? l.preco : parseValorBR(l.valor),
    duracao_min: l.duracao_min,
  }));
  const valorTotal = Math.round(linhas.reduce((s, l) => s + l.valor, 0) * 100) / 100;
  const soma = linhas.reduce((s, l) => s + l.duracao_min, 0);
  const duracaoMin = e.duracaoEditadaMin != null && e.duracaoEditadaMin > 0 ? e.duracaoEditadaMin : soma;
  const fimIso = new Date(instanteMs(e.inicioIso) + duracaoMin * 60000).toISOString();
  return { valorTotal, duracaoMin, fimIso, linhas };
}

/**
 * Atendimentos da mesma profissional que se sobrepõem (estrito) ao novo horário.
 * Ignora cancelados, faltas e o `ignorarId` (o próprio atendimento na edição).
 */
export function conflitosDeHorario(
  novo: { profissional_id: string; inicioIso: string; fimIso: string },
  existentes: { id: string; profissional_id: string; inicio: string; fim: string; status: string; cliente_nome?: string | null }[],
  ignorarId?: string,
): { id: string; cliente_nome: string | null; inicio: string }[] {
  const ni = instanteMs(novo.inicioIso);
  const nf = instanteMs(novo.fimIso);
  return existentes
    .filter((a) => a.id !== ignorarId
      && a.profissional_id === novo.profissional_id
      && a.status !== 'cancelado' && a.status !== 'faltou'
      && instanteMs(a.inicio) < nf && ni < instanteMs(a.fim))
    .map((a) => ({ id: a.id, cliente_nome: a.cliente_nome ?? null, inicio: a.inicio }));
}

/** Linhas da edição: atendimento antigo sem linhas começa com uma linha montada do serviço principal. */
export function linhasIniciaisEdicao(
  ag: { servico_id: string | null; profissional_id: string; valor: number | null; duracao_min: number | null },
  linhas: { servico_id: string; profissional_id: string; valor: number; duracao_min: number }[],
): { servico_id: string; profissional_id: string; valor: number; duracao_min: number }[] {
  if (linhas.length > 0) return linhas;
  if (!ag.servico_id) return [];
  return [{ servico_id: ag.servico_id, profissional_id: ag.profissional_id, valor: ag.valor ?? 0, duracao_min: ag.duracao_min ?? 0 }];
}

/** Agrupa por profissional, na ordem recebida, mantendo colunas sem atendimento. */
export function colunasPorProfissional<T extends { profissional_id: string }>(
  ags: T[], profissionais: { id: string; nome: string }[],
): { profissional: { id: string; nome: string }; itens: T[] }[] {
  return profissionais.map((profissional) => ({
    profissional,
    itens: ags.filter((a) => a.profissional_id === profissional.id),
  }));
}

/**
 * Resumo do dia: total de atendimentos, receita prevista (`faturamentoPrevistoDia`: sem cancelados,
 * faltas e sessões de pacote, cada um pelo valor cobrado — valor − desconto_rateado da comanda),
 * nº de profissionais e pendentes (status agendado). Mesmos 4 números no web e no app.
 * Cancelados não contam em nada (decisão do dono, 01/10); faltas contam no total e nas profissionais.
 */
export function resumoDoDia(
  ags: {
    status: string; profissional_id: string; valor: number | null; pacote_cliente_id?: string | null;
    desconto_rateado?: number | string | null;
  }[],
): { total: number; receitaPrevista: number; profissionais: number; pendentes: number } {
  const validos = ags.filter((a) => a.status !== 'cancelado');
  return {
    total: validos.length,
    receitaPrevista: faturamentoPrevistoDia(validos.map((a) => ({
      valor: a.valor, status: a.status, pacote_cliente_id: a.pacote_cliente_id ?? null, desconto_rateado: a.desconto_rateado ?? null,
    }))),
    profissionais: new Set(validos.map((a) => a.profissional_id)).size,
    pendentes: validos.filter((a) => a.status === 'agendado').length,
  };
}

/**
 * Links de contato da cliente no detalhe do atendimento: `tel:` e WhatsApp (`https://wa.me/55…`,
 * sem duplicar o DDI de número já salvo com 55). Sem telefone (ou sem dígitos) devolve null e a
 * tela esconde os dois botões.
 */
export function contatosCliente(telefone: string | null | undefined): { ligar: string; whatsapp: string } | null {
  const digitos = (telefone ?? '').replace(/\D/g, '');
  if (!digitos) return null;
  return { ligar: `tel:${digitos}`, whatsapp: `https://wa.me/${toWhatsApp(digitos)}` };
}
