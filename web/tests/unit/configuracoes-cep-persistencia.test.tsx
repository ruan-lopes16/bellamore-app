/**
 * "O CEP não persiste em Configurações" — o Salvar gravava o formulário INTEIRO. Um formulário
 * aberto antes de o CEP ser salvo (PWA retomado, outra aba ou aparelho) devolvia ao banco o
 * endereço antigo, sem CEP, ao salvar qualquer outro campo. A tela também seguia mostrando o
 * endereço de quando foi aberta. Banco simulado em memória (nada real).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { colunasAlteradas } from '@shared/configuracoes-empresa';
import { lerEnderecoEmpresa, serializarEnderecoEmpresa } from '@shared/endereco';

const banco = vi.hoisted(() => ({
  empresa: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/supabase/client', () => {
  function consulta(tabela: string) {
    const b: Record<string, unknown> = {};
    const eu = () => b;
    Object.assign(b, {
      select: eu, eq: eu, in: eu, order: eu, limit: eu, maybeSingle: eu,
      single: () => Promise.resolve({ data: tabela === 'empresas' ? { ...banco.empresa } : { nome: 'Dona' }, error: null }),
      update: (p: Record<string, unknown>) => {
        if (tabela === 'empresas') { banco.updates.push(p); banco.empresa = { ...banco.empresa, ...p }; }
        return { eq: () => ({ select: () => Promise.resolve({ data: [{ id: 'e1' }], error: null }) }) };
      },
      then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
    });
    return b;
  }
  return { createClient: () => ({
    from: consulta,
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1', email: 'dona@x.com' } } }) },
    storage: { from: () => ({}) },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }) };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('aba=empresa'),
}));
vi.mock('@/components/EmpresaAtivaProvider', () => ({ useEmpresaAtiva: () => ({ empresaId: 'e1' }) }));
vi.mock('@/components/PermissoesProvider', () => ({ usePermissoes: () => ({ pode: () => true, papel: 'gestor' }) }));
vi.mock('@/components/permissoes/PermissoesPanel', () => ({ PermissoesPanel: () => null }));
vi.mock('@/components/configuracoes/CartoesConfig', () => ({ CartoesConfig: () => null }));
vi.mock('@/components/SwRegister', () => ({ registrarEInscrever: vi.fn() }));
vi.mock('@shared/agenda-consultas', () => ({
  carregarPreferenciaAgenda: () => Promise.resolve('propria'), salvarPreferenciaAgenda: vi.fn(),
}));

import ConfiguracoesPage from '@/app/(app)/configuracoes/page';

const SEM_CEP = 'Rua A, 12, Centro, Recife - PE';
const COM_CEP = serializarEnderecoEmpresa({ cep: '50000-000', rua: 'Rua A', numero: '12', bairro: 'Centro', cidade: 'Recife', uf: 'PE' });

beforeEach(() => {
  cleanup();
  banco.empresa = { id: 'e1', nome: 'Bella', endereco: SEM_CEP };
  banco.updates = [];
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ erro: true }) })) as unknown as typeof fetch;
  Object.defineProperty(window, 'location', { value: { reload: vi.fn() }, writable: true, configurable: true });
});

async function abrir() {
  render(<ConfiguracoesPage />);
  return await screen.findByPlaceholderText('00000-000') as HTMLInputElement;
}

describe('Configurações — CEP persiste', () => {
  it('CEP digitado é gravado e lido de volta', async () => {
    const cep = await abrir();
    await userEvent.type(cep, '50000-000');
    fireEvent.submit(cep.closest('form')!);
    await waitFor(() => expect(banco.updates.length).toBe(1));
    expect(lerEnderecoEmpresa(banco.empresa.endereco as string).cep).toBe('50000-000');
    cleanup();
    expect((await abrir()).value).toBe('50000-000');
  });

  it('formulário aberto antes do CEP ser salvo em outro lugar não apaga o CEP ao salvar outro campo', async () => {
    const cep = await abrir();
    expect(cep.value).toBe('');
    // Outra aba/aparelho grava o CEP enquanto esta tela segue aberta.
    banco.empresa = { ...banco.empresa, endereco: COM_CEP };
    const nome = screen.getByPlaceholderText('Ex: Studio Bella');
    await userEvent.clear(nome);
    await userEvent.type(nome, 'Bella Estética');
    fireEvent.submit(cep.closest('form')!);
    await waitFor(() => expect(banco.updates.length).toBe(1));
    expect(banco.updates[0]).toEqual({ nome: 'Bella Estética' });
    expect(lerEnderecoEmpresa(banco.empresa.endereco as string).cep).toBe('50000-000');
  });

  it('ao voltar para a tela sem edições, relê a empresa e mostra o CEP salvo depois', async () => {
    const cep = await abrir();
    banco.empresa = { ...banco.empresa, endereco: COM_CEP };
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(cep.value).toBe('50000-000'));
  });

  it('sem nada alterado, Salvar não grava nada', async () => {
    const cep = await abrir();
    fireEvent.submit(cep.closest('form')!);
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(banco.updates).toEqual([]);
  });
});

describe('colunasAlteradas', () => {
  it('só as colunas diferentes do que foi carregado; sem carga, tudo', () => {
    const carregado = { nome: 'A', endereco: '{"cep":""}', horario: { seg: 1 } };
    expect(colunasAlteradas(carregado, { nome: 'B', endereco: '{"cep":""}', horario: { seg: 1 } })).toEqual({ nome: 'B' });
    expect(colunasAlteradas(carregado, { ...carregado, horario: { seg: 2 } })).toEqual({ horario: { seg: 2 } });
    expect(colunasAlteradas(null, carregado)).toEqual(carregado);
  });
});
