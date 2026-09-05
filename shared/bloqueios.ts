/**
 * Domínio de bloqueios de agenda.
 *
 * Dois tipos: "de um profissional" (`escopo='profissional'`, com
 * `profissional_id`) e "geral" (`escopo='geral'`, agenda toda). O
 * tipo "geral" só é oferecido a dona/gestora. Bloqueio pedido por
 * profissional nasce `pendente` e só vale depois que dona/gestora
 * aprova. Estas funções puras concentram todas essas regras para web
 * e mobile usarem a mesma coisa.
 */

export type EscopoBloqueio    = 'profissional' | 'geral';
export type SituacaoBloqueio  = 'aprovado' | 'pendente';
export type MotivoBloqueio    =
  | 'folga' | 'feriado' | 'almoco' | 'reuniao' | 'manutencao' | 'outro';

export const MOTIVOS_BLOQUEIO: { key: MotivoBloqueio; label: string }[] = [
  { key: 'folga',      label: 'Folga' },
  { key: 'feriado',    label: 'Feriado' },
  { key: 'almoco',     label: 'Almoço' },
  { key: 'reuniao',    label: 'Reunião' },
  { key: 'manutencao', label: 'Manutenção' },
  { key: 'outro',      label: 'Outro' },
];

/** Rótulo em pt-BR de um motivo; travessão para nulo/desconhecido. */
export function motivoBloqueioLabel(motivo: string | null | undefined): string {
  const m = MOTIVOS_BLOQUEIO.find((x) => x.key === motivo);
  return m ? m.label : '—';
}

/** Só dona (owner) e gestora podem criar bloqueio "geral". */
export function podeSelecionarEscopoGeral(role: string): boolean {
  return role === 'owner' || role === 'gestor';
}

/** Bloqueio de dona/gestora nasce aprovado; de profissional, pendente. */
export function situacaoInicialBloqueio(role: string): SituacaoBloqueio {
  return role === 'owner' || role === 'gestor' ? 'aprovado' : 'pendente';
}

export interface MontarInsertBloqueioInput {
  role: string;
  meuUserId: string;
  empresaId: string;
  /** Escopo pedido. Ignorado (forçado 'profissional') quando role = profissional. */
  escopo: EscopoBloqueio;
  /** Profissional-alvo quando a gestão cria escopo 'profissional'. */
  profissionalId: string | null;
  motivo: MotivoBloqueio;
  titulo?: string | null;
  /** ISO string. */
  dataInicio: string;
  /** ISO string. */
  dataFim: string;
}

export interface BloqueioInsert {
  empresa_id: string;
  escopo: EscopoBloqueio;
  profissional_id: string | null;
  motivo: MotivoBloqueio;
  titulo: string;
  data_inicio: string;
  data_fim: string;
  situacao: SituacaoBloqueio;
  criado_por: string;
}

/**
 * Monta o objeto de `insert` em `agenda_bloqueios` já coerente com as
 * regras de papel — o mesmo que a RLS exige. Profissional sempre vira
 * `escopo='profissional'`, `profissional_id = meuUserId`,
 * `situacao='pendente'`, independentemente do que foi passado.
 */
export function montarInsertBloqueio(input: MontarInsertBloqueioInput): BloqueioInsert {
  const ehGestao = input.role === 'owner' || input.role === 'gestor';
  const escopo: EscopoBloqueio = ehGestao ? input.escopo : 'profissional';
  const profissional_id =
    escopo === 'geral'
      ? null
      : ehGestao
        ? input.profissionalId
        : input.meuUserId;

  return {
    empresa_id:      input.empresaId,
    escopo,
    profissional_id,
    motivo:          input.motivo,
    titulo:          (input.titulo ?? '').trim() || motivoBloqueioLabel(input.motivo),
    data_inicio:     input.dataInicio,
    data_fim:        input.dataFim,
    situacao:        situacaoInicialBloqueio(input.role),
    criado_por:      input.meuUserId,
  };
}

/**
 * Forma mínima de um bloqueio para checagem de colisão com agendamento.
 * Tanto o tipo `Bloqueio` do web quanto `BloqueioAgenda` do mobile são
 * estruturalmente compatíveis com esta interface.
 */
export interface BlocoParaChecagem {
  escopo: EscopoBloqueio;
  profissional_id: string | null;
  situacao: SituacaoBloqueio;
  /** ISO string. */
  data_inicio: string;
  /** ISO string. */
  data_fim: string;
  motivo?: string | null;
  titulo?: string | null;
}

/** Um bloqueio vale para este profissional se é geral ou aponta para ele. */
function blocoAlcancaProfissional(b: BlocoParaChecagem, profissionalId: string): boolean {
  return b.escopo === 'geral' || b.profissional_id === profissionalId;
}

/** Bloqueio ativo = aprovado OU pendente (pendente também trava o agendamento). */
function blocoAtivo(b: BlocoParaChecagem): boolean {
  return b.situacao === 'aprovado' || b.situacao === 'pendente';
}

/**
 * Primeiro bloqueio (menor `data_inicio`) que colide com o intervalo
 * meia-aberto [inicioISO, fimISO) para o profissional dado, ou `null`.
 * Considera bloqueio "geral" e o do próprio profissional; aprovado OU
 * pendente. Encostar (fim de um == início do outro) NÃO é colisão.
 * Fonte única de verdade para web, mobile e o pré-check que espelha o
 * trigger `check_agendamento_bloqueio` do banco.
 */
export function bloqueioEmConflito(
  blocos: readonly BlocoParaChecagem[],
  profissionalId: string,
  inicioISO: string,
  fimISO: string,
): BlocoParaChecagem | null {
  const ini = Date.parse(inicioISO);
  const fim = Date.parse(fimISO);
  if (Number.isNaN(ini) || Number.isNaN(fim)) return null;

  let achado: BlocoParaChecagem | null = null;
  let achadoIni = Infinity;
  for (const b of blocos) {
    if (!blocoAtivo(b) || !blocoAlcancaProfissional(b, profissionalId)) continue;
    const bIni = Date.parse(b.data_inicio);
    const bFim = Date.parse(b.data_fim);
    if (Number.isNaN(bIni) || Number.isNaN(bFim)) continue;
    if (bIni < fim && bFim > ini && bIni < achadoIni) {
      achado = b;
      achadoIni = bIni;
    }
  }
  return achado;
}

/**
 * Bloqueio que cobre um instante pontual (usado no clique da Timeline).
 * Meia-aberto: `data_inicio <= instante < data_fim`.
 */
export function bloqueioNoInstante(
  blocos: readonly BlocoParaChecagem[],
  profissionalId: string,
  instanteISO: string,
): BlocoParaChecagem | null {
  const t = Date.parse(instanteISO);
  if (Number.isNaN(t)) return null;
  for (const b of blocos) {
    if (!blocoAtivo(b) || !blocoAlcancaProfissional(b, profissionalId)) continue;
    const bIni = Date.parse(b.data_inicio);
    const bFim = Date.parse(b.data_fim);
    if (Number.isNaN(bIni) || Number.isNaN(bFim)) continue;
    if (bIni <= t && t < bFim) return b;
  }
  return null;
}
