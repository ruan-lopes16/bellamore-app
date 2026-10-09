import { describe, expect, it } from 'vitest';
import {
  configLegada, taxaDoCartao, validarTabela, chaveBandeira, maquininhaPadrao, parcelasDisponiveis, nomeBandeira,
  type ConfigCartoes,
} from '@shared/taxas-cartao';
import { carregarConfigCartoes, definirPadrao, salvarMaquininha } from '@shared/taxas-cartao-consultas';
import { fakeDb, opsDe } from './fixtures/fake-db';

const tabela = (taxaDeb: number, avista: number, parc: number, max = 3) => [
  { bandeiraId: null, modalidade: 'debito' as const, parcelas: 1, taxa: taxaDeb },
  ...Array.from({ length: max }, (_, i) => ({ bandeiraId: null, modalidade: 'credito' as const, parcelas: i + 1, taxa: i === 0 ? avista : parc })),
];
const cfg: ConfigCartoes = {
  legado: false,
  bandeiras: [
    { id: 'b-visa', chave: 'visa', nome: 'Visa', ativa: true, ordem: 1 },
    { id: 'b-amex', chave: 'amex', nome: 'Amex', ativa: true, ordem: 2 },
  ],
  maquininhas: [{
    id: 'm1', nome: 'Stone', maxParcelas: 3, ativa: true, padrao: true, ordem: 1,
    taxas: [...tabela(0.02, 0.04, 0.05), { bandeiraId: 'b-amex', modalidade: 'credito', parcelas: 2, taxa: 0.07 }],
  }],
};

describe('taxaDoCartao', () => {
  it('padrão, exceção da bandeira e pix', () => {
    expect(taxaDoCartao(cfg, { maquininhaId: 'm1', bandeiraChave: 'visa', metodo: 'credito', parcelas: 2 })).toBe(0.05);
    expect(taxaDoCartao(cfg, { maquininhaId: 'm1', bandeiraChave: 'amex', metodo: 'credito', parcelas: 2 })).toBe(0.07);
    expect(taxaDoCartao(cfg, { maquininhaId: 'm1', bandeiraChave: 'amex', metodo: 'credito', parcelas: 3 })).toBe(0.05);
    expect(taxaDoCartao(cfg, { maquininhaId: 'm1', bandeiraChave: null, metodo: 'debito' })).toBe(0.02);
    expect(taxaDoCartao(cfg, { maquininhaId: 'm1', bandeiraChave: 'visa', metodo: 'pix' })).toBe(0);
  });
  it('sem linha → null; maquininha ausente usa a padrão', () => {
    expect(taxaDoCartao(cfg, { maquininhaId: 'm1', bandeiraChave: 'visa', metodo: 'credito', parcelas: 6 })).toBeNull();
    expect(taxaDoCartao(cfg, { maquininhaId: null, bandeiraChave: 'visa', metodo: 'credito', parcelas: 1 })).toBe(0.04);
    expect(taxaDoCartao(cfg, { maquininhaId: 'x', bandeiraChave: 'visa', metodo: 'debito' })).toBe(0.02);
  });
});

describe('validarTabela', () => {
  it('padrão completa ok; faltando parcela ou fora da faixa → mensagem', () => {
    expect(validarTabela({ maxParcelas: 3, taxas: tabela(0.02, 0.04, 0.05) })).toBeNull();
    expect(validarTabela({ maxParcelas: 4, taxas: tabela(0.02, 0.04, 0.05) })).toBe('Preencha a taxa do crédito em 4x');
    expect(validarTabela({ maxParcelas: 3, taxas: tabela(0.02, 0.04, 0.05).filter(t => t.modalidade !== 'debito') })).toBe('Preencha a taxa do débito');
    expect(validarTabela({ maxParcelas: 3, taxas: tabela(0.25, 0.04, 0.05) })).toBe('As taxas precisam ficar entre 0% e 20%');
    expect(validarTabela({ maxParcelas: 19, taxas: [] })).toBe('O máximo de parcelas precisa ficar entre 1 e 18');
    expect(validarTabela({ maxParcelas: 3, taxas: [...tabela(0.02, 0.04, 0.05), { bandeiraId: null, modalidade: 'debito', parcelas: 2, taxa: 0.02 }] })).toBe('O débito só tem taxa em 1x');
    expect(validarTabela({ maxParcelas: 3, taxas: [...tabela(0.02, 0.04, 0.05), { bandeiraId: null, modalidade: 'credito', parcelas: 2, taxa: 0.06 }] })).toBe('Há taxas repetidas para a mesma combinação');
  });
});

