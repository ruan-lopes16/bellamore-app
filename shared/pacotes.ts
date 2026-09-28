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
 * hojeIso deve ser uma data yyyy-MM-dd (comparacao lexicografica, sem parse
 * de fuso horario).
 */
export function calcularPacotesAtivosCliente(
  rows: PacoteClienteRaw[],
  hojeIso: string,
): PacoteClienteOpt[] {
  return rows
    .filter(pc => (pc.pacote?.controla_sessoes ?? true) && (!pc.data_validade || pc.data_validade >= hojeIso))
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
