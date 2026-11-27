/**
 * B12 — troca de e-mail de login avisa a própria pessoa (sino + push), já que sem domínio próprio
 * o app não manda e-mail ao endereço antigo.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { avisoLoginTrocado, rotaDoAviso, TIPOS_NOTIFICACAO } from '@shared/notificacoes';

describe('avisoLoginTrocado', () => {
  it('cita o e-mail antigo, o novo e quem trocou', () => {
    const a = avisoLoginTrocado('ana@velho.com', 'ana@novo.com', 'Carla');
    expect(a.titulo).toBe('Seu e-mail de login foi alterado');
    expect(a.mensagem).toContain('de ana@velho.com para ana@novo.com por Carla');
    expect(a.mensagem).toContain('fale com a dona do estúdio');
  });
  it('sem e-mail antigo nem nome, o texto continua legível', () => {
    const a = avisoLoginTrocado(null, 'ana@novo.com', '  ');
    expect(a.mensagem).toContain('foi trocado para ana@novo.com por a administração do estúdio');
  });
  it('tipo conhecido, com ícone e rota para Notificações nas duas plataformas', () => {
    expect(TIPOS_NOTIFICACAO.login_trocado.icone).toBe('KeyRound');
    expect(rotaDoAviso('login_trocado', 'web')).toBe('/notificacoes');
    expect(rotaDoAviso('login_trocado', 'app', 'profissional')).toBe('/(profissional)/notificacoes');
  });
});

describe('rota da Equipe grava o aviso ao trocar o login', () => {
  const src = readFileSync(resolve(__dirname, '../../app/api/profissionais/route.ts'), 'utf8');
  it('insere em notificacoes com tipo login_trocado para a pessoa, nunca para quem trocou o próprio', () => {
    expect(src).toMatch(/if \(userId !== requesterId\)[\s\S]{0,600}from\('notificacoes'\)\.insert\(\{[\s\S]{0,120}tipo: 'login_trocado'/);
  });
  it('as duas telas de Notificações conhecem o ícone', () => {
    expect(readFileSync(resolve(__dirname, '../../app/(app)/notificacoes/page.tsx'), 'utf8')).toMatch(/ICONES[\s\S]{0,200}KeyRound/);
    expect(readFileSync(resolve(__dirname, '../../../mobile/components/TelaNotificacoes.tsx'), 'utf8')).toMatch(/ICONES[\s\S]{0,200}KeyRound/);
  });
});
