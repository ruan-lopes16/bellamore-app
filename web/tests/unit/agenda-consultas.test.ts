import { describe, expect, it } from 'vitest';
import { carregarPreferenciaAgenda, salvarPreferenciaAgenda, salvarAvaliacao } from '@shared/agenda-consultas';

type Resp = { data: unknown; error: { code?: string; message: string } | null };

/** Client falso: grava a cadeia de cada `from` e responde `resp` no fim (await, maybeSingle ou select pós-upsert). */
function falso(resp: Resp, rpcResp?: Resp) {
  const ops: [string, unknown[]][] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  const builder: Record<string, unknown> = new Proxy({}, {
    get(_a, prop) {
      if (prop === 'then') return (ok: (v: Resp) => unknown) => ok(resp);
      return (...args: unknown[]) => { ops.push([String(prop), args]); return builder; };
    },
  });
  const db = {
    from(t: string) { ops.push(['from', [t]]); return builder; },
    rpc(fn: string, args: unknown) {
      rpcs.push({ fn, args });
      return Promise.resolve(rpcResp ?? { data: null, error: null });
    },
  };
  return { db, ops, rpcs };
}

describe('carregarPreferenciaAgenda', () => {
  it('lê a linha da pessoa na empresa e devolve "todas"', async () => {
    const { db, ops } = falso({ data: { agenda_abre_em: 'todas' }, error: null });
    expect(await carregarPreferenciaAgenda(db, 'e1', 'u1')).toBe('todas');
    expect(ops).toContainEqual(['from', ['empresa_membros']]);
    expect(ops).toContainEqual(['select', ['agenda_abre_em']]);
    expect(ops).toContainEqual(['eq', ['empresa_id', 'e1']]);
    expect(ops).toContainEqual(['eq', ['user_id', 'u1']]);
  });
  it('valor desconhecido ou sem linha vira "propria"', async () => {
    expect(await carregarPreferenciaAgenda(falso({ data: { agenda_abre_em: 'x' }, error: null }).db, 'e1', 'u1')).toBe('propria');
    expect(await carregarPreferenciaAgenda(falso({ data: null, error: null }).db, 'e1', 'u1')).toBe('propria');
  });
  it('coluna ainda não criada (sem a 094: 42703 / PGRST204) vira "propria"', async () => {
    for (const code of ['42703', 'PGRST204']) {
      const { db } = falso({ data: null, error: { code, message: 'column empresa_membros.agenda_abre_em does not exist' } });
      expect(await carregarPreferenciaAgenda(db, 'e1', 'u1')).toBe('propria');
    }
  });
  it('outro erro lança em português (nunca finge a preferência)', async () => {
    const { db } = falso({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } });
    await expect(carregarPreferenciaAgenda(db, 'e1', 'u1')).rejects.toThrow('Sua sessão expirou. Entre de novo.');
  });
});

describe('salvarPreferenciaAgenda', () => {
  it('chama a função da 094 com empresa e valor', async () => {
    const { db, rpcs } = falso({ data: null, error: null }, { data: null, error: null });
    await salvarPreferenciaAgenda(db, 'e1', 'todas');
    expect(rpcs).toEqual([{ fn: 'salvar_preferencia_agenda', args: { p_empresa: 'e1', p_valor: 'todas' } }]);
  });
  it('sem a 094 (PGRST202) avisa que falta a migration', async () => {
    const { db } = falso({ data: null, error: null }, { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(salvarPreferenciaAgenda(db, 'e1', 'propria'))
      .rejects.toThrow('Atualização do banco pendente: peça para rodar a migration 094.');
  });
  it('recusa da função em português passa como veio', async () => {
    const { db } = falso({ data: null, error: null },
      { data: null, error: { code: '42501', message: 'Você não tem permissão para ver a agenda da equipe.' } });
    await expect(salvarPreferenciaAgenda(db, 'e1', 'todas')).rejects.toThrow('Você não tem permissão para ver a agenda da equipe.');
  });
});

describe('salvarAvaliacao', () => {
  const dados = { empresaId: 'e1', agendamentoId: 'a1', clienteId: 'c1', nota: 5, comentario: '  ótimo  ' };

  it('upsert por agendamento_id, sem profissional_id, com .select("id")', async () => {
    const { db, ops } = falso({ data: [{ id: 'av1' }], error: null });
    await salvarAvaliacao(db, dados);
    expect(ops).toContainEqual(['from', ['avaliacoes']]);
    const up = ops.find(([m]) => m === 'upsert')!;
    expect(up[1][0]).toEqual({ empresa_id: 'e1', agendamento_id: 'a1', cliente_id: 'c1', nota: 5, comentario: 'ótimo' });
    expect(up[1][0]).not.toHaveProperty('profissional_id');
    expect(up[1][1]).toEqual({ onConflict: 'agendamento_id' });
    expect(ops).toContainEqual(['select', ['id']]);
  });
  it('comentário vazio vira null', async () => {
    const { db, ops } = falso({ data: [{ id: 'av1' }], error: null });
    await salvarAvaliacao(db, { ...dados, comentario: '   ' });
    expect((ops.find(([m]) => m === 'upsert')![1][0] as { comentario: unknown }).comentario).toBeNull();
  });
  it('nota fora de 1 a 5 é recusada antes de ir ao banco', async () => {
    for (const nota of [0, 6, 2.5, NaN]) {
      const { db, ops } = falso({ data: [{ id: 'av1' }], error: null });
      await expect(salvarAvaliacao(db, { ...dados, nota })).rejects.toThrow('Escolha uma nota de 1 a 5.');
      expect(ops).toHaveLength(0);
    }
  });
  it('0 linhas (RLS) vira aviso de permissão', async () => {
    const { db } = falso({ data: [], error: null });
    await expect(salvarAvaliacao(db, dados))
      .rejects.toThrow('Você não tem permissão para salvar a avaliação. Fale com a dona ou a gestora.');
  });
  it('erro do trigger (P0001) passa em português', async () => {
    const { db } = falso({ data: null, error: { code: 'P0001', message: 'A cliente não confere com a do atendimento.' } });
    await expect(salvarAvaliacao(db, dados)).rejects.toThrow('A cliente não confere com a do atendimento.');
  });
});
