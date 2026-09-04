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
