import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

// Desde a migration 031, agendamentos.cliente_id → public.clientes. O embed
// `users!agendamentos_cliente_id_fkey` dá erro no PostgREST de produção
// (verificado em 2026-09-29) e derrubava agenda, dashboard e área da profissional.
const ARQUIVOS_COM_EMBED = [
  'mobile/hooks/useAgenda.ts',
  'mobile/hooks/useDashboard.ts',
  'mobile/hooks/useProfissional.ts',
  'mobile/app/(empresa)/agendamento/[id].tsx',
  'mobile/app/(profissional)/agendamento/[id].tsx',
];

describe('mobile usa public.clientes como entidade de cliente', () => {
  for (const arq of ARQUIVOS_COM_EMBED) {
    it(`${arq}: embed de cliente via clientes!`, () => {
      const src = ler(arq);
      expect(src).not.toContain('users!agendamentos_cliente_id_fkey');
      expect(src).toContain('clientes!agendamentos_cliente_id_fkey');
    });
  }

  it('useClientes lê de clientes (ativos, da empresa) e não de empresa_membros/users', () => {
    const src = ler('mobile/hooks/useClientes.ts');
    expect(src).toContain(".from('clientes')");
    expect(src).not.toContain(".from('empresa_membros')");
    expect(src).not.toContain(".from('users')");
    expect(src).toContain(".eq('ativo', true)");
  });

  it('anamnese do detalhe usa maybeSingle (sem erro PGRST116 quando não há ficha)', () => {
    const src = ler('mobile/hooks/useClientes.ts');
    const trecho = src.slice(src.indexOf(".from('anamnese_fichas')"));
    expect(trecho.slice(0, 300)).toContain('.maybeSingle()');
  });
});
