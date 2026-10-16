import { describe, expect, it } from 'vitest';
import { ratearDescontoCentavos } from '@shared/comanda-fechamento';
import {
  montarPayloadFechamento, montarPayloadEdicao, fecharComandaNoBanco, editarComandaNoBanco,
  ErroGravacaoComanda, type EstadoFechamentoComanda, type EstadoEdicaoComanda, type ItemComandaTela,
} from '@shared/comanda-gravacao';
import { configLegada, type ConfigCartoes } from '@shared/taxas-cartao';
import { fakeDb } from './fixtures/fake-db';

describe('ratearDescontoCentavos — espelho de public.ratear_desconto_centavos (090)', () => {
  it('proporcional, com o resto de centavos na maior parte', () => {
    // 100 entre 100 / 200 / 300: piso 16 + 33 + 50 = 99, resto 1 vai para o 300.
    expect(ratearDescontoCentavos([100, 200, 300], 100)).toEqual([16, 33, 51]);
  });
  it('empate de peso: o resto vai para a que veio primeiro', () => {
    expect(ratearDescontoCentavos([100, 100, 100], 100)).toEqual([34, 33, 33]);
    expect(ratearDescontoCentavos([50, 100, 100], 101)).toEqual([20, 41, 40]);
  });
  it('parte de peso 0 (sessão de pacote) recebe 0', () => {
    expect(ratearDescontoCentavos([0, 1000, 500], 300)).toEqual([0, 200, 100]);
  });
  it('soma das cotas = desconto e nenhuma cota passa do peso da parte', () => {
    const pesos = [1, 1, 1, 9997];
    const cotas = ratearDescontoCentavos(pesos, 10000);
    expect(cotas.reduce((s, c) => s + c, 0)).toBe(10000);
    cotas.forEach((c, i) => expect(c).toBeLessThanOrEqual(pesos[i]));
  });
  it('resto que não cabe na maior parte passa para a próxima maior (limite por parte)', () => {
    // desconto = soma: cada parte fica com o próprio peso.
    expect(ratearDescontoCentavos([3, 3, 3], 9)).toEqual([3, 3, 3]);
    // piso: 3·5/7=2, 2·5/7=1, 2·5/7=1 → resto 1; o maior (3) tem folga 1 → [3,1,1].
    expect(ratearDescontoCentavos([3, 2, 2], 5)).toEqual([3, 1, 1]);
    // piso 1 + 0 + 0, resto 2: a maior (2) só cabe +1; o outro centavo vai para a próxima (ordem de entrada).
    expect(ratearDescontoCentavos([2, 1, 1], 3)).toEqual([2, 1, 0]);
  });
  it('desconto zero → tudo zero; sem partes e desconto zero → lista vazia', () => {
    expect(ratearDescontoCentavos([100, 200], 0)).toEqual([0, 0]);
    expect(ratearDescontoCentavos([], 0)).toEqual([]);
  });
  it('mesmos erros do banco', () => {
    expect(() => ratearDescontoCentavos([100], -1)).toThrow('Desconto inválido.');
    expect(() => ratearDescontoCentavos([], 1)).toThrow('O desconto não pode ser maior que o subtotal.');
    expect(() => ratearDescontoCentavos([100], 101)).toThrow('O desconto não pode ser maior que o subtotal.');
    expect(() => ratearDescontoCentavos([100, -5], 10)).toThrow('Valor inválido no rateio do desconto.');
  });
});

const config: ConfigCartoes = { ...configLegada(null), legado: false,
  maquininhas: configLegada(null).maquininhas.map(m => ({ ...m, id: 'MAQ' })) };

const at = (agendamento_id: string, valor: number, extra: Partial<ItemComandaTela> = {}): ItemComandaTela =>
  ({ tipo: 'agendamento', descricao: 'Atendimento', agendamento_id, valor, quantidade: 1, ...extra });

const estado = (e: Partial<EstadoFechamentoComanda> = {}): EstadoFechamentoComanda => ({
  comandaId: 'C', empresaId: 'E', clienteId: 'CL', desconto: 0, itens: [], pacoteLinks: {}, splits: [], config, ...e,
});

