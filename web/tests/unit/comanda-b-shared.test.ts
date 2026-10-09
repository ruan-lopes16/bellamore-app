import { describe, expect, it } from 'vitest';
import { diffItensComanda } from '@shared/comanda-fechamento';
import { cartoesComandaDoDia } from '@shared/comanda';
import { gerarTextoRecibo, linkWhatsAppRecibo } from '@shared/comanda-recibo';
import { carregarBacklogComandas, carregarComandasSoExtrasDoDia, carregarComissoesPagasDosItens } from '@shared/comanda-consultas';
import { limitesDias } from '@shared/periodos';
import { fakeDb, opsDe } from './fixtures/fake-db';

describe('diffItensComanda', () => {
  const orig = [
    { item_id: 'a', valor: 50, quantidade: 1, profissional_id: 'p1' },
    { item_id: 'b', valor: 30, quantidade: 2, profissional_id: null },
    { item_id: 'c', valor: 10, quantidade: 1, profissional_id: null },
  ];
  it('atualiza só o que mudou, apaga removidos e insere novos', () => {
    const r = diffItensComanda(orig, [
      { item_id: 'a', tipo: 'servico', descricao: 'Esmalte', quantidade: 1, valor: 60, profissional_id: 'p1' },
      { item_id: 'b', tipo: 'produto', descricao: 'Creme', quantidade: 2, valor: 30, profissional_id: null },
      { tipo: 'servico', descricao: 'Novo', quantidade: 1, valor: 20, profissional_id: 'p2' },
    ]);
    expect(r.atualizar).toEqual([{ item_id: 'a', valor_unit: 60, quantidade: 1, profissional_id: 'p1' }]);
    expect(r.apagar).toEqual(['c']);
    expect(r.inserir.map(i => i.descricao)).toEqual(['Novo']);
  });
  it('troca de profissional e undefined = null', () => {
    const r = diffItensComanda([{ item_id: 'a', valor: 50, quantidade: 1, profissional_id: 'p1' }],
      [{ item_id: 'a', tipo: 'servico', descricao: 'X', quantidade: 1, valor: 50 }]);
    expect(r.atualizar).toEqual([{ item_id: 'a', valor_unit: 50, quantidade: 1, profissional_id: null }]);
  });
  it('nada mudou → listas vazias', () => {
    const r = diffItensComanda(orig.slice(0, 1), [{ item_id: 'a', tipo: 'servico', descricao: 'E', quantidade: 1, valor: 50, profissional_id: 'p1' }]);
    expect(r).toEqual({ inserir: [], atualizar: [], apagar: [] });
  });
});

describe('cartoesComandaDoDia', () => {
  const cli = { id: 'c1', nome: 'Ana', telefone: '34999' };
  const ag = (id: string, hora: string, status: string, comanda_id: string | null, cliente = cli) =>
    ({ id, data_hora_inicio: `2026-10-08T${hora}:00-03:00`, status, comanda_id, cliente });
  it('uma comanda fechada por cartão e um cartão para os abertos', () => {
    const cards = cartoesComandaDoDia([
      ag('1', '09:00', 'concluido', 'K1'),
      ag('2', '11:00', 'concluido', 'K2'),
      ag('3', '15:00', 'agendado', null),
      ag('4', '16:00', 'concluido', null),
    ], []);
    expect(cards.map(c => [c.comandaId, c.fechada, c.agendamentos.map(a => a.id)])).toEqual([
      ['K1', true, ['1']],
      ['K2', true, ['2']],
      [null, false, ['3', '4']],
    ]);
    expect(cards[0].chave).toBe('c1|K1');
    expect(cards[2].chave).toBe('c1|aberta');
  });
  it('sem cliente vira __sem__; comanda só com extras vira cartão fechado sem agendamentos', () => {
    const cards = cartoesComandaDoDia([ag('1', '10:00', 'agendado', null, null as any)], [
      { id: 'K9', fechada_at: '2026-10-08T12:00:00-03:00', cliente: { id: 'c2', nome: 'Bia', telefone: null } },
      { id: 'K8', fechada_at: '2026-10-08T08:00:00-03:00', cliente: null },
    ]);
    expect(cards.map(c => [c.clienteId, c.nome, c.comandaId, c.fechada])).toEqual([
      ['__sem__', 'Cliente', 'K8', true],
      ['__sem__', 'Cliente', null, false],
      ['c2', 'Bia', 'K9', true],
    ]);
    expect(cards[2].agendamentos).toEqual([]);
    expect(cards[2].telefone).toBeUndefined();
  });
});

