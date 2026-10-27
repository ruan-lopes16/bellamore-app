import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import {
  carregarCatalogoPacotes, carregarPacotesVendidos,
  type PacoteCatalogo, type PacoteVendido as PacoteVendidoBase,
} from '@shared/pacotes-consultas';
import { saldoSessoes, statusPacoteCliente, totalSessoes, type StatusPacoteCliente } from '@shared/pacotes';
import { hojeBRT } from '@shared/periodos';

export type { PacoteCatalogo };

/**
 * Catálogo de pacotes da empresa (ativos e desativados), pela mesma carga do web
 * (`carregarCatalogoPacotes`: paginada, lança o erro do banco).
 */
export function usePacotes() {
  const empresaId = useAuthStore(s => s.empresaAtiva?.id);
  return useQuery({
    queryKey: ['pacotes', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarCatalogoPacotes(supabase, empresaId!),
  });
}

/**
 * Pacote vendido já com o que a tela mostra, calculado pelas regras únicas de shared/pacotes.ts:
 * `status` exibido (`statusPacoteCliente`, último dia de validade vale, em Brasília) e o total de
 * sessões (`totalSessoes`; null = ilimitado ou combo, que não controla sessões).
 */
export type PacoteVendido = PacoteVendidoBase & {
  statusExibido: StatusPacoteCliente;
  /** Σ das quantidades; null = ilimitado ou combo. */
  total_sessoes: number | null;
  /** Linhas de pacote_uso desta venda (qualquer serviço, igual ao trigger). */
  usadas: number;
};

/** Status e totais de um vendido pelas funções de shared (exportado para os testes de tela). */
export function resumirVendido(v: PacoteVendidoBase, hojeChave: string): PacoteVendido {
  const combo = !v.pacote.controla_sessoes;
  const saldo = saldoSessoes(v.pacote.servicos, v.usos, combo);
  const statusExibido = statusPacoteCliente(
    { data_validade: v.data_validade, status: v.status, combo }, saldo, v.usos.length, hojeChave,
  );
  return {
    ...v,
    statusExibido,
    total_sessoes: combo ? null : totalSessoes(v.pacote.servicos),
    usadas: v.usos.length,
  };
}

/**
 * Pacotes vendidos às clientes (aba "Vendidos" e "Relatório"), com usos e cobrança (096).
 * Mesma carga do web (`carregarPacotesVendidos`).
 */
export function usePacotesVendidos() {
  const empresaId = useAuthStore(s => s.empresaAtiva?.id);
  return useQuery({
    queryKey: ['pacotes-vendidos', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      const hoje = hojeBRT();
      return (await carregarPacotesVendidos(supabase, empresaId!)).map(v => resumirVendido(v, hoje));
    },
  });
}