describe('montarPayloadFechamento — casos do inventário §1.3', () => {
  it('atendimento simples', () => {
    expect(montarPayloadFechamento(estado({
      itens: [at('AG1', 120)], splits: [{ metodo: 'pix', valor: 120 }],
    }))).toEqual({
      comanda_id: 'C', empresa_id: 'E', cliente_id: 'CL', desconto: 0,
      atendimentos: [{ agendamento_id: 'AG1', valor: 120 }],
      itens: [],
      pagamentos: [{ valor: 120, metodo: 'pix', parcelas: 1, bandeira: null, maquininha_id: null, taxa_perc: null }],
    });
  });

  it('multi-serviço: linhas, sem valor do atendimento; cartão com maquininha e taxa da configuração', () => {
    const p = montarPayloadFechamento(estado({
      desconto: 10,
      itens: [at('AG1', 80, { ag_servico_id: 'AS1' }), at('AG1', 40, { ag_servico_id: 'AS2' })],
      splits: [{ metodo: 'credito', valor: 110, bandeira: 'visa', parcelas: 2, maquininhaId: 'MAQ' }],
    }));
    expect(p.desconto).toBe(10);
    expect(p.atendimentos).toEqual([{ agendamento_id: 'AG1', linhas: [
      { ag_servico_id: 'AS1', valor: 80 }, { ag_servico_id: 'AS2', valor: 40 },
    ] }]);
    expect(p.pagamentos).toEqual([{ valor: 110, metodo: 'credito', parcelas: 2, bandeira: 'visa', maquininha_id: 'MAQ', taxa_perc: 0.0559 }]);
  });

  it('sessão de pacote vinculada (na comanda ou na Agenda): valor 0 e vínculo; total 0 sem pagamento → lista vazia', () => {
    const p = montarPayloadFechamento(estado({ itens: [at('AG1', 0)], pacoteLinks: { AG1: 'PC1' } }));
    expect(p.atendimentos).toEqual([{ agendamento_id: 'AG1', valor: 0, pacote_cliente_id: 'PC1' }]);
    expect(p.pagamentos).toEqual([]);
  });

  it('desvincular: null explícito vai no payload', () => {
    const p = montarPayloadFechamento(estado({
      itens: [at('AG1', 120)], pacoteLinks: { AG1: null }, splits: [{ metodo: 'dinheiro', valor: 120 }],
    }));
    expect(p.atendimentos).toEqual([{ agendamento_id: 'AG1', valor: 120, pacote_cliente_id: null }]);
    expect(p.atendimentos[0]).toHaveProperty('pacote_cliente_id', null);
  });

  it('combo vinculado na Agenda: sem a chave no mapa, a chave não vai (não mexe no vínculo)', () => {
    const p = montarPayloadFechamento(estado({ itens: [at('AG1', 0)] }));
    expect(p.atendimentos[0]).not.toHaveProperty('pacote_cliente_id');
  });

  it('vender pacote novo, serviço extra com profissional e produto extra', () => {
    const p = montarPayloadFechamento(estado({
      itens: [
        at('AG1', 120),
        { tipo: 'pacote', descricao: 'Pacote 5 sessões', pacote_id: 'PK1', quantidade: 1, valor: 450 },
        { tipo: 'servico', descricao: 'Escova', servico_id: 'SV2', profissional_id: 'PROF2', quantidade: 1, valor: 40 },
        { tipo: 'produto', descricao: 'Óleo capilar', produto_id: 'PR1', quantidade: 2, valor: 35 },
      ],
      splits: [{ metodo: 'pix', valor: 680 }],
    }));
    expect(p.itens).toEqual([
      { tipo: 'pacote', descricao: 'Pacote 5 sessões', quantidade: 1, valor_unit: 450, servico_id: null, profissional_id: null, produto_id: null, pacote_id: 'PK1' },
      { tipo: 'servico', descricao: 'Escova', quantidade: 1, valor_unit: 40, servico_id: 'SV2', profissional_id: 'PROF2', produto_id: null, pacote_id: null },
      { tipo: 'produto', descricao: 'Óleo capilar', quantidade: 2, valor_unit: 35, servico_id: null, profissional_id: null, produto_id: 'PR1', pacote_id: null },
    ]);
  });

  it('quantidade de pacote fracionada é arredondada para inteiro (mínimo 1), como o caminho antigo', () => {
    const p = montarPayloadFechamento(estado({
      itens: [
        { tipo: 'pacote', descricao: 'P', pacote_id: 'PK1', quantidade: 1.6, valor: 100 },
        { tipo: 'pacote', descricao: 'P', pacote_id: 'PK2', quantidade: 0.2, valor: 100 },
        { tipo: 'produto', descricao: 'Óleo', produto_id: 'PR1', quantidade: 1.5, valor: 10 },
      ],
    }));
    expect(p.itens.map(i => i.quantidade)).toEqual([2, 1, 1.5]);
  });

  it('profissional vazio ("Profissional (opcional)") vira null', () => {
    const p = montarPayloadFechamento(estado({
      itens: [{ tipo: 'servico', descricao: 'Escova', servico_id: 'SV2', profissional_id: '', quantidade: 1, valor: 40 }],
    }));
    expect(p.itens[0].profissional_id).toBeNull();
  });

  it('taxa de reserva paga: nada a mandar (o banco lê); o payload nunca leva campos calculados', () => {
    const p = montarPayloadFechamento(estado({ itens: [at('AG1', 120)], splits: [{ metodo: 'pix', valor: 90 }] }));
    for (const k of ['subtotal', 'total', 'desconto_reserva', 'fechada_at', 'profissional_id']) expect(p).not.toHaveProperty(k);
    expect(p.pagamentos[0]).not.toHaveProperty('valor_liquido');
  });

  it('cortesia por desconto de 100%: sem pagamento (o banco grava a Cortesia R$ 0)', () => {
    const p = montarPayloadFechamento(estado({ desconto: 120, itens: [at('AG1', 120)] }));
    expect(p.desconto).toBe(120);
    expect(p.pagamentos).toEqual([]);
  });

  it('comanda só com extras e cliente avulso (__sem__ → null); pagamento R$ 0 é descartado', () => {
    const p = montarPayloadFechamento(estado({
      clienteId: '__sem__', desconto: 5,
      itens: [{ tipo: 'produto', descricao: 'Esmalte', produto_id: 'PR3', quantidade: 1, valor: 25 }],
      splits: [{ metodo: 'pix', valor: 20 }, { metodo: 'dinheiro', valor: 0 }],
    }));
    expect(p.cliente_id).toBeNull();
    expect(p.atendimentos).toEqual([]);
    expect(p.pagamentos).toEqual([expect.objectContaining({ metodo: 'pix', valor: 20 })]);
  });

  it('valores arredondados a centavos', () => {
    const p = montarPayloadFechamento(estado({ desconto: 10.006, itens: [at('AG1', 99.999)], splits: [{ metodo: 'pix', valor: 90.004 }] }));
    expect(p.desconto).toBe(10.01);
    expect(p.atendimentos[0].valor).toBe(100);
    expect(p.pagamentos[0].valor).toBe(90);
  });
});

