import { describe, expect, it } from 'vitest';
import {
  AVISO_PACOTE_PARCIAL, pacoteCobreAtendimento, pacotesDoAtendimento, servicoIdsDoAtendimento,
  vinculosPacoteSemCobertura, type PacoteClienteOpt,
} from '@shared/pacotes';
import {
  ErroPacote, MSG_SEM_MIGRATION_100, MSG_VENDA_VARIOS_PACOTES, excluirVendaPacotes,
} from '@shared/pacotes-venda';
import {
  calcularRelatorioUtilizacao, pacotesDaMesmaVenda, carregarPacotesVendidos, type PacoteVendido,
} from '@shared/pacotes-consultas';
import { DIAS_DISPOSITIVO_ATIVO, limiteVistoEm } from '@shared/push-dispositivos';
import { calcularKpisFinanceiros, DADOS_VAZIOS } from '@shared/kpis-financeiros';
import { limitesMes } from '@shared/periodos';

const pac = (id: string, servicos: string[]): PacoteClienteOpt => ({
  id, nome: id, total: 5, usadas: 0, restantes: 5, servicos: servicos.map(s => ({ servico_id: s })), sessoes: [],
});

describe('pacoteCobreAtendimento / pacotesDoAtendimento (A7)', () => {
  it('cobre todos, parte, vazio e repetidos', () => {
    const p = pac('p1', ['a', 'b']);
    expect(pacoteCobreAtendimento(p, ['a', 'b'])).toBe(true);
    expect(pacoteCobreAtendimento(p, ['a', 'a', 'b', ''])).toBe(true);
    expect(pacoteCobreAtendimento(p, ['a', 'c'])).toBe(false);
    expect(pacoteCobreAtendimento(p, [])).toBe(false);
    expect(pacoteCobreAtendimento(p, [''])).toBe(false);
  });
  it('separa elegíveis e sinaliza parcial', () => {
    const cobre = pac('cobre', ['a', 'b']);
    const parte = pac('parte', ['a']);
    const outro = pac('outro', ['z']);
    const r = pacotesDoAtendimento([cobre, parte, outro], ['a', 'b']);
    expect(r.elegiveis.map(p => p.id)).toEqual(['cobre']);
    expect(r.temParcial).toBe(true);
    expect(pacotesDoAtendimento([cobre, outro], ['a', 'b']).temParcial).toBe(false);
    expect(pacotesDoAtendimento([cobre], []).elegiveis).toEqual([]);
  });
  it('servicoIdsDoAtendimento: null se alguma linha não tem servico_id', () => {
    expect(servicoIdsDoAtendimento([{ servico_id: 'a' }, { servico_id: 'b' }])).toEqual(['a', 'b']);
    expect(servicoIdsDoAtendimento([{ servico_id: 'a' }, { servico_id: null }])).toBeNull();
    expect(servicoIdsDoAtendimento([{ servico_id: 'a' }, {}])).toBeNull();
    expect(servicoIdsDoAtendimento([{ servico_id: '' }])).toBeNull();
    expect(servicoIdsDoAtendimento([])).toEqual([]);
  });
  it('vinculosPacoteSemCobertura: só vínculo a pacote ativo que não cobre tudo', () => {
    const ativos = [pac('p-ab', ['a', 'b']), pac('p-a', ['a'])];
    const itens = [
      { agendamento_id: 'ag1', servico_id: 'a' }, { agendamento_id: 'ag1', servico_id: 'b' },
      { agendamento_id: 'ag2', servico_id: 'a' }, { agendamento_id: 'ag2', servico_id: 'b' },
      { agendamento_id: 'ag3', servico_id: 'a' }, { agendamento_id: 'ag3', servico_id: null },
      { agendamento_id: 'ag4', servico_id: 'z' },
      { agendamento_id: 'ag5', servico_id: 'a' },
      { servico_id: 'b' }, // extra sem atendimento
    ];
    const links = { ag1: 'p-ab', ag2: 'p-a', ag3: 'p-ab', ag4: 'fora-da-lista', ag5: null, ag9: 'p-a' };
    expect(vinculosPacoteSemCobertura(itens, links, ativos).sort()).toEqual(['ag2', 'ag3']);
    expect(vinculosPacoteSemCobertura(itens, {}, ativos)).toEqual([]);
  });
  it('texto do aviso', () => {
    expect(AVISO_PACOTE_PARCIAL).toBe('Este pacote não cobre todos os serviços deste atendimento. Para usar a sessão, separe o serviço do pacote num atendimento próprio.');
  });
});

