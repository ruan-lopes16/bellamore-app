import { somarDias } from './periodos';
import { lerPrecoServico } from './servicos';

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

// ── Cadastro do pacote (web e app: PacoteForm) ───────────────────────────────────────────────

/** Validade digitada no cadastro: `semValidade` → null; senão inteiro ≥ 1, ou erro. */
export function lerValidadeDias(texto: string, semValidade: boolean): { valor: number | null; erro: string | null } {
  if (semValidade) return { valor: null, erro: null };
  const t = texto.trim();
  const n = Number(t);
  if (!t || !Number.isInteger(n) || n < 1) return { valor: null, erro: 'Informe a validade em dias (1 ou mais) ou marque "Sem validade".' };
  return { valor: n, erro: null };
}

/**
 * Valida o cadastro do pacote (regra única de web e app). Nome ≥ 2 caracteres; preço > 0 (lido por
 * `lerPrecoServico`, formato brasileiro — como o serviço: a cortesia é dada no atendimento, nunca no
 * catálogo); validade inteira ≥ 1 ou "Sem validade"; ao menos um serviço (só quando a composição pode
 * mudar: pacote já vendido, ou com a contagem de vendidos indisponível, mantém a composição gravada).
 * Devolve o erro em português ou os valores prontos para gravar (validade null = sem validade).
 */
export function validarPacote(d: {
  nome: string; precoTxt: string; validadeTxt: string; semValidade: boolean; qtdServicos: number; composicaoTravada: boolean;
}): { erro: string; preco?: undefined; validadeDias?: undefined } | { erro: null; preco: number; validadeDias: number | null } {
  if (d.nome.trim().length < 2) return { erro: 'Informe o nome do pacote (pelo menos 2 letras).' };
  const preco = lerPrecoServico(d.precoTxt);
  if (!Number.isFinite(preco) || preco <= 0) return { erro: 'Informe um preço maior que zero.' };
  const v = lerValidadeDias(d.validadeTxt, d.semValidade);
  if (v.erro) return { erro: v.erro };
  if (!d.composicaoTravada && d.qtdServicos === 0) return { erro: 'Adicione pelo menos um serviço ao pacote.' };
  return { erro: null, preco, validadeDias: v.valor };
}

// ── Venda (valores) ─────────────────────────────────────────────────────────────────────────

const emCentavos = (v: number) => Math.round(v * 100);

/** Quantidade de unidades aceita pela venda: inteiro de 1 a 100 (contrato da `vender_pacote`). */
export function quantidadeValida(q: number): boolean {
  return Number.isInteger(q) && q >= 1 && q <= 100;
}

/**
 * Subtotal da venda pela mesma conta da `vender_pacote`: o valor unitário arredondado em centavos
 * × a quantidade. Quantidade ou valor inválidos → 0 (a tela bloqueia com o motivo).
 */
export function subtotalVendaPacote(valorUnit: number, quantidade: number): number {
  if (!quantidadeValida(quantidade) || !(valorUnit >= 0)) return 0;
  return (emCentavos(valorUnit) * quantidade) / 100;
}

/**
 * `valor_pago` de cada unidade (mesma regra da `vender_pacote`, contrato): o líquido
 * (valorUnit × quantidade − desconto) dividido em centavos; o resto, 1 centavo cada, vai nas primeiras
 * unidades. A soma bate com o total da venda.
 */
export function ratearValorPago(valorUnit: number, quantidade: number, desconto: number): number[] {
  const n = Math.max(1, Math.floor(quantidade));
  const liquido = Math.max(0, emCentavos(valorUnit) * n - emCentavos(desconto));
  const base = Math.floor(liquido / n);
  const resto = liquido - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < resto ? 1 : 0)) / 100);
}

// ── Vendidos (lista) ────────────────────────────────────────────────────────────────────────

export type FiltroVendidos = 'todos' | 'ativo' | 'concluido' | 'expirado' | 'a_cobrar';

/** Pacote "a cobrar": cobrança pendente e não cancelado (selo e filtro "A cobrar"). */
export function estaACobrar(v: { cobranca: 'paga' | 'pendente'; statusExibido: StatusPacoteCliente }): boolean {
  return v.cobranca === 'pendente' && v.statusExibido !== 'cancelado';
}

/**
 * Filtro da aba Vendidos. "A cobrar" = `estaACobrar`; os demais pelo status exibido. Cancelado só
 * aparece em Todos (contrato).
 */
export function filtrarVendidos<T extends { statusExibido: StatusPacoteCliente; cobranca: 'paga' | 'pendente' }>(
  lista: T[], filtro: FiltroVendidos,
): T[] {
  if (filtro === 'todos') return lista;
  if (filtro === 'a_cobrar') return lista.filter(estaACobrar);
  return lista.filter(v => v.statusExibido === filtro);
}

/** Rótulo do status exibido (cartões, filtros e exportação). */
export const ROTULO_STATUS_PACOTE: Record<StatusPacoteCliente, string> = {
  ativo: 'Ativo', concluido: 'Concluído', expirado: 'Expirado', cancelado: 'Cancelado',
};

/** Status na exportação de Vendidos: "Ativo · A cobrar" quando a cobrança está pendente. */
export function rotuloStatusVendido(v: { cobranca: 'paga' | 'pendente'; statusExibido: StatusPacoteCliente }): string {
  const r = ROTULO_STATUS_PACOTE[v.statusExibido];
  return estaACobrar(v) ? `${r} · A cobrar` : r;
}

// ── Excluir pacote vendido ──────────────────────────────────────────────────────────────────

export const MSG_SESSOES_USADAS = 'Este pacote já tem sessões usadas. Para cancelar, fale com a dona.';

/**
 * Sem a 096 a exclusão de pacote vendido fica indisponível: o caminho antigo apagava só o pacote e a
 * venda dele continuava no faturamento.
 */
export const MSG_EXCLUSAO_SEM_096 =
  'Excluir pacote vendido ainda não está disponível: a venda dele continuaria no faturamento. Fale com a dona.';

export const TITULO_EXCLUIR_VENDIDO = 'Excluir pacote vendido?';

/** Texto da confirmação de exclusão de pacote vendido (web e app). */
export function textoExcluirVendido(v: { pacote: string; cliente: string; aCobrar: boolean }): string {
  return v.aCobrar
    ? `O pacote "${v.pacote}" a cobrar de ${v.cliente} será excluído e não entrará mais na comanda. Sem volta.`
    : `O pacote "${v.pacote}" de ${v.cliente} será excluído. Se ele foi cobrado sozinho, a venda e o pagamento saem do faturamento; com outros pacotes na mesma venda, só o valor dele sai (a devolução é manual). Atendimentos vinculados serão desvinculados. Sem volta.`;
}
