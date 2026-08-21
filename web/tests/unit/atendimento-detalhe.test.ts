import { describe, expect, it } from 'vitest';
import { descreverServicos } from '@shared/atendimento-detalhe';

type ServicoDoAgendamentoTeste = { ordem: number; servico: { nome: string } | null };

describe('descreverServicos', () => {
  it('junta os servicos de agendamento_servicos na ordem', () => {
    expect(descreverServicos({
      servico: { nome: 'Design de sobrancelha' },
      agendamento_servicos: [
        { ordem: 2, servico: { nome: 'Buco' } },
        { ordem: 0, servico: { nome: 'Design de sobrancelha' } },
        { ordem: 1, servico: { nome: 'Spa dos labios' } },
      ],
    })).toBe('Design de sobrancelha + Spa dos labios + Buco');
  });

  it('cai no servico legado quando nao ha agendamento_servicos', () => {
    expect(descreverServicos({ servico: { nome: 'Limpeza de pele' }, agendamento_servicos: [] }))
      .toBe('Limpeza de pele');
    expect(descreverServicos({ servico: { nome: 'Limpeza de pele' } }))
      .toBe('Limpeza de pele');
    expect(descreverServicos({ servico: { nome: 'Limpeza de pele' }, agendamento_servicos: null }))
      .toBe('Limpeza de pele');
  });

  it('ignora linhas sem servico e cai no legado se sobrar nada', () => {
    expect(descreverServicos({
      servico: { nome: 'Limpeza de pele' },
      agendamento_servicos: [{ ordem: 0, servico: null }],
    })).toBe('Limpeza de pele');
  });

  it('ignora apenas as linhas vazias quando ha outras validas', () => {
    expect(descreverServicos({
      servico: null,
      agendamento_servicos: [
        { ordem: 0, servico: { nome: 'Massagem' } },
        { ordem: 1, servico: null },
      ],
    })).toBe('Massagem');
  });

  it('retorna null quando nao ha nome nenhum', () => {
    expect(descreverServicos({ servico: null, agendamento_servicos: [] })).toBeNull();
    expect(descreverServicos({})).toBeNull();
  });

  it('nao muta o array recebido', () => {
    const servicos: ServicoDoAgendamentoTeste[] = [
      { ordem: 1, servico: { nome: 'B' } },
      { ordem: 0, servico: { nome: 'A' } },
    ];
    descreverServicos({ agendamento_servicos: servicos });
    expect(servicos[0].ordem).toBe(1);
  });
});
