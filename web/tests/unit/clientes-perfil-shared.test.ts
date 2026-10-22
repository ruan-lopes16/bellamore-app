import { describe, expect, it } from 'vitest';
import {
  textoKpiUltimaVisita, kpisPerfilCliente, tagsPerfilCliente, AVISO_CLIENTE_ARQUIVADA,
  type Agregado, type ClienteBase,
} from '@shared/clientes-segmentos';
import {
  textoItensVenda, textoTaxaHistorico, clienteTemHistorico, excluirCliente,
  MSG_EXCLUSAO_COM_HISTORICO, MSG_SEM_PERMISSAO_EXCLUIR,
} from '@shared/clientes-consultas';
import { opcoesRemoverCliente, type PodeFn } from '@shared/permissoes';
import { fakeDb, opsDe } from './fixtures/fake-db';

const HOJE = '2026-10-22';
const ag = (o: Partial<Agregado> = {}): Agregado => ({
  atendimentos: 3, totalGasto: 250.5, ultimaVisita: '2026-10-10T13:00:00Z', servicoFavorito: { id: 's1', nome: 'Corte' }, ...o,
});
const cli = (o: Partial<ClienteBase> = {}): ClienteBase => ({
  id: 'c1', nome: 'Ana', telefone: null, email: null, data_nascimento: null, ativo: true, created_at: '2026-10-05T12:00:00Z', ...o,
});

describe('textoKpiUltimaVisita (KPI do perfil, igual no web e no app)', () => {
  it('Hoje, Ontem, há N dias e — (Brasília)', () => {
    expect(textoKpiUltimaVisita(null, HOJE)).toBe('—');
    // 02:00Z de 22/10 ainda é 21/10 em Brasília → Ontem
    expect(textoKpiUltimaVisita('2026-10-22T02:00:00Z', HOJE)).toBe('Ontem');
    expect(textoKpiUltimaVisita('2026-10-22T15:00:00Z', HOJE)).toBe('Hoje');
    expect(textoKpiUltimaVisita('2026-10-10T13:00:00Z', HOJE)).toBe('há 12 dias');
  });
});

describe('kpisPerfilCliente', () => {
  it('4 KPIs na ordem única, com os valores do agregado', () => {
    expect(kpisPerfilCliente(ag(), HOJE)).toEqual([
      { rotulo: 'Atendimentos', valor: '3', secreto: true },
      { rotulo: 'Total gasto', valor: 'R$ 250,50', secreto: true },
      { rotulo: 'Última visita', valor: 'há 12 dias', secreto: false },
      { rotulo: 'Serviço favorito', valor: 'Corte', secreto: false },
    ]);
  });
  it('sem agregado (carregando ou erro): "—" em todos, nunca zero', () => {
    for (const k of kpisPerfilCliente(null, HOJE)) expect(k.valor).toBe('—');
  });
  it('cliente sem atendimento mostra 0 atendimentos e — nos textos', () => {
    const k = kpisPerfilCliente(ag({ atendimentos: 0, totalGasto: 0, ultimaVisita: null, servicoFavorito: null }), HOJE);
    expect(k.map(x => x.valor)).toEqual(['0', 'R$ 0,00', '—', '—']);
  });
});

describe('tagsPerfilCliente', () => {
  it('sem agregado: só "Arquivada" (quando for), nunca segmento chutado', () => {
    expect(tagsPerfilCliente(cli(), null, HOJE)).toEqual([]);
    expect(tagsPerfilCliente(cli({ ativo: false }), null, HOJE)).toEqual(['Arquivada']);
  });
  it('com agregado: os segmentos da lista', () => {
    expect(tagsPerfilCliente(cli(), ag({ atendimentos: 8 }), HOJE)).toEqual(['VIP', 'Recorrente', 'Nova']);
  });
});

describe('AVISO_CLIENTE_ARQUIVADA', () => {
  it('texto único', () => {
    expect(AVISO_CLIENTE_ARQUIVADA).toBe('Cliente arquivada: fora da lista e dos segmentos. O histórico é mantido.');
  });
});

