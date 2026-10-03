import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const page = ler('web/app/(app)/financeiro/page.tsx');
const cal = ler('web/components/FinanceMonthCalendar.tsx');

describe('web Financeiro: recorrentes e calendário pelas regras únicas', () => {
  it('lançamento', () => {
    for (const t of ['carregarHistoricoRecorrentesMensais(', 'recorrentesParaLancarNoMes(', 'montarLancamentosRecorrentes(',
      'textoRecorrentesPendentes(', 'lancarRecorrentesMensais(']) expect(page).toContain(t);
    for (const t of ['templatesRecorrentesParaLancar(', 'proximaParcelaAtual(', '.limit(5000)']) expect(page).not.toContain(t);
  });
  it('calendário', () => {
    for (const t of ['gradeCalendarioMes(', 'rotuloIntervaloMes(', 'DIAS_SEMANA_ABREV', 'rotuloDiaExtenso(']) expect(cal).toContain(t);
    expect(cal).not.toContain("from 'date-fns'");
  });
});
