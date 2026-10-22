/**
 * @file clientes-segmentos.ts
 * Segmentos e filtros ÚNICOS de clientes (web e app), decisões do dono de 2026-10-22.
 * Uma cliente pode estar em mais de um segmento; arquivadas ficam fora de todos.
 * Atendimento = agendamento concluído (sessão de pacote inclusive); gasto = atendimento cobrado
 * (sessão de pacote vale 0) + extras de comanda + vendas avulsas. Datas sempre em Brasília.
 */
import { chaveDiaBRT, chaveMesBRT, diasEntre, ultimoDiaDoMes } from './periodos';
import { valorCobradoAtendimento } from './kpis-financeiros';

export const VIP_GASTO = 2000;
export const VIP_ATENDIMENTOS = 8;
export const RECORRENTE_ATENDIMENTOS = 5;
export const DIAS_EM_RISCO = 45;
export const DIAS_SUMIDA = 60;
export const DIAS_RETORNO = 30;
export const DIAS_NUNCA_ATENDIDA = 30;

export type Segmento = 'vip' | 'recorrente' | 'em_risco' | 'sumida' | 'nova' | 'nunca_atendida';
export type FiltroClientes = 'todas' | 'novas' | 'aniversariantes' | 'retornos' | 'arquivadas' | Segmento;
export type ClienteBase = { id: string; nome: string; telefone: string | null; email: string | null; data_nascimento: string | null; ativo: boolean | null; created_at: string };
export type AtendimentoBase = { cliente_id: string | null; data_hora_inicio: string; valor: number | null; desconto_rateado?: number | null; pacote_cliente_id: string | null; servico_id: string | null; servico_nome?: string | null };
export type ExtraBase = { cliente_id: string | null; valor_unit: number; quantidade: number; desconto_rateado?: number | null; fechada_at: string };
export type VendaBase = { cliente_id: string | null; valor_final: number; created_at: string };
export type Agregado = { atendimentos: number; totalGasto: number; ultimaVisita: string | null; servicoFavorito: { id: string; nome: string | null } | null };

export const ROTULO_SEGMENTO: Record<Segmento, string> = {
  vip: 'VIP', recorrente: 'Recorrente', em_risco: 'Em risco', sumida: 'Sumida', nova: 'Nova', nunca_atendida: 'Nunca atendida',
};

export const ROTULO_FILTRO: Record<FiltroClientes, string> = {
  todas: 'Todas', novas: 'Novas', aniversariantes: 'Aniversariantes', retornos: 'Retornos', arquivadas: 'Arquivadas',
  ...ROTULO_SEGMENTO,
};

const centavos = (v: number): number => Math.round(v * 100);

/**
 * Serviço mais frequente entre os atendimentos (ignora os sem serviço).
 * Empate: o do atendimento mais recente.
 */
export function servicoFavorito(atend: AtendimentoBase[]): { id: string; nome: string | null } | null {
  const por = new Map<string, { n: number; ultima: string; nome: string | null }>();
  for (const a of atend) {
    if (!a.servico_id) continue;
    const e = por.get(a.servico_id) ?? { n: 0, ultima: '', nome: null };
    e.n++;
    if (a.data_hora_inicio >= e.ultima) { e.ultima = a.data_hora_inicio; e.nome = a.servico_nome ?? e.nome; }
    por.set(a.servico_id, e);
  }
  let melhor: { id: string; n: number; ultima: string; nome: string | null } | null = null;
  for (const [id, e] of por) {
    if (!melhor || e.n > melhor.n || (e.n === melhor.n && e.ultima > melhor.ultima)) melhor = { id, ...e };
  }
  return melhor ? { id: melhor.id, nome: melhor.nome } : null;
}

/**
 * Agrega por cliente: nº de atendimentos concluídos, total gasto (sessão de pacote vale 0, soma em
 * centavos), última visita e serviço favorito. Linhas sem cliente são ignoradas.
 */
export function agregarClientes(atend: AtendimentoBase[], extras: ExtraBase[], vendas: VendaBase[]): Map<string, Agregado> {
  const cent = new Map<string, number>();
  const porCliente = new Map<string, AtendimentoBase[]>();
  const somar = (id: string, v: number) => cent.set(id, (cent.get(id) ?? 0) + centavos(v));
  for (const a of atend) {
    if (!a.cliente_id) continue;
    const lista = porCliente.get(a.cliente_id) ?? [];
    lista.push(a);
    porCliente.set(a.cliente_id, lista);
    somar(a.cliente_id, a.pacote_cliente_id ? 0 : valorCobradoAtendimento(a));
  }
  for (const x of extras) {
    if (!x.cliente_id) continue;
    somar(x.cliente_id, Math.max((Number(x.valor_unit) || 0) * (Number(x.quantidade) || 0) - (Number(x.desconto_rateado) || 0), 0));
  }
  for (const v of vendas) if (v.cliente_id) somar(v.cliente_id, Number(v.valor_final) || 0);

  const out = new Map<string, Agregado>();
  for (const id of new Set([...porCliente.keys(), ...cent.keys()])) {
    const lista = porCliente.get(id) ?? [];
    let ultima: string | null = null;
    for (const a of lista) if (!ultima || a.data_hora_inicio > ultima) ultima = a.data_hora_inicio;
    out.set(id, { atendimentos: lista.length, totalGasto: (cent.get(id) ?? 0) / 100, ultimaVisita: ultima, servicoFavorito: servicoFavorito(lista) });
  }
  return out;
}

