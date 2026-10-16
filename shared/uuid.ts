/**
 * @file uuid.ts
 * Id gerado no cliente (web e app) para gravar uma linha sem precisar ler de volta
 * (`insert` sem `.select()`): o RETURNING exige que a linha nova passe na policy de SELECT,
 * que nem todo papel tem (ex.: `vendas` para a profissional que fecha a própria comanda).
 */

type CryptoMinimo = { randomUUID?: () => string; getRandomValues?: <T extends Uint8Array>(a: T) => T };

let geradorRegistrado: (() => string) | null = null;

/**
 * Registra o gerador de UUID da plataforma (o app registra o `randomUUID` do `expo-crypto` no
 * layout raiz, porque o Hermes não tem `crypto.randomUUID`). `null` volta ao comportamento
 * padrão. O web não registra nada: usa o `crypto.randomUUID` do navegador.
 */
export function registrarGeradorUuid(gerador: (() => string) | null): void {
  geradorRegistrado = gerador;
}

/**
 * UUID v4 (RFC 4122). Ordem: gerador registrado (`registrarGeradorUuid`), `crypto.randomUUID`
 * (navegador), `crypto.getRandomValues` e, por último, `Math.random` (só se nada existir — o app
 * registra o expo-crypto na inicialização). Não é segredo (só chave primária); uma colisão,
 * improvável, viraria erro de chave duplicada no INSERT, que a tela já confere.
 */
export function novoUuid(): string {
  if (geradorRegistrado) return geradorRegistrado();
  const c = (globalThis as { crypto?: CryptoMinimo }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versão 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
