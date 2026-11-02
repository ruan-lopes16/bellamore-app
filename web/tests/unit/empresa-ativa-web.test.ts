// web/tests/unit/empresa-ativa-web.test.ts
// Empresa ativa no web: resolução no servidor (cookie validado contra vínculos ativos), cookie
// seguro, telas lendo do contexto em vez de `.limit(1)`, seletor e convite aceito em outra empresa.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  carregarVinculosAtivos, resolverEmpresaAtiva, opcoesCookieEmpresaAtiva,
} from '@/lib/auth/empresa-ativa';
import { COOKIE_EMPRESA_ATIVA } from '@shared/empresa-ativa';
import { mensagemConviteAceitoOutraEmpresa } from '@shared/convites-consultas';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

type Linha = Record<string, unknown>;

/** Fake mínimo do supabase-js: registra os filtros/ordens e devolve as linhas. */
function fakeDb(linhas: Linha[], error: { message: string } | null = null) {
  const chamadas: string[] = [];
  const q: Record<string, unknown> = {};
  const enc = (nome: string) => (...args: unknown[]) => { chamadas.push(`${nome}:${JSON.stringify(args)}`); return q; };
  for (const n of ['select', 'eq', 'order', 'range', 'limit']) q[n] = enc(n);
  q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: error ? null : linhas, error }).then(res);
  return { db: { from: (t: string) => { chamadas.push(`from:${t}`); return q; } }, chamadas };
}

const emp = (id: string, nome = `Empresa ${id}`) => ({ id, nome, logo_url: null, segmento: null, meta_mensal: null });
const linhas: Linha[] = [
  { id: 'm2', empresa_id: 'B', role: 'profissional', created_at: '2026-05-01T00:00:00Z', empresa: emp('B') },
  { id: 'm1', empresa_id: 'A', role: 'owner', created_at: '2026-01-01T00:00:00Z', empresa: emp('A') },
];

describe('carregarVinculosAtivos', () => {
  it('só vínculos ativos da pessoa, em ordem determinística, sem .limit(1)', async () => {
    const { db, chamadas } = fakeDb(linhas);
    const r = await carregarVinculosAtivos(db, 'u1');
    expect(r.map(v => v.empresa_id)).toEqual(['B', 'A']);
    expect(chamadas).toContain('from:empresa_membros');
    expect(chamadas).toContain('eq:["user_id","u1"]');
    expect(chamadas).toContain('eq:["ativo",true]');
    expect(chamadas.some(c => c.startsWith('order:["created_at"'))).toBe(true);
    expect(chamadas.some(c => c.startsWith('order:["id"'))).toBe(true);
    expect(chamadas.some(c => c.startsWith('limit:'))).toBe(false);
  });
  it('descarta vínculo sem empresa (empresa apagada / RLS)', async () => {
    const { db } = fakeDb([...linhas, { id: 'm3', empresa_id: 'C', role: 'gestor', created_at: null, empresa: null }]);
    expect((await carregarVinculosAtivos(db, 'u1')).map(v => v.empresa_id)).toEqual(['B', 'A']);
  });
  it('erro do banco lança (nunca vira "sem empresa")', async () => {
    const { db } = fakeDb([], { message: 'boom' });
    await expect(carregarVinculosAtivos(db, 'u1')).rejects.toThrow();
  });
});

describe('resolverEmpresaAtiva', () => {
  it('cookie com vínculo ativo vence', async () => {
    const { db } = fakeDb(linhas);
    const r = await resolverEmpresaAtiva(db, 'u1', 'B');
    expect(r.ativo?.empresa_id).toBe('B');
    expect(r.ativo?.role).toBe('profissional');
    expect(r.vinculos).toHaveLength(2);
  });
  it('cookie de empresa sem vínculo cai na mais antiga', async () => {
    const { db } = fakeDb(linhas);
    expect((await resolverEmpresaAtiva(db, 'u1', 'Z')).ativo?.empresa_id).toBe('A');
  });
  it('sem cookie → mais antiga; sem vínculos → null', async () => {
    expect((await resolverEmpresaAtiva(fakeDb(linhas).db, 'u1', null)).ativo?.empresa_id).toBe('A');
    expect((await resolverEmpresaAtiva(fakeDb([]).db, 'u1', 'A')).ativo).toBeNull();
  });
});

