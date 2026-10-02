import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const hook = ler('mobile/hooks/useFinanceiro.ts');
const tela = ler('mobile/app/(empresa)/financeiro.tsx');
const cal = ler('mobile/components/CalendarioMesFinanceiro.tsx');

describe('app Financeiro = web Financeiro (recorrentes e calendário)', () => {
  it('lançamento só com as duas listas carregadas com sucesso', () => {
    for (const t of ['carregarHistoricoRecorrentesMensais(', 'recorrentesParaLancarNoMes(', 'montarLancamentosRecorrentes(',
      'lancarRecorrentesMensais(', 'despesas.isSuccess && historicoQ.isSuccess', 'invalidarFinanceiro(qc)',
      "'fin-despesas-historico'"]) expect(hook).toContain(t);
    expect(hook).not.toContain('.insert(');
  });
  it('tela: aviso, botão (travado em voo), feedback e calendário', () => {
    for (const t of ['<CalendarioMesFinanceiro', 'textoRecorrentesPendentes(', 'Lançar agora', 'lancarRecorrentes', '!isError &&',
      'disabled={lancandoRecorrentes}', 'jaExistiam'])
      expect(tela).toContain(t);
  });
  it('calendário com a grade única', () => {
    for (const t of ['gradeCalendarioMes(', 'rotuloIntervaloMes(', 'DIAS_SEMANA_ABREV', 'rotuloMesAno(']) expect(cal).toContain(t);
  });
});
