import { describe, it, expect } from 'vitest';
import { temPermissao, rotaInicial } from '@/lib/permissions';

describe('temPermissao', () => {
  describe('owner', () => {
    it('tem acesso total', () => {
      expect(temPermissao('owner', 'ver_financeiro_sensivel')).toBe(true);
      expect(temPermissao('owner', 'configurar_empresa')).toBe(true);
      expect(temPermissao('owner', 'gerenciar_profissionais')).toBe(true);
      expect(temPermissao('owner', 'ver_todos_agendamentos')).toBe(true);
    });
  });

  describe('gestor', () => {
    it('tem acesso gerencial mas não a dados financeiros sensíveis', () => {
      expect(temPermissao('gestor', 'ver_financeiro_sensivel')).toBe(false);
      expect(temPermissao('gestor', 'ver_despesas')).toBe(true);
      expect(temPermissao('gestor', 'ver_resumo_financeiro')).toBe(true);
    });

    it('pode gerenciar operações', () => {
      expect(temPermissao('gestor', 'gerenciar_profissionais')).toBe(true);
      expect(temPermissao('gestor', 'gerenciar_servicos')).toBe(true);
      expect(temPermissao('gestor', 'gerenciar_estoque')).toBe(true);
      expect(temPermissao('gestor', 'fechar_comanda')).toBe(true);
    });

    it('não pode configurar empresa', () => {
      expect(temPermissao('gestor', 'configurar_empresa')).toBe(false);
    });
  });

  describe('profissional', () => {
    it('acesso limitado à própria agenda e comissão', () => {
      expect(temPermissao('profissional', 'ver_proprios_agendamentos')).toBe(true);
      expect(temPermissao('profissional', 'ver_propria_comissao')).toBe(true);
      expect(temPermissao('profissional', 'ver_anamnese')).toBe(true);
      expect(temPermissao('profissional', 'fechar_comanda')).toBe(true);
    });

    it('não tem acesso a dados de outros profissionais', () => {
      expect(temPermissao('profissional', 'ver_todos_agendamentos')).toBe(false);
      expect(temPermissao('profissional', 'ver_comissoes_todas')).toBe(false);
      expect(temPermissao('profissional', 'ver_todos_clientes')).toBe(false);
    });

    it('não tem acesso financeiro', () => {
      expect(temPermissao('profissional', 'ver_financeiro_sensivel')).toBe(false);
      expect(temPermissao('profissional', 'ver_despesas')).toBe(false);
      expect(temPermissao('profissional', 'ver_resumo_financeiro')).toBe(false);
    });

    it('não pode gerenciar recursos', () => {
      expect(temPermissao('profissional', 'gerenciar_profissionais')).toBe(false);
      expect(temPermissao('profissional', 'gerenciar_servicos')).toBe(false);
      expect(temPermissao('profissional', 'configurar_empresa')).toBe(false);
    });
  });

  describe('cliente', () => {
    it('não tem nenhuma permissão', () => {
      expect(temPermissao('cliente', 'ver_financeiro_sensivel')).toBe(false);
      expect(temPermissao('cliente', 'ver_proprios_agendamentos')).toBe(false);
      expect(temPermissao('cliente', 'ver_anamnese')).toBe(false);
      expect(temPermissao('cliente', 'fechar_comanda')).toBe(false);
    });
  });
});

describe('rotaInicial', () => {
  it('owner e gestor vão ao dashboard', () => {
    expect(rotaInicial('owner')).toBe('/dashboard');
    expect(rotaInicial('gestor')).toBe('/dashboard');
  });

  it('profissional vai à agenda', () => {
    expect(rotaInicial('profissional')).toBe('/agenda');
  });

  it('cliente vai ao início', () => {
    expect(rotaInicial('cliente')).toBe('/inicio');
  });
});
