/**
 * Revisão final da branch Paridade Configurações, Notificações e Papéis:
 * - sair do web tira a inscrição de push deste navegador (computador compartilhado: os lembretes
 *   e o resumo da conta anterior não aparecem para quem entrar depois);
 * - senha mínima de shared (8) também no cadastro, na senha definida pela dona na Equipe e no
 *   `POST /api/profissionais` (web e app);
 * - `expo-system-ui` no app, para o modo "Sistema" funcionar no Android.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { removerInscricaoWebPush } from '@/lib/push/inscricao-web';
import { SENHA_MINIMA, validarSenhaMinima } from '@shared/senha';

const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');

function fakeDelete(resposta: { error: { message: string } | null } | Error) {
  const ops: [string, unknown[]][] = [];
  const builder = {
    delete() { ops.push(['delete', []]); return builder; },
    eq(...a: unknown[]) {
      ops.push(['eq', a]);
      return builder;
    },
    select(...a: unknown[]) {
      ops.push(['select', a]);
      return resposta instanceof Error ? Promise.reject(resposta) : Promise.resolve(resposta);
    },
  };
  const tabelas: string[] = [];
  return { db: { from(t: string) { tabelas.push(t); return builder; } }, ops, tabelas };
}

describe('removerInscricaoWebPush (sair do web)', () => {
  it('apaga só a inscrição deste navegador e desta pessoa', async () => {
    const f = fakeDelete({ error: null });
    expect(await removerInscricaoWebPush(f.db, 'u1', 'https://push/x')).toBe(true);
    expect(f.tabelas).toEqual(['web_push_subscriptions']);
    expect(f.ops).toEqual([['delete', []], ['eq', ['user_id', 'u1']], ['eq', ['endpoint', 'https://push/x']], ['select', ['id']]]);
  });

  it('sem endpoint ou sem pessoa não consulta nada', async () => {
    const f = fakeDelete({ error: null });
    expect(await removerInscricaoWebPush(f.db, 'u1', '')).toBe(false);
    expect(await removerInscricaoWebPush(f.db, '', 'https://push/x')).toBe(false);
    expect(f.tabelas).toEqual([]);
  });

  it('erro do banco ou da rede nunca impede sair (devolve false, não lança)', async () => {
    expect(await removerInscricaoWebPush(fakeDelete({ error: { message: 'x' } }).db, 'u1', 'e')).toBe(false);
    expect(await removerInscricaoWebPush(fakeDelete(new Error('rede')).db, 'u1', 'e')).toBe(false);
  });

  it('a Sidebar tira a inscrição ANTES do signOut (depois a RLS não deixa apagar)', () => {
    const src = ler('web/components/Sidebar.tsx');
    const sair = src.slice(src.indexOf('async function sair()'));
    const corpo = sair.slice(0, sair.indexOf('\n  }\n'));
    expect(corpo).toMatch(/desinscreverPushDoNavegador\(/);
    expect(corpo.indexOf('desinscreverPushDoNavegador(')).toBeLessThan(corpo.indexOf('signOut('));
    const sw = ler('web/components/SwRegister.tsx');
    expect(sw).toMatch(/export async function desinscreverPushDoNavegador/);
    expect(sw).toMatch(/removerInscricaoWebPush\(/);
  });
});

describe('senha mínima de shared em todo cadastro de senha', () => {
  it('validarSenhaMinima', () => {
    expect(SENHA_MINIMA).toBe(8);
    expect(validarSenhaMinima('1234567')).toBe('A senha deve ter pelo menos 8 caracteres.');
    expect(validarSenhaMinima('12345678')).toBeNull();
    expect(validarSenhaMinima('')).toBe('A senha deve ter pelo menos 8 caracteres.');
  });

  const ARQUIVOS = [
    'web/app/cadastro/page.tsx',
    'web/app/(app)/equipe/page.tsx',
    'web/app/api/profissionais/route.ts',
    'mobile/app/(auth)/register.tsx',
    'mobile/app/(empresa)/convidar-profissional.tsx',
  ];

  it.each(ARQUIVOS)('%s usa a regra de shared, sem o mínimo 6 antigo', (arq) => {
    const src = ler(arq);
    expect(src).not.toMatch(/6 caracteres|minLength=\{6\}|length\s*<\s*6\b|length\s*>=\s*6\b/i);
    expect(src).toMatch(/validarSenhaMinima|SENHA_MINIMA/);
  });

  it('o servidor recusa senha curta pela mesma função', () => {
    expect(ler('web/app/api/profissionais/route.ts')).toMatch(/validarSenhaMinima\(String\(senha\)\)/);
  });

  it('o gerador de senha da Equipe gera senha que passa na regra', () => {
    for (const arq of ['web/app/(app)/equipe/page.tsx', 'mobile/app/(empresa)/convidar-profissional.tsx']) {
      const m = ler(arq).match(/for \(let i = 0; i < (\d+); i\+\+\) s \+=/);
      expect(m, arq).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(SENHA_MINIMA);
    }
  });
});

describe('modo "Sistema" no Android', () => {
  it('expo-system-ui é dependência do app (sem ele a Expo ignora userInterfaceStyle no Android)', () => {
    const pkg = JSON.parse(ler('mobile/package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['expo-system-ui']).toBeTruthy();
    const app = JSON.parse(ler('mobile/app.json')) as { expo: { userInterfaceStyle?: string } };
    expect(app.expo.userInterfaceStyle).toBe('automatic');
  });
});
