/**
 * C8 (105): vincular/desvincular pacote ao editar comanda fechada, web e app pela mesma regra.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { restaurarValoresPeloCatalogo } from '@shared/comanda-gravacao';

const ler = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');
const TELAS = {
  web: ler('app/(app)/comanda/page.tsx'),
  app: ler('../mobile/app/(empresa)/nova-comanda.tsx'),
};

describe('restaurarValoresPeloCatalogo', () => {
  const precos: Record<string, number> = { S1: 120, S2: 80 };
  const itens = [
    { tipo: 'agendamento', agendamento_id: 'A', servico_id: 'S1', valor: 0 },
    { tipo: 'agendamento', agendamento_id: 'A', servico_id: 'S2', valor: 0 },
    { tipo: 'agendamento', agendamento_id: 'B', servico_id: 'S1', valor: 0 },
    { tipo: 'servico', servico_id: 'S1', valor: 0 },
  ];
  it('só as linhas do atendimento pedido voltam ao preço de tabela', () => {
    expect(restaurarValoresPeloCatalogo(itens, ['A'], id => precos[id]).map(i => i.valor)).toEqual([120, 80, 0, 0]);
  });
  it('serviço fora do catálogo fica como está; nada mudou → mesma lista', () => {
    expect(restaurarValoresPeloCatalogo(itens, ['A'], () => undefined)).toBe(itens);
  });
});

describe.each(Object.entries(TELAS))('%s — edição de comanda fechada', (_nome, src) => {
  it('manda só os vínculos que mudaram', () => {
    expect(src).toContain('pacoteLinks: vinculosAlterados(pacoteLinksOriginais, pacoteLinks)');
    expect(src).toContain('setPacoteLinksOriginais(linksExistentes)');
  });
  it('desvincular na edição volta ao preço de tabela', () => {
    expect(src).toContain('restaurarValoresPeloCatalogo(prev, [agendamentoId], id => servicos.find(s => s.id === id)?.preco)');
  });
  it('o seletor de vincular não some mais na edição', () => {
    expect(src).not.toMatch(/if \((comandaExistenteId|emEdicao)\) return null;\s*\/\/ Pacote só vale se cobrir/);
  });
});
