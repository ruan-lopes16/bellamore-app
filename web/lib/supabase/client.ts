import { createBrowserClient } from '@supabase/ssr';

// Singleton: reutiliza a mesma instância em todo o ciclo de vida do browser.
// Evita recriar conexões a cada render de componente.
let _client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (!_client) {
    _client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _client;
}
