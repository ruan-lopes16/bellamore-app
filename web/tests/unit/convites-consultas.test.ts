import { describe, expect, it } from 'vitest';
import {
  aceitarConvite, cancelarConvite, carregarConvitesPendentes, carregarHistoricoEquipe, carregarMeusConvites,
  recusarConvite, semMigration092, TAMANHO_PAGINA_HISTORICO_EQUIPE,
} from '@shared/convites-consultas';
import { descreverHistoricoEquipe, quandoHistoricoEquipe, rotuloPapelEquipe, type LinhaHistoricoEquipe } from '@shared/equipe';
import { fakeDb, opsDe } from './fixtures/fake-db';

const ok = (data: unknown) => ({ data, error: null });

describe('convites (consultas)', () => {
  it('carregarMeusConvites chama meus_convites e normaliza; sem a 092 devolve vazio; outro erro lança', async () => {
    const { db, rpcs } = fakeDb({ rpc: () => ok([{ id: 'c1', empresa_id: 'e1', empresa_nome: 'Bellamore', role: 'gestor', percentual_comissao: '45.50', tipo_contrato: 'x', criado_em: '2026-10-16T12:00:00Z', convidado_por_nome: 'Dona' }]) });
    expect(await carregarMeusConvites(db)).toEqual([{ id: 'c1', empresa_id: 'e1', empresa_nome: 'Bellamore', role: 'gestor', percentual_comissao: 45.5, tipo_contrato: null, criado_em: '2026-10-16T12:00:00Z', convidado_por_nome: 'Dona' }]);
    expect(rpcs).toEqual([{ fn: 'meus_convites', args: {} }]);
    expect(await carregarMeusConvites(fakeDb().db)).toEqual([]);
    await expect(carregarMeusConvites(fakeDb({ rpc: () => ({ data: null, error: { code: 'P0001', message: 'Sessão expirada. Entre de novo.' } }) }).db))
      .rejects.toThrow('Sessão expirada. Entre de novo.');
  });

  it('aceitar devolve a empresa; recusar e cancelar mandam os parâmetros certos; mensagens do banco chegam à tela', async () => {
    const { db, rpcs } = fakeDb({ rpc: fn => ok(fn === 'aceitar_convite' ? 'e1' : null) });
    expect(await aceitarConvite(db, 'c1')).toBe('e1');
    await recusarConvite(db, 'c2');
    await cancelarConvite(db, 'e1', 'c3');
    expect(rpcs).toEqual([
      { fn: 'aceitar_convite', args: { p_convite: 'c1' } },
      { fn: 'recusar_convite', args: { p_convite: 'c2' } },
      { fn: 'cancelar_convite', args: { p_empresa: 'e1', p_convite: 'c3' } },
    ]);
    const falha = (message: string, code = 'P0001') => fakeDb({ rpc: () => ({ data: null, error: { code, message } }) }).db;
    await expect(aceitarConvite(falha('Este convite já foi respondido ou cancelado.'), 'c1')).rejects.toThrow('Este convite já foi respondido ou cancelado.');
    await expect(recusarConvite(falha('Convite não encontrado.'), 'c1')).rejects.toThrow('Convite não encontrado.');
    await expect(cancelarConvite(falha('x', '42501'), 'e1', 'c1')).rejects.toThrow('Você não tem permissão para cancelar o convite');
    // Sem a 092 aceitar não finge sucesso.
    await expect(aceitarConvite(fakeDb().db, 'c1')).rejects.toThrow();
    await expect(aceitarConvite(fakeDb({ rpc: () => ok(null) }).db, 'c1')).rejects.toThrow('Não foi possível aceitar o convite.');
  });

  it('carregarConvitesPendentes: empresa, pendentes, mais recentes primeiro; sem a tabela = vazio', async () => {
    const { db, chamadas } = fakeDb({ linhas: { convites_equipe: [{ id: 'c1', user_id: 'u1', email: 'a@x.com', nome: 'Ana', role: 'profissional', percentual_comissao: 40, tipo_contrato: 'pj', convidado_por: 'd1', criado_em: '2026-10-16' }] } });
    expect(await carregarConvitesPendentes(db, 'e1')).toEqual([{ id: 'c1', user_id: 'u1', email: 'a@x.com', nome: 'Ana', role: 'profissional', percentual_comissao: 40, tipo_contrato: 'pj', convidado_por: 'd1', criado_em: '2026-10-16' }]);
    const ops = opsDe(chamadas, 'convites_equipe')[0];
    expect(ops).toContainEqual(['eq', ['empresa_id', 'e1']]);
    expect(ops).toContainEqual(['eq', ['status', 'pendente']]);
    expect(ops).toContainEqual(['order', ['criado_em', { ascending: false }]]);
    expect(await carregarConvitesPendentes(fakeDb({ erroTabelasCodigo: { convites_equipe: { code: 'PGRST205', message: "Could not find the table 'public.convites_equipe'" } } }).db, 'e1')).toEqual([]);
    await expect(carregarConvitesPendentes(fakeDb({ erroTabelasCodigo: { convites_equipe: { code: '57014', message: 'timeout' } } }).db, 'e1')).rejects.toThrow();
  });

  it('carregarHistoricoEquipe pagina com uma linha a mais para saber se tem mais', async () => {
    const n = TAMANHO_PAGINA_HISTORICO_EQUIPE;
    const linhas = Array.from({ length: n + 1 }, (_, i) => ({ id: `h${i}`, acao: 'desativado', alvo_user_id: 'u1', feito_por: null, criado_em: '2026-10-16', detalhe: {} }));
    const { db, rpcs } = fakeDb({ rpc: () => ok(linhas) });
    const r = await carregarHistoricoEquipe(db, 'e1', 2);
    expect(rpcs[0]).toEqual({ fn: 'listar_historico_equipe', args: { p_empresa: 'e1', p_limite: n + 1, p_offset: 2 * n } });
    expect(r).toMatchObject({ temMais: true, disponivel: true });
    expect(r.linhas).toHaveLength(n);
    expect((await carregarHistoricoEquipe(fakeDb({ rpc: () => ok(linhas.slice(0, 3)) }).db, 'e1', -1)).temMais).toBe(false);
    expect(await carregarHistoricoEquipe(fakeDb().db, 'e1', 0)).toEqual({ linhas: [], temMais: false, disponivel: false });
    await expect(carregarHistoricoEquipe(fakeDb({ rpc: () => ({ data: null, error: { code: '42501', message: 'Sem permissão para ver o histórico da equipe.' } }) }).db, 'e1', 0))
      .rejects.toThrow('Você não tem permissão para carregar o histórico da equipe');
  });

  it('semMigration092 só para função/tabela inexistente', () => {
    expect(semMigration092({ code: 'PGRST202' })).toBe(true);
    expect(semMigration092({ code: '42P01' })).toBe(true);
    expect(semMigration092({ code: '42883' })).toBe(false);
    expect(semMigration092({ code: 'P0001', message: 'x' })).toBe(false);
    expect(semMigration092(null)).toBe(false);
  });
});

