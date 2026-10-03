import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CHAVES_FINANCEIRO, invalidarFinanceiro } from '@shared/invalidacao-financeira';

const raiz = join(__dirname, '..', '..', '..');
const ler = (...p: string[]) => readFileSync(join(raiz, ...p), 'utf8').replace(/\r\n/g, '\n');

describe('mobile invalidarFinanceiro', () => {
  it('invalida todos os prefixos que alimentam números financeiros', () => {
    const qc = { invalidateQueries: vi.fn() };
    invalidarFinanceiro(qc as never);
    const chamadas = qc.invalidateQueries.mock.calls.map(c => c[0].queryKey[0]);
    for (const k of [
      'fin-resumo', 'fin-despesas', 'fin-despesas-historico', 'dash-financeiro', 'rel-dados',
      'rel-sumidos', 'comissoes-pendentes', 'comandas-nao-fechadas', 'comissoes-gestor',
    ]) expect(chamadas).toContain(k);
    expect(chamadas).toHaveLength(CHAVES_FINANCEIRO.length);
  });

  it('cada chave existe de fato em algum hook do mobile', () => {
    const hooks = ['useFinanceiro', 'useDashboard', 'useProfissional', 'useRelatorios', 'useComissoesGestor']
      .map(h => ler('mobile', 'hooks', `${h}.ts`)).join('\n');
    for (const k of CHAVES_FINANCEIRO) expect(hooks).toContain(`'${k}'`);
  });

  it('as telas que mexem em dinheiro chamam o helper', () => {
    expect(ler('mobile', 'app', '(empresa)', 'nova-comanda.tsx')).toContain('invalidarFinanceiro(qc)');
    const ag = ler('mobile', 'app', '(empresa)', 'agendamento', '[id].tsx');
    expect(ag.match(/invalidarFinanceiro\(qc\)/g)?.length).toBe(2);
    expect(ler('mobile', 'hooks', 'useComissoesGestor.ts')).toContain('invalidarFinanceiro(qc)');
    expect(ler('mobile', 'app', '(empresa)', 'financeiro.tsx').match(/invalidarFinanceiro\(qc\)/g)?.length).toBe(3);
    expect(ler('mobile', 'app', '(empresa)', 'nova-despesa.tsx')).toContain('invalidarFinanceiro(qc)');
  });
});

describe('web Relatórios: pagar comissão e carga', () => {
  const src = ler('web', 'app', '(app)', 'relatorios', 'page.tsx');
  it('atualiza dados.comissoes (KPI) só com os ids confirmados pelo banco', () => {
    expect(src).toContain('comissoes: prev.comissoes.map');
    expect(src).toContain('ids.filter(id => !confirmados.has(id))');
    expect(src).toContain("marcar(r.confirmados, 'pago')");
  });
  it('descarta respostas velhas e bloqueia exportação com erro', () => {
    expect(src).toContain('const req = ++reqRef.current');
    expect(src).toContain('if (req !== reqRef.current) return');
    expect(src).toContain('++reqRetiradasRef.current');
    expect(src).toContain('{!loading && !erroCarga && (\n            <ExportButton');
  });
});

describe('web Financeiro: respostas velhas e dono resolvido', () => {
  const src = ler('web', 'app', '(app)', 'financeiro', 'page.tsx');
  it('contador de requisição e espera de isOwner', () => {
    expect(src).toContain('useState<boolean | null>(null)');
    expect(src).toContain('if (!empresaId || isOwner === null) return;');
    expect(src).toContain('const req = ++reqRef.current');
    expect((src.match(/if \(req !== reqRef\.current\) return/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src).toContain('if (req === reqRef.current) setLoading(false)');
  });
});

describe('mobile: dashboard, sumidas, período personalizado, gráfico vazio', () => {
  it('dashboard mostra — fora do sucesso', () => {
    const d = ler('mobile', 'app', '(empresa)', 'dashboard.tsx');
    expect(d).toContain("financeiroPronto ? formatBRL(receitaMes) : '—'");
    expect(d).toContain("hojePronto ? formatBRL(receitaHoje) : '—'");
    expect(d).not.toContain('{formatBRL(comissoesPendentes.total)}');
  });
  it('sumidas ignora cliente nulo e mostra — enquanto carrega', () => {
    const h = ler('mobile', 'hooks', 'useRelatorios.ts');
    expect(h).toContain('carregarUltimasVisitas(');
    expect(ler('shared', 'dashboard-consultas.ts')).toContain('a.cliente_id && !mapa.has(a.cliente_id)');
    expect(h).toContain('sumidos: sumidosQ.data,');
    expect(ler('mobile', 'app', '(empresa)', 'relatorios.tsx')).toContain("clientes?.sumidos == null ? '—'");
  });
  it('paraIsoBR rejeita data inexistente e a tela avisa', () => {
    const r = ler('mobile', 'app', '(empresa)', 'relatorios.tsx');
    expect(r).toContain('d.getDate()');
    expect(r).toContain('dataCustomInvalida');
    expect(r).toContain('Data inválida');
  });
  it('gráfico vazio do Financeiro usa rótulo de shared', () => {
    const f = ler('mobile', 'app', '(empresa)', 'financeiro.tsx');
    expect(f).toContain("rotuloMesCurto(somarMeses(format(mesRef, 'yyyy-MM'), i - 5))");
    expect(f).not.toContain("'MMM', { locale: ptBR }");
  });
});
