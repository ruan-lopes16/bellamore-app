import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { novoUuid, registrarGeradorUuid } from '@shared/uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('novoUuid', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('usa crypto.randomUUID quando existe', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555' });
    expect(novoUuid()).toBe('11111111-2222-4333-8444-555555555555');
  });
  it('sem randomUUID (Hermes): v4 válido por getRandomValues ou Math.random, sem repetir', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => { a.fill(0xff); return a; } });
    expect(novoUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    vi.stubGlobal('crypto', undefined);
    const ids = new Set(Array.from({ length: 500 }, () => novoUuid()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(V4);
  });
});

describe('registrarGeradorUuid (item 12: expo-crypto no app)', () => {
  afterEach(() => { registrarGeradorUuid(null); vi.unstubAllGlobals(); });
  it('gerador registrado tem prioridade sobre crypto.randomUUID', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555' });
    registrarGeradorUuid(() => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(novoUuid()).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });
  it('sem gerador (ou depois de limpar) volta ao crypto.randomUUID', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555' });
    registrarGeradorUuid(() => 'x');
    registrarGeradorUuid(null);
    expect(novoUuid()).toBe('11111111-2222-4333-8444-555555555555');
  });
  it('o app registra o randomUUID do expo-crypto no layout raiz', () => {
    const layout = readFileSync(resolve(__dirname, '../../../mobile/app/_layout.tsx'), 'utf8');
    expect(layout).toMatch(/import \* as Crypto from 'expo-crypto'|import \{ randomUUID \} from 'expo-crypto'/);
    expect(layout).toMatch(/registrarGeradorUuid\(/);
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../mobile/package.json'), 'utf8'));
    expect(pkg.dependencies['expo-crypto']).toBe('~13.0.2');
  });
});
