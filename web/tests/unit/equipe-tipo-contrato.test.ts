import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const equipe = readFileSync(join(process.cwd(), 'app', '(app)', 'equipe', 'page.tsx'), 'utf8');
const api    = readFileSync(join(process.cwd(), 'app', 'api', 'profissionais', 'route.ts'), 'utf8');

describe('equipe: tipo de contrato', () => {
  it('modal tem o select com pj e clt', () => {
    expect(equipe).toContain('PJ / Comissionada');
    expect(equipe).toMatch(/value="clt"/);
  });
  it('select da listagem traz tipo_contrato', () => {
    expect(equipe).toMatch(/tipo_contrato/);
  });
  it('API PATCH valida e grava tipo_contrato', () => {
    expect(api).toMatch(/tipo_contrato === 'pj' \|\| tipo_contrato === 'clt'/);
    expect(api).toContain('tipo_contrato: tc');
  });
});
