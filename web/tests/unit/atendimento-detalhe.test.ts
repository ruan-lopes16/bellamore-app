import { describe, expect, it } from 'vitest';
import { descreverServicos, montarDetalheAtendimento } from '@shared/atendimento-detalhe';
import type { EntradaDetalhe } from '@shared/atendimento-detalhe';

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

const COMANDA = {
  id: 'c1', valor_total: 300, desconto: 50, desconto_reserva: 20,
  fechada_at: '2026-08-12T18:00:00Z', observacao: null,
};

function entrada(over: Partial<EntradaDetalhe> = {}): EntradaDetalhe {
  return {
    agendamentoId: 'a1',
    comandaIdEsperado: 'c1',
    comanda: COMANDA,
    itens: [],
    pagamentos: [],
    agendamentosDaComanda: [],
    ...over,
  };
}

describe('montarDetalheAtendimento', () => {
  it('separa o desconto manual do desconto de reserva sem contar duas vezes', () => {
    // comandas.desconto ja inclui o desconto_reserva (migration 057)
    const d = montarDetalheAtendimento(entrada());
    expect(d.subtotal).toBe(300);
    expect(d.descontoManual).toBe(30);   // 50 - 20
    expect(d.descontoReserva).toBe(20);
    expect(d.total).toBe(250);           // 300 - 50
  });

  it('une as linhas dos agendamentos com os extras da comanda', () => {
    const d = montarDetalheAtendimento(entrada({
      agendamentosDaComanda: [{
        id: 'a1', data_hora_inicio: '2026-08-12T14:00:00Z', valor: 250,
        servico: { nome: 'Sobrancelha' },
        agendamento_servicos: [
          { ordem: 0, servico: { nome: 'Sobrancelha' } },
          { ordem: 1, servico: { nome: 'Buco' } },
        ],
        profissional: { nome: 'Ana Clara' },
      }],
      itens: [{
        id: 'i1', tipo: 'produto', descricao: 'Serum facial',
        quantidade: 2, valor_unit: 25, profissional: null,
      }],
    }));

    expect(d.itens).toHaveLength(2);
    expect(d.itens[0]).toMatchObject({
      origem: 'agendamento', tipo: 'servico',
      descricao: 'Sobrancelha + Buco', quantidade: 1,
      valorUnit: 250, valorLinha: 250,
      profissional: 'Ana Clara', esteAtendimento: true,
    });
    expect(d.itens[1]).toMatchObject({
      origem: 'comanda_item', tipo: 'produto',
      descricao: 'Serum facial', quantidade: 2,
      valorUnit: 25, valorLinha: 50, esteAtendimento: false,
    });
  });

  it('marca so o agendamento aberto como esteAtendimento', () => {
    const d = montarDetalheAtendimento(entrada({
      agendamentoId: 'a2',
      agendamentosDaComanda: [
        { id: 'a1', data_hora_inicio: '2026-08-12T14:00:00Z', valor: 100, servico: { nome: 'X' } },
        { id: 'a2', data_hora_inicio: '2026-08-12T15:00:00Z', valor: 150, servico: { nome: 'Y' } },
      ],
    }));
    expect(d.itens.map((i) => i.esteAtendimento)).toEqual([false, true]);
  });

  it('lista os outros atendimentos cobertos pela mesma comanda', () => {
    const d = montarDetalheAtendimento(entrada({
      agendamentosDaComanda: [
        { id: 'a1', data_hora_inicio: '2026-08-12T14:00:00Z', valor: 100, servico: { nome: 'X' } },
        { id: 'a2', data_hora_inicio: '2026-08-12T15:00:00Z', valor: 150, servico: { nome: 'Y' } },
      ],
    }));
    expect(d.outrosAtendimentos).toEqual([
      { id: 'a2', dataHoraInicio: '2026-08-12T15:00:00Z', servicos: 'Y' },
    ]);
  });

  it('nao lista outros atendimentos quando a comanda cobre so um', () => {
    const d = montarDetalheAtendimento(entrada({
      agendamentosDaComanda: [
        { id: 'a1', data_hora_inicio: '2026-08-12T14:00:00Z', valor: 100, servico: { nome: 'X' } },
      ],
    }));
    expect(d.outrosAtendimentos).toEqual([]);
  });

  it('normaliza os campos opcionais do pagamento', () => {
    const d = montarDetalheAtendimento(entrada({
      pagamentos: [
        { id: 'p1', metodo: 'pix', valor: 100 },
        { id: 'p2', metodo: 'credito', valor: 150, bandeira: 'visa', parcelas: 3, taxa_perc: 4.5, valor_liquido: 143.25 },
      ],
    }));
    expect(d.pagamentos[0]).toEqual({
      id: 'p1', metodo: 'pix', valor: 100,
      bandeira: null, parcelas: 1, taxaPerc: null, valorLiquido: null,
    });
    expect(d.pagamentos[1]).toEqual({
      id: 'p2', metodo: 'credito', valor: 150,
      bandeira: 'visa', parcelas: 3, taxaPerc: 4.5, valorLiquido: 143.25,
    });
  });

  it('reporta sem_comanda quando o atendimento nao foi fechado', () => {
    const d = montarDetalheAtendimento(entrada({ comandaIdEsperado: null, comanda: null }));
    expect(d.situacao).toBe('sem_comanda');
    expect(d.itens).toEqual([]);
    expect(d.pagamentos).toEqual([]);
    expect(d.total).toBe(0);
  });

  it('reporta bloqueado_por_rls quando ha comanda mas ela nao veio', () => {
    // profissional abrindo o atendimento de uma colega: migration 045 filtra
    // a linha e o PostgREST devolve vazio, sem erro.
    const d = montarDetalheAtendimento(entrada({ comandaIdEsperado: 'c1', comanda: null }));
    expect(d.situacao).toBe('bloqueado_por_rls');
    expect(d.itens).toEqual([]);
    expect(d.total).toBe(0);
  });

  it('reporta completo quando a comanda veio', () => {
    expect(montarDetalheAtendimento(entrada()).situacao).toBe('completo');
  });
});
