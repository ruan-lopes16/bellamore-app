import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const gestor = ler('web/app/(app)/comissoes/ComissoesGestorView.tsx');
const prof = ler('web/app/(app)/comissoes/ComissoesProfissionalView.tsx');
const equipe = ler('web/app/(app)/equipe/page.tsx');

describe('web Comissões usa as regras únicas', () => {
  it('gestão', () => {
    for (const t of ['PERIODOS_COMISSAO', 'limitesPeriodoComissao(', 'rotuloPeriodoComissao(', 'carregarComissoesDoPeriodo(',
      'normalizarComissoes(', 'resumoComissoes(', 'comissoesPorProfissional(', 'agruparComissoesPorData(',
      'pagarComissoes(', 'MENSAGEM_PAGAMENTO_PARCIAL', 'Não foi possível carregar as comissões', 'reqRef.current'])
      expect(gestor).toContain(t);
    for (const t of ['startOfMonth', 'endOfMonth', 'toISOString()', 'function getPeriodRange', "from('comissoes')", 'percentual_comissao'])
      expect(gestor).not.toContain(t);
  });
  it('profissional', () => {
    for (const t of ['PERIODOS_COMISSAO', 'limitesPeriodoComissao(', 'carregarComissoesDoPeriodo(', 'profissionalId: userId',
      'resumoComissoesProfissional(', 'FILTROS_COMISSAO', 'filtrarComissoes(', 'Comissão média', 'rotuloDataHoraBRT('])
      expect(prof).toContain(t);
    expect(prof).not.toContain('startOfMonth');
    expect(prof).not.toContain("from('comissoes')");
  });
  it('Equipe: Pagar = pendentes do mês (Brasília), aviso das anteriores', () => {
    for (const t of ['pendentesPorProfissional(', 'pagarComissoes(', 'limitesMes(', 'hojeBRT()', 'de meses anteriores', 'ids_pendentes_mes'])
      expect(equipe).toContain(t);
    expect(equipe).not.toContain(".update({ status: 'pago' })");
    expect(equipe).not.toContain('startOfMonth(new Date())');
  });
});