describe('cookie da empresa ativa', () => {
  it('httpOnly, sameSite lax, path /, secure só em produção', () => {
    expect(opcoesCookieEmpresaAtiva(true)).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: true });
    expect(opcoesCookieEmpresaAtiva(false)).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: false });
    expect(opcoesCookieEmpresaAtiva(true).maxAge).toBeGreaterThan(60 * 60 * 24 * 30);
  });
  it('getAppContext lê o cookie e resolve pela função única', () => {
    const src = ler('web/lib/auth/server-context.ts');
    expect(src).toContain('COOKIE_EMPRESA_ATIVA');
    expect(src).toContain('resolverEmpresaAtiva(');
    expect(src).not.toMatch(/\.limit\(1\)/);
  });
  it('POST /api/empresa-ativa valida o vínculo antes de gravar', () => {
    const src = ler('web/app/api/empresa-ativa/route.ts');
    expect(src).toContain('export async function POST');
    expect(src).toContain('export async function GET');
    expect(src).toContain('carregarVinculosAtivos(');
    expect(src).toContain('opcoesCookieEmpresaAtiva(');
    const iValida = src.indexOf('carregarVinculosAtivos(', src.indexOf('export async function POST'));
    const iGrava = src.indexOf('cookies.set(', src.indexOf('export async function POST'));
    expect(iValida).toBeGreaterThan(0);
    expect(iGrava).toBeGreaterThan(iValida);
    expect(src).toMatch(/status: 403/);
  });
  it('push subscribe usa a empresa ativa', () => {
    const src = ler('web/app/api/push/subscribe/route.ts');
    expect(src).toContain('resolverEmpresaAtiva(');
    expect(src).toContain('COOKIE_EMPRESA_ATIVA');
  });
  it('nome do cookie é o de shared', () => {
    expect(COOKIE_EMPRESA_ATIVA).toBe('bm_empresa');
  });
});

// ── Varredura: nenhuma tela escolhe a empresa com `.limit(1)` em empresa_membros ───────────────
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : arquivos(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

/** Exceções documentadas (arquivo relativo à raiz → motivo). Hoje nenhuma. */
const EXCECOES: Record<string, string> = {};

describe('varredura: sem .limit(1) de empresa_membros em web/app e web/components', () => {
  const todos = [...arquivos(join(root, 'web', 'app')), ...arquivos(join(root, 'web', 'components'))];
  it('cada consulta a empresa_membros não usa .limit(1)', () => {
    const achados: string[] = [];
    for (const f of todos) {
      const rel = relative(root, f).replace(/\\/g, '/');
      if (EXCECOES[rel]) continue;
      const src = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
      // Cada trecho vai de from('empresa_membros') até o próximo `;` ou o próximo `from(`.
      const re = /from\(\s*['"]empresa_membros['"]\s*\)/g;
      for (const m of src.matchAll(re)) {
        const resto = src.slice((m.index ?? 0) + m[0].length);
        const fim = Math.min(...[resto.indexOf(';'), resto.indexOf('from(')].filter(n => n >= 0), resto.length);
        if (/\.limit\(\s*1\s*\)/.test(resto.slice(0, fim))) achados.push(rel);
      }
    }
    expect(achados).toEqual([]);
  });
  it('as telas pegam a empresa do contexto (useEmpresaAtiva)', () => {
    const telas = [
      'vendas/page.tsx', 'pacotes/page.tsx', 'servicos/page.tsx', 'estoque/page.tsx', 'configuracoes/page.tsx',
      'notificacoes/page.tsx', 'comanda/page.tsx', 'equipe/page.tsx', 'comissoes/ComissoesProfissionalView.tsx',
      'comissoes/ComissoesGestorView.tsx', 'relatorios/page.tsx', 'agenda/page.tsx', 'clientes/[id]/page.tsx',
      'clientes/page.tsx', 'financeiro/page.tsx',
    ];
    for (const t of telas) {
      const src = ler(`web/app/(app)/${t}`);
      expect(src, t).toContain('useEmpresaAtiva()');
      expect(src, t).not.toMatch(/\.limit\(1\)\.(single|maybeSingle)\(\)/);
    }
  });
  it('o AppLayout fornece a empresa ativa às telas e os vínculos ao seletor', () => {
    const src = ler('web/components/AppLayout.tsx');
    expect(src).toContain('<EmpresaAtivaProvider');
    expect(src).toMatch(/vinculos=\{/);
  });
});

describe('seletor de empresa', () => {
  const src = ler('web/components/SeletorEmpresa.tsx');
  it('só aparece com 2 vínculos ou mais e recarrega ao trocar', () => {
    expect(src).toMatch(/vinculos\.length < 2\) return null/);
    expect(src).toContain('trocarEmpresaAtiva(novo)');
    expect(ler('web/components/EmpresaAtivaProvider.tsx')).toContain("fetch('/api/empresa-ativa'");
    expect(src).toContain('window.location.reload()');
  });
  it('está na Sidebar', () => {
    expect(ler('web/components/Sidebar.tsx')).toContain('<SeletorEmpresa');
  });
});

describe('convite aceito tendo outra empresa', () => {
  const banner = ler('web/components/ConvitesRecebidosBanner.tsx');
  it('grava a empresa nova como ativa e vai para o painel dela', () => {
    expect(banner).toContain('trocarEmpresaAtiva(c.empresa_id)');
    expect(banner).toContain("window.location.assign('/dashboard')");
  });
  it('se não der para trocar, avisa para escolher no seletor', () => {
    expect(banner).toContain('mensagemConviteAceitoOutraEmpresa(');
    expect(mensagemConviteAceitoOutraEmpresa('Bellamore')).toBe(
      'Convite aceito. Você agora faz parte da equipe de Bellamore. Não foi possível abrir essa empresa agora: '
      + 'escolha-a no seletor de empresa do menu.',
    );
  });
});