describe('gerarTextoRecibo', () => {
  it('mesmo formato do web, data em Brasília', () => {
    const t = gerarTextoRecibo({
      nome: 'Ana', valor: 90, dataIso: '2026-10-08T17:30:00Z',
      itens: [{ descricao: 'Corte', quantidade: 1, valor: 80 }, { descricao: 'Creme', quantidade: 2, valor: 10 }],
      splits: [{ metodo: 'credito', valor: 50, bandeira: 'visa', parcelas: 2 }, { metodo: 'pix', valor: 40 }],
      desconto: 5, descontoReserva: 5,
    });
    expect(t.split('\n')).toEqual([
      '🌸 *Recibo de Atendimento*', '', '👤 Ana', '📅 08/10/2026 às 14:30', '',
      '*Serviços:*', '• Corte — R$ 80,00', '• Creme (2x) — R$ 20,00',
      '• Taxa de reserva paga — −R$ 5,00', '• Desconto — −R$ 5,00', '',
      '💰 *Total: R$ 90,00*', '', '*Pagamento:*', '• Crédito Visa 2x — R$ 50,00', '• PIX — R$ 40,00',
    ]);
  });
  it('link do WhatsApp com DDI e texto codificado', () => {
    expect(linkWhatsAppRecibo('(34) 99178-0000', 'a b')).toBe('https://wa.me/5534991780000?text=a%20b');
  });
});

describe('consultas da comanda', () => {
  it('backlog: sem comanda, não cancelado/faltou, já terminou, mais antigo primeiro, até 500', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true });
    await carregarBacklogComandas(db, 'emp', '2026-10-08T12:00:00.000Z');
    const [ops] = opsDe(chamadas, 'agendamentos');
    expect(ops).toContainEqual(['eq', ['empresa_id', 'emp']]);
    expect(ops).toContainEqual(['is', ['comanda_id', null]]);
    expect(ops).toContainEqual(['not', ['status', 'in', '("cancelado","faltou")']]);
    expect(ops).toContainEqual(['lt', ['data_hora_fim', '2026-10-08T12:00:00.000Z']]);
    expect(ops).toContainEqual(['limit', [500]]);
  });
  it('comandas só com extras: fechadas no dia, sem agendamento vinculado', async () => {
    const l = limitesDias('2026-10-08', '2026-10-08');
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas: { comandas: [
      { id: 'K1', fechada_at: '2026-10-08T12:00:00Z', cliente: null, agendamentos: [] },
      { id: 'K2', fechada_at: '2026-10-08T13:00:00Z', cliente: null, agendamentos: [{ id: 'a' }] },
    ] } });
    const r = await carregarComandasSoExtrasDoDia(db, 'emp', l);
    expect(r.map(c => c.id)).toEqual(['K1']);
    const [ops] = opsDe(chamadas, 'comandas');
    expect(ops).toContainEqual(['eq', ['status', 'fechada']]);
    expect(ops).toContainEqual(['gte', ['fechada_at', l.startIso]]);
    expect(ops).toContainEqual(['lte', ['fechada_at', l.endIso]]);
  });
  it('comissões pagas dos itens: lista vazia não consulta', async () => {
    const { db, chamadas } = fakeDb();
    expect((await carregarComissoesPagasDosItens(db, [])).size).toBe(0);
    expect(opsDe(chamadas, 'comissoes')).toEqual([]);
  });
});
