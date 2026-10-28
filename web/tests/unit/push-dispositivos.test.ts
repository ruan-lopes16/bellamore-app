import { describe, expect, it } from 'vitest';
import { fakeDb, opsDe } from './fixtures/fake-db';
import { registrarDispositivoPush, removerDispositivoPush, semMigration097 } from '@shared/push-dispositivos';

const E = 'emp-1';

describe('semMigration097', () => {
  it('função ou tabela inexistente no PostgREST (nunca 42883)', () => {
    expect(semMigration097({ code: 'PGRST202', message: 'x' })).toBe(true);
    expect(semMigration097({ code: 'PGRST205', message: 'x' })).toBe(true);
    expect(semMigration097({ code: '42P01', message: 'relation does not exist' })).toBe(true);
    expect(semMigration097({ code: '', message: 'Could not find the table public.push_dispositivos' })).toBe(true);
    expect(semMigration097({ code: '42883', message: 'function does not exist' })).toBe(false);
    expect(semMigration097({ code: '42501', message: 'x' })).toBe(false);
    expect(semMigration097(null)).toBe(false);
  });
});

describe('registrarDispositivoPush', () => {
  it('chama a função da 097 com empresa, plataforma e token sem espaços', async () => {
    const { db, rpcs } = fakeDb({ rpc: () => ({ data: null, error: null }) });
    expect(await registrarDispositivoPush(db, { empresaId: E, plataforma: 'expo', token: '  ExponentPushToken[a] ' })).toBe('registrado');
    expect(rpcs).toEqual([{ fn: 'registrar_push_dispositivo', args: { p_empresa: E, p_plataforma: 'expo', p_token: 'ExponentPushToken[a]' } }]);
  });

  it('sem a 097 (PGRST202): devolve sem_migration para o app usar users.push_token', async () => {
    const { db } = fakeDb();
    expect(await registrarDispositivoPush(db, { empresaId: E, plataforma: 'expo', token: 't' })).toBe('sem_migration');
  });

  it('erro do banco vira mensagem em português (texto próprio da função)', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: null, error: { code: '42501', message: 'Você não tem vínculo ativo com esta empresa.' } }) });
    await expect(registrarDispositivoPush(db, { empresaId: E, plataforma: 'expo', token: 't' }))
      .rejects.toThrow('Você não tem vínculo ativo com esta empresa.');
  });

  it('token vazio ou empresa vazia nem chegam ao banco', async () => {
    const { db, rpcs } = fakeDb({ rpc: () => ({ data: null, error: null }) });
    await expect(registrarDispositivoPush(db, { empresaId: E, plataforma: 'expo', token: '  ' })).rejects.toThrow('Token de notificação vazio.');
    await expect(registrarDispositivoPush(db, { empresaId: '', plataforma: 'expo', token: 't' })).rejects.toThrow('Escolha a empresa antes de ativar as notificações.');
    expect(rpcs).toEqual([]);
  });
});

describe('removerDispositivoPush', () => {
  it('apaga pelo token com .select(\'id\') e devolve as linhas apagadas', async () => {
    const { db, chamadas } = fakeDb({ respostaUpdate: () => ({ data: [{ id: 'd1' }], error: null }) });
    expect(await removerDispositivoPush(db, ' tok ')).toBe(1);
    expect(opsDe(chamadas, 'push_dispositivos')).toEqual([[['delete', []], ['eq', ['token', 'tok']], ['select', ['id']]]]);
  });

  it('aparelho já removido: 0, sem erro', async () => {
    const { db } = fakeDb({ respostaUpdate: () => ({ data: [], error: null }) });
    expect(await removerDispositivoPush(db, 'tok')).toBe(0);
  });

  it('token vazio: 0, sem consulta', async () => {
    const { db, chamadas } = fakeDb();
    expect(await removerDispositivoPush(db, '')).toBe(0);
    expect(chamadas).toEqual([]);
  });

  it('sem a 097: sem_migration; outro erro: lança em português', async () => {
    const sem = fakeDb({ respostaUpdate: () => ({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }) });
    expect(await removerDispositivoPush(sem.db, 'tok')).toBe('sem_migration');
    const falha = fakeDb({ respostaUpdate: () => ({ data: null, error: { code: '57014', message: 'timeout' } }) });
    await expect(removerDispositivoPush(falha.db, 'tok')).rejects.toThrow('O banco demorou demais para responder.');
  });
});
