import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Task 6 da fase "Paridade Configurações, Notificações e Papéis": push pelo servidor, empresa salva,
// Notificações com alertas e guardas de rota no app. Lê os fontes do app como texto.
const mob = join(__dirname, '..', '..', '..', 'mobile');
const ler = (p: string) => readFileSync(join(mob, p), 'utf8');

describe('app: push pelo servidor sem lembrete dobrado', () => {
  const notif = ler('lib/notifications.ts');
  it('registra o aparelho em push_dispositivos pela função de shared', () => {
    expect(notif).toContain("from '@shared/push-dispositivos'");
    expect(notif).toContain('registrarDispositivoPush(supabase');
    expect(notif).toContain("plataforma: 'expo'");
  });
  it('decide o lembrete local por usarLembreteLocal (só sem a 097)', () => {
    expect(notif).toContain("from '@shared/lembretes-locais'");
    expect(notif).toContain('usarLembreteLocal(');
  });
  it('registrado no servidor cancela os lembretes locais já agendados', () => {
    const i = notif.indexOf("resultado === 'registrado'");
    expect(i).toBeGreaterThan(-1);
    expect(notif.slice(i, i + 400)).toContain('cancelarLembretesLocais()');
  });
  it('sem a 097 segue pelo caminho antigo (users.push_token)', () => {
    expect(notif).toMatch(/from\('users'\)[\s\S]*push_token/);
  });
  it('agendarLembretesLocais não agenda nada fora do modo local', () => {
    const i = notif.indexOf('export async function agendarLembretesLocais');
    expect(i).toBeGreaterThan(-1);
    const corpo = notif.slice(i, notif.indexOf('\n}', i));
    expect(corpo).toContain('usarLembreteLocal(');
    expect(corpo.indexOf('usarLembreteLocal(')).toBeLessThan(corpo.indexOf('scheduleNotificationAsync'));
  });
  it('só pede permissão em ativarNotificacoes; a sincronização da abertura nunca pede', () => {
    expect(notif).toMatch(/export async function ativarNotificacoes\(/);
    expect(notif.match(/requestPermissionsAsync/g)?.length).toBe(1);
    const i = notif.indexOf('export async function ativarNotificacoes(');
    expect(notif.slice(i, notif.indexOf('\n}', i))).toContain('pedirPermissao: true');
  });
  it('sem permissão: nenhum lembrete local', () => {
    const i = notif.indexOf("return 'sem_permissao'");
    expect(i).toBeGreaterThan(-1);
    expect(notif.slice(Math.max(0, i - 300), i)).toContain('cancelarLembretesLocais()');
  });
  it('ao sair, tira o aparelho do servidor e cancela os lembretes locais', () => {
    const i = notif.indexOf('export async function desativarPushDoAparelho');
    expect(i).toBeGreaterThan(-1);
    const corpo = notif.slice(i, notif.indexOf('\n}', i));
    expect(corpo).toContain('removerDispositivoPush(supabase');
    expect(corpo).toContain('cancelarLembretesLocais()');
  });
  it('toque na notificação usa rotaDoAviso de shared', () => {
    expect(notif).toContain('rotaDoAviso(');
  });
});

describe('app: _layout raiz', () => {
  const layout = ler('app/_layout.tsx');
  it('não pede permissão automática no login', () => {
    expect(layout).not.toContain('registrarPushToken');
    expect(layout).not.toContain('ativarNotificacoes(');
    expect(layout).not.toContain('requestPermissionsAsync');
  });
  it('sincroniza o aparelho (sem pedir) na abertura e na troca de empresa', () => {
    expect(layout).toMatch(/sincronizarPushDispositivo\(\{[^}]*pedirPermissao: false/);
    expect(layout).toMatch(/\[user\?\.id, empresaAtiva\?\.id\]/);
  });
  it('sessão expirada cancela os lembretes locais', () => {
    const i = layout.indexOf('if (!session)');
    expect(layout.slice(i, layout.indexOf('else if', i))).toContain('cancelarLembretesLocais()');
  });
});

describe('app: sair e empresa salva', () => {
  const store = ler('stores/authStore.ts');
  it('sair tira o aparelho do servidor ANTES do signOut (a RLS precisa da sessão)', () => {
    const i = store.indexOf('sair: async');
    const corpo = store.slice(i, store.indexOf('},', i));
    expect(corpo).toContain('desativarPushDoAparelho()');
    expect(corpo.indexOf('desativarPushDoAparelho()')).toBeLessThan(corpo.indexOf('signOut()'));
  });
  it('empresa escolhida salva em AsyncStorage e lida em carregarSessao', () => {
    expect(store).toContain('STORAGE_EMPRESA_ATIVA');
    expect(store).toContain('AsyncStorage.getItem(STORAGE_EMPRESA_ATIVA)');
    expect(store).toContain('AsyncStorage.setItem(STORAGE_EMPRESA_ATIVA');
    expect(store).toContain('escolherEmpresaAtiva(');
  });
  it('troca de empresa recarrega a sessão', () => {
    expect(store).toMatch(/trocarEmpresa: async[\s\S]*carregarSessao\(\{ manterEmpresaId/);
  });
  it('agenda só agenda lembrete local quando o registro manda', () => {
    expect(ler('app/(empresa)/agenda.tsx')).toContain('agendarLembretesLocais(');
  });
});

describe('app: seletor de empresa nos dois menus', () => {
  it('componente único, só com 2+ empresas, que troca pela store e invalida as queries', () => {
    const c = ler('components/SeletorEmpresa.tsx');
    expect(c).toContain('empresasDisponiveis.length < 2');
    expect(c).toContain('trocarEmpresa(');
    expect(c).toContain('invalidateQueries()');
  });
  it('Mais e Início da profissional usam o seletor', () => {
    expect(ler('app/(empresa)/mais.tsx')).toContain('<SeletorEmpresa');
    expect(ler('app/(profissional)/inicio.tsx')).toContain('<SeletorEmpresa');
  });
  it('Mais sem fallback de papel', () => {
    expect(ler('app/(empresa)/mais.tsx')).not.toMatch(/roleAtivo \?\? '(profissional|gestor)'/);
  });
});

describe('app: Notificações com alertas e avisos', () => {
  const hook = ler('hooks/useNotificacoes.ts');
  it('hook usa as consultas e regras de shared', () => {
    for (const f of ['carregarAvisos(', 'contarAvisosNaoLidos(', 'carregarDadosAlertas(', 'marcarLidas(', 'marcarTodasLidas(supabase', 'alertasCalculados(', 'contagemSino(']) {
      expect(hook).toContain(f);
    }
    // Avisos de uma empresa nunca aparecem na outra.
    expect(hook).toContain('empresaId');
    expect(hook).not.toContain(".limit(50)");
  });
  it('uma tela só para as duas áreas, com Alertas, Avisos e filtro Não lidas', () => {
    const t = ler('components/TelaNotificacoes.tsx');
    for (const s of ['Alertas', 'Avisos', 'Não lidas', 'Marcar todas como lidas', 'rotaDoAviso(', 'rotaDoDestino(', 'TIPOS_NOTIFICACAO', 'VISUAL_ALERTA']) {
      expect(t).toContain(s);
    }
    expect(ler('app/(empresa)/notificacoes.tsx')).toContain('area="empresa"');
    expect(ler('app/(profissional)/notificacoes.tsx')).toContain('area="profissional"');
  });
  it('profissional: tela registrada sem aba e sino no Início', () => {
    expect(existsSync(join(mob, 'app/(profissional)/notificacoes.tsx'))).toBe(true);
    expect(ler('app/(profissional)/_layout.tsx')).toMatch(/name="notificacoes"[^/]*href: null/);
    expect(ler('app/(profissional)/inicio.tsx')).toContain("/(profissional)/notificacoes");
    expect(ler('app/(profissional)/inicio.tsx')).toContain('useSino(');
  });
  it('sino da empresa usa contagemSino (avisos + alertas)', () => {
    expect(ler('app/(empresa)/dashboard.tsx')).toContain('useSino(');
  });
  it('badge de comandas não fechadas no menu Mais', () => {
    const m = ler('app/(empresa)/mais.tsx');
    expect(m).toContain("pode('comanda.fechar')");
    expect(m).toContain('useComandasNaoFechadas(');
  });
});

describe('app: guarda de rota por permissão', () => {
  const layout = ler('app/(empresa)/_layout.tsx');
  it('(empresa)/_layout usa permissaoDaRota com os segmentos', () => {
    expect(layout).toContain('permissaoDaRota(');
    expect(layout).toContain('useSegments(');
    expect(layout).toContain('<SemAcesso');
  });
  it('tela Sem acesso com Voltar', () => {
    const s = ler('components/SemAcesso.tsx');
    expect(s).toContain('Sem acesso');
    expect(s).toContain('Voltar');
  });
});
