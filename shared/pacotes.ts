import { somarDias } from './periodos';

/** Uma sessao registrada em pacote_uso, ja resolvida para exibicao. */
export type PacoteSessaoFeita = {
  id: string;
  data: string;             // pacote_uso.created_at (ISO)
  servico: string | null;
  viaAg: boolean;           // true = veio de um agendamento; false = lancamento avulso
};

/** Formato bruto vindo do supabase (join pacote_clientes -> pacotes -> pacote_servicos / pacote_uso). */
export type PacoteClienteRaw = {
  id: string;
  data_validade: string | null; // yyyy-MM-dd
  pacote: {
    nome: string | null;
    controla_sessoes: boolean | null;
    servicos: { servico_id: string; quantidade: number | null }[];
  } | null;
  uso: {
    id: string;
    created_at: string;
    agendamento_id: string | null;
    servico: { nome: string } | null;
  }[];
};

/** Pacote do cliente ja elegivel para uso (ativo, dentro da validade, com sessao sobrando). */
export type PacoteClienteOpt = {
  id: string;
  nome: string;
  total: number | null;      // null = ilimitado
  usadas: number;
  restantes: number | null;  // null = ilimitado
  servicos: { servico_id: string }[];
  sessoes: PacoteSessaoFeita[];
};

/**
 * Filtra e calcula, a partir dos pacote_clientes ATIVOS de um cliente (o
 * caller ja filtrou status='ativo' na query), quais ainda tem sessao
 * disponivel. Mesma regra usada pelo trigger fn_registrar_uso_pacote
 * (migration 036): combo (controla_sessoes=false) nao entra, pacote vencido
 * nao entra, "restantes" soma a quantidade de todos os servicos do pacote e
 * subtrai o total ja usado (qualquer servico), null em qualquer linha de
 * servico torna o pacote inteiro ilimitado.
 *
 * Inclui tambem os pacotes "a cobrar" (cobranca pendente): a cliente pode
 * usar as sessoes antes de pagar, entao o caller nao deve filtrar por cobranca.
 * O ultimo dia de validade ainda vale (ver `pacoteValidoEm`).
 *
 * hojeIso deve ser uma data yyyy-MM-dd (comparacao lexicografica, sem parse
 * de fuso horario).
 */
export function calcularPacotesAtivosCliente(
  rows: PacoteClienteRaw[],
  hojeIso: string,
): PacoteClienteOpt[] {
  return rows
    .filter(pc => (pc.pacote?.controla_sessoes ?? true) && pacoteValidoEm(pc.data_validade, hojeIso))
    .map(pc => {
      const servicosPac = pc.pacote?.servicos ?? [];
      const ilimitado = servicosPac.some(s => s.quantidade == null);
      const total = ilimitado ? null : servicosPac.reduce((s, x) => s + (x.quantidade ?? 0), 0);
      const usadas = pc.uso.length;
      const restantes = total != null ? total - usadas : null;
      const sessoes: PacoteSessaoFeita[] = [...pc.uso]
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        .map(u => ({ id: u.id, data: u.created_at, servico: u.servico?.nome ?? null, viaAg: !!u.agendamento_id }));
      return {
        id: pc.id,
        nome: pc.pacote?.nome ?? 'Pacote',
        total,
        usadas,
        restantes,
        servicos: servicosPac.map(s => ({ servico_id: s.servico_id })),
        sessoes,
      };
    })
    .filter(p => p.restantes === null || p.restantes > 0);
}

/**
 * Um pacote sem validade (null) vale sempre; com validade, o ULTIMO dia ainda vale.
 * Ambas as datas sao chaves yyyy-MM-dd em Brasilia (comparacao lexicografica).
 */
export function pacoteValidoEm(dataValidade: string | null, hojeChave: string): boolean {
  return !dataValidade || dataValidade >= hojeChave;
}

/** Data de validade (yyyy-MM-dd) = inicio + validadeDias; null quando o pacote nao tem validade. */
export function dataValidade(validadeDias: number | null, inicioChave: string): string | null {
  if (validadeDias == null) return null;
  return somarDias(inicioChave, validadeDias);
}

/** Uso de sessao (linha de pacote_uso). */
export type UsoPacote = { servico_id: string | null };

/**
 * Servico dentro de um pacote (pacote_servicos). Sessao ilimitada = `quantidade` null
 * (coluna real) ou `ilimitado` verdadeiro.
 */
