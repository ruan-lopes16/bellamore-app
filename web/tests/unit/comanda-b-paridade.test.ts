import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(process.cwd(), '..');
const web = readFileSync(join(raiz, 'web/app/(app)/comanda/page.tsx'), 'utf8');

describe('Comanda B — web', () => {
  it('usa as regras de shared', () => {
    expect(web).toContain("from '@shared/comanda-recibo'");
    expect(web).toContain('cartoesComandaDoDia(');
    expect(web).toContain('diffItensComanda(');
    expect(web).toContain('carregarBacklogComandas(');
    expect(web).toContain('carregarComandasSoExtrasDoDia(');
    expect(web).toContain('carregarComissoesPagasDosItens(');
    expect(web).not.toMatch(/function gerarTextoRecibo/);
  });
  it('não apaga mais todos os itens da comanda na edição', () => {
    expect(web).not.toMatch(/from\('comanda_itens'\)\.delete\(\)\.eq\('comanda_id'/);
  });
  it('abre a comanda do cartão, não a primeira da cliente', () => {
    expect(web).not.toMatch(/agendamentos\.find\(a => a\.comanda_id\)\?\.comanda_id/);
  });
  it('trava profissional e remoção de extra com comissão paga', () => {
    expect(web).toContain('comissao_paga');
    expect(web).toContain('Comissão já paga');
  });
});

describe('Comanda B — web: abertura de comanda fechada', () => {
  it('zera os originais e ignora respostas de aberturas antigas', () => {
    const corpo = web.match(/async function abrirComandaFechada[\s\S]*?\n {2}\}\r?\n/)?.[0] ?? '';
    expect(corpo).toContain('setItensOriginais([])');
    expect(corpo).toContain('aberturaRef.current');
    expect(web).toContain('cargaFalhou');
  });
});
