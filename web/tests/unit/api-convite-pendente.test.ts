// @vitest-environment node
// web/tests/unit/api-convite-pendente.test.ts
// Entrega 3, Task 2: conta existente sem vínculo ativo nunca é vinculada sem aceite — as rotas POST de
// /api/profissionais e /api/convites gravam o convite pendente (092); PATCH com troca de login grava
// `login_trocado`; DELETE /api/convites cancela pela função da 092. Testes de rota com client falso
// (nada roda contra o banco) + varredura de código.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── Client falso do Supabase ────────────────────────────────────────────────
type Op = { tabela: string; acao: 'select' | 'insert' | 'update' | 'upsert' | 'delete'; payload?: unknown; filtros: [string, unknown][] };
type Resposta = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number };
type Responder = (op: Op) => Resposta | undefined;

let ops: Op[] = [];
let responder: Responder = () => undefined;
let rpcs: { fn: string; args: unknown }[] = [];
let rpcResposta: Resposta = { data: null, error: null };
const auth = {
  createUser: vi.fn(),
  inviteUserByEmail: vi.fn(),
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
};

function builder(tabela: string) {
  const op: Op = { tabela, acao: 'select', filtros: [] };
  let registrado = false;
  const registra = () => { if (!registrado) { ops.push(op); registrado = true; } };
  const resolve = (): Promise<Resposta> => {
    registra();
    const r = responder(op) ?? { data: null, error: null };
    return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count });
  };
  const q: Record<string, unknown> = {
    select() { return q; },
    insert(p: unknown) { op.acao = 'insert'; op.payload = p; return q; },
    update(p: unknown) { op.acao = 'update'; op.payload = p; return q; },
    upsert(p: unknown) { op.acao = 'upsert'; op.payload = p; return q; },
    delete() { op.acao = 'delete'; return q; },
    eq(c: string, v: unknown) { op.filtros.push([c, v]); return q; },
    neq(c: string, v: unknown) { op.filtros.push([`!${c}`, v]); return q; },
    ilike(c: string, v: unknown) { op.filtros.push([`~${c}`, v]); return q; },
    limit() { return q; },
    maybeSingle: resolve,
    single: resolve,
    then(ok: (r: Resposta) => unknown, err?: (e: unknown) => unknown) { return resolve().then(ok, err); },
  };
  return q;
}

const admin = { from: (t: string) => builder(t), auth: { admin: auth }, rpc: vi.fn() };
const usuarioDb = {
  rpc: vi.fn(async (fn: string, args: unknown) => { rpcs.push({ fn, args }); return rpcResposta; }),
};

vi.mock('@supabase/supabase-js', () => ({ createClient: () => admin }));
vi.mock('@/lib/auth/quem-chama', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/quem-chama')>()),
  quemChama: vi.fn(async () => 'req'),
  clienteComoQuemChama: vi.fn(async () => usuarioDb),
}));
const perms = { isOwner: true, chaves: ['equipe.gerenciar'] as string[] };
vi.mock('@shared/permissoes-consultas', () => ({ carregarPermissoesDoMembro: vi.fn(async () => perms) }));

import { POST as postProfissionais, PATCH as patchProfissionais } from '@/app/api/profissionais/route';
import { POST as postConvites, DELETE as deleteConvites } from '@/app/api/convites/route';
import { faltaMigration092, gravarConvitePendente, ERRO_SEM_MIGRATION_092 } from '@/lib/equipe/convite-pendente';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const req = (corpo: unknown): any => ({ json: async () => corpo, url: 'http://app.test/api/x', headers: new Headers() });

const EMP = 'emp-1';
const ALVO = 'alvo-1';
const CONVITE = { id: 'conv-1', user_id: ALVO, email: 'thalia@x.com', nome: 'Thalia', role: 'profissional',
  percentual_comissao: 40, tipo_contrato: 'pj', convidado_por: 'req', criado_em: '2026-10-16T12:00:00Z' };

type Cenario = {
  vinculo?: { role: string; percentual_comissao: number; tipo_contrato: string | null; ativo: boolean } | null;
  pendente?: { id: string; role: string } | null;
  semMigration?: boolean;
  ownerId?: string;
  requesterRole?: string;
};

