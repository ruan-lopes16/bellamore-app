import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(resolve(__dirname, '../../lib/auth/server-context.ts'), 'utf8');

describe('getAppContext — sessão inválida não derruba a página com "Algo deu errado"', () => {
  it('envolve a leitura de sessão/membro num try/catch', () => {
    expect(src).toMatch(/getAppContext = cache\(async \(\): Promise<AppContext> => \{\s*try \{/);
  });
  it('deixa o redirect() do Next.js atravessar sem ser tratado como erro de sessão', () => {
    expect(src).toContain('isNextRedirectError');
    expect(src).toContain("digest.startsWith('NEXT_REDIRECT')");
    expect(src).toMatch(/if \(isNextRedirectError\(err\)\) throw err;/);
  });
  it('qualquer outro erro cai para /login em vez de propagar', () => {
    const trechoCatch = src.slice(src.indexOf('} catch (err) {'));
    expect(trechoCatch).toContain("redirect('/login');");
  });
});
