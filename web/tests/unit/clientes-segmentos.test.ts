import { describe, expect, it } from 'vitest';
import {
  agregarClientes, aniversariantesDoMes, contarSegmentos, filtrarClientes, segmentosDaCliente, servicoFavorito,
  DIAS_EM_RISCO, DIAS_SUMIDA, VIP_GASTO, VIP_ATENDIMENTOS, ROTULO_FILTRO, ROTULO_SEGMENTO,
  type AtendimentoBase, type ClienteBase,
} from '@shared/clientes-segmentos';
import { DIAS_RECONQUISTA } from '@shared/dashboard';

const HOJE = '2026-10-22';
const cli = (o: Partial<ClienteBase> = {}): ClienteBase => ({
  id: 'c1', nome: 'Ana', telefone: null, email: null, data_nascimento: null, ativo: true,
  created_at: '2026-01-01T12:00:00Z', ...o,
});
const at = (dia: string, o: Partial<AtendimentoBase> = {}): AtendimentoBase => ({
  cliente_id: 'c1', data_hora_inicio: `${dia}T15:00:00Z`, valor: 100, pacote_cliente_id: null, servico_id: 's1', ...o,
});
const seg = (c: ClienteBase, atend: AtendimentoBase[]) =>
  segmentosDaCliente(c, agregarClientes(atend, [], []).get(c.id), HOJE);

describe('constantes', () => {
  it('valores da spec e dashboard alinhado', () => {
    expect(VIP_GASTO).toBe(2000); expect(VIP_ATENDIMENTOS).toBe(8);
    expect(DIAS_EM_RISCO).toBe(45); expect(DIAS_SUMIDA).toBe(60);
    expect(DIAS_RECONQUISTA).toBe(DIAS_EM_RISCO);
  });
});

describe('agregarClientes', () => {
  it('sessão de pacote conta visita mas não gasto; soma extras e vendas', () => {
    const ag = agregarClientes(
      [at('2026-10-01', { valor: 100, desconto_rateado: 20 }), at('2026-10-10', { valor: 500, pacote_cliente_id: 'p1' })],
      [{ cliente_id: 'c1', valor_unit: 30, quantidade: 2, desconto_rateado: 10, fechada_at: '2026-10-01T10:00:00Z' }],
      [{ cliente_id: 'c1', valor_final: 15.5, created_at: '2026-10-02T10:00:00Z' }],
    ).get('c1')!;
    expect(ag.atendimentos).toBe(2);
    expect(ag.totalGasto).toBe(80 + 50 + 15.5);
    expect(ag.ultimaVisita).toBe('2026-10-10T15:00:00Z');
  });
  it('ignora linhas sem cliente', () => {
    expect(agregarClientes([at('2026-10-01', { cliente_id: null })], [], []).size).toBe(0);
  });
});

describe('segmentos nos limites', () => {
  it('VIP por gasto: 1999,99 não, 2000 sim', () => {
    expect(seg(cli(), [at('2026-10-20', { valor: 1999.99 })]).has('vip')).toBe(false);
    expect(seg(cli(), [at('2026-10-20', { valor: 2000 })]).has('vip')).toBe(true);
  });
  it('VIP por 8 atendimentos (7 não)', () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => at(`2026-09-${String(i + 1).padStart(2, '0')}`, { valor: 0 }));
    expect(seg(cli(), n(7)).has('vip')).toBe(false);
    expect(seg(cli(), n(8)).has('vip')).toBe(true);
  });
  it('em risco: 45 não, 46 sim, 60 sim, 61 sumida', () => {
    expect(seg(cli(), [at('2026-09-07')]).has('em_risco')).toBe(false); // 45 dias
    expect(seg(cli(), [at('2026-09-06')]).has('em_risco')).toBe(true); // 46
    expect(seg(cli(), [at('2026-08-23')]).has('em_risco')).toBe(true); // 60
    expect(seg(cli(), [at('2026-08-23')]).has('sumida')).toBe(false);
    expect(seg(cli(), [at('2026-08-22')]).has('sumida')).toBe(true); // 61
    expect(seg(cli(), [at('2026-08-22')]).has('em_risco')).toBe(false);
  });
  it('recorrente: 5 atendimentos e visita há ≤ 45 dias', () => {
    const n = (dia: string, k: number) => Array.from({ length: k }, () => at(dia));
    expect(seg(cli(), n('2026-09-07', 5)).has('recorrente')).toBe(true);
    expect(seg(cli(), n('2026-09-07', 4)).has('recorrente')).toBe(false);
    expect(seg(cli(), n('2026-09-06', 5)).has('recorrente')).toBe(false);
  });
  it('mais de um segmento ao mesmo tempo', () => {
    const s = seg(cli({ created_at: '2026-10-02T12:00:00Z' }), [at('2026-10-20', { valor: 3000 })]);
    expect(s.has('vip')).toBe(true);
    expect(s.has('nova')).toBe(true);
    expect(s.has('recorrente')).toBe(false);
  });
  it('nova: cadastrada no mês corrente em Brasília', () => {
    expect(seg(cli({ created_at: '2026-10-01T03:00:00Z' }), []).has('nova')).toBe(true);
    expect(seg(cli({ created_at: '2026-10-01T02:59:00Z' }), []).has('nova')).toBe(false); // 30/09 em BRT
  });
  it('nunca atendida: ≥ 30 dias e sem atendimento', () => {
    expect(seg(cli({ created_at: '2026-09-22T12:00:00Z' }), []).has('nunca_atendida')).toBe(true); // 30
    expect(seg(cli({ created_at: '2026-09-23T12:00:00Z' }), []).has('nunca_atendida')).toBe(false); // 29
    expect(seg(cli({ created_at: '2026-01-01T12:00:00Z' }), [at('2026-10-20')]).has('nunca_atendida')).toBe(false);
  });
  it('arquivada fica fora de todos os segmentos', () => {
    expect(seg(cli({ ativo: false }), [at('2026-10-20', { valor: 5000 })]).size).toBe(0);
  });
});