export type ItemPacote = { servico_id: string; quantidade: number | null; ilimitado?: boolean | null };

const ehIlimitado = (i: ItemPacote) => i.quantidade == null || !!i.ilimitado;

/**
 * Saldo de sessoes por servico. `total`/`restantes` null = ilimitado.
 * `restantes` nunca fica negativo. Usos sem servico nao contam para nenhum item.
 * No modo combo (`combo` = controla_sessoes false) o saldo e apenas informativo:
 * o status do pacote nao muda por sessao (ver `statusPacoteCliente`).
 */
export function saldoSessoes(
  itens: ItemPacote[],
  usos: UsoPacote[],
  combo: boolean,
): { servico_id: string; total: number | null; usadas: number; restantes: number | null }[] {
  void combo;
  return itens.map(i => {
    const total = ehIlimitado(i) ? null : (i.quantidade as number);
    const usadas = usos.filter(u => u.servico_id === i.servico_id).length;
    return { servico_id: i.servico_id, total, usadas, restantes: total == null ? null : Math.max(0, total - usadas) };
  });
}

/** Status exibido de um pacote vendido. */
export type StatusPacoteCliente = 'ativo' | 'concluido' | 'expirado' | 'cancelado';

/**
 * Status exibido de um pacote vendido. Status gravado diferente de 'ativo' prevalece:
 * 'concluido' e 'cancelado' saem como estao (cancelado nunca aparece como "Expirado"); qualquer
 * outro valor gravado sai como 'expirado' (nunca como ativo).
 * Ativo: conclui quando as sessoes se esgotam (nunca em combo ou com sessao ilimitada)
 * e expira depois do ultimo dia de validade.
 *
 * Mesma regra do trigger fn_registrar_uso_pacote (036/037/078) para o saldo: o total soma as
 * quantidades de todos os servicos e as sessoes usadas contam qualquer servico (`usos` = total de
 * linhas de pacote_uso); um servico ilimitado nunca esgota. O saldo por servico de `saldoSessoes`
 * e so exibicao. Diferenca conhecida: o trigger compara a validade com CURRENT_DATE do servidor
 * (UTC), aqui a comparacao e em Brasilia.
 */
export function statusPacoteCliente(
  p: { data_validade: string | null; status: string | null; combo: boolean },
  saldo: ReturnType<typeof saldoSessoes>,
  usos: number,
  hojeChave: string,
): StatusPacoteCliente {
  if (p.status === 'concluido') return 'concluido';
  if (p.status === 'cancelado') return 'cancelado';
  if (p.status && p.status !== 'ativo') return 'expirado';
  const ilimitado = saldo.some(s => s.total == null);
  const total = saldo.reduce((acc, s) => acc + (s.total ?? 0), 0);
  if (!p.combo && !ilimitado && total > 0 && usos >= total) return 'concluido';
  if (!pacoteValidoEm(p.data_validade, hojeChave)) return 'expirado';
  return 'ativo';
}

/** Rotulo da validade do pacote no catalogo. */
export function rotuloValidade(validadeDias: number | null): string {
  if (validadeDias == null) return 'Sem validade';
  return `Válido por ${validadeDias} ${validadeDias === 1 ? 'dia' : 'dias'}`;
}

/** Total de sessoes do pacote; null se algum servico for ilimitado. */
export function totalSessoes(itens: ItemPacote[]): number | null {
  if (itens.some(ehIlimitado)) return null;
  return itens.reduce((acc, i) => acc + (i.quantidade ?? 0), 0);
}

/**
 * Itens "Pacote X — a cobrar" para a comanda: pacotes vendidos com cobranca pendente.
 * Usam o pacote_cliente ja existente (nao criam outro) e o valor combinado.
 */
export function itensACobrar(
  pendentes: { id: string; pacote_id: string; nome: string; valor_pago: number }[],
): { tipo: 'pacote'; pacote_id: string; pacote_cliente_id: string; descricao: string; valor_unit: number; quantidade: 1 }[] {
  return pendentes.map(p => ({
    tipo: 'pacote' as const,
    pacote_id: p.pacote_id,
    pacote_cliente_id: p.id,
    descricao: `Pacote ${p.nome} — a cobrar`,
    valor_unit: p.valor_pago,
    quantidade: 1 as const,
  }));
}
