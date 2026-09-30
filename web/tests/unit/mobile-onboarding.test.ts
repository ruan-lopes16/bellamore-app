import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('onboarding do app nativo igual ao web', () => {
  it('register não insere em users (o trigger handle_new_user já cria) e manda nome no metadata', () => {
    const src = ler('mobile/app/(auth)/register.tsx');
    expect(src).not.toMatch(/from\('users'\)\s*\.insert/);
    expect(src).toMatch(/options:\s*\{[\s\S]*data:\s*\{[\s\S]*nome/);
    expect(src).toContain('emailRedirectTo');
    expect(src).toMatch(/confirmar|confirmacao/i);
  });
  it('telas de verificar e-mail e criar empresa existem', () => {
    expect(existsSync(join(root, 'mobile/app/(auth)/verificar-email.tsx'))).toBe(true);
    expect(existsSync(join(root, 'mobile/app/criar-empresa.tsx'))).toBe(true);
  });
  it('criar-empresa usa a mesma RPC do web', () => {
    expect(ler('mobile/app/criar-empresa.tsx')).toContain("rpc('criar_empresa_completo'");
  });
  it('root layout manda quem não tem empresa para criar-empresa', () => {
    const src = ler('mobile/app/_layout.tsx');
    expect(src).toContain('semEmpresa');
    expect(src).toContain("'/criar-empresa'");
  });
  it('redirect do root layout depende de user?.id, não do objeto user', () => {
    const src = ler('mobile/app/_layout.tsx');
    expect(src).toMatch(/\[user\?\.id,\s*roleAtivo,\s*isOwner,\s*semEmpresa\]/);
  });
  it('login mostra mensagem genérica (não o erro cru do Supabase)', () => {
    expect(ler('mobile/app/(auth)/login.tsx')).toContain('E-mail ou senha incorretos.');
  });
});
