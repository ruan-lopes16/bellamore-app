import { describe, expect, it } from 'vitest';
import {
  TIPOS_NOTIFICACAO, VISUAL_ALERTA, alertasCalculados, contagemSino, rotaDoAviso, rotaDoDestino, tipoNotificacao,
  type Alerta, type EntradaAlertas,
} from '@shared/notificacoes';
import { CHAVES_PERMISSAO, type ChavePermissao, type PermissoesUsuario } from '@shared/permissoes';

// 28/10/2026 10:00 em Brasília = 13:00Z.
const AGORA = new Date('2026-10-28T13:00:00Z');
const EU = 'u-eu';
const dona: PermissoesUsuario = { isOwner: true, papel: null, chaves: [...CHAVES_PERMISSAO] };
const prof = (...chaves: ChavePermissao[]): PermissoesUsuario => ({ isOwner: false, papel: 'profissional', chaves });

const dados: EntradaAlertas = {
  agendamentosHoje: [
    // 14:00 BRT de hoje, de outra profissional
    { id: 'a2', data_hora_inicio: '2026-10-28T17:00:00Z', data_hora_fim: '2026-10-28T18:00:00Z', status: 'confirmado', profissional_id: 'u-outra', cliente: { nome: 'Bia' }, servico: { nome: 'Unha' } },
    // 11:00 BRT, minha
    { id: 'a1', data_hora_inicio: '2026-10-28T14:00:00Z', data_hora_fim: '2026-10-28T15:00:00Z', status: 'agendado', profissional_id: EU, cliente: { nome: 'Ana' }, servico: { nome: 'Corte' } },
    // já terminou
    { id: 'a0', data_hora_inicio: '2026-10-28T11:00:00Z', data_hora_fim: '2026-10-28T12:00:00Z', status: 'agendado', profissional_id: EU, cliente: { nome: 'X' }, servico: { nome: 'Y' } },
    // concluído
    { id: 'a3', data_hora_inicio: '2026-10-28T19:00:00Z', data_hora_fim: '2026-10-28T20:00:00Z', status: 'concluido', profissional_id: EU, cliente: { nome: 'X' }, servico: { nome: 'Y' } },
    // 23:30 BRT de hoje = 02:30Z de amanhã (UTC) — ainda é hoje em Brasília
    { id: 'a4', data_hora_inicio: '2026-10-29T02:30:00Z', data_hora_fim: '2026-10-29T03:00:00Z', status: 'agendado', profissional_id: EU, cliente: null, servico: { nome: null } },
    // 00:30 BRT de amanhã
    { id: 'a5', data_hora_inicio: '2026-10-29T03:30:00Z', data_hora_fim: '2026-10-29T04:00:00Z', status: 'agendado', profissional_id: EU, cliente: { nome: 'Z' }, servico: { nome: 'Z' } },
  ],
  estoqueBaixo: [
    { id: 'p1', nome: 'Óleo', estoque_atual: 0, estoque_minimo: 2 },
    { id: 'p2', nome: 'Creme', estoque_atual: 1.5, estoque_minimo: 3 },
  ],
  despesasVencendo: [
    { id: 'd1', descricao: 'Aluguel', valor: 1500, data_vencimento: '2026-10-28' },
    { id: 'd2', descricao: 'Luz', valor: '210.5', data_vencimento: '2026-11-02' },
    { id: 'd3', descricao: 'Fora', valor: 10, data_vencimento: '2026-11-10' },
    { id: 'd4', descricao: 'Vencida', valor: 10, data_vencimento: '2026-10-27' },
  ],
  comissoesPendentes: [
    { id: 'c1', valor_comissao: 50, profissional_id: EU, profissional: { nome: 'Eu' } },
    { id: 'c2', valor_comissao: '25.5', profissional_id: EU, profissional: { nome: 'Eu' } },
    { id: 'c3', valor_comissao: 100, profissional_id: 'u-outra', profissional: { nome: 'Outra' } },
  ],
  aniversariantes: [
    { id: 'k1', nome: 'Carla', data_nascimento: '1904-10-28' },
    { id: 'k2', nome: 'Duda', data_nascimento: '1990-10-29' },
    { id: 'k3', nome: 'Eva', data_nascimento: '1990-11-02' },
    { id: 'k4', nome: 'Longe', data_nascimento: '1990-12-25' },
  ],
  comandasNaoFechadas: [
    { id: 'n1', data_hora_inicio: '2026-10-20T13:00:00Z', profissional_id: 'u-outra' },
    { id: 'n2', data_hora_inicio: '2026-10-25T13:00:00Z', profissional_id: EU },
  ],
};

