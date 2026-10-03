import { describe, expect, it } from 'vitest';
import {
  CATALOGO_PERMISSOES, CHAVES_PERMISSAO, ehChavePermissao, pode, permissoesPadrao,
  resolverPermissao, configVazia, valorDoPapel, estadoDoMembro, contarExcecoes,
  aplicarMudancas, chaveMudanca, podeEditarAlvo, descreverHistorico,
  type PermissoesUsuario,
} from '@shared/permissoes';

const PADRAO_PROFISSIONAL = [
  'clientes.ver_todas', 'clientes.cadastrar', 'clientes.editar', 'anamnese.ver', 'anamnese.editar',
  'comanda.fechar', 'comanda.desconto', 'comanda.editar_fechada', 'pacotes.vender',
].sort();

describe('catálogo', () => {
  it('tem 27 chaves únicas, todas com rótulo e grupo', () => {
    expect(CHAVES_PERMISSAO).toHaveLength(27);
    expect(new Set(CHAVES_PERMISSAO).size).toBe(27);
    for (const p of CATALOGO_PERMISSOES) {
      expect(p.rotulo.length).toBeGreaterThan(3);
      expect(p.grupo.length).toBeGreaterThan(2);
    }
  });

  it('padrão da gestora = tudo menos excluir cliente (comportamento de hoje)', () => {
    expect(permissoesPadrao('gestor').sort()).toEqual(CHAVES_PERMISSAO.filter(c => c !== 'clientes.excluir').sort());
  });

  it('padrão da profissional = comportamento de hoje', () => {
    expect(permissoesPadrao('profissional').sort()).toEqual(PADRAO_PROFISSIONAL);
  });

  it('sem papel = nada', () => {
    expect(permissoesPadrao(null)).toEqual([]);
  });

  it('ehChavePermissao', () => {
    expect(ehChavePermissao('agenda.excluir')).toBe(true);
    expect(ehChavePermissao('agenda.inventada')).toBe(false);
  });
});

describe('pode', () => {
  const prof: PermissoesUsuario = { isOwner: false, papel: 'profissional', chaves: ['clientes.cadastrar'] };
  const dona: PermissoesUsuario = { isOwner: true, papel: null, chaves: [] };
  it('dona pode tudo, inclusive "dona"', () => {
    expect(pode(dona, 'agenda.excluir')).toBe(true);
    expect(pode(dona, 'dona')).toBe(true);
  });
  it('demais: só as chaves da lista; "dona" nunca', () => {
    expect(pode(prof, 'clientes.cadastrar')).toBe(true);
    expect(pode(prof, 'agenda.excluir')).toBe(false);
    expect(pode(prof, 'dona')).toBe(false);
  });
});

describe('resolverPermissao — mesma ordem da função SQL tem_permissao', () => {
  const base = { isOwner: false, papel: 'profissional' as const, papelLinhas: {}, membroLinhas: {} };
  it('dona → sempre true', () => {
    expect(resolverPermissao({ ...base, isOwner: true, membroLinhas: { 'agenda.excluir': false } }, 'agenda.excluir')).toBe(true);
  });
  it('sem papel → false', () => {
    expect(resolverPermissao({ ...base, papel: null }, 'clientes.cadastrar')).toBe(false);
  });
  it('exceção da pessoa vence o papel', () => {
    expect(resolverPermissao({ ...base, papelLinhas: { 'agenda.excluir': false }, membroLinhas: { 'agenda.excluir': true } }, 'agenda.excluir')).toBe(true);
  });
  it('linha do papel vence o padrão', () => {
    expect(resolverPermissao({ ...base, papelLinhas: { 'clientes.cadastrar': false } }, 'clientes.cadastrar')).toBe(false);
  });
  it('sem linhas → padrão', () => {
    expect(resolverPermissao(base, 'clientes.cadastrar')).toBe(true);
    expect(resolverPermissao(base, 'agenda.excluir')).toBe(false);
  });
});

