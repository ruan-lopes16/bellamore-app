import { describe, expect, it, vi } from 'vitest';
import { mensagemErroBanco } from '@shared/erros';

describe('mensagemErroBanco — mensagens próprias das funções (087, 088, 090, 091, 092)', () => {
  it('P0001 mostra o texto da função', () => {
    expect(mensagemErroBanco({ code: 'P0001', message: 'Carrinho vazio.' }, 'registrar a venda')).toBe('Carrinho vazio.');
    expect(mensagemErroBanco({ code: 'P0001', message: 'Estoque insuficiente: Óleo (restam 1)' }, 'registrar a venda'))
      .toBe('Estoque insuficiente: Óleo (restam 1)');
    expect(mensagemErroBanco({ code: 'P0001', message: 'Este convite já foi respondido ou cancelado.' }, 'aceitar o convite'))
      .toBe('Este convite já foi respondido ou cancelado.');
  });

  it('42501 com texto próprio da função mostra o texto', () => {
    expect(mensagemErroBanco({ code: '42501', message: 'Você não tem permissão para registrar vendas avulsas.' }, 'registrar a venda'))
      .toBe('Você não tem permissão para registrar vendas avulsas.');
    expect(mensagemErroBanco({ code: '42501', message: 'Sem permissão para gerenciar a equipe.' }, 'cancelar o convite'))
      .toBe('Sem permissão para gerenciar a equipe.');
    expect(mensagemErroBanco({ code: '42501', message: 'Você não tem permissão para movimentar o estoque.' }, 'movimentar'))
      .toBe('Você não tem permissão para movimentar o estoque.');
  });

  it('42501 sem texto próprio (RLS, permission denied) usa o fallback em português', () => {
    const fb = 'Você não tem permissão para cadastrar cliente. Fale com a dona ou a gestora.';
    expect(mensagemErroBanco({ code: '42501', message: 'new row violates row-level security policy for table "clientes"' }, 'cadastrar cliente')).toBe(fb);
    expect(mensagemErroBanco({ code: '42501', message: 'permission denied for table clientes' }, 'cadastrar cliente')).toBe(fb);
    expect(mensagemErroBanco({ code: '42501', message: '' }, 'cadastrar cliente')).toBe(fb);
    expect(mensagemErroBanco({ code: null, message: 'new row violates row-level security policy' }, 'cadastrar cliente')).toBe(fb);
  });

  it('nunca mostra texto técnico em inglês, mesmo com P0001', () => {
    const msg = mensagemErroBanco({ code: 'P0001', message: 'duplicate key value violates unique constraint' }, 'salvar');
    expect(msg).not.toMatch(/violates|duplicate/i);
    expect(msg).toBe('Não foi possível salvar. Tente de novo; se continuar, fale com o suporte.');
  });

  it('códigos desconhecidos seguem genéricos', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(mensagemErroBanco({ code: 'XX000', message: 'boom' }, 'salvar')).toBe('Não foi possível salvar. Tente de novo; se continuar, fale com o suporte.');
  });
});