describe('excluirVendaPacotes (A2)', () => {
  it('chama a RPC com p_empresa e p_venda', async () => {
    const chamadas: unknown[] = [];
    const db = { rpc: (fn: string, args: unknown) => { chamadas.push([fn, args]); return Promise.resolve({ error: null }); } };
    await excluirVendaPacotes(db, 'e1', 'v1');
    expect(chamadas).toEqual([['excluir_venda_pacotes', { p_empresa: 'e1', p_venda: 'v1' }]]);
  });
  it('PGRST202 vira a mensagem da migration 100', async () => {
    const db = { rpc: () => Promise.resolve({ error: { code: 'PGRST202', message: 'x' } }) };
    await expect(excluirVendaPacotes(db, 'e', 'v')).rejects.toThrow(MSG_SEM_MIGRATION_100);
    await expect(excluirVendaPacotes(db, 'e', 'v')).rejects.toBeInstanceOf(ErroPacote);
  });
  it('outro erro vira ErroPacote e rede caída é semResposta', async () => {
    const db = { rpc: () => Promise.resolve({ error: { code: '42501', message: 'x' } }) };
    await expect(excluirVendaPacotes(db, 'e', 'v')).rejects.toBeInstanceOf(ErroPacote);
    const rede = { rpc: () => Promise.reject(new Error('net')) };
    await expect(excluirVendaPacotes(rede, 'e', 'v')).rejects.toMatchObject({ semResposta: true });
  });
  it('textos exatos', () => {
    expect(MSG_SEM_MIGRATION_100).toBe('Atualize o sistema: falta a migration 100.');
    expect(MSG_VENDA_VARIOS_PACOTES(3)).toBe('Esta venda tem 3 pacotes. Para tirar só um, exclua a venda inteira e venda de novo os que ficam.');
  });
});

function vend(id: string, o: Partial<PacoteVendido> = {}): PacoteVendido {
  return {
    id, pacote: { id: 'pk', nome: 'Pk', preco: 100, validade_dias: null, controla_sessoes: true, servicos: [{ servico_id: 's', nome: 'S', quantidade: 2 }] },
    cliente: { id: 'c', nome: 'C' }, data_inicio: null, data_validade: null, valor_pago: 100, status: 'ativo',
    observacao: null, cobranca: 'paga', venda_id: null, comanda_id: null, usos: [], ...o,
  };
}

describe('pacotesDaMesmaVenda', () => {
  it('conta pelo venda_id; sem venda, 1', () => {
    const lista = [vend('a', { venda_id: 'V' }), vend('b', { venda_id: 'V' }), vend('c', { venda_id: 'W' }), vend('d')];
    expect(pacotesDaMesmaVenda(lista, lista[0])).toBe(2);
    expect(pacotesDaMesmaVenda(lista, lista[2])).toBe(1);
    expect(pacotesDaMesmaVenda(lista, lista[3])).toBe(1);
  });
});

describe('calcularRelatorioUtilizacao — fora do faturamento (A8)', () => {
  const lista = [
    vend('a', { venda_id: 'V', valor_pago: 100 }),
    vend('b', { comanda_id: 'C', valor_pago: 50.5 }),
    vend('c', { valor_pago: 80 }),
    vend('d', { valor_pago: null }), // preço 100
    vend('e', { cobranca: 'pendente' }),
  ];
  it('só soma venda/comanda e separa o resto', () => {
    const r = calcularRelatorioUtilizacao(lista);
    expect(r.receitaTotal).toBe(150.5);
    expect(r.porPacote[0].receita).toBe(150.5);
    expect(r.foraDoFaturamento).toEqual({ quantidade: 2, valor: 180 });
    expect(r.aCobrar).toBe(1);
  });
  it('sem a 096 mantém a receita antiga e fora zerado', () => {
    const r = calcularRelatorioUtilizacao(lista, false);
    expect(r.receitaTotal).toBe(330.5);
    expect(r.foraDoFaturamento).toEqual({ quantidade: 0, valor: 0 });
  });
});