describe('contarSegmentos', () => {
  it('conta só ativas', () => {
    const cs = [cli({ id: 'a' }), cli({ id: 'b', ativo: false }), cli({ id: 'c', created_at: '2026-10-05T12:00:00Z' })];
    const ag = agregarClientes([at('2026-10-20', { cliente_id: 'a', valor: 2500 })], [], []);
    const r = contarSegmentos(cs, ag, HOJE);
    expect(r.total).toBe(2); expect(r.vip).toBe(1); expect(r.nova).toBe(1); expect(r.novasMes).toBe(1);
  });
});

describe('filtrarClientes', () => {
  const cs = [
    cli({ id: 'a', nome: 'Zélia', telefone: '(11) 98888-7777', email: 'z@x.com', data_nascimento: '1990-10-25' }),
    cli({ id: 'b', nome: 'Ângela', data_nascimento: '1990-10-03' }),
    cli({ id: 'c', nome: 'Bia', ativo: false, data_nascimento: '1990-10-01' }),
  ];
  const ag = agregarClientes([at('2026-10-10', { cliente_id: 'a' })], [], []);
  it('todas só ativas, ordem por nome', () => {
    expect(filtrarClientes(cs, ag, 'todas', '', HOJE).map(c => c.id)).toEqual(['b', 'a']);
  });
  it('arquivadas só arquivadas', () => {
    expect(filtrarClientes(cs, ag, 'arquivadas', '', HOJE).map(c => c.id)).toEqual(['c']);
  });
  it('aniversariantes ordenados por dia, só ativas', () => {
    expect(filtrarClientes(cs, ag, 'aniversariantes', '', HOJE).map(c => c.id)).toEqual(['b', 'a']);
  });
  it('retornos: visita nos últimos 30 dias', () => {
    expect(filtrarClientes(cs, ag, 'retornos', '', HOJE).map(c => c.id)).toEqual(['a']);
  });
  it('busca sem acento/caixa, telefone por dígitos e e-mail', () => {
    expect(filtrarClientes(cs, ag, 'todas', 'angela', HOJE).map(c => c.id)).toEqual(['b']);
    expect(filtrarClientes(cs, ag, 'todas', '98888', HOJE).map(c => c.id)).toEqual(['a']);
    expect(filtrarClientes(cs, ag, 'todas', 'Z@X', HOJE).map(c => c.id)).toEqual(['a']);
    expect(filtrarClientes(cs, ag, 'todas', '(11) 98888-7777', HOJE).map(c => c.id)).toEqual(['a']);
  });
  it('filtro de segmento', () => {
    expect(filtrarClientes(cs, ag, 'nunca_atendida', '', HOJE).map(c => c.id)).toEqual(['b']);
  });
});