describe('montarPayloadEdicao', () => {
  const ed = (e: Partial<EstadoEdicaoComanda> = {}): EstadoEdicaoComanda => ({
    comandaId: 'C', empresaId: 'E', desconto: 15, itens: [], splits: [], config, ...e,
  });

  it('estado completo: atendimentos sem vínculo, itens com item_id, pagamento reaberto com pagamento_id', () => {
    const p = montarPayloadEdicao(ed({
      itens: [
        at('AG1', 130),
        { tipo: 'servico', item_id: 'IT1', descricao: 'Escova', servico_id: 'SV2', profissional_id: 'PROF2', quantidade: 1, valor: 45 },
        { tipo: 'produto', item_id: 'IT2', descricao: 'Óleo capilar', produto_id: 'PR1', quantidade: 2, valor: 35 },
        { tipo: 'servico', item_id: 'IT3', descricao: 'Hidratação', servico_id: 'SV4', quantidade: 1, valor: 60 },
      ],
      splits: [
        { metodo: 'debito', valor: 170, bandeira: 'elo', pagamentoId: 'PG1', taxaGravada: 0.0239, metodoGravado: 'debito',
          parcelasGravadas: 1, maquininhaGravada: 'MAQ', bandeiraGravada: 'elo', maquininhaId: 'MAQ' },
        { metodo: 'dinheiro', valor: 120 },
      ],
    }));
    expect(p).toEqual({
      comanda_id: 'C', empresa_id: 'E', desconto: 15,
      atendimentos: [{ agendamento_id: 'AG1', valor: 130 }],
      itens: [
        { item_id: 'IT1', tipo: 'servico', descricao: 'Escova', quantidade: 1, valor_unit: 45, servico_id: 'SV2', profissional_id: 'PROF2', produto_id: null, pacote_id: null },
        { item_id: 'IT2', tipo: 'produto', descricao: 'Óleo capilar', quantidade: 2, valor_unit: 35, servico_id: null, profissional_id: null, produto_id: 'PR1', pacote_id: null },
        { item_id: 'IT3', tipo: 'servico', descricao: 'Hidratação', quantidade: 1, valor_unit: 60, servico_id: 'SV4', profissional_id: null, produto_id: null, pacote_id: null },
      ],
      pagamentos: [
        { pagamento_id: 'PG1', valor: 170, metodo: 'debito', parcelas: 1, bandeira: 'elo', maquininha_id: 'MAQ', taxa_perc: 0.0239 },
        { pagamento_id: null, valor: 120, metodo: 'dinheiro', parcelas: 1, bandeira: null, maquininha_id: null, taxa_perc: null },
      ],
    });
  });

  it('vínculo de pacote e cliente não vão (ignorados na edição)', () => {
    const p = montarPayloadEdicao(ed({ itens: [at('AG1', 0)] }));
    expect(p.atendimentos[0]).not.toHaveProperty('pacote_cliente_id');
    expect(p).not.toHaveProperty('cliente_id');
  });

  it('item extra sem item_id é recusado (a tela gera o id uma vez e reaproveita na nova tentativa)', () => {
    expect(() => montarPayloadEdicao(ed({
      itens: [{ tipo: 'servico', descricao: 'Escova', servico_id: 'SV2', quantidade: 1, valor: 45 }],
    }))).toThrow('Item da comanda sem identificador');
  });
});

