import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { estadoTrocaMesDashboard } from '@shared/dashboard';

const raiz = path.resolve(__dirname, '../../..');
const ler = (p: string) => readFileSync(path.join(raiz, p), 'utf8');

describe('estadoTrocaMesDashboard — troca de mês sem "travar"', () => {
  it('sem troca em curso: nada esmaecido, sem aviso', () => {
    expect(estadoTrocaMesDashboard({ mesPedido: '2026-11', mesDosDados: '2026-11', carregando: false }))
      .toEqual({ atualizando: false, mesDosNumeros: null, aviso: null });
  });

  it('pediu outro mês e os números ainda são do anterior: esmaece e diz de qual mês são', () => {
    expect(estadoTrocaMesDashboard({ mesPedido: '2026-10', mesDosDados: '2026-11', carregando: true }))
      .toEqual({ atualizando: true, mesDosNumeros: '2026-11', aviso: 'Atualizando… · mostrando Novembro 2026' });
  });

  it('cliques seguidos: resposta de um clique antigo nunca passa pelo mês novo', () => {
    // Pediu setembro depois de outubro; chegou outubro (resposta antiga) e a de setembro segue em curso.
    const e = estadoTrocaMesDashboard({ mesPedido: '2026-09', mesDosDados: '2026-10', carregando: true });
    expect(e.atualizando).toBe(true);
    expect(e.mesDosNumeros).toBe('2026-10');
    // Mesmo que a busca pare, números de outro mês continuam marcados.
    expect(estadoTrocaMesDashboard({ mesPedido: '2026-09', mesDosDados: '2026-10', carregando: false }).atualizando).toBe(true);
  });

  it('mesmo mês recarregando: só "Atualizando…"', () => {
    expect(estadoTrocaMesDashboard({ mesPedido: '2026-11', mesDosDados: '2026-11', carregando: true }))
      .toEqual({ atualizando: true, mesDosNumeros: null, aviso: 'Atualizando…' });
  });

  it('1ª carga (sem dado nenhum) sem busca: não marca nada', () => {
    expect(estadoTrocaMesDashboard({ mesPedido: '2026-11', mesDosDados: null, carregando: false }).atualizando).toBe(false);
  });
});

describe('Dashboard usa a troca de mês nas duas plataformas', () => {
  it('web: navegação no cliente com transição, provider e conteúdo esmaecido', () => {
    const page = ler('web/app/(app)/dashboard/page.tsx');
    const troca = ler('web/app/(app)/dashboard/TrocaMes.tsx');
    expect(page).toContain('<TrocaMesProvider mes={mesRefKey} hoje={hojeStr}>');
    expect(page).toContain('<NavegacaoMes />');
    expect(page).toContain('<ConteudoMes>');
    expect(page).not.toContain('href={`/dashboard?mes=${paramAnterior}`}');
    expect(troca).toContain('useTransition');
    expect(troca).toContain('estadoTrocaMesDashboard(');
    // owner_id não é mais uma ida ao banco em série antes das demais.
    expect(page).not.toMatch(/const empOwner = await supabase/);
  });

  it('app: dado carrega o próprio mês, KPIs pelos limites dele e indicador de atualização', () => {
    const hook = ler('mobile/hooks/useDashboard.ts');
    const tela = ler('mobile/app/(empresa)/dashboard.tsx');
    expect(hook).toContain('placeholderData: keepPreviousData');
    expect(hook).toContain('estadoTrocaMesDashboard(');
    expect(hook).toContain('calcularKpisFinanceiros(dados, limMesDados)');
    expect(tela).toContain('trocaMes.aviso');
    expect(tela).toContain('rotuloMesAno(mesDosNumeros)');
  });
});
