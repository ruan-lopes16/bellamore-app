import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CHAVES_FINANCEIRO } from '@shared/invalidacao-financeira';

const raiz = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');

describe('Fase 2B — correções da revisão final', () => {
  it('comissões da profissional: sem zeros enquanto carrega', () => {
    const s = ler('mobile/app/(profissional)/comissoes.tsx');
    expect(s).toContain('const semNumero = erro || isLoading || carregandoResumo || !resumo;');
    expect(s).toContain("semNumero ? '—' : formatarMoeda(n)");
    expect(s).toContain('filter(Boolean)');
  });
  it('início da profissional: KPIs com "—" enquanto carrega/erro', () => {
    const s = ler('mobile/app/(profissional)/inicio.tsx');
    expect(s).toContain('const semResumo = erroResumo || carregandoResumo || !resumoMes;');
    expect(s).toContain("semResumo ? '—' : formatarMoeda(resumoMes.total)");
    expect(s).toContain("erroKpis || carregandoKpis || !kpisDia ? '—'");
  });
  it('Relatórios web: Pagar desabilitado enquanto a chamada roda', () => {
    const s = ler('web/app/(app)/relatorios/page.tsx');
    expect(s).toContain('setPagandoId(profissionalId)');
    expect(s).toContain('disabled={pagandoId !== null}');
  });
  it('Mais: badge de comissões só consulta com permissão', () => {
    expect(ler('mobile/app/(empresa)/mais.tsx')).toContain("useResumoComissoesPendentes(pode('comissoes.ver_todas'))");
  });
  it('Relatórios mobile: badge de variação só sem erro', () => {
    expect(ler('mobile/app/(empresa)/relatorios.tsx')).toContain('{dFat !== null && !isError && (<View style={{');
  });
  it('invalidação financeira inclui as chaves da profissional e reconquista', () => {
    for (const k of ['dash-reconquista', 'prof-comissoes', 'prof-kpis-dia']) expect(CHAVES_FINANCEIRO).toContain(k);
  });
});