function cenario(c: Cenario) {
  responder = (op) => {
    const f = Object.fromEntries(op.filtros);
    if (op.tabela === 'empresa_membros' && op.acao === 'select') {
      if (f.user_id === 'req') return { data: { empresa_id: EMP, role: c.requesterRole ?? 'owner', empresa: { nome: 'Bellamore' } } };
      if (f.user_id === ALVO) return { data: c.vinculo ? { id: 'mem-1', ...c.vinculo } : null };
    }
    if (op.tabela === 'empresas') return { data: { owner_id: c.ownerId ?? 'req' } };
    if (op.tabela === 'users' && op.acao === 'select') return { data: { id: ALVO } };
    if (op.tabela === 'convites_equipe') {
      if (c.semMigration) return { error: { code: 'PGRST205', message: "Could not find the table 'public.convites_equipe'" } };
      if (op.acao === 'select') return { data: c.pendente ?? null };
      return { data: { ...CONVITE, ...(op.payload as object) } };
    }
    if (op.tabela === 'empresa_membros' && op.acao === 'upsert') {
      return { data: { id: 'mem-1', user_id: ALVO, ...(op.payload as object) } };
    }
    return undefined;
  };
}

const escritasEmMembros = () => ops.filter(o => o.tabela === 'empresa_membros' && o.acao !== 'select');
const escritasConvite = () => ops.filter(o => o.tabela === 'convites_equipe' && o.acao !== 'select');

const ROTAS = [
  ['profissionais', postProfissionais, { senha: '123456' }],
  ['convites', postConvites, {}],
] as const;

beforeEach(() => {
  ops = []; rpcs = []; rpcResposta = { data: null, error: null };
  perms.isOwner = true; perms.chaves = ['equipe.gerenciar'];
  vi.clearAllMocks();
  // Conta já existe: createUser recusa (profissionais) e users devolve a conta (convites).
  auth.createUser.mockResolvedValue({ data: null, error: { message: 'A user with this email address has already been registered' } });
  auth.inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'novo' } }, error: null });
});

