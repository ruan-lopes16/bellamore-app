import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { decidirDestinoSessao } from '@shared/destino-sessao';

const ler = (p: string) => readFileSync(resolve(__dirname, '../../..', p), 'utf8');

describe('decidirDestinoSessao', () => {
  it('sem sessão vai para o login', () => {
    expect(decidirDestinoSessao({ temSessao: false, erroVinculos: false, temVinculo: false })).toBe('login');
  });
  it('erro ao ler os vínculos é estado próprio, nunca login nem criar-empresa', () => {
    expect(decidirDestinoSessao({ temSessao: true, erroVinculos: true, temVinculo: false })).toBe('erro-vinculos');
    expect(decidirDestinoSessao({ temSessao: true, erroVinculos: true, temVinculo: true })).toBe('erro-vinculos');
  });
  it('sem vínculo (lido com sucesso) vai criar a empresa; com vínculo entra no app', () => {
    expect(decidirDestinoSessao({ temSessao: true, erroVinculos: false, temVinculo: false })).toBe('criar-empresa');
    expect(decidirDestinoSessao({ temSessao: true, erroVinculos: false, temVinculo: true })).toBe('app');
  });
});

describe('erro nos vínculos — fiação (web e app)', () => {
  it('getAppContext usa a decisão e não manda o erro de vínculos para /login', () => {
    const s = ler('web/lib/auth/server-context.ts');
    expect(s).toContain('decidirDestinoSessao');
    expect(s).toContain('ErroVinculosError');
    expect(s).toMatch(/if \(err instanceof ErroVinculosError\) throw err;/);
  });
  it('AppLayout mostra ErroVinculos com título, "Tentar de novo" e "Sair"', () => {
    expect(ler('web/components/AppLayout.tsx')).toContain('<ErroVinculos />');
    const c = ler('web/components/ErroVinculos.tsx');
    expect(c).toContain('TITULO_ERRO_VINCULOS');
    expect(c).toContain('Tentar de novo');
    expect(c).toContain('Sair');
    expect(c).toContain('desinscreverPushDoNavegador');
    expect(c.indexOf('desinscreverPushDoNavegador(')).toBeLessThan(c.indexOf('signOut('));
  });
  it('app: erroEmpresas mostra o erro de empresas com "Tentar de novo" e "Sair"', () => {
    const c = ler('mobile/components/ErroPermissoes.tsx');
    expect(c).toContain('TITULO_ERRO_VINCULOS');
    expect(c).toContain('Tentar de novo');
    expect(c).toContain('Sair');
    expect(ler('mobile/app/_layout.tsx')).toContain("if (destino === 'erro-vinculos') return;");
  });
});

describe('convite — a empresa ativa só muda depois do aceite', () => {
  it('web: /convite/aceitar só troca a empresa depois de definir a senha', () => {
    const s = ler('web/app/convite/aceitar/page.tsx');
    const troca = s.indexOf('trocarEmpresaAtiva(');
    expect(troca).toBeGreaterThan(-1);
    expect(troca).toBeGreaterThan(s.indexOf('auth.updateUser('));
    expect(s.indexOf("fetch('/api/empresa-ativa')")).toBeLessThan(s.indexOf('auth.updateUser('));
    expect(s.match(/trocarEmpresaAtiva\(/g)).toHaveLength(1);
  });
  it('app: o banner só recarrega a sessão com a empresa nova depois de aceitarConvite', () => {
    const s = ler('mobile/components/BannerConvites.tsx');
    expect(s.indexOf('aceitarConvite(supabase')).toBeLessThan(s.indexOf('carregarSessao({ manterEmpresaId: empresaId })'));
  });
});