const grupos = (l: Alerta[]) => l.map(a => a.grupo);
const doGrupo = (l: Alerta[], g: Alerta['grupo']) => l.filter(a => a.grupo === g);

describe('alertasCalculados — dona (tudo)', () => {
  const l = alertasCalculados(dados, dona, { userId: EU, agora: AGORA });

  it('agendamentos de hoje em Brasília, ainda não terminados e não concluídos, em ordem de horário', () => {
    const ags = doGrupo(l, 'agendamentos');
    expect(ags.map(a => a.id)).toEqual(['ag-a1', 'ag-a2', 'ag-a4']);
    expect(ags[0].titulo).toBe('11:00 — Ana');
    expect(ags[0].descricao).toBe('Corte · Agendado');
    expect(ags[2].titulo).toBe('23:30 — Cliente');
    expect(ags[2].descricao).toBe('Serviço · Agendado');
    expect(ags[0].destino).toEqual({ tela: 'agenda' });
  });

  it('estoque baixo; zerado é urgente', () => {
    const est = doGrupo(l, 'estoque');
    expect(est.map(a => a.titulo)).toEqual(['Estoque baixo: Óleo', 'Estoque baixo: Creme']);
    expect(est[1].descricao).toBe('1,5 em estoque (mínimo: 3)');
    expect(est.map(a => a.urgente)).toEqual([true, false]);
  });

  it('despesas de hoje a hoje+7; vence hoje é urgente', () => {
    const d = doGrupo(l, 'despesas');
    expect(d.map(a => a.id)).toEqual(['desp-d1', 'desp-d2']);
    expect(d[0].titulo).toBe('Aluguel — R$ 1.500,00');
    expect(d[0].descricao).toBe('Vence hoje!');
    expect(d[0].urgente).toBe(true);
    expect(d[1].descricao).toBe('Vence em 5 dias (02/11)');
    expect(d[1].urgente).toBe(false);
  });

  it('comissões pendentes agrupadas por profissional (por nome)', () => {
    const c = doGrupo(l, 'comissoes');
    expect(c.map(a => [a.titulo, a.descricao])).toEqual([
      ['Comissão pendente: Eu', 'R$ 75,50 a pagar'],
      ['Comissão pendente: Outra', 'R$ 100,00 a pagar'],
    ]);
    expect(c[0].destino).toEqual({ tela: 'comissoes' });
  });

  it('comandas não fechadas num alerta só, com a mais antiga', () => {
    const c = doGrupo(l, 'comandas');
    expect(c).toHaveLength(1);
    expect(c[0].titulo).toBe('2 comandas não fechadas');
    expect(c[0].descricao).toBe('A mais antiga é de 20/10');
  });

  it('aniversariantes dos próximos 7 dias; hoje é urgente', () => {
    const a = doGrupo(l, 'aniversarios');
    expect(a.map(x => [x.id, x.descricao, x.urgente])).toEqual([
      ['aniv-k1', 'Aniversário HOJE! 🎉', true],
      ['aniv-k2', 'Amanhã!', false],
      ['aniv-k3', 'Em 5 dias · 02/11', false],
    ]);
    expect(a[0].destino).toEqual({ tela: 'cliente', id: 'k1' });
  });

  it('ordem dos grupos', () => {
    expect([...new Set(grupos(l))]).toEqual(['agendamentos', 'estoque', 'despesas', 'comissoes', 'comandas', 'aniversarios']);
  });
});