describe.each(ROTAS)('POST /api/%s — conta existente', (_n, POST, extra) => {
  const corpo = (o: Record<string, unknown> = {}) => ({ empresaId: EMP, nome: ' Thalia ', email: 'Thalia@X.com', ...extra, ...o });

  it('sem vínculo: grava convite pendente e nunca escreve em empresa_membros', async () => {
    cenario({ vinculo: null });
    const r = await POST(req(corpo({ percentual_comissao: 40, tipo_contrato: 'pj' })));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.status).toBe('convite_pendente');
    expect(json.convite.id).toBe('conv-1');
    expect(escritasEmMembros()).toEqual([]);
    const [ins] = escritasConvite();
    expect(ins.acao).toBe('insert');
    expect(ins.payload).toMatchObject({ empresa_id: EMP, user_id: ALVO, status: 'pendente', email: 'thalia@x.com',
      nome: 'Thalia', role: 'profissional', percentual_comissao: 40, tipo_contrato: 'pj', convidado_por: 'req' });
  });

  it('vínculo inativo: não reativa; convite com o papel do vínculo e comissão/contrato preservados', async () => {
    cenario({ vinculo: { role: 'gestor', percentual_comissao: 35, tipo_contrato: 'clt', ativo: false } });
    const r = await POST(req(corpo({ role: 'profissional' })));
    expect((await r.json()).status).toBe('convite_pendente');
    expect(escritasEmMembros()).toEqual([]);
    expect(escritasConvite()[0].payload).toMatchObject({ role: 'gestor', percentual_comissao: 35, tipo_contrato: 'clt' });
  });

  it('pendente já existe: atualiza a linha (sem novo INSERT)', async () => {
    cenario({ vinculo: null, pendente: { id: 'conv-1', role: 'profissional' } });
    const r = await POST(req(corpo({ percentual_comissao: 50 })));
    expect(r.status).toBe(200);
    const w = escritasConvite();
    expect(w).toHaveLength(1);
    expect(w[0].acao).toBe('update');
    expect(w[0].filtros).toEqual(expect.arrayContaining([['id', 'conv-1'], ['status', 'pendente']]));
    expect(escritasEmMembros()).toEqual([]);
  });

  it('sem a 092: 503 com a mensagem da migration, sem vincular', async () => {
    cenario({ vinculo: null, semMigration: true });
    const r = await POST(req(corpo()));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe('Atualização do banco pendente: peça para rodar a migration 092.');
    expect(escritasEmMembros()).toEqual([]);
  });

  it('gestora não convida de novo uma gestora inativa, nem altera o pendente de gestora', async () => {
    perms.isOwner = false;
    cenario({ vinculo: { role: 'gestor', percentual_comissao: 0, tipo_contrato: null, ativo: false }, requesterRole: 'gestor', ownerId: 'dona' });
    expect((await POST(req(corpo()))).status).toBe(403);
    cenario({ vinculo: null, pendente: { id: 'conv-1', role: 'gestor' }, requesterRole: 'gestor', ownerId: 'dona' });
    const r = await POST(req(corpo()));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe('Só a dona pode alterar o convite de uma gestora.');
    expect(escritasConvite()).toEqual([]);
    expect(escritasEmMembros()).toEqual([]);
  });

  it('gestora não convida gestora nem a dona', async () => {
    perms.isOwner = false;
    cenario({ vinculo: null, requesterRole: 'gestor', ownerId: 'dona' });
    expect((await POST(req(corpo({ role: 'gestor' })))).status).toBe(403);
    cenario({ vinculo: null, requesterRole: 'gestor', ownerId: ALVO });
    expect((await POST(req(corpo()))).status).toBe(403);
    expect(escritasConvite()).toEqual([]);
  });

  it('vínculo ativo: mantém o comportamento de antes (atualiza o vínculo, sem convite)', async () => {
    cenario({ vinculo: { role: 'profissional', percentual_comissao: 30, tipo_contrato: null, ativo: true } });
    const r = await POST(req(corpo()));
    const json = await r.json();
    expect(json.status).toBe('adicionado');
    expect(escritasConvite()).toEqual([]);
    expect(escritasEmMembros()[0].acao).toBe('upsert');
    expect(escritasEmMembros()[0].payload).toMatchObject({ percentual_comissao: 30, role: 'profissional' });
  });
});

describe('POST — conta nova continua com vínculo na hora', () => {
  it('profissionais: cria a conta e o vínculo', async () => {
    auth.createUser.mockResolvedValue({ data: { user: { id: ALVO } }, error: null });
    cenario({ vinculo: null });
    const r = await postProfissionais(req({ empresaId: EMP, nome: 'Ana', email: 'ana@x.com', senha: '123456' }));
    expect((await r.json()).status).toBe('criado');
    expect(escritasEmMembros().map(o => o.acao)).toEqual(['upsert']);
    expect(escritasConvite()).toEqual([]);
  });
  it('convites: envia o convite do Supabase e vincula', async () => {
    auth.inviteUserByEmail.mockResolvedValue({ data: { user: { id: ALVO } }, error: null });
    cenario({ vinculo: null });
    responder = ((base) => (op: Op) => (op.tabela === 'users' && op.acao === 'select' ? { data: null } : base(op)))(responder);
    const r = await postConvites(req({ empresaId: EMP, nome: 'Ana', email: 'ana@x.com' }));
    expect((await r.json()).status).toBe('convite_enviado');
    expect(escritasEmMembros().map(o => o.acao)).toEqual(['upsert']);
    expect(escritasConvite()).toEqual([]);
  });
});