describe('chaveBandeira e auxiliares', () => {
  it('slug sem acento e sufixo se repetir', () => {
    expect(chaveBandeira('Diners Club', [])).toBe('diners-club');
    expect(chaveBandeira('Cabal', ['cabal'])).toBe('cabal-2');
    expect(chaveBandeira('Elô', ['elo', 'elo-2'])).toBe('elo-3');
  });
  it('padrão, parcelas e nome', () => {
    expect(maquininhaPadrao(cfg)?.id).toBe('m1');
    expect(parcelasDisponiveis(cfg.maquininhas[0])).toEqual([1, 2, 3]);
    expect(nomeBandeira(cfg, 'amex')).toBe('Amex');
    expect(nomeBandeira(cfg, 'cabal')).toBe('cabal');
    expect(nomeBandeira(cfg, null)).toBe('');
  });
  it('configLegada monta uma maquininha virtual com as taxas da 084', () => {
    const c = configLegada({ taxa_cartao_debito: 0.03, taxa_cartao_credito_avista: 0.04, taxa_cartao_credito_parcelado: 0.06 });
    expect(c.legado).toBe(true);
    expect(c.maquininhas).toHaveLength(1);
    expect(c.maquininhas[0]).toMatchObject({ id: 'legado', maxParcelas: 18, padrao: true });
    // Antes da 086 o crédito ia até 18x (taxa de parcelado): continua oferecido
    expect(taxaDoCartao(c, { maquininhaId: 'legado', bandeiraChave: 'visa', metodo: 'credito', parcelas: 18 })).toBe(0.06);
    expect(taxaDoCartao(c, { maquininhaId: 'legado', bandeiraChave: 'visa', metodo: 'credito', parcelas: 12 })).toBe(0.06);
    expect(c.bandeiras.map(b => b.chave)).toEqual(['visa', 'mastercard', 'elo', 'amex', 'hipercard']);
  });
});

describe('carregarConfigCartoes', () => {
  it('tabela ausente → configuração legada da empresa', async () => {
    const { db } = fakeDb({
      erroTabelas: { cartao_maquininhas: 'relation "public.cartao_maquininhas" does not exist' },
      linhas: { empresas: [{ id: 'emp', taxa_cartao_debito: 0.03 }] },
    });
    const c = await carregarConfigCartoes(db, 'emp');
    expect(c.legado).toBe(true);
    expect(c.maquininhas[0].taxas.find(t => t.modalidade === 'debito')?.taxa).toBe(0.03);
  });
  it('outro erro é lançado', async () => {
    const { db } = fakeDb({ erroTabelas: { cartao_bandeiras: 'timeout' } });
    await expect(carregarConfigCartoes(db, 'emp')).rejects.toThrow('timeout');
  });
  it('monta a configuração convertendo numéricos em string', async () => {
    const { db } = fakeDb({ linhas: {
      cartao_bandeiras: [{ id: 'b1', chave: 'visa', nome: 'Visa', ativa: true, ordem: 1 }],
      cartao_maquininhas: [{ id: 'm1', nome: 'Stone', max_parcelas: 2, ativa: true, padrao: true, ordem: 1 }],
      cartao_taxas: [
        { id: 't1', maquininha_id: 'm1', bandeira_id: null, modalidade: 'debito', parcelas: 1, taxa: '0.0200' },
        { id: 't2', maquininha_id: 'm1', bandeira_id: 'b1', modalidade: 'credito', parcelas: 2, taxa: '0.0700' },
      ],
    } });
    const c = await carregarConfigCartoes(db, 'emp');
    expect(c.legado).toBe(false);
    expect(c.maquininhas[0]).toMatchObject({ id: 'm1', maxParcelas: 2 });
    expect(c.maquininhas[0].taxas).toEqual([
      { id: 't1', bandeiraId: null, modalidade: 'debito', parcelas: 1, taxa: 0.02 },
      { id: 't2', bandeiraId: 'b1', modalidade: 'credito', parcelas: 2, taxa: 0.07 },
    ]);
  });
});