describe('estado do painel', () => {
  it('valorDoPapel usa a linha ou o padrão', () => {
    const cfg = configVazia();
    expect(valorDoPapel(cfg, 'profissional', 'agenda.excluir')).toBe(false);
    cfg.papel.profissional['agenda.excluir'] = true;
    expect(valorDoPapel(cfg, 'profissional', 'agenda.excluir')).toBe(true);
  });

  it('estadoDoMembro e contarExcecoes', () => {
    const cfg = configVazia();
    cfg.membros['u1'] = { 'agenda.excluir': true, 'clientes.editar': false };
    expect(estadoDoMembro(cfg, 'u1', 'agenda.excluir')).toBe('permitir');
    expect(estadoDoMembro(cfg, 'u1', 'clientes.editar')).toBe('bloquear');
    expect(estadoDoMembro(cfg, 'u1', 'pacotes.vender')).toBe('padrao');
    expect(estadoDoMembro(cfg, 'u2', 'pacotes.vender')).toBe('padrao');
    expect(contarExcecoes(cfg, 'u1')).toBe(2);
    expect(contarExcecoes(cfg, 'u2')).toBe(0);
  });

  it('aplicarMudancas não altera o original; permitido null remove a exceção', () => {
    const cfg = configVazia();
    cfg.membros['u1'] = { 'agenda.excluir': true };
    const novo = aplicarMudancas(cfg, [
      { tipo: 'papel', alvo: 'profissional', chave: 'estoque.acessar', permitido: true },
      { tipo: 'membro', alvo: 'u1', chave: 'agenda.excluir', permitido: null },
      { tipo: 'membro', alvo: 'u2', chave: 'clientes.editar', permitido: false },
    ]);
    expect(novo.papel.profissional['estoque.acessar']).toBe(true);
    expect(novo.membros['u1']['agenda.excluir']).toBeUndefined();
    expect(novo.membros['u2']['clientes.editar']).toBe(false);
    expect(cfg.membros['u1']['agenda.excluir']).toBe(true);
    expect(cfg.papel.profissional['estoque.acessar']).toBeUndefined();
  });

  it('chaveMudanca identifica alvo + chave', () => {
    expect(chaveMudanca({ tipo: 'membro', alvo: 'u1', chave: 'agenda.excluir', permitido: null })).toBe('membro:u1:agenda.excluir');
  });
});

describe('podeEditarAlvo — regra da gestora (espelha salvar_permissoes)', () => {
  const dona = { isOwner: true, papel: null, userId: 'd' };
  const gestora = { isOwner: false, papel: 'gestor' as const, userId: 'g' };
  const prof = { isOwner: false, papel: 'profissional' as const, userId: 'p' };
  it('dona edita qualquer papel e qualquer membro que não seja dona', () => {
    expect(podeEditarAlvo(dona, { tipo: 'papel', papel: 'gestor' })).toBe(true);
    expect(podeEditarAlvo(dona, { tipo: 'membro', userId: 'g', papel: 'gestor' })).toBe(true);
    expect(podeEditarAlvo(dona, { tipo: 'membro', userId: 'x', papel: 'owner' })).toBe(false);
  });
  it('gestora: só papel profissional e profissionais que não sejam ela', () => {
    expect(podeEditarAlvo(gestora, { tipo: 'papel', papel: 'profissional' })).toBe(true);
    expect(podeEditarAlvo(gestora, { tipo: 'papel', papel: 'gestor' })).toBe(false);
    expect(podeEditarAlvo(gestora, { tipo: 'membro', userId: 'p', papel: 'profissional' })).toBe(true);
    expect(podeEditarAlvo(gestora, { tipo: 'membro', userId: 'g2', papel: 'gestor' })).toBe(false);
    expect(podeEditarAlvo(gestora, { tipo: 'membro', userId: 'g', papel: 'profissional' })).toBe(false);
  });
  it('profissional nunca edita', () => {
    expect(podeEditarAlvo(prof, { tipo: 'papel', papel: 'profissional' })).toBe(false);
  });
});

describe('descreverHistorico', () => {
  it('formata em horário de Brasília com ✔/✘/padrão', () => {
    const txt = descreverHistorico(
      { id: '1', criado_em: '2026-10-02T17:30:00Z', alterado_por: 'g', alvo_tipo: 'papel', alvo: 'profissional', chave: 'agenda.excluir', de: false, para: true },
      { g: 'Carla' },
    );
    expect(txt).toBe('02/10 14:30 · Carla · Profissional · Excluir agendamento: ✘ → ✔');
  });
  it('membro e volta ao padrão', () => {
    const txt = descreverHistorico(
      { id: '2', criado_em: '2026-10-02T03:05:00Z', alterado_por: null, alvo_tipo: 'membro', alvo: 'u1', chave: 'clientes.editar', de: false, para: null },
      { u1: 'Ana' },
    );
    expect(txt).toBe('02/10 00:05 · Alguém · Ana · Editar cliente: ✘ → padrão');
  });
});