describe('PATCH /api/profissionais — troca de login vai para o histórico', () => {
  function cenarioPatch(erroHistorico?: { code: string; message: string }) {
    responder = (op) => {
      const f = Object.fromEntries(op.filtros);
      if (op.tabela === 'empresas' && op.acao === 'select') {
        if (f.owner_id) return { count: 0 };
        return { data: { owner_id: 'req' } };
      }
      if (op.tabela === 'empresa_membros' && op.acao === 'select') {
        if (f['!empresa_id']) return { count: 0 };
        if (f.user_id === 'req') return { data: { id: 'mem-req' } };
        return { data: { id: 'mem-1', role: 'profissional' } };
      }
      if (op.tabela === 'users' && op.acao === 'select') return { data: [] };
      if (op.tabela === 'equipe_historico') return { error: erroHistorico ?? null };
      return undefined;
    };
    auth.getUserById.mockResolvedValue({ data: { user: { email: 'antigo@x.com' } }, error: null });
    auth.updateUserById.mockResolvedValue({ data: {}, error: null });
  }
  const corpo = { empresaId: EMP, userId: ALVO, membroId: 'mem-1', email: 'Novo@X.com' };

  it('grava login_trocado com de/para e quem fez', async () => {
    cenarioPatch();
    const r = await patchProfissionais(req(corpo));
    expect(r.status).toBe(200);
    const hist = ops.filter(o => o.tabela === 'equipe_historico');
    expect(hist).toHaveLength(1);
    expect(hist[0].payload).toEqual({ empresa_id: EMP, alvo_user_id: ALVO, acao: 'login_trocado',
      detalhe: { de: 'antigo@x.com', para: 'novo@x.com' }, feito_por: 'req' });
  });

  it('falha do histórico (ou sem a 092) não desfaz a troca já feita', async () => {
    cenarioPatch({ code: 'PGRST205', message: 'Could not find the table' });
    expect((await patchProfissionais(req(corpo))).status).toBe(200);
  });

  it('sem troca de e-mail não grava histórico', async () => {
    cenarioPatch();
    auth.getUserById.mockResolvedValue({ data: { user: { email: 'novo@x.com' } }, error: null });
    await patchProfissionais(req(corpo));
    expect(ops.filter(o => o.tabela === 'equipe_historico')).toEqual([]);
  });
});