describe('alertasCalculados — por permissão', () => {
  it('profissional sem chaves: só a própria agenda e as próprias comissões, e aniversariantes', () => {
    const l = alertasCalculados(dados, prof(), { userId: EU, agora: AGORA });
    expect(doGrupo(l, 'agendamentos').map(a => a.id)).toEqual(['ag-a1', 'ag-a4']);
    expect(doGrupo(l, 'estoque')).toEqual([]);
    expect(doGrupo(l, 'despesas')).toEqual([]);
    expect(doGrupo(l, 'comandas')).toEqual([]);
    expect(doGrupo(l, 'comissoes').map(a => a.descricao)).toEqual(['R$ 75,50 a pagar']);
    expect(doGrupo(l, 'aniversarios')).toHaveLength(3);
  });

  it('cada chave libera o seu alerta', () => {
    const l = alertasCalculados(dados, prof('estoque.acessar', 'financeiro.ver', 'comissoes.ver_todas', 'agenda.ver_equipe', 'comanda.fechar', 'agenda.gerenciar_outras'), { userId: EU, agora: AGORA });
    expect(doGrupo(l, 'agendamentos')).toHaveLength(3);
    expect(doGrupo(l, 'estoque')).toHaveLength(2);
    expect(doGrupo(l, 'despesas')).toHaveLength(2);
    expect(doGrupo(l, 'comissoes')).toHaveLength(2);
    expect(doGrupo(l, 'comandas')[0].titulo).toBe('2 comandas não fechadas');
  });

  it('comanda.fechar sem agenda.gerenciar_outras: só as próprias comandas', () => {
    const l = alertasCalculados(dados, prof('comanda.fechar'), { userId: EU, agora: AGORA });
    const c = doGrupo(l, 'comandas');
    expect(c[0].titulo).toBe('1 comanda não fechada');
    expect(c[0].descricao).toBe('A mais antiga é de 25/10');
  });

  it('permissões ainda não carregadas (null) → nenhum alerta que dependa de permissão', () => {
    const l = alertasCalculados(dados, null, { userId: EU, agora: AGORA });
    expect(new Set(grupos(l))).toEqual(new Set(['aniversarios']));
  });

  it('dados ausentes (não carregados) não geram alerta', () => {
    expect(alertasCalculados({}, dona, { userId: EU, agora: AGORA })).toEqual([]);
    expect(alertasCalculados({ estoqueBaixo: null, despesasVencendo: null, comandasNaoFechadas: null }, dona, { userId: EU, agora: AGORA })).toEqual([]);
  });

  it('agendamento sem data_hora_fim confia no filtro da consulta; comanda sempre confere a profissional', () => {
    const l = alertasCalculados({
      agendamentosHoje: [{ id: 'x', data_hora_inicio: '2026-10-28T20:00:00Z', status: 'agendado', profissional_id: EU, cliente: { nome: 'Ana' }, servico: null }],
      comandasNaoFechadas: [
        { id: 'n', data_hora_inicio: '2026-10-27T13:00:00Z', profissional_id: EU },
        { id: 'm', data_hora_inicio: '2026-10-26T13:00:00Z', profissional_id: null },
      ],
    }, prof('comanda.fechar'), { userId: EU, agora: AGORA });
    expect(l.map(a => a.titulo)).toEqual(['17:00 — Ana', '1 comanda não fechada']);
  });
});

describe('contagemSino', () => {
  const l = alertasCalculados(dados, dona, { userId: EU, agora: AGORA });
  it('estoque + despesas um a um, comissões e comandas uma vez cada, mais os avisos não lidos', () => {
    // 2 estoque + 2 despesas + 1 comissões + 1 comandas + 3 não lidas
    expect(contagemSino(l, 3)).toBe(9);
  });
  it('agendamentos e aniversários não entram no sino', () => {
    expect(contagemSino(doGrupo(l, 'agendamentos').concat(doGrupo(l, 'aniversarios')), 0)).toBe(0);
  });
  it('qualquer parte com erro (null) → null', () => {
    expect(contagemSino(null, 2)).toBeNull();
    expect(contagemSino(l, null)).toBeNull();
  });
});

