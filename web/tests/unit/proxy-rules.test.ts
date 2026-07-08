import { describe, expect, it } from 'vitest';
import {
  getSupabaseAuthCookieBaseName,
  hasSupabaseAuthCookie,
  isProtectedAppPath,
  shouldRedirectToLogin,
} from '@/lib/auth/proxy-rules';

const SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';

describe('proxy auth rules', () => {
  it('derives the Supabase auth cookie name from the project URL', () => {
    expect(getSupabaseAuthCookieBaseName(SUPABASE_URL)).toBe(
      'sb-abcdefghijklmnopqrst-auth-token',
    );
  });

  it('detects regular and chunked Supabase auth cookies', () => {
    expect(
      hasSupabaseAuthCookie(['sb-abcdefghijklmnopqrst-auth-token'], SUPABASE_URL),
    ).toBe(true);
    expect(
      hasSupabaseAuthCookie(['sb-abcdefghijklmnopqrst-auth-token.0'], SUPABASE_URL),
    ).toBe(true);
  });

  it('does not treat code verifier cookies as an authenticated session', () => {
    expect(
      hasSupabaseAuthCookie(
        ['sb-abcdefghijklmnopqrst-auth-token-code-verifier'],
        SUPABASE_URL,
      ),
    ).toBe(false);
  });

  it('protects app routes without protecting API and public auth routes', () => {
    expect(isProtectedAppPath('/dashboard')).toBe(true);
    expect(isProtectedAppPath('/clientes/123')).toBe(true);
    expect(isProtectedAppPath('/criar-empresa')).toBe(true);
    expect(isProtectedAppPath('/api/cron/lembretes')).toBe(false);
    expect(isProtectedAppPath('/login')).toBe(false);
    expect(isProtectedAppPath('/cadastro')).toBe(false);
    expect(isProtectedAppPath('/auth/callback')).toBe(false);
    expect(isProtectedAppPath('/offline')).toBe(false);
    expect(isProtectedAppPath('/')).toBe(false);
  });

  it('redirects protected app routes only when no Supabase auth cookie exists', () => {
    expect(
      shouldRedirectToLogin({
        pathname: '/agenda',
        cookieNames: [],
        supabaseUrl: SUPABASE_URL,
      }),
    ).toBe(true);

    expect(
      shouldRedirectToLogin({
        pathname: '/agenda',
        cookieNames: ['sb-abcdefghijklmnopqrst-auth-token'],
        supabaseUrl: SUPABASE_URL,
      }),
    ).toBe(false);
  });
});