/** Dias desde a última visita (Brasília) até hoje; null se nunca veio. */
function diasSemVir(a: Agregado | undefined, hojeChave: string): number | null {
  return a?.ultimaVisita ? diasEntre(chaveDiaBRT(a.ultimaVisita), hojeChave) : null;
}

/** Segmentos da cliente. Arquivada (`ativo === false`) devolve conjunto vazio. */
export function segmentosDaCliente(c: ClienteBase, a: Agregado | undefined, hojeChave: string): Set<Segmento> {
  const s = new Set<Segmento>();
  if (c.ativo === false) return s;
  const atend = a?.atendimentos ?? 0;
  const gasto = centavos(a?.totalGasto ?? 0);
  const dias = diasSemVir(a, hojeChave);
  if (gasto >= VIP_GASTO * 100 || atend >= VIP_ATENDIMENTOS) s.add('vip');
  if (dias !== null) {
    if (atend >= RECORRENTE_ATENDIMENTOS && dias <= DIAS_EM_RISCO) s.add('recorrente');
    if (dias > DIAS_EM_RISCO && dias <= DIAS_SUMIDA) s.add('em_risco');
    if (dias > DIAS_SUMIDA) s.add('sumida');
  }
  if (chaveMesBRT(c.created_at) === hojeChave.slice(0, 7)) s.add('nova');
  if (atend === 0 && diasEntre(chaveDiaBRT(c.created_at), hojeChave) >= DIAS_NUNCA_ATENDIDA) s.add('nunca_atendida');
  return s;
}

/** Contagem por segmento (só ativas), para os cartões. `novasMes` = `nova`. */
export function contarSegmentos(clientes: ClienteBase[], ag: Map<string, Agregado>, hojeChave: string): Record<Segmento, number> & { total: number; novasMes: number } {
  const r = { vip: 0, recorrente: 0, em_risco: 0, sumida: 0, nova: 0, nunca_atendida: 0, total: 0, novasMes: 0 };
  for (const c of clientes) {
    if (c.ativo === false) continue;
    r.total++;
    for (const s of segmentosDaCliente(c, ag.get(c.id), hojeChave)) r[s]++;
  }
  r.novasMes = r.nova;
  return r;
}

/** Dia do aniversário no mês de `hojeChave`; 29/02 em ano comum vira 28. null se não cai no mês ou é inválida. */
function diaAniversarioNoMes(nascimento: string | null, hojeChave: string): number | null {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(nascimento ?? '');
  if (!m) return null;
  const mes = Number(m[1]);
  const dia = Number(m[2]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || mes !== Number(hojeChave.slice(5, 7))) return null;
  return Math.min(dia, Number(ultimoDiaDoMes(hojeChave.slice(0, 7)).slice(8, 10)));
}

/** Aniversariantes (ativas) do mês corrente, ordenadas por dia e depois por nome. */
export function aniversariantesDoMes(clientes: ClienteBase[], hojeChave: string): ClienteBase[] {
  return clientes
    .filter(c => c.ativo !== false)
    .map(c => ({ c, dia: diaAniversarioNoMes(c.data_nascimento, hojeChave) }))
    .filter((x): x is { c: ClienteBase; dia: number } => x.dia !== null)
    .sort((x, y) => x.dia - y.dia || x.c.nome.localeCompare(y.c.nome, 'pt-BR'))
    .map(x => x.c);
}

const semAcento = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Filtra e ordena a lista. "Todas" = só ativas; "Arquivadas" = só arquivadas; os demais filtros
 * olham só ativas. Busca: nome (sem acento/caixa), telefone (só dígitos) e e-mail.
 * Aniversariantes ordena por dia; os demais por nome.
 */
export function filtrarClientes(clientes: ClienteBase[], ag: Map<string, Agregado>, filtro: FiltroClientes, busca: string, hojeChave: string): ClienteBase[] {
  const termo = semAcento(busca.trim());
  const digitos = busca.replace(/\D/g, '');
  const passaBusca = (c: ClienteBase): boolean => {
    if (!termo) return true;
    if (semAcento(c.nome).includes(termo)) return true;
    if (c.email && semAcento(c.email).includes(termo)) return true;
    return digitos.length > 0 && (c.telefone ?? '').replace(/\D/g, '').includes(digitos);
  };
  let lista: ClienteBase[];
  if (filtro === 'arquivadas') lista = clientes.filter(c => c.ativo === false);
  else if (filtro === 'aniversariantes') lista = aniversariantesDoMes(clientes, hojeChave);
  else {
    const ativas = clientes.filter(c => c.ativo !== false);
    if (filtro === 'todas') lista = ativas;
    else if (filtro === 'retornos') {
      lista = ativas.filter(c => { const d = diasSemVir(ag.get(c.id), hojeChave); return d !== null && d <= DIAS_RETORNO; });
    } else {
      const alvo: Segmento = filtro === 'novas' ? 'nova' : filtro;
      lista = ativas.filter(c => segmentosDaCliente(c, ag.get(c.id), hojeChave).has(alvo));
    }
  }
  lista = lista.filter(passaBusca);
  return filtro === 'aniversariantes' ? lista : [...lista].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
