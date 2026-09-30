import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

/** Rotas de um grupo (caminho relativo sem .tsx, com "/"), percorrendo subpastas; ignora _layout. */
function rotasDoGrupo(grupo: string): string[] {
  const base = join(root, 'mobile/app', grupo);
  const out: string[] = [];
  const andar = (dir: string, prefixo: string) => {
    for (const n of readdirSync(dir)) {
      const caminho = join(dir, n);
      if (statSync(caminho).isDirectory()) andar(caminho, `${prefixo}${n}/`);
      else if (n.endsWith('.tsx') && n !== '_layout.tsx') out.push(prefixo + n.replace(/\.tsx$/, ''));
    }
  };
  andar(base, '');
  return out;
}

describe('navegação do app nativo', () => {
  for (const grupo of ['(empresa)', '(profissional)']) {
    it(`${grupo}: toda rota está declarada no Tabs (as que não são aba com href: null)`, () => {
      const layout = ler(`mobile/app/${grupo}/_layout.tsx`);
      for (const rota of rotasDoGrupo(grupo)) {
        // aceita name="rota" ou 'rota' dentro da lista mapeada para <Tabs.Screen>
        const escapada = rota.replace(/[[\]]/g, (c) => `\\${c}`);
        expect(layout, `rota ${rota} não declarada`).toMatch(new RegExp(`["']${escapada}["']`));
      }
    });
  }

  it('existe mobile/app/index.tsx', () => {
    expect(existsSync(join(root, 'mobile/app/index.tsx'))).toBe(true);
  });

  it('root layout só recarrega sessão em SIGNED_IN/INITIAL_SESSION (não em TOKEN_REFRESHED/USER_UPDATED)', () => {
    const src = ler('mobile/app/_layout.tsx');
    expect(src).toMatch(/event === 'SIGNED_IN'|\['SIGNED_IN'/);
    expect(src).toContain('INITIAL_SESSION');
  });

  it('sessão expirada limpa o estado local antes de ir para o login', () => {
    const src = ler('mobile/app/_layout.tsx');
    const i = src.indexOf('if (!session)');
    expect(i).toBeGreaterThan(-1);
    const bloco = src.slice(i, src.indexOf('else if', i));
    expect(bloco).toContain('limparSessao()');
    expect(bloco.indexOf('limparSessao')).toBeLessThan(bloco.indexOf("router.replace('/(auth)/login')"));
    expect(ler('mobile/stores/authStore.ts')).toMatch(/limparSessao: \(\) =>/);
  });

  it('papel desconhecido falha fechado (profissional), nunca gestor', () => {
    for (const arq of ['mobile/app/(empresa)/_layout.tsx', 'mobile/app/(empresa)/mais.tsx', 'mobile/app/(empresa)/dashboard.tsx']) {
      expect(ler(arq)).not.toMatch(/roleAtivo \?\? 'gestor'/);
    }
  });

  it('rotaParaNotificacao só aponta para rotas que existem', () => {
    const src = ler('mobile/lib/notifications.ts');
    expect(src).not.toContain('/(profissional)/financeiro');
    expect(src).not.toContain('${base}/notificacoes');
  });
});
