import { describe, expect, it, vi } from 'vitest';
import {
  carregarMinhasPermissoes, carregarConfigPermissoes, salvarPermissoes,
  carregarPermissoesDoMembro, papelDeRole,
} from '@shared/permissoes-consultas';
import { permissoesPadrao } from '@shared/permissoes';

/** Query builder falso: qualquer encadeamento devolve a si mesmo; await resolve `resposta`. */
function fakeQuery(resposta: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'maybeSingle', 'single']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok);
  return q;
}

describe('carregarMinhasPermissoes', () => {
  it('dona: todas as chaves, sem consultar', async () => {
    const sb = { from: vi.fn(), rpc: vi.fn() };
    const r = await carregarMinhasPermissoes(sb, 'e', true, null);
    expect(r.isOwner).toBe(true);
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it('usa minhas_permissoes e ignora chave desconhecida / não permitida', async () => {
    const sb = { from: vi.fn(), rpc: vi.fn().mockResolvedValue({
      data: [
        { chave: 'agenda.excluir', permitido: true },
        { chave: 'clientes.cadastrar', permitido: false },
        { chave: 'chave.velha', permitido: true },
      ], error: null }) };
    const r = await carregarMinhasPermissoes(sb, 'e', false, 'profissional');
    expect(sb.rpc).toHaveBeenCalledWith('minhas_permissoes', { p_empresa: 'e' });
    expect(r.chaves).toEqual(['agenda.excluir']);
  });

  it('erro (ex.: migration 083 ainda não aplicada) → padrões do papel', async () => {
    const sb = { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } }) };
    const r = await carregarMinhasPermissoes(sb, 'e', false, 'profissional');
    expect([...r.chaves].sort()).toEqual(permissoesPadrao('profissional').sort());
  });

  it('exceção lançada → padrões do papel', async () => {
    const sb = { from: vi.fn(), rpc: vi.fn().mockRejectedValue(new Error('rede')) };
    const r = await carregarMinhasPermissoes(sb, 'e', false, 'gestor');
    expect([...r.chaves].sort()).toEqual(permissoesPadrao('gestor').sort());
  });
});

describe('carregarConfigPermissoes', () => {
  it('monta papel e membros a partir das duas tabelas, ignorando chave desconhecida', async () => {
    const sb = {
      rpc: vi.fn(),
      from: vi.fn((t: string) => fakeQuery(t === 'permissoes_papel'
        ? { data: [{ papel: 'profissional', chave: 'agenda.excluir', permitido: true }, { papel: 'gestor', chave: 'x.y', permitido: true }], error: null }
        : { data: [{ user_id: 'u1', chave: 'clientes.editar', permitido: false }], error: null })),
    };
    const cfg = await carregarConfigPermissoes(sb, 'e');
    expect(cfg.papel.profissional).toEqual({ 'agenda.excluir': true });
    expect(cfg.papel.gestor).toEqual({});
    expect(cfg.membros).toEqual({ u1: { 'clientes.editar': false } });
  });

  it('lança o erro do banco', async () => {
    const sb = { rpc: vi.fn(), from: vi.fn(() => fakeQuery({ data: null, error: { message: 'boom' } })) };
    await expect(carregarConfigPermissoes(sb, 'e')).rejects.toThrow('boom');
  });
});

describe('salvarPermissoes', () => {
  it('chama salvar_permissoes com o rascunho', async () => {
    const sb = { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ error: null }) };
    const m = [{ tipo: 'papel' as const, alvo: 'profissional' as const, chave: 'agenda.excluir' as const, permitido: true }];
    const r = await salvarPermissoes(sb, 'e', m);
    expect(sb.rpc).toHaveBeenCalledWith('salvar_permissoes', { p_empresa: 'e', p_mudancas: m });
    expect(r.error).toBeNull();
  });
});

describe('carregarPermissoesDoMembro (service role)', () => {
  it('não membro e não dona → null', async () => {
    const sb = { rpc: vi.fn(), from: vi.fn((t: string) => fakeQuery(t === 'empresas'
      ? { data: { owner_id: 'outra' }, error: null }
      : { data: null, error: null })) };
    expect(await carregarPermissoesDoMembro(sb, 'e', 'u')).toBeNull();
  });

  it('profissional com exceção', async () => {
    const respostas: Record<string, unknown> = {
      empresas: { data: { owner_id: 'dona' }, error: null },
      empresa_membros: { data: { role: 'profissional' }, error: null },
      permissoes_papel: { data: [], error: null },
      permissoes_membro: { data: [{ chave: 'equipe.gerenciar', permitido: true }], error: null },
    };
    const sb = { rpc: vi.fn(), from: vi.fn((t: string) => fakeQuery(respostas[t])) };
    const r = await carregarPermissoesDoMembro(sb, 'e', 'u');
    expect(r?.chaves).toContain('equipe.gerenciar');
    expect(r?.chaves).toContain('clientes.cadastrar');
    expect(r?.chaves).not.toContain('agenda.excluir');
  });
});

describe('papelDeRole', () => {
  it('converte o role do banco', () => {
    expect(papelDeRole('gestor')).toBe('gestor');
    expect(papelDeRole('profissional')).toBe('profissional');
    expect(papelDeRole('owner')).toBeNull();
    expect(papelDeRole(null)).toBeNull();
  });
});