describe('fecharComandaNoBanco / editarComandaNoBanco', () => {
  const payload = montarPayloadFechamento(estado({ itens: [at('AG1', 120)], splits: [{ metodo: 'pix', valor: 120 }] }));
  const payloadEd = montarPayloadEdicao({ comandaId: 'C', empresaId: 'E', desconto: 0, itens: [at('AG1', 120)], splits: [{ metodo: 'pix', valor: 120 }], config });

  it('chama fechar_comanda com { p } e devolve via função', async () => {
    const { db, rpcs, chamadas } = fakeDb({ rpc: () => ({ data: 'C', error: null }) });
    await expect(fecharComandaNoBanco(db, payload)).resolves.toEqual({ via: 'funcao' });
    expect(rpcs).toEqual([{ fn: 'fechar_comanda', args: { p: payload } }]);
    expect(chamadas).toHaveLength(0);
  });

  it('chama editar_comanda com { p } (devolve void)', async () => {
    const { db, rpcs } = fakeDb({ rpc: () => ({ data: null, error: null }) });
    await expect(editarComandaNoBanco(db, payloadEd)).resolves.toEqual({ via: 'funcao' });
    expect(rpcs).toEqual([{ fn: 'editar_comanda', args: { p: payloadEd } }]);
  });

  it('sem a 090 (PGRST202) → via antigo, sem tocar tabela nenhuma', async () => {
    const { db, chamadas } = fakeDb();
    await expect(fecharComandaNoBanco(db, payload)).resolves.toEqual({ via: 'antigo' });
    await expect(editarComandaNoBanco(db, payloadEd)).resolves.toEqual({ via: 'antigo' });
    expect(chamadas).toHaveLength(0);
  });

  it('42883 (algo dentro da função falta) é erro, nunca volta ao caminho antigo', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: null, error: { code: '42883', message: 'function x does not exist' } }) });
    await expect(fecharComandaNoBanco(db, payload)).rejects.toBeInstanceOf(ErroGravacaoComanda);
  });

  it('erro sem code (rede caiu): manda conferir antes de repetir', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }) });
    const e = await fecharComandaNoBanco(db, payload).catch(x => x);
    expect(e).toBeInstanceOf(ErroGravacaoComanda);
    expect(e.semResposta).toBe(true);
    expect(e.message).toBe('Sem resposta do servidor: a comanda pode ter sido fechada. Confira antes de repetir.');
    const e2 = await editarComandaNoBanco(db, payloadEd).catch(x => x);
    expect(e2.semResposta).toBe(true);
    expect(e2.message).toBe('Sem resposta do servidor: a alteração da comanda pode ter sido salva. Confira antes de repetir.');
  });

  it('erro de regra da função (P0001): a mensagem do banco vai para a tela, com o code', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: null, error: { code: 'P0001', message: 'Este atendimento já teve a comanda fechada.' } }) });
    const e = await fecharComandaNoBanco(db, payload).catch(x => x);
    expect(e.message).toBe('Este atendimento já teve a comanda fechada.');
    expect(e.code).toBe('P0001');
    expect(e.semResposta).toBe(false);
  });

  it('42501 da função já vem em português e é mantido', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: null, error: { code: '42501', message: 'Você não tem permissão para fechar a comanda.' } }) });
    await expect(fecharComandaNoBanco(db, payload)).rejects.toThrow('Você não tem permissão para fechar a comanda.');
  });

  it('recusa de RLS em inglês vira mensagem em português', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "comandas"' } }) });
    await expect(fecharComandaNoBanco(db, payload)).rejects.toThrow('Você não tem permissão para fechar a comanda. Fale com a dona ou a gestora.');
    await expect(editarComandaNoBanco(db, payloadEd)).rejects.toThrow('Você não tem permissão para editar a comanda. Fale com a dona ou a gestora.');
  });

  it('22P02, 23505 e 57014 (em inglês) viram mensagem em português', async () => {
    const casos: [string, string][] = [
      ['22P02', 'Dado inválido enviado ao banco.'],
      ['23505', 'Registro duplicado.'],
      ['57014', 'O banco demorou demais para responder. Confira antes de repetir.'],
    ];
    for (const [code, texto] of casos) {
      const { db } = fakeDb({ rpc: () => ({ data: null, error: { code, message: 'some english message' } }) });
      const e = await fecharComandaNoBanco(db, payload).catch(x => x) as ErroGravacaoComanda;
      expect(e.message).toBe(texto);
      expect(e.code).toBe(code);
      await expect(editarComandaNoBanco(db, payloadEd)).rejects.toThrow(texto);
    }
  });

  it('fechar sem devolver o id é erro (nunca sucesso sem comanda)', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: null, error: null }) });
    await expect(fecharComandaNoBanco(db, payload)).rejects.toThrow('Não foi possível fechar a comanda.');
  });

  it('nova tentativa reaproveita o mesmo comanda_id (idempotência no banco)', async () => {
    let n = 0;
    const { db, rpcs } = fakeDb({ rpc: () => (++n === 1
      ? { data: null, error: { code: '', message: 'Failed to fetch' } }
      : { data: 'C', error: null }) });
    await fecharComandaNoBanco(db, payload).catch(() => null);
    await expect(fecharComandaNoBanco(db, payload)).resolves.toEqual({ via: 'funcao' });
    expect(rpcs.map(r => (r.args.p as { comanda_id: string }).comanda_id)).toEqual(['C', 'C']);
  });
});
