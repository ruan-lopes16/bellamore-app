type RedirectCheckInput = {
  pathname: string;
  cookieNames: Iterable<string>;
  supabaseUrl?: string;
};

const PUBLIC_PREFIXES = [
  '/login',
  '/cadastro',
  '/verificar-email',
  '/auth/callback',
  '/offline',
];

export function getSupabaseAuthCookieBaseName(supabaseUrl?: string): string | null {
  if (!supabaseUrl) return null;

  try {
    const hostname = new URL(supabaseUrl).hostname;
    const projectRef = hostname.split('.')[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

export function hasSupabaseAuthCookie(
  cookieNames: Iterable<string>,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
) {
  const expectedBaseName = getSupabaseAuthCookieBaseName(supabaseUrl);

  for (const name of cookieNames) {
    if (expectedBaseName) {
      if (name === expectedBaseName || name.startsWith(`${expectedBaseName}.`)) {
        return true;
      }
      continue;
    }

    if (/^sb-[a-z0-9_-]+-auth-token(?:\.\d+)?$/i.test(name)) {
      return true;
    }
  }

  return false;
}

export function isProtectedAppPath(pathname: string) {
  if (pathname === '/') return false;
  if (pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/_next/')) return false;
  if (pathname.includes('.')) return false;

  return !PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function shouldRedirectToLogin({
  pathname,
  cookieNames,
  supabaseUrl,
}: RedirectCheckInput) {
  return isProtectedAppPath(pathname) && !hasSupabaseAuthCookie(cookieNames, supabaseUrl);
}
