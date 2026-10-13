import { afterEach, describe, expect, it, vi } from 'vitest';
import { novoUuid } from '@shared/uuid';

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
