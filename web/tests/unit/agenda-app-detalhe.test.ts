import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Task 9 da paridade da Agenda: detalhe do atendimento no app — status pela regra única,
// avaliação (1 a 5 + comentário) e aviso de taxa paga ao excluir, igual ao web.
const raiz = join(process.cwd(), '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8').replace(/\r\n/g, '\n');

const EMP = 'mobile/app/(empresa)/agendamento/[id].tsx';
const PROF = 'mobile/app/(profissional)/agendamento/[id].tsx';
const BOTOES = 'mobile/components/atendimento/BotoesStatus.tsx';
const AVAL = 'mobile/components/atendimento/AvaliacaoAtendimento.tsx';
const LIB = 'mobile/lib/statusAtendimento.ts';
const TAXA = 'mobile/lib/taxaCancelamento.ts';

describe('app: detalhe do atendimento', () => {
  it('arquivos novos existem', () => {
    for (const f of [BOTOES, AVAL, LIB]) expect(existsSync(join(raiz, f))).toBe(true);
  });

  describe('status pela regra única', () => {
    it('botões vêm de statusPermitidos e concluído com comanda mostra MSG_CONCLUIDO_COM_COMANDA', () => {
      const b = ler(BOTOES);
      expect(b).toContain("from '@shared/agenda'");
      expect(b).toContain('statusPermitidos(');
      expect(b).toContain('MSG_CONCLUIDO_COM_COMANDA');
    });

    it('as duas telas usam BotoesStatus com comanda_id e não têm mais transições fixas', () => {
      for (const f of [EMP, PROF]) {
        const t = ler(f);
        expect(t).toContain('<BotoesStatus');
        expect(t).toMatch(/comandaFechada=\{!!ag\.comanda_id\}/);
        expect(t).not.toContain("ag.status === 'agendado' &&");
        expect(t).not.toContain('const podeConfirmar');
        expect(t).not.toContain('function confirmarCancelamento');
      }
    });

    it('toda troca passa por precisaConfirmarStatus, sem segunda pergunta quando a taxa já perguntou', () => {
      for (const f of [EMP, PROF]) {
        const t = ler(f);
        expect(t).toContain('precisaConfirmarStatus(');
        expect(t).toContain('escolherCobrancaCancelamento(');
        expect(t).toMatch(/perguntou \? null : precisaConfirmarStatus\(/);
        expect(t).toContain('confirmarAlerta(');
      }
    });

    it('o helper da taxa informa se perguntou', () => {
      const h = ler(TAXA);
      expect(h).toContain('perguntou: boolean');
      expect(h).toContain('perguntou: true');
      expect(h).toContain('perguntou: false');
    });

    it('confirmarAlerta resolve false ao fechar o alerta', () => {
      const l = ler(LIB);
      expect(l).toContain('export function confirmarAlerta(');
      expect(l).toContain("style: 'cancel'");
      expect(l).toContain('onDismiss');
    });
  });

  describe('avaliação', () => {
    it('carrega por agendamento_id e salva com salvarAvaliacao', () => {
      const a = ler(AVAL);
      expect(a).toContain("from('avaliacoes')");
      expect(a).toContain(".eq('agendamento_id', agendamentoId)");
      expect(a).toContain('.maybeSingle()');
      expect(a).toContain('salvarAvaliacao(');
      expect(a).not.toContain('profissional_id');
      expect(a).toContain('[1, 2, 3, 4, 5]');
      expect(a).toContain('Comentário (opcional)');
    });

    it('aparece só em concluído e só para quem pode mexer no atendimento', () => {
      for (const f of [EMP, PROF]) {
        const t = ler(f);
        expect(t).toContain('<AvaliacaoAtendimento');
        expect(t).toMatch(/podeAlterar && ag\.status === 'concluido' && !!\(ag\.cliente_id \?\? ag\.cliente\?\.id\) && !!empresaAtiva\?\.id && \(/);
      }
    });
  });

  describe('excluir', () => {
    it('consulta as taxas pagas do atendimento com o mesmo texto do web', () => {
      // A consulta mora em shared (mesma função do web); o app só repassa o client.
      expect(ler(LIB)).toContain('export function avisoTaxaPagaAoExcluir(');
      const l = ler('shared/agenda-consultas.ts');
      expect(l).toContain('export async function avisoTaxaPagaAoExcluir(');
      expect(l).toContain("from('taxas_reserva').select('valor, status, paga_em').eq('agendamento_id', agendamentoId)");
      expect(l).toContain("from('taxas_cancelamento').select('valor, status, paga_em').eq('agendamento_id', agendamentoId)");
      expect(l).toContain("t.paga_em != null || t.status === 'pago' || t.status === 'paga'");
      expect(l).toContain(' A taxa de ${formatarMoeda(totalPago)} (paga) também será removida e sai do faturamento daquele período.');
    });

    it('a tela da empresa monta o aviso antes de confirmar', () => {
      const t = ler(EMP);
      expect(t).toContain('await avisoTaxaPagaAoExcluir(');
      expect(t).toContain("Esta ação não pode ser desfeita.${aviso}");
      expect(t).not.toContain('Taxas de reserva/cancelamento vinculadas também serão removidas.');
    });
  });
});
