/**
 * @file clientes-constantes.ts
 * Limites dos segmentos de clientes (decisões do dono de 2026-10-22). Módulo SEM nenhum import de
 * propósito: é lido no nível do módulo por `dashboard.ts` (DIAS_RECONQUISTA) e por
 * `kpis-financeiros.ts` (clientesSumidas). Se morasse em `clientes-segmentos.ts` (que importa
 * `kpis-financeiros.ts`), haveria ciclo de import, e no Metro/CommonJS a constante podia ser lida
 * como `undefined` conforme a ordem de carga. `clientes-segmentos.ts` reexporta tudo daqui.
 */

/** VIP: total gasto ≥ R$ 2.000 ... */
export const VIP_GASTO = 2000;
/** ... ou ≥ 8 atendimentos. */
export const VIP_ATENDIMENTOS = 8;
/** Recorrente: ≥ 5 atendimentos e última visita há ≤ DIAS_EM_RISCO dias. */
export const RECORRENTE_ATENDIMENTOS = 5;
/** Em risco: > 45 e ≤ DIAS_SUMIDA dias sem vir (também a "reconquista" do Dashboard). */
export const DIAS_EM_RISCO = 45;
/** Sumida: > 60 dias sem vir. */
export const DIAS_SUMIDA = 60;
/** Retornos (filtro): última visita nos últimos 30 dias. */
export const DIAS_RETORNO = 30;
/** Nunca atendida: cadastrada há ≥ 30 dias e sem nenhum atendimento. */
export const DIAS_NUNCA_ATENDIDA = 30;
