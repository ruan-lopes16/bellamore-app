/**
 * Paridade Configurações / Notificações / Login — parte web (Task 5).
 * Regras puras do web (destino do callback, senha, badges da Sidebar, inscrição de push) e
 * varredura das telas para travar o uso das funções de shared.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { destinoCallback, urlCallback } from '@/lib/auth/destino-pos-login';
import { validarNovaSenha, SENHA_MINIMA } from '@/lib/senha';
import { gravarInscricaoWebPush } from '@/lib/push/inscricao-web';
import { isProtectedAppPath } from '@/lib/auth/proxy-rules';

const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');

// ── Login, convite e cadastro ─────────────────────────────────

describe('destinoCallback', () => {
  it('next interno vale como está', () => {
    expect(destinoCallback('/redefinir-senha', false)).toBe('/redefinir-senha');
    expect(destinoCallback('/convite/aceitar', true)).toBe('/convite/aceitar');
  });
  it('sem next: /dashboard com empresa, /criar-empresa sem', () => {
    expect(destinoCallback(null, true)).toBe('/dashboard');
    expect(destinoCallback(null, false)).toBe('/criar-empresa');
    expect(destinoCallback('', false)).toBe('/criar-empresa');
  });
  it('next externo é ignorado (open redirect)', () => {
    expect(destinoCallback('//evil.com', true)).toBe('/dashboard');
    expect(destinoCallback('https://evil.com', false)).toBe('/criar-empresa');
  });
});

describe('urlCallback', () => {
  it('monta o link do e-mail com next codificado', () => {
    expect(urlCallback('https://app.x', '/criar-empresa')).toBe('https://app.x/auth/callback?next=%2Fcriar-empresa');
  });
  it('next inválido cai no padrão /criar-empresa', () => {
    expect(urlCallback('https://app.x', '//evil.com')).toBe('https://app.x/auth/callback?next=%2Fcriar-empresa');
  });
});

describe('proxy: rotas públicas novas', () => {
  it('/convite/aceitar e /redefinir-senha não exigem login', () => {
    expect(isProtectedAppPath('/convite/aceitar')).toBe(false);
    expect(isProtectedAppPath('/redefinir-senha')).toBe(false);
    expect(isProtectedAppPath('/convite')).toBe(true);
  });
  it('o proxy manda o caminho com a query no next', () => {
    expect(ler('web/proxy.ts')).toContain('pathname + request.nextUrl.search');
  });
});

describe('telas de login', () => {
  it('login respeita next via nextSeguro', () => {
    const src = ler('web/app/login/page.tsx');
    expect(src).toContain("nextSeguro(params.get('next'))");
    expect(src).not.toContain("router.push('/dashboard')");
  });
  it('callback decide o destino por destinoCallback e pelos vínculos ativos', () => {
    const src = ler('web/app/auth/callback/route.ts');
    expect(src).toContain('destinoCallback(');
    expect(src).toContain('carregarVinculosAtivos(');
  });
  it('cadastro e verificar-email passam next explícito', () => {
    expect(ler('web/app/cadastro/page.tsx')).toContain('urlCallback(window.location.origin');
    const ver = ler('web/app/verificar-email/page.tsx');
    expect(ver).toContain('urlCallback(window.location.origin');
    expect(ver).not.toMatch(/\/auth\/callback`/);
  });
  it('/criar-empresa redireciona quem já tem vínculo ativo', () => {
    const src = ler('web/app/criar-empresa/page.tsx');
    expect(src).toContain('carregarVinculosAtivos(');
    expect(src).toContain("redirect('/dashboard')");
    expect(src).toMatch(/<ConvitesRecebidosBanner\s+semEmpresa\s*\/>/);
  });
  it('convite sem login mostra "Convite inválido ou expirado"', () => {
    expect(ler('web/app/convite/aceitar/page.tsx')).toContain('Convite inválido ou expirado');
  });
});

// ── Configurações ─────────────────────────────────────────────

describe('validarNovaSenha', () => {
  it('mínimo de 8', () => {
    expect(SENHA_MINIMA).toBe(8);
    expect(validarNovaSenha('1234567', '1234567')).toMatch(/8 caracteres/);
    expect(validarNovaSenha('12345678', '12345678')).toBeNull();
  });
  it('confirmação diferente', () => {
    expect(validarNovaSenha('12345678', '12345679')).toBe('As senhas não coincidem.');
  });
  it('vazia', () => {
    expect(validarNovaSenha('', '')).toMatch(/8 caracteres/);
  });
});

describe('Configurações web', () => {
  const src = ler('web/app/(app)/configuracoes/page.tsx');
  it('troca de senha logada', () => {
    expect(src).toContain('updateUser({ password: novaSenha })');
    expect(src).toContain('validarNovaSenha(novaSenha, novaSenhaConf)');
  });
  it('taxas com parseValorBR', () => {
    expect(src).toContain('parseValorBR(taxaValor)');
    expect(src).toContain('parseValorBR(reservaValor)');
    expect(src).not.toMatch(/parseFloat\(\w+\.replace\(','/);
  });
  it('endereço por shared/endereco (lê o formato antigo também)', () => {
    expect(src).toContain('lerEnderecoEmpresa(empresa.endereco)');
    expect(src).toContain('serializarEnderecoEmpresa(');
    expect(src).not.toContain("endRaw.split(',')");
  });
});

// ── Push preso à empresa ──────────────────────────────────────

function dbFalso(resposta: { data: unknown; error: unknown }) {
  const chamadas: { tabela?: string; linha?: unknown; opcoes?: unknown; select?: string } = {};
  const db = {
    from(tabela: string) {
      chamadas.tabela = tabela;
      return {
        upsert(linha: unknown, opcoes: unknown) {
          chamadas.linha = linha; chamadas.opcoes = opcoes;
          return { select(c: string) { chamadas.select = c; return Promise.resolve(resposta); } };
        },
      };
    },
  };
  return { db, chamadas };
}

describe('gravarInscricaoWebPush', () => {
  const corpo = { endpoint: 'https://push/1', keys: { p256dh: 'p', auth: 'a' } };
  it('upsert por (user_id, endpoint) com a empresa ativa, conferido', async () => {
    const { db, chamadas } = dbFalso({ data: [{ id: 'x' }], error: null });
    await gravarInscricaoWebPush(db, 'u1', 'e2', corpo);
    expect(chamadas.tabela).toBe('web_push_subscriptions');
    expect(chamadas.linha).toEqual({ user_id: 'u1', empresa_id: 'e2', endpoint: 'https://push/1', p256dh: 'p', auth: 'a' });
    expect(chamadas.opcoes).toEqual({ onConflict: 'user_id, endpoint' });
    expect(chamadas.select).toBe('id');
  });
  it('erro do banco lança', async () => {
    const { db } = dbFalso({ data: null, error: { message: 'boom' } });
    await expect(gravarInscricaoWebPush(db, 'u1', 'e2', corpo)).rejects.toThrow();
  });
  it('0 linhas (RLS) lança', async () => {
    const { db } = dbFalso({ data: [], error: null });
    await expect(gravarInscricaoWebPush(db, 'u1', 'e2', corpo)).rejects.toThrow();
  });
  it('corpo inválido lança sem gravar', async () => {
    const { db, chamadas } = dbFalso({ data: [{ id: 'x' }], error: null });
    await expect(gravarInscricaoWebPush(db, 'u1', 'e2', { endpoint: '' })).rejects.toThrow();
    expect(chamadas.tabela).toBeUndefined();
  });
  it('rota confere a gravação e a troca de empresa re-inscreve', () => {
    expect(ler('web/app/api/push/subscribe/route.ts')).toContain('gravarInscricaoWebPush(');
    const sw = ler('web/components/SwRegister.tsx');
    expect(sw).toContain('if (!res.ok)');
    expect(ler('web/components/EmpresaAtivaProvider.tsx')).toContain('sincronizarPushSeAtivo()');
  });
});

// ── Sino e badges da Sidebar ──────────────────────────────────

// A regra (sino = contagemSino da tela, badges por permissão) é testada em
// revisao-config-5-6.test.ts (badgesDoMenu + carregarContagensSino, a mesma do app).
describe('Sidebar', () => {
  it('usa as contagens leves e a regra única de shared, sem contagens próprias', () => {
    const src = ler('web/components/Sidebar.tsx');
    expect(src).toContain('carregarContagensSino(');
    expect(src).toContain('contarAvisosNaoLidos(');
    expect(src).toContain('badgesDoMenu(');
    expect(src).not.toContain("from('comissoes')");
    expect(src).toContain('EVENTO_SINO');
    expect(ler('web/lib/sino.ts')).toContain("from '@shared/notificacoes'");
  });
});

// ── Tela de Notificações ──────────────────────────────────────

describe('Notificações web', () => {
  const src = ler('web/app/(app)/notificacoes/page.tsx');
  it('usa as funções de shared', () => {
    for (const t of ['carregarDadosAlertas(', 'alertasCalculados(', 'carregarAvisos(', 'contarAvisosNaoLidos(',
      'marcarLidas(', 'marcarTodasLidas(', 'rotaDoAviso(', 'rotaDoDestino(', 'TIPOS_NOTIFICACAO', 'VISUAL_ALERTA',
      'rotuloDataHoraBRT(']) expect(src).toContain(t);
  });
  it('duas seções e filtro Não lidas', () => {
    // Textos de shared (TEXTOS_NOTIFICACOES), os mesmos do app.
    expect(src).toContain('{T.secaoAlertas}');
    expect(src).toContain('{T.secaoAvisos}');
    expect(src).toContain('T.filtroNaoLidas');
  });
  it('datas em Brasília (sem hojeStr em UTC)', () => {
    expect(src).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
    expect(src).not.toContain('differenceInDays');
    expect(src).not.toContain("from('notificacoes')");
  });
  it('avisa a Sidebar ao marcar como lida', () => {
    expect(src).toContain('EVENTO_SINO');
  });
});

vi.restoreAllMocks();