describe('carregarPacotesVendidos — comanda_id no select', () => {
  function dbFalso(falhaComColunas: boolean) {
    const selects: string[] = [];
    const db = {
      from: () => {
        const q: Record<string, unknown> = {};
        let sel = '';
        q.select = (s: string) => { sel = s; selects.push(s); return q; };
        q.eq = () => q;
        q.order = () => q;
        q.range = () => (falhaComColunas && sel.includes('comanda_id')
          ? Promise.resolve({ data: null, error: { message: 'column pacote_clientes.cobranca does not exist' } })
          : Promise.resolve({ data: [{ id: 'x', pacote: {}, cliente: {}, usos: [], comanda_id: 'C1' }], error: null }));
        return q;
      },
    };
    return { db, selects };
  }
  it('pede comanda_id e mapeia', async () => {
    const { db, selects } = dbFalso(false);
    const r = await carregarPacotesVendidos(db as never, 'e');
    expect(selects[0]).toContain('comanda_id');
    expect(r[0].comanda_id).toBe('C1');
  });
  it('sem a 096 refaz sem as colunas', async () => {
    const { db, selects } = dbFalso(true);
    const r = await carregarPacotesVendidos(db as never, 'e');
    expect(selects.length).toBe(2);
    expect(selects[1]).not.toContain('comanda_id');
    expect(r.length).toBe(1);
  });
});

describe('limiteVistoEm', () => {
  it('é agora menos 30 dias em ISO', () => {
    expect(DIAS_DISPOSITIVO_ATIVO).toBe(30);
    expect(limiteVistoEm(new Date('2026-11-03T12:00:00.000Z'))).toBe('2026-10-04T12:00:00.000Z');
  });
});

describe('A9 — bruto igual à soma das partes (propriedade)', () => {
  it('500 conjuntos aleatórios de valores com 2 casas', () => {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const val = () => Math.round(rnd() * 100000) / 100;
    const L = limitesMes('2026-09');
    for (let i = 0; i < 500; i++) {
      const n = () => 1 + Math.floor(rnd() * 5);
      const dados = {
        ...DADOS_VAZIOS,
        agendamentos: Array.from({ length: n() }, (_, k) => ({
          id: `a${k}`, status: 'concluido', valor: val(), data_hora_inicio: '2026-09-10T13:00:00Z', pacote_cliente_id: null,
          cliente_id: 'c', profissional_id: 'p', servico_id: 's', servico: { nome: 'S', categoria: null },
          profissional: { nome: 'P', foto_url: null }, cliente: { nome: 'C' },
        })),
        vendas: Array.from({ length: n() }, (_, k) => ({ id: `v${k}`, valor_final: val(), created_at: '2026-09-11T13:00:00Z' })),
        taxasCancelamento: Array.from({ length: n() }, (_, k) => ({ id: `t${k}`, valor: val(), paga_em: '2026-09-12T13:00:00Z' })),
        taxasReserva: Array.from({ length: n() }, (_, k) => ({ id: `r${k}`, valor: val(), paga_em: '2026-09-13T13:00:00Z', status: 'pago' })),
        servicosExtras: Array.from({ length: n() }, (_, k) => ({ id: `x${k}`, valor_unit: val(), quantidade: 1, fechada_at: '2026-09-14T13:00:00Z' })),
      } as never;
      const k = calcularKpisFinanceiros(dados, L);
      const soma = Math.round((k.receitaServicos + k.receitaServicosExtras + k.receitaVendas
        + k.receitaTaxasCancelamento + k.receitaTaxasReserva) * 100) / 100;
      expect(k.bruto).toBe(soma);
    }
  });
});
