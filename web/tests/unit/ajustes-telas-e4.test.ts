// web/tests/unit/ajustes-telas-e4.test.ts
// Item 15 (Entrega 4): spinner do histórico de Vendas, contador de requisição no app, badges
// conferem `.error` e mensagem própria quando todas as recorrentes já estavam lançadas.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mostrarSpinnerHistorico } from '@shared/venda';
import { textoLancamentoRecorrentes, TODAS_RECORRENTES_LANCADAS } from '@shared/despesas';
import { contagemBadge, somarBadges } from '@shared/dashboard';

const raiz = resolve(__dirname, '../../..');
const ler = (p: string) => readFileSync(resolve(raiz, p), 'utf8');

describe('spinner do histórico de Vendas só na 1ª carga do dia', () => {
  it('dia ainda não carregado → spinner', () => {
    expect(mostrarSpinnerHistorico(null, '2026-10-15')).toBe(true);
    expect(mostrarSpinnerHistorico('2026-10-14', '2026-10-15')).toBe(true);
  });
  it('recarga do mesmo dia (voltar à tela, depois de uma venda) → sem spinner', () => {
    expect(mostrarSpinnerHistorico('2026-10-15', '2026-10-15')).toBe(false);
  });
  for (const arq of ['web/app/(app)/vendas/page.tsx', 'mobile/app/(empresa)/vendas.tsx']) {
    it(`${arq} usa mostrarSpinnerHistorico`, () => {
      expect(ler(arq)).toMatch(/mostrarSpinnerHistorico\(/);
    });
  }
  it('app: carregar (produtos/clientes/cartões) com contador de requisição', () => {
    const s = ler('mobile/app/(empresa)/vendas.tsx');
    expect(s).toMatch(/const req = \+\+reqCarregarRef\.current;/);
    expect(s).toMatch(/if \(req !== reqCarregarRef\.current\) return;/);
  });
});

describe('lançamento de recorrentes', () => {
  it('nenhuma inserida porque todas já existiam → mensagem própria', () => {
    expect(TODAS_RECORRENTES_LANCADAS).toBe('Todas as recorrentes deste mês já estavam lançadas.');
    expect(textoLancamentoRecorrentes({ inseridas: 0, jaExistiam: 3 })).toBe(TODAS_RECORRENTES_LANCADAS);
    expect(textoLancamentoRecorrentes({ inseridas: 0, jaExistiam: 0 })).toBe(TODAS_RECORRENTES_LANCADAS);
  });
  it('com inseridas mantém o texto de sempre', () => {
    expect(textoLancamentoRecorrentes({ inseridas: 1, jaExistiam: 0 })).toBe('1 despesa lançada.');
    expect(textoLancamentoRecorrentes({ inseridas: 2, jaExistiam: 1 })).toBe('2 despesas lançadas. 1 já estava lançada.');
    expect(textoLancamentoRecorrentes({ inseridas: 1, jaExistiam: 2 })).toBe('1 despesa lançada. 2 já estavam lançadas.');
  });
  for (const arq of ['web/app/(app)/financeiro/page.tsx', 'mobile/app/(empresa)/financeiro.tsx']) {
    it(`${arq} usa textoLancamentoRecorrentes`, () => {
      expect(ler(arq)).toMatch(/textoLancamentoRecorrentes\(/);
    });
  }
});

describe('badges conferem .error', () => {
  it('contagemBadge: erro → null; sem erro → count (null vira 0)', () => {
    expect(contagemBadge({ count: 5, error: null })).toBe(5);
    expect(contagemBadge({ count: null, error: null })).toBe(0);
    expect(contagemBadge({ count: null, error: { message: 'x' } })).toBeNull();
  });
  it('somarBadges: qualquer parte com erro → null (a tela mantém o número anterior)', () => {
    expect(somarBadges([1, 2, 0])).toBe(3);
    expect(somarBadges([1, null])).toBeNull();
  });
  it('Sidebar web usa contagemBadge', () => {
    expect(ler('web/components/Sidebar.tsx')).toMatch(/contagemBadge\(/);
  });
  it('app: badge de comissões do menu e sino de notificações conferem o erro', () => {
    expect(ler('mobile/app/(empresa)/mais.tsx')).toMatch(/isError/);
    expect(ler('mobile/hooks/useNotificacoes.ts')).toMatch(/lista\.isError/);
  });
});