describe('DELETE /api/convites — cancelar convite', () => {
  it('chama cancelar_convite como quem chama', async () => {
    const r = await deleteConvites(req({ empresaId: EMP, conviteId: 'conv-1' }));
    expect(r.status).toBe(200);
    expect(rpcs).toEqual([{ fn: 'cancelar_convite', args: { p_empresa: EMP, p_convite: 'conv-1' } }]);
  });
  it('corpo incompleto → 400', async () => {
    expect((await deleteConvites(req({ empresaId: EMP }))).status).toBe(400);
    expect(rpcs).toEqual([]);
  });
  it('sem a 092 → 503', async () => {
    rpcResposta = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    const r = await deleteConvites(req({ empresaId: EMP, conviteId: 'conv-1' }));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe(ERRO_SEM_MIGRATION_092);
  });
  it('sem permissão (42501) → 403 em português', async () => {
    rpcResposta = { data: null, error: { code: '42501', message: 'Sem permissão para gerenciar a equipe.' } };
    const r = await deleteConvites(req({ empresaId: EMP, conviteId: 'conv-1' }));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe('Você não tem permissão para cancelar o convite. Fale com a dona ou a gestora.');
  });
  it('erro de regra (P0001) volta com a mensagem do banco', async () => {
    rpcResposta = { data: null, error: { code: 'P0001', message: 'Só a dona pode cancelar o convite de uma gestora.' } };
    const r = await deleteConvites(req({ empresaId: EMP, conviteId: 'conv-1' }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('Só a dona pode cancelar o convite de uma gestora.');
  });
});

describe('faltaMigration092 e gravarConvitePendente', () => {
  it('só pelo código, nunca por texto solto nem 42883', () => {
    expect(faltaMigration092({ code: 'PGRST205' })).toBe(true);
    expect(faltaMigration092({ code: 'PGRST202' })).toBe(true);
    expect(faltaMigration092({ code: '42P01' })).toBe(true);
    expect(faltaMigration092({ code: '42883', message: 'function does not exist' })).toBe(false);
    expect(faltaMigration092({ code: 'XX000', message: 'Could not find the table convites_equipe' })).toBe(false);
    expect(faltaMigration092(null)).toBe(false);
  });
  it('INSERT concorrente (23505) → 409; pendente respondido no meio → 409', async () => {
    const base = { empresaId: EMP, userId: ALVO, email: 'a@x.com', nome: 'A', role: 'profissional' as const,
      percentual_comissao: 0, tipo_contrato: null, convidadoPor: 'req', quemConvidaEhDona: true };
    responder = (op) => (op.acao === 'select' ? { data: null } : { error: { code: '23505', message: 'duplicate key' } });
    expect(await gravarConvitePendente(admin, base)).toMatchObject({ ok: false, status: 409 });
    responder = (op) => (op.acao === 'select' ? { data: { id: 'c', role: 'profissional' } } : { data: null });
    expect(await gravarConvitePendente(admin, base)).toMatchObject({ ok: false, status: 409 });
  });
});

// ── Varredura de código ─────────────────────────────────────────────────────
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('varredura — caminho de conta existente sem vínculo ativo', () => {
  it('o módulo do convite pendente nunca toca em empresa_membros', () => {
    const src = ler('web/lib/equipe/convite-pendente.ts');
    expect(src).not.toMatch(/from\(\s*['"`]empresa_membros/);
    expect(src).not.toMatch(/\.upsert\(/);
    expect([...src.matchAll(/\.from\(\s*['"`](\w+)['"`]/g)].map(m => m[1])).toEqual(
      ['convites_equipe', 'convites_equipe', 'convites_equipe']);
  });

  it.each(['web/app/api/profissionais/route.ts', 'web/app/api/convites/route.ts'])('%s: o ramo do convite retorna antes de qualquer escrita em empresa_membros', (arq) => {
    const src = ler(arq);
    const ini = src.indexOf('export async function POST(');
    const post = src.slice(ini, src.indexOf('export async function', ini + 10));
    const iRamo = post.indexOf('if (contaExistente && !atual?.ativo) {');
    expect(iRamo).toBeGreaterThan(0);
    const fimRamo = post.indexOf("return NextResponse.json({ status: 'convite_pendente', convite: r.convite });", iRamo);
    expect(fimRamo).toBeGreaterThan(iRamo);
    const ramo = post.slice(iRamo, fimRamo);
    expect(ramo).toContain('gravarConvitePendente(');
    expect(ramo).not.toMatch(/empresa_membros/);
    expect(ramo).not.toMatch(/\.(upsert|update|insert)\(/);
    // Toda escrita em empresa_membros do POST vem depois do ramo (só vínculo ativo ou conta nova chegam lá).
    for (const m of post.matchAll(/\.from\('empresa_membros'\)\s*\.(upsert|update|insert)\(/g)) {
      expect(m.index!).toBeGreaterThan(fimRamo);
    }
    // podeGerenciarMembro vale também para vínculo inativo e conta existente sem vínculo.
    expect(post).toContain('if (atual || contaExistente) {');
    expect(post.indexOf('podeGerenciarMembro(')).toBeLessThan(iRamo);
  });

  it('PATCH grava login_trocado só depois de trocar o login no Auth', () => {
    const src = ler('web/app/api/profissionais/route.ts');
    const patch = src.slice(src.indexOf('export async function PATCH('));
    const iAuth = patch.indexOf('updateUserById(userId, { email: emailNovo');
    const iHist = patch.indexOf(".from('equipe_historico').insert(");
    expect(iHist).toBeGreaterThan(iAuth);
    expect(patch.slice(iHist - 200, iHist)).toContain('if (trocouEmail) {');
    expect(patch).toContain("acao: 'login_trocado'");
    expect(patch).toContain('feito_por: requesterId');
  });

  it('DELETE usa o client de quem chama (auth.uid() na função), não o service role', () => {
    const src = ler('web/app/api/convites/route.ts');
    const del = src.slice(src.indexOf('export async function DELETE('));
    expect(del).toContain('clienteComoQuemChama(req)');
    expect(del).toMatch(/db\.rpc\('cancelar_convite'/);
    expect(del).not.toContain("adminClient.rpc('cancelar_convite'");
  });
});
