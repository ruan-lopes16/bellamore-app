import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

// RLS de estoque_movimentos só deixa a profissional baixar estoque ligado a um
// atendimento dela: a baixa dos produtos extras da comanda precisa levar agendamento_id.
describe('comanda: baixa de estoque dos produtos extras leva agendamento_id', () => {
  for (const arq of ['web/app/(app)/comanda/page.tsx', 'mobile/app/(empresa)/nova-comanda.tsx']) {
    it(arq, () => expect(ler(arq)).toContain('agendamento_id: agIds[0] ?? null'));
  }
  it('app não engole o erro da baixa', () => {
    expect(ler('mobile/app/(empresa)/nova-comanda.tsx')).toMatch(/if \(errEst\) Alert\.alert\('Estoque'/);
  });
});
