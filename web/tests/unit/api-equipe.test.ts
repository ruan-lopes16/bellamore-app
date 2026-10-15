// web/tests/unit/api-equipe.test.ts
// Trava as regras das rotas de Equipe (Task 2 da paridade de equipe): convite/adicionar nunca zera a
// comissão de quem já é da equipe, o PATCH aceita o app (Bearer) com empresa explícita e a troca de
// e-mail troca também o login.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { traduzirErroEmailAuth } from '@/lib/auth/quem-chama';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

const prof = ler('web/app/api/profissionais/route.ts');
const conv = ler('web/app/api/convites/route.ts');
const quem = ler('web/lib/auth/quem-chama.ts');

/** Corpo do handler exportado `nome` (do `export async function` até o próximo ou o fim). */
function handler(src: string, nome: string): string {
  const ini = src.indexOf(`export async function ${nome}(`);
  expect(ini).toBeGreaterThanOrEqual(0);
  const prox = src.indexOf('export async function', ini + 10);
  return src.slice(ini, prox < 0 ? undefined : prox);
}

describe('POST de profissionais e convites', () => {
  it.each([['profissionais', prof], ['convites', conv]])('%s usa vinculoParaGravar e nunca zera a comissão', (_n, src) => {
    const post = handler(src, 'POST');
    expect(post).toContain('vinculoParaGravar(');
    expect(post).not.toMatch(/percentual_comissao\s*\?\?\s*0/);
    expect(post).toMatch(/select\('id, role, percentual_comissao, tipo_contrato'\)/);
    expect(post).toMatch(/\.select\('[^']*tipo_contrato[^']*user:users/);
  });
});

describe('quem chama', () => {
  it('Bearer pelo admin, senão cookie', () => {
    expect(quem).toContain('auth.getUser(token)');
    expect(quem).toContain("from '@/lib/supabase/server'");
  });
  it('os três handlers usam quemChama', () => {
    expect(handler(prof, 'POST')).toContain('quemChama(req');
    expect(handler(prof, 'PATCH')).toContain('quemChama(req');
    expect(handler(conv, 'POST')).toContain('quemChama(req');
    expect(prof).not.toContain("req.headers.get('authorization')");
    expect(conv).not.toContain("req.headers.get('authorization')");
  });
});

describe('PATCH de profissionais', () => {
  const patch = handler(prof, 'PATCH');
  it('exige empresaId e usa montarPatchVinculo', () => {
    expect(patch).toMatch(/if \(!empresaId/);
    expect(patch).toContain('montarPatchVinculo(');
    expect(patch).toContain('emailValido(');
  });
  it('troca o login do e-mail no Auth antes de gravar users', () => {
    expect(patch).toMatch(/updateUserById\(userId, \{ email: emailNovo!?, email_confirm: true \}\)/);
    expect(patch).toContain('Este e-mail já é usado por outra conta.');
    const iAuth = patch.indexOf('updateUserById(userId, { email: emailNovo');
    const iUsers = patch.indexOf(".from('users').update(");
    const iVinculo = patch.indexOf(".from('empresa_membros')\n        .update(");
    expect(iAuth).toBeGreaterThan(0);
    expect(iUsers).toBeGreaterThan(iAuth);
    expect(iVinculo).toBeGreaterThan(iUsers);
  });
  it('confere o vínculo do alvo na empresa e o membroId', () => {
    expect(patch).toMatch(/\.eq\('id', membroId\)\s*\.eq\('user_id', userId\)/);
    expect(patch).toContain('podeGerenciarMembro(');
    expect(patch).toContain("'equipe.gerenciar'");
  });
  it('nunca devolve a mensagem crua do Auth', () => {
    expect(patch).not.toMatch(/error: \w*[aA]uth\w*\.message/);
  });
});

describe('C1 — troca do e-mail de login não sequestra contas', () => {
  const patch = handler(prof, 'PATCH');
  const iAuth = patch.indexOf('updateUserById(userId, { email: emailNovo');
  it('só a dona troca o login', () => {
    const iDona = patch.indexOf('if (!permsReq.isOwner)');
    expect(iDona).toBeGreaterThan(0);
    expect(iDona).toBeLessThan(iAuth);
  });
  it('confere vínculo em outra empresa e owner_id de qualquer empresa antes do Auth', () => {
    const iOutras = patch.indexOf(".eq('user_id', userId).neq('empresa_id', empresaId)");
    const iDonaDeAlguma = patch.indexOf(".eq('owner_id', userId)");
    expect(iOutras).toBeGreaterThan(0);
    expect(iDonaDeAlguma).toBeGreaterThan(0);
    expect(iOutras).toBeLessThan(iAuth);
    expect(iDonaDeAlguma).toBeLessThan(iAuth);
    expect(patch).toContain('rOutras.error || rDonaDeAlguma.error');
  });
  it('podeGerenciarMembro e membroId conferidos antes do Auth', () => {
    expect(patch.indexOf('podeGerenciarMembro(')).toBeLessThan(iAuth);
    expect(patch.indexOf('alvo.id !== membroId')).toBeLessThan(iAuth);
  });
  it('compara com o e-mail do Auth e confere o erro do getUserById', () => {
    expect(patch).toContain('Não foi possível conferir a conta desta pessoa.');
    expect(patch.indexOf('getUserById(userId)')).toBeLessThan(iAuth);
    expect(patch).not.toContain(".from('users').select('email')");
  });
  it('mensagem da recusa existe', () => {
    expect(prof).toContain('O e-mail de login desta pessoa só pode ser trocado pela dona, e só quando a conta dela não é usada em outra empresa.');
  });
});

describe('I1/I2 — POST não contorna podeGerenciarMembro nem sobrescreve perfil', () => {
  it.each([['profissionais', prof], ['convites', conv]])('%s aplica podeGerenciarMembro antes do upsert do vínculo', (_n, src) => {
    const post = handler(src, 'POST');
    const iGuard = post.indexOf('podeGerenciarMembro(');
    const iUpsert = post.indexOf(".from('empresa_membros')\n      .upsert(");
    expect(iGuard).toBeGreaterThan(0);
    expect(iUpsert).toBeGreaterThan(iGuard);
    expect(post).toMatch(/ERRO_GERENCIAR_MEMBRO|Você só pode editar profissionais da equipe/);
  });
  it('profissionais: só conta criada agora grava users', () => {
    const post = handler(prof, 'POST');
    expect(post).toMatch(/if \(status === 'criado'\) \{\s*await adminClient\.from\('users'\)\.upsert\(/);
  });
});

describe('traduzirErroEmailAuth', () => {
  it('e-mail já usado → 409', () => {
    expect(traduzirErroEmailAuth('A user with this email address has already been registered'))
      .toEqual({ status: 409, error: 'Este e-mail já é usado por outra conta.' });
    expect(traduzirErroEmailAuth('Email exists')).toMatchObject({ status: 409 });
  });
  it('outro erro → 400 em português', () => {
    const r = traduzirErroEmailAuth('Unable to validate email address: invalid format');
    expect(r.status).toBe(400);
    expect(r.error).toBe('Não foi possível trocar o e-mail de login.');
  });
});