describe('salvarMaquininha e definirPadrao', () => {
  it('rejeita tabela incompleta antes de gravar', async () => {
    const { db, chamadas } = fakeDb();
    await expect(salvarMaquininha(db, 'emp', { nome: 'X', maxParcelas: 3, ativa: true, padrao: false, ordem: 1, taxas: [] }, []))
      .rejects.toThrow('Preencha a taxa do débito');
    expect(chamadas).toHaveLength(0);
  });
  it('grava só a diferença das taxas', async () => {
    const originais = [
      { id: 'o1', bandeiraId: null, modalidade: 'debito' as const, parcelas: 1, taxa: 0.02 },
      { id: 'o2', bandeiraId: null, modalidade: 'credito' as const, parcelas: 1, taxa: 0.04 },
      { id: 'o3', bandeiraId: null, modalidade: 'credito' as const, parcelas: 2, taxa: 0.05 },
    ];
    const { db, chamadas } = fakeDb({ awaitavel: true });
    const r = await salvarMaquininha(db, 'emp', {
      id: 'm1', nome: 'Stone', maxParcelas: 1, ativa: true, padrao: true, ordem: 1,
      taxas: [
        { bandeiraId: null, modalidade: 'debito', parcelas: 1, taxa: 0.03 },
        { bandeiraId: null, modalidade: 'credito', parcelas: 1, taxa: 0.04 },
      ],
    }, originais);
    expect(r.id).toBe('m1');
    const taxas = opsDe(chamadas, 'cartao_taxas').flat();
    expect(taxas.filter(([m]) => m === 'delete')).toHaveLength(1);   // o3 (acima do máximo)
    expect(taxas.filter(([m]) => m === 'update')).toHaveLength(1);   // o1 mudou
    expect(taxas.filter(([m]) => m === 'insert')).toHaveLength(0);
  });
  it('definirPadrao desmarca as outras e marca a escolhida', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas: { cartao_maquininhas: [{ id: 'm2', ativa: true }] } });
    await definirPadrao(db, 'emp', 'm2');
    const ups = opsDe(chamadas, 'cartao_maquininhas').map(o => o.find(([m]) => m === 'update')?.[1][0]).filter(Boolean);
    expect(ups).toEqual([{ padrao: false }, { padrao: true }]);
  });
  it('retry com originais desatualizados: delete de linhas já apagadas não é erro', async () => {
    const originais = [
      { id: 'o1', bandeiraId: null, modalidade: 'debito' as const, parcelas: 1, taxa: 0.02 },
      { id: 'o2', bandeiraId: null, modalidade: 'credito' as const, parcelas: 1, taxa: 0.04 },
      { id: 'o3', bandeiraId: null, modalidade: 'credito' as const, parcelas: 2, taxa: 0.05 },
    ];
    const { db } = fakeDb({ awaitavel: true, respostaUpdate: (tabela) => ({ data: tabela === 'cartao_taxas' ? [] : [{ id: 'm1' }], error: null }) });
    await expect(salvarMaquininha(db, 'emp', {
      id: 'm1', nome: 'Stone', maxParcelas: 1, ativa: true, padrao: true, ordem: 1,
      taxas: [
        { bandeiraId: null, modalidade: 'debito', parcelas: 1, taxa: 0.02 },
        { bandeiraId: null, modalidade: 'credito', parcelas: 1, taxa: 0.04 },
      ],
    }, originais)).resolves.toEqual({ id: 'm1' });
  });
  it('definirPadrao rejeita maquininha inativa ou inexistente sem alterar nada', async () => {
    const a = fakeDb({ awaitavel: true, linhas: { cartao_maquininhas: [{ id: 'm2', ativa: false }] } });
    await expect(definirPadrao(a.db, 'emp', 'm2')).rejects.toThrow('Ative a maquininha antes de torná-la padrão');
    expect(a.chamadas).toHaveLength(1);
    const b = fakeDb({ awaitavel: true, linhas: { cartao_maquininhas: [] } });
    await expect(definirPadrao(b.db, 'emp', 'm2')).rejects.toThrow('Maquininha não encontrada');
  });
  it('definirPadrao: se marcar falhar, devolve a marca à padrão anterior', async () => {
    const { db, chamadas } = fakeDb({
      awaitavel: true,
      linhas: { cartao_maquininhas: [{ id: 'm2', ativa: true }] },
      respostaUpdate: (_t, _ids, lote) => lote === 0 ? { data: [{ id: 'antigo' }], error: null }
        : lote === 1 ? { data: [], error: null } : { data: [{ id: 'antigo' }], error: null },
    });
    await expect(definirPadrao(db, 'emp', 'm2')).rejects.toThrow();
    const ups = opsDe(chamadas, 'cartao_maquininhas').map(o => o.find(([m]) => m === 'update')?.[1][0]).filter(Boolean);
    expect(ups).toEqual([{ padrao: false }, { padrao: true }, { padrao: true }]);
    const ultimo = opsDe(chamadas, 'cartao_maquininhas').at(-1)!;
    expect(ultimo.find(([m]) => m === 'in')![1]).toEqual(['id', ['antigo']]);
  });
});
