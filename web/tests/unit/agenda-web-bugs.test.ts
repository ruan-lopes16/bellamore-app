import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { montarAgendamento } from '../../../shared/agenda';

// Task 3 da paridade da Agenda: bugs da agenda do web (varredura de texto + regra pura).
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');
const agenda = ler('web/app/(app)/agenda/page.tsx');
const cliente = ler('web/app/(app)/clientes/[id]/page.tsx');

describe('edição de atendimento antigo', () => {
  it('monta as linhas iniciais com linhasIniciaisEdicao', () => {
    expect(agenda).toMatch(/import \{[^}]*linhasIniciaisEdicao[^}]*montarAgendamento[^}]*\} from '@shared\/agenda'/);
    expect(agenda).toContain('linhasIniciaisEdicao(');
  });
});

describe('taxa de reserva sobre o total', () => {
  for (const [nome, src] of [['agenda', agenda], ['perfil da cliente', cliente]] as const) {
    it(`${nome}: sugerida pelo valorTotal, recalculada e travada após edição manual`, () => {
      expect(src).toContain('montarAgendamento(');
      expect(src).toContain('taxaEditadaManual');
      expect(src).toMatch(/useEffect\(\(\) => \{[^]*?valorTaxaReservaSugerida\(taxaReservaCfg, valorTotal\)[^]*?\}, \[[^\]]*valorTotal[^\]]*\]\)/);
      expect(src).toContain('setTaxaEditadaManual(true)');
    });
  }
  it('agenda: onServicoChange não calcula mais a taxa com o preço de um serviço só', () => {
    const i = agenda.indexOf('function onServicoChange');
    expect(agenda.slice(i, i + 700)).not.toContain('valorTaxaReservaSugerida');
  });
});

describe('cortesia', () => {
  it('"0" na linha grava 0, vazio usa o preço', () => {
    const base = { servico_id: 's', profissional_id: 'p', duracao_min: 30, preco: 100 };
    expect(montarAgendamento({ linhas: [{ ...base, valor: '0' }], inicioIso: '2026-10-19T12:00:00.000Z' }).valorTotal).toBe(0);
    expect(montarAgendamento({ linhas: [{ ...base, valor: '' }], inicioIso: '2026-10-19T12:00:00.000Z' }).valorTotal).toBe(100);
  });
  it('agenda grava o valor de montarAgendamento', () => {
    expect(agenda).toContain('valor:             montado.valorTotal');
    expect(agenda).toContain('valor:           l.valor,');
  });
});

describe('avaliação', () => {
  it('usa salvarAvaliacao, sem profissional_id, e mostra o erro', () => {
    expect(agenda).toContain("import { salvarAvaliacao } from '@shared/agenda-consultas'");
    expect(agenda).toContain('await salvarAvaliacao(');
    expect(agenda).not.toContain("from('avaliacoes')");
    expect(agenda).not.toContain('avaliacaoAg.profissionalId');
    const i = agenda.indexOf('async function salvar() {', agenda.indexOf('function AvaliacaoModal'));
    expect(agenda.slice(i, i + 500)).toContain('catch');
  });
});

describe('carga do dia', () => {
  it('fetchDia confere o erro e avisa em vez de lista vazia silenciosa', () => {
    const i = agenda.indexOf('const fetchDia = useCallback');
    const corpo = agenda.slice(i, i + 2500);
    // Carga paginada (`buscarPaginas` lança no erro de qualquer página) e conferida no catch.
    expect(corpo).toContain('buscarPaginas(');
    expect(corpo).toContain('} catch (e) {');
    expect(corpo).toContain('setErroDia(');
    expect(agenda).toContain('erroDia &&');
  });
});