describe('tipos e rotas dos avisos', () => {
  it('só os tipos vivos', () => {
    expect(Object.keys(TIPOS_NOTIFICACAO).sort()).toEqual(
      ['agendamento', 'bloqueio_aprovado', 'bloqueio_pendente', 'bloqueio_recusado', 'estoque_baixo', 'resumo'],
    );
    for (const t of Object.values(TIPOS_NOTIFICACAO)) {
      expect(t.rotulo).toBeTruthy();
      expect(t.icone).toBeTruthy();
    }
    expect(tipoNotificacao('comissao')).toBeNull();
    expect(tipoNotificacao('cliente_sumido')).toBeNull();
    expect(tipoNotificacao('resumo')).toBe('resumo');
    expect(tipoNotificacao(null)).toBeNull();
  });

  it('cada grupo de alerta tem visual', () => {
    for (const g of ['agendamentos', 'estoque', 'despesas', 'comissoes', 'comandas', 'aniversarios'] as const) {
      expect(VISUAL_ALERTA[g].icone).toBeTruthy();
    }
  });

  it('rotaDoAviso no web', () => {
    expect(rotaDoAviso('agendamento', 'web')).toBe('/agenda');
    expect(rotaDoAviso('bloqueio_pendente', 'web')).toBe('/agenda');
    expect(rotaDoAviso('bloqueio_recusado', 'web')).toBe('/agenda');
    expect(rotaDoAviso('estoque_baixo', 'web')).toBe('/estoque');
    expect(rotaDoAviso('resumo', 'web')).toBe('/dashboard');
    expect(rotaDoAviso('comissao', 'web')).toBe('/notificacoes');
  });

  it('rotaDoAviso no app (empresa e profissional)', () => {
    expect(rotaDoAviso('agendamento', 'app')).toBe('/(empresa)/agenda');
    expect(rotaDoAviso('estoque_baixo', 'app')).toBe('/(empresa)/estoque');
    expect(rotaDoAviso('resumo', 'app')).toBe('/(empresa)/dashboard');
    expect(rotaDoAviso('agendamento', 'app', 'profissional')).toBe('/(profissional)/agenda');
    expect(rotaDoAviso('bloqueio_aprovado', 'app', 'profissional')).toBe('/(profissional)/agenda');
    expect(rotaDoAviso('resumo', 'app', 'profissional')).toBe('/(profissional)/inicio');
    expect(rotaDoAviso('estoque_baixo', 'app', 'profissional')).toBe('/(profissional)/notificacoes');
    expect(rotaDoAviso(undefined, 'app')).toBe('/(empresa)/notificacoes');
  });

  it('rotaDoDestino dos alertas', () => {
    expect(rotaDoDestino({ tela: 'cliente', id: 'k1' }, 'web')).toBe('/clientes/k1');
    expect(rotaDoDestino({ tela: 'cliente', id: 'k1' }, 'app')).toBe('/(empresa)/cliente/k1');
    expect(rotaDoDestino({ tela: 'comanda' }, 'web')).toBe('/comanda');
    expect(rotaDoDestino({ tela: 'comanda' }, 'app')).toBe('/(empresa)/nova-comanda');
    expect(rotaDoDestino({ tela: 'financeiro' }, 'web')).toBe('/financeiro');
    expect(rotaDoDestino({ tela: 'comissoes' }, 'app', 'profissional')).toBe('/(profissional)/comissoes');
    expect(rotaDoDestino({ tela: 'agenda' }, 'app', 'profissional')).toBe('/(profissional)/agenda');
    expect(rotaDoDestino({ tela: 'estoque' }, 'app', 'profissional')).toBe('/(profissional)/notificacoes');
  });
});
