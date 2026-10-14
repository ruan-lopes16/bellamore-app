import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Bug de produção (2026-10-14): a profissional (com comanda.fechar) via "Você não tem permissão
 * para fechar a comanda". O INSERT em `comandas` pedia RETURNING (`.select('id')`), mas a policy de
 * SELECT só mostra à profissional comandas ligadas a atendimentos dela — e a recém-criada ainda não
 * está ligada. Id gerado no cliente, sem RETURNING, e profissional_id = quem fechou.
 */
const raiz = join(process.cwd(), '..');
const telas = {
  web: readFileSync(join(raiz, 'web', 'app', '(app)', 'comanda', 'page.tsx'), 'utf8'),
  app: readFileSync(join(raiz, 'mobile', 'app', '(empresa)', 'nova-comanda.tsx'), 'utf8'),
};

describe.each(Object.entries(telas))('criação da comanda (%s)', (_nome, src) => {
  const inicio = src.indexOf(".from('comandas').insert({");
  const trecho = src.slice(inicio, src.indexOf('});', inicio) + 3 + 40);

  it('existe uma criação de comanda', () => {
    expect(inicio).toBeGreaterThan(-1);
  });
  it('id gerado no cliente e profissional_id = quem fechou', () => {
    expect(src).toContain('const comandaId = novoUuid();');
    expect(trecho).toContain('id: ');
    expect(trecho).toContain('profissional_id: meuUserId || null');
  });
  it('sem RETURNING (nenhum .select depois do insert)', () => {
    expect(trecho).not.toMatch(/\}\)\s*\.select\(/);
  });
});
