import { describe, expect, it } from 'vitest';
import {
  selecionarLembrete, corpoLembrete, tituloLembrete, destinatarios,
  corpoResumoDiario, corpoResumoDiarioProfissional, type AgLembrete,
} from '@shared/lembretes';

const base: AgLembrete = {
  id: 'a1', profissional_id: 'p1', data_hora_inicio: '2026-09-04T17:30:00-03:00',
  cliente_nome: 'Lazara', descricao_servico: 'Design com tintura',
  lembrete_30min_em: null,
};

describe('selecionarLembrete — janela de 30 min', () => {
  it('inclui quem começa em 30 min e ainda não avisado', () => {
    const agora = new Date('2026-09-04T17:00:00-03:00');
    expect(selecionarLembrete([base], agora).map(a => a.id)).toEqual(['a1']);
  });
  it('inclui quem começa em 26 min (dentro da folga)', () => {
    const agora = new Date('2026-09-04T17:04:00-03:00');
    expect(selecionarLembrete([base], agora).map(a => a.id)).toEqual(['a1']);
  });
  it('exclui quem começa em 40 min (fora da folga)', () => {
    const agora = new Date('2026-09-04T16:50:00-03:00');
    expect(selecionarLembrete([base], agora)).toEqual([]);
  });
  it('exclui quem já tem lembrete_30min_em', () => {
    const agora = new Date('2026-09-04T17:00:00-03:00');
    expect(selecionarLembrete([{ ...base, lembrete_30min_em: '2026-09-04T16:59:00-03:00' }], agora)).toEqual([]);
  });
  it('exclui quem já começou (horário passou)', () => {
    const agora = new Date('2026-09-04T17:31:00-03:00');
    expect(selecionarLembrete([base], agora)).toEqual([]);
  });
});

describe('corpoLembrete / tituloLembrete', () => {
  it('corpo = "cliente · serviço · HH:mm"', () => {
    expect(corpoLembrete(base)).toBe('Lazara · Design com tintura · 17:30');
  });
  it('usa o pacote quando descricao_servico já vem com o nome do pacote', () => {
    expect(corpoLembrete({ ...base, descricao_servico: 'Pacote Cílios (5 sessões)' }))
      .toBe('Lazara · Pacote Cílios (5 sessões) · 17:30');
  });
  it('fallbacks quando falta dado', () => {
    expect(corpoLembrete({ ...base, cliente_nome: null, descricao_servico: null }))
      .toBe('Cliente · Atendimento · 17:30');
  });
  it('título fixo', () => {
    expect(tituloLembrete()).toBe('Atendimento em 30 minutos');
  });
});

describe('destinatarios', () => {
  it('profissional do ag + owners/gestores, sem duplicar', () => {
    const membros = [
      { user_id: 'p1', role: 'profissional' },
      { user_id: 'owner1', role: 'owner' },
      { user_id: 'g1', role: 'gestor' },
      { user_id: 'p2', role: 'profissional' },
    ];
    expect(destinatarios('p1', membros).sort()).toEqual(['g1', 'owner1', 'p1'].sort());
  });
});

describe('corpoResumoDiario', () => {
  it('junta só as linhas com contagem > 0', () => {
    expect(corpoResumoDiario({ agendamentos: 3, despesasVencendo: 0, estoqueBaixo: 2 }))
      .toBe('📅 3 atendimentos hoje\n📦 2 produtos com estoque baixo');
  });
  it('singular', () => {
    expect(corpoResumoDiario({ agendamentos: 1, despesasVencendo: 1, estoqueBaixo: 1 }))
      .toBe('📅 1 atendimento hoje\n💰 1 despesa vencendo hoje\n📦 1 produto com estoque baixo');
  });
  it('tudo zero → string vazia', () => {
    expect(corpoResumoDiario({ agendamentos: 0, despesasVencendo: 0, estoqueBaixo: 0 })).toBe('');
  });
});

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

describe('corpoResumoDiarioProfissional', () => {
  it('atendimentos + comissão formatada em BRL', () => {
    expect(corpoResumoDiarioProfissional({ atendimentos: 3, comissao: 150.5 }))
      .toBe(`📅 3 atendimentos hoje\n💰 ${brl(150.5)} em comissão hoje`);
  });
  it('singular', () => {
    expect(corpoResumoDiarioProfissional({ atendimentos: 1, comissao: 0 }))
      .toBe(`📅 1 atendimento hoje\n💰 ${brl(0)} em comissão hoje`);
  });
  it('sem atendimento hoje → string vazia (mesmo com comissão residual)', () => {
    expect(corpoResumoDiarioProfissional({ atendimentos: 0, comissao: 50 })).toBe('');
  });
});
