import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { marcarAgendamentosFechados } from '@shared/comanda';

// Bug de producao (2026-09-28): depois de fechar a comanda, a lista local
// marcava o atendimento como 'concluido' mas deixava comanda_id nulo. Como a
// regra de "comanda aberta" e `status !== 'concluido' || !comanda_id`, o
// atendimento continuava aparecendo como aberto — e fechar de novo gerava uma
// segunda comanda com pagamento em dobro.

const aberta = (a: { status: string; comanda_id: string | null }) =>
  a.status !== 'concluido' || !a.comanda_id;

describe('marcarAgendamentosFechados', () => {
  const ags = [
    { id: 'a1', status: 'agendado',  comanda_id: null },
    { id: 'a2', status: 'concluido', comanda_id: null }, // concluido pelo atalho, sem comanda
    { id: 'a3', status: 'agendado',  comanda_id: null }, // outro cliente, fora desta comanda
  ];

  it('grava status E comanda_id nos atendimentos fechados, e eles deixam de contar como abertos', () => {
    const r = marcarAgendamentosFechados(ags, ['a1', 'a2'], 'c1');
    expect(r.find(a => a.id === 'a1')).toMatchObject({ status: 'concluido', comanda_id: 'c1' });
    expect(r.find(a => a.id === 'a2')).toMatchObject({ status: 'concluido', comanda_id: 'c1' });
    expect(r.filter(aberta).map(a => a.id)).toEqual(['a3']);
  });

  it('nao mexe em atendimentos fora da comanda nem muta a lista original', () => {
    const r = marcarAgendamentosFechados(ags, ['a1'], 'c1');
    expect(r.find(a => a.id === 'a3')).toBe(ags[2]);
    expect(ags[0].comanda_id).toBeNull();
  });
});

describe('telas de Comanda usam o helper e barram fechamento duplicado', () => {
  const root = join(__dirname, '..', '..', '..');
  const arquivos = [
    'web/app/(app)/comanda/page.tsx',
    'mobile/app/(empresa)/nova-comanda.tsx',
  ];

  for (const arq of arquivos) {
    const src = readFileSync(join(root, arq), 'utf8');

    it(`${arq}: atualiza a lista local com marcarAgendamentosFechados`, () => {
      expect(src).toContain('marcarAgendamentosFechados(');
      expect(src).not.toMatch(/agIds\.includes\(ag\.id\)\s*\?\s*\{\s*\.\.\.ag,\s*status:\s*'concluido'\s*\}/);
    });

    it(`${arq}: confere no banco se algum atendimento ja tem comanda antes de criar outra`, () => {
      const idxGuard = src.indexOf("not('comanda_id', 'is', null)");
      const idxInsert = src.indexOf(".from('comandas').insert(");
      expect(idxGuard).toBeGreaterThan(-1);
      expect(idxGuard).toBeLessThan(idxInsert);
    });
  }
});
