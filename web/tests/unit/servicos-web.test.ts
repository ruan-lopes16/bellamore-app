import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { excluirServicoConferido, MSG_SERVICO_USADO } from '@/lib/servicos-web';

const pagina = readFileSync(resolve(__dirname, '../../app/(app)/servicos/page.tsx'), 'utf8');

function dbFake(opts: { rpcErro?: { code?: string; message?: string } | null; usos?: Record<string, number>; apagados?: number }) {
  const chamadas: string[] = [];
  return {
    chamadas,
    rpc: async () => ({ error: opts.rpcErro ?? null }),
    from: (t: string) => ({
      select: () => ({ eq: async () => { chamadas.push('count:' + t); return { count: opts.usos?.[t] ?? 0, error: null }; } }),
      delete: () => ({ eq: () => ({ eq: () => ({ select: async () => { chamadas.push('delete'); return { data: Array.from({ length: opts.apagados ?? 1 }, () => ({ id: 'x' })), error: null }; } }) }) }),
    }),
  };
}

describe('excluirServicoConferido', () => {
  it('usa a função da 096 quando existe', async () => {
    const db = dbFake({});
    await expect(excluirServicoConferido(db, 'e', 's')).resolves.toBeUndefined();
    expect(db.chamadas).toEqual([]);
  });
  it('mostra a mensagem do banco quando o serviço foi usado', async () => {
    const db = dbFake({ rpcErro: { code: 'P0001', message: MSG_SERVICO_USADO } });
    await expect(excluirServicoConferido(db, 'e', 's')).rejects.toThrow(MSG_SERVICO_USADO);
  });
  it('sem a 096, recusa serviço usado sem apagar', async () => {
    const db = dbFake({ rpcErro: { code: 'PGRST202' }, usos: { comanda_itens: 2 } });
    await expect(excluirServicoConferido(db, 'e', 's')).rejects.toThrow(MSG_SERVICO_USADO);
    expect(db.chamadas).not.toContain('delete');
  });
  it('sem a 096, apaga serviço nunca usado e avisa se não apagou nada', async () => {
    const ok = dbFake({ rpcErro: { code: 'PGRST202' } });
    await expect(excluirServicoConferido(ok, 'e', 's')).resolves.toBeUndefined();
    expect(ok.chamadas).toContain('delete');
    const sem = dbFake({ rpcErro: { code: 'PGRST202' }, apagados: 0 });
    await expect(excluirServicoConferido(sem, 'e', 's')).rejects.toThrow('Você não tem permissão para excluir serviços.');
  });
});

describe('tela de Serviços (web)', () => {
  it('usa as regras compartilhadas', () => {
    expect(pagina).toContain('validarServico');
    expect(pagina).toContain('DURACOES_PADRAO');
    expect(pagina).toContain('excluirServicoConferido');
    expect(pagina).not.toContain("supabase.from('servicos').delete()");
  });
  it('confere o erro das cargas de serviços, insumos e produtos', () => {
    expect(pagina).toMatch(/errServs/);
    expect(pagina).toMatch(/errProds/);
    expect(pagina).toMatch(/errIns\w*Carga|errInsCarga/);
  });
});