describe('aniversariantesDoMes', () => {
  it('29/02 vira 28/02 em ano não bissexto', () => {
    const cs = [cli({ id: 'a', nome: 'A', data_nascimento: '2000-02-29' }), cli({ id: 'b', nome: 'B', data_nascimento: '1990-02-10' }), cli({ id: 'd', nome: 'D', data_nascimento: '1990-02-28' })];
    expect(aniversariantesDoMes(cs, '2026-02-15').map(c => c.id)).toEqual(['b', 'a', 'd']);
    expect(aniversariantesDoMes(cs, '2028-02-15').map(c => c.id)).toEqual(['b', 'd', 'a']);
    expect(aniversariantesDoMes(cs, '2026-03-15')).toEqual([]);
  });
  it('ignora arquivadas e datas inválidas', () => {
    const cs = [cli({ ativo: false, data_nascimento: '1990-10-05' }), cli({ id: 'x', data_nascimento: 'lixo' })];
    expect(aniversariantesDoMes(cs, HOJE)).toEqual([]);
  });
});

describe('servicoFavorito', () => {
  it('mais frequente', () => {
    expect(servicoFavorito([at('2026-10-01', { servico_id: 'a' }), at('2026-10-02', { servico_id: 'b', servico_nome: 'B' }), at('2026-10-03', { servico_id: 'b', servico_nome: 'B' })]))
      .toEqual({ id: 'b', nome: 'B' });
  });
  it('empate: o mais recente', () => {
    expect(servicoFavorito([at('2026-10-01', { servico_id: 'a', servico_nome: 'A' }), at('2026-10-05', { servico_id: 'b', servico_nome: 'B' })]))
      .toEqual({ id: 'b', nome: 'B' });
  });
  it('sem serviço: null', () => {
    expect(servicoFavorito([at('2026-10-01', { servico_id: null })])).toBeNull();
  });
});

describe('rótulos', () => {
  it('existem para todos', () => {
    expect(ROTULO_FILTRO.todas).toBe('Todas'); expect(ROTULO_SEGMENTO.vip).toBe('VIP');
  });
});

describe('textos únicos da lista (web e app)', () => {
  it('filtros no plural; segmentos (tags) no singular', async () => {
    const { FILTROS_CLIENTES } = await import('@shared/clientes-segmentos');
    expect(FILTROS_CLIENTES.map(f => ROTULO_FILTRO[f])).toEqual(
      ['Todas', 'Novas', 'Aniversariantes', 'Retornos', 'VIP', 'Recorrentes', 'Em risco', 'Sumidas', 'Nunca atendidas', 'Arquivadas'],
    );
    expect([ROTULO_SEGMENTO.recorrente, ROTULO_SEGMENTO.sumida, ROTULO_SEGMENTO.nunca_atendida]).toEqual(['Recorrente', 'Sumida', 'Nunca atendida']);
  });
  it('cartões: os 6 da spec, cada um com o filtro', async () => {
    const { CARTOES_CLIENTES } = await import('@shared/clientes-segmentos');
    expect(CARTOES_CLIENTES.map(c => [c.rotulo, c.filtro])).toEqual([
      ['Total', 'todas'], ['Novas no mês', 'novas'], ['VIP', 'vip'], ['Em risco', 'em_risco'], ['Sumidas', 'sumida'], ['Nunca atendidas', 'nunca_atendida'],
    ]);
  });
  it('tags da linha: segmentos na ordem fixa, sem "Nunca atendida"; arquivada só "Arquivada"', async () => {
    const { tagsDaLinha } = await import('@shared/clientes-segmentos');
    const ag = agregarClientes(Array.from({ length: 8 }, () => at('2026-10-20')), [], []);
    expect(tagsDaLinha(cli({ created_at: '2026-10-02T12:00:00Z' }), ag.get('c1'), HOJE)).toEqual(['VIP', 'Recorrente', 'Nova']);
    expect(tagsDaLinha(cli(), undefined, HOJE)).toEqual([]);
    expect(tagsDaLinha(cli({ ativo: false }), ag.get('c1'), HOJE)).toEqual(['Arquivada']);
  });
  it('última visita em Brasília e lista vazia', async () => {
    const { textoUltimaVisita, textoListaVazia } = await import('@shared/clientes-segmentos');
    expect(textoUltimaVisita('2026-10-21T02:00:00Z')).toBe('Última visita 20/10/26');
    expect(textoUltimaVisita(null)).toBe('Sem atendimento');
    expect(textoListaVazia('todas', '')).toBe('Nenhuma cliente cadastrada ainda.');
    expect(textoListaVazia('todas', 'ana')).toBe('Nenhuma cliente encontrada.');
    expect(textoListaVazia('vip', '')).toBe('Nenhuma cliente encontrada.');
  });
});