describe('descreverHistoricoEquipe', () => {
  const base = (acao: string, detalhe: Record<string, unknown> = {}, extra: Partial<LinhaHistoricoEquipe> = {}): LinhaHistoricoEquipe =>
    ({ id: 'h', acao, detalhe, alvo_user_id: 'u1', feito_por: 'd1', criado_em: '2026-10-16T17:30:00Z', ...extra });
  const nomes = { u1: 'Thalia', d1: 'Carla' };

  it('frases de cada ação', () => {
    expect(descreverHistoricoEquipe(base('convite_enviado', { role: 'gestor' }), nomes)).toBe('Carla convidou Thalia para a equipe como Gestora.');
    expect(descreverHistoricoEquipe(base('convite_aceito', { role: 'profissional' }), nomes)).toBe('Thalia aceitou o convite e entrou na equipe como Profissional.');
    expect(descreverHistoricoEquipe(base('convite_recusado'), nomes)).toBe('Thalia recusou o convite para a equipe.');
    expect(descreverHistoricoEquipe(base('convite_cancelado'), nomes)).toBe('Carla cancelou o convite de Thalia.');
    expect(descreverHistoricoEquipe(base('login_trocado', { de: 'th***@x.com', para: 'th***@y.com' }), nomes))
      .toBe('Carla trocou o e-mail de login de Thalia de th***@x.com para th***@y.com.');
    expect(descreverHistoricoEquipe(base('desativado'), nomes)).toBe('Carla desativou Thalia.');
    expect(descreverHistoricoEquipe(base('reativado'), nomes)).toBe('Carla reativou Thalia.');
    expect(descreverHistoricoEquipe(base('papel_trocado', { de: 'profissional', para: 'gestor' }), nomes)).toBe('Carla mudou o papel de Thalia de Profissional para Gestora.');
    expect(descreverHistoricoEquipe(base('comissao_trocada', { de: 40, para: 45.5 }), nomes)).toBe('Carla mudou a comissão de Thalia de 40% para 45,5%.');
    expect(descreverHistoricoEquipe(base('contrato_trocado', { de: null, para: 'clt' }), nomes)).toBe('Carla mudou o contrato de Thalia de sem contrato para CLT.');
    expect(descreverHistoricoEquipe(base('contrato_trocado', { de: 'pj', para: null }), nomes)).toBe('Carla mudou o contrato de Thalia de PJ / Comissionada para sem contrato.');
  });

  it('nomes: mapa da tela, depois o do banco, depois o do convite; sem autor = "Alguém"', () => {
    expect(descreverHistoricoEquipe(base('desativado', {}, { feito_por: null, alvo_nome: 'Bia' }), {})).toBe('Alguém desativou Bia.');
    expect(descreverHistoricoEquipe(base('convite_recusado', { nome: 'Cau', email: 'c***@x.com' }, { alvo_user_id: null }), {})).toBe('Cau recusou o convite para a equipe.');
    expect(descreverHistoricoEquipe(base('convite_recusado', { email: 'c***@x.com' }, { alvo_user_id: null }), {})).toBe('c***@x.com recusou o convite para a equipe.');
    expect(descreverHistoricoEquipe(base('reativado', {}, { feito_por_nome: 'Dona', alvo_user_id: null, detalhe: null }), {})).toBe('Dona reativou uma pessoa.');
  });

  it('rótulos e data em Brasília', () => {
    expect(rotuloPapelEquipe('owner')).toBe('Dona');
    expect(quandoHistoricoEquipe('2026-10-16T02:05:00Z')).toBe('15/10/2026 23:05');
    expect(quandoHistoricoEquipe('lixo')).toBe('');
  });
});