describe('textos do histórico', () => {
  it('itens da venda', () => {
    expect(textoItensVenda([{ nome: 'Óleo', quantidade: 2 }, { nome: 'Creme', quantidade: 1 }])).toBe('2× Óleo, 1× Creme');
    expect(textoItensVenda([])).toBe('Sem itens');
  });
  it('taxa: título e situação com a forma de pagamento quando paga', () => {
    expect(textoTaxaHistorico('taxa_reserva', 'pago', 'pix')).toEqual({ titulo: 'Taxa de reserva', detalhe: 'Paga · Pix' });
    expect(textoTaxaHistorico('taxa_reserva', 'pago', null)).toEqual({ titulo: 'Taxa de reserva', detalhe: 'Paga' });
    expect(textoTaxaHistorico('taxa_cancelamento', 'pendente', 'pix')).toEqual({ titulo: 'Taxa de cancelamento', detalhe: 'Pendente' });
    expect(textoTaxaHistorico('taxa_cancelamento', 'retida', null)).toEqual({ titulo: 'Taxa de cancelamento', detalhe: 'Retida' });
  });
});

describe('clienteTemHistorico', () => {
  it('false sem nenhum vínculo; consulta as 5 tabelas pela cliente', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true });
    expect(await clienteTemHistorico(db, 'c1')).toBe(false);
    expect(chamadas.map(c => c.tabela).sort()).toEqual(['agendamentos', 'avaliacoes', 'comandas', 'pacote_clientes', 'vendas']);
    expect(opsDe(chamadas, 'comandas')[0]).toContainEqual(['eq', ['clientes_id', 'c1']]);
    expect(opsDe(chamadas, 'vendas')[0]).toContainEqual(['eq', ['cliente_id', 'c1']]);
  });
  it('true com qualquer vínculo', async () => {
    const { db } = fakeDb({ awaitavel: true, linhas: { avaliacoes: [{ id: 'a1' }] } });
    expect(await clienteTemHistorico(db, 'c1')).toBe(true);
  });
  it('erro de leitura lança (nunca vira "sem histórico")', async () => {
    const { db } = fakeDb({ awaitavel: true, erroTabelas: { vendas: 'falhou' } });
    await expect(clienteTemHistorico(db, 'c1')).rejects.toThrow();
  });
});

describe('excluirCliente', () => {
  it('apaga da empresa com select(id)', async () => {
    const { db, chamadas } = fakeDb({});
    await excluirCliente(db, 'e1', 'c1');
    const ops = opsDe(chamadas, 'clientes')[0];
    expect(ops).toContainEqual(['delete', []]);
    expect(ops).toContainEqual(['eq', ['id', 'c1']]);
    expect(ops).toContainEqual(['eq', ['empresa_id', 'e1']]);
    expect(ops).toContainEqual(['select', ['id']]);
  });
  it('0 linhas vira aviso de permissão', async () => {
    const { db } = fakeDb({ respostaUpdate: () => ({ data: [], error: null }) });
    await expect(excluirCliente(db, 'e1', 'c1')).rejects.toThrow(MSG_SEM_PERMISSAO_EXCLUIR);
  });
  it('mensagem de histórico única', () => {
    expect(MSG_EXCLUSAO_COM_HISTORICO).toContain('Arquive em vez disso.');
  });
});

describe('opcoesRemoverCliente (mesma regra no web e no app)', () => {
  const com = (...chaves: string[]): PodeFn => (a) => chaves.includes(a);
  it('arquivar só para ativa com permissão; excluir só com clientes.excluir', () => {
    const tudo = com('clientes.arquivar', 'clientes.editar', 'clientes.excluir');
    expect(opcoesRemoverCliente(false, tudo)).toEqual({ arquivar: true, excluir: true, algum: true });
    expect(opcoesRemoverCliente(true, tudo)).toEqual({ arquivar: false, excluir: true, algum: true });
    expect(opcoesRemoverCliente(true, com('clientes.arquivar', 'clientes.editar'))).toEqual({ arquivar: false, excluir: false, algum: false });
    expect(opcoesRemoverCliente(false, com('clientes.arquivar'))).toEqual({ arquivar: false, excluir: false, algum: false });
  });
});
