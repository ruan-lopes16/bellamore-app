import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// carregarMinhasPermissoes devolve null quando a RPC falha. Cada consumidor mostra erro com
// "Tentar de novo" e não libera nada (nunca cai nos padrões do papel).
const raiz = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');

describe('web: falha das permissões', () => {
  it('getAppContext tipa permissoes como possivelmente null', () => {
    expect(ler('web/lib/auth/server-context.ts')).toContain('permissoes: PermissoesUsuario | null;');
  });
  it('AppLayout troca a página pelo erro e passa "nada liberado" para a Sidebar', () => {
    const s = ler('web/components/AppLayout.tsx');
    expect(s).toContain('<ErroPermissoes />');
    expect(s).toContain('permissoes ? <PrivacyProvider>{children}</PrivacyProvider> : <ErroPermissoes />');
    expect(s).toContain('permissoes={permissoes ?? NADA_LIBERADO}');
  });
  it('o erro tem "Tentar de novo"', () => {
    expect(ler('web/components/ErroPermissoes.tsx')).toContain('Tentar de novo');
  });
  it('exigirAcesso não redireciona com permissões null (a pessoa fica na rota para tentar de novo)', () => {
    expect(ler('web/lib/auth/requireRole.ts')).toMatch(/if \(!permissoes\) return;/);
  });
  it('PermissoesProvider transforma null em nada liberado', () => {
    expect(ler('web/components/PermissoesProvider.tsx')).toContain('value ?? SEM_PERMISSOES');
  });
});

describe('app: falha das permissões', () => {
  const store = ler('mobile/stores/authStore.ts');
  it('authStore expõe permissoesErro e nunca usa os padrões do papel', () => {
    expect(store).toContain('permissoesErro');
    expect(store).not.toContain('permissoesPadrao');
    expect(store).toContain('carregadas ?? PERMISSOES_VAZIAS');
    // Empresas com erro também não liberam nada (sessão incompleta: erro com "Tentar de novo").
    expect(store).toContain('permissoesCarregadas: !erroEmpresas && carregadas !== null');
    expect(store).toContain("set({ permissoes: PERMISSOES_VAZIAS, permissoesCarregadas: false, permissoesErro: true });");
  });
  it('_layout raiz mostra o erro com "Tentar de novo"', () => {
    expect(ler('mobile/app/_layout.tsx')).toContain('{user && permissoesErro && <ErroPermissoes />}');
    const c = ler('mobile/components/ErroPermissoes.tsx');
    expect(c).toContain('Tentar de novo');
    expect(c).toContain('recarregarPermissoes');
  });
  it('usePermissoes expõe permissoesErro', () => {
    expect(ler('mobile/lib/permissions.ts')).toContain('permissoesErro');
  });
});
