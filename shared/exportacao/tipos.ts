/**
 * Exportações (Excel/PDF) compartilhadas entre web e app
 * (spec docs/superpowers/specs/2026-10-07-paridade-fase2c-exportacao-design.md).
 * Cada tela monta uma "linha padrão" a partir do que já carregou e entrega a uma
 * definição de shared/exportacao/<tela>.ts — mesmas colunas nas duas plataformas.
 */
import { chaveDiaBRT, horaBRT, rotuloDataBR } from '../periodos';

export type ColunaExportacao<T> = {
  cabecalho: string;
  valor: (linha: T) => string | number | null | undefined;
  /** Largura no Excel (caracteres). */
  largura?: number;
};

export type DefinicaoExportacao<T> = { arquivo: string; titulo: string; colunas: ColunaExportacao<T>[] };

/** 'Relatório Março 2026' → 'relatorio-marco-2026'. */
export function nomeArquivoSeguro(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Mesma regra de célula para Excel e PDF: null/undefined → ''. */
export function linhasParaCelulas<T>(def: DefinicaoExportacao<T>, linhas: T[]): (string | number)[][] {
  return linhas.map(l => def.colunas.map(c => c.valor(l) ?? ''));
}

/** 'yyyy-MM-dd' (ou ISO) → 'dd/MM/yyyy'; vazio → ''. */
export function dataBR(dia: string | null | undefined): string {
  return dia ? rotuloDataBR(dia.slice(0, 10)) : '';
}

/** Instante → 'dd/MM/yyyy HH:mm' em Brasília. */
export function dataHoraBR(ts: string): string {
  return `${rotuloDataBR(chaveDiaBRT(ts))} ${horaBRT(ts)}`;
}
