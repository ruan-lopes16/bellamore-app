// web/tests/unit/convites-telas-web.test.ts
// Entrega 3, Task 3: telas do web para convite com aceite e histórico da Equipe.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mensagemCadastroEquipe, MENSAGEM_CONVITE_PENDENTE } from '@/lib/convites-web';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

describe('mensagemCadastroEquipe', () => {
  it('convite pendente avisa que a pessoa precisa aceitar', () => {
    expect(mensagemCadastroEquipe('convite_pendente', 'Ana')).toBe(MENSAGEM_CONVITE_PENDENTE);
    expect(MENSAGEM_CONVITE_PENDENTE).toBe('Convite enviado. A pessoa já tem conta e precisa aceitar o convite ao entrar no app.');
  });
  it('mantém as mensagens antigas', () => {
    expect(mensagemCadastroEquipe('convite_enviado', 'Ana')).toContain('Convite enviado! Ana');
    expect(mensagemCadastroEquipe('adicionado', 'Ana')).toContain('Ana já tinha conta');
    expect(mensagemCadastroEquipe('criado', 'Ana')).toBeUndefined();
  });
});

describe('banner da convidada', () => {
  const banner = ler('web/components/ConvitesRecebidosBanner.tsx');
  it('usa as funções de shared e mostra erros em português', () => {
    expect(banner).toContain('carregarMeusConvites(');
    expect(banner).toContain('aceitarConvite(');
    expect(banner).toContain('recusarConvite(');
    expect(banner).toContain('window.location.reload');
    expect(banner).toContain('Aceitar');
    expect(banner).toContain('Recusar');
  });
  it('fica no AppLayout e em /criar-empresa', () => {
    expect(ler('web/components/AppLayout.tsx')).toContain('<ConvitesRecebidosBanner');
    expect(ler('web/app/criar-empresa/page.tsx')).toContain('<ConvitesRecebidosBanner');
  });
});

describe('Equipe', () => {
  const src = ler('web/app/(app)/equipe/page.tsx');
  it('convites pendentes e histórico só com equipe.gerenciar (histórico também para a dona)', () => {
    expect(src).toContain('carregarConvitesPendentes(');
    expect(src).toContain('cancelarConvite(');
    expect(src).toContain('carregarHistoricoEquipe(');
    expect(src).toContain('Convites pendentes');
    expect(src).toContain('Histórico');
    expect(src).toContain('descreverHistoricoEquipe(');
    expect(src).toContain('quandoHistoricoEquipe(');
    expect(src).toContain('podeEquipe || isOwner');
    expect(src).toContain('SmoothTabs');
  });
  it('modais usam a mensagem de convite pendente', () => {
    expect(src).toContain('mensagemCadastroEquipe(');
  });
  it('nunca grava empresa_membros por insert/upsert', () => {
    expect(src).not.toMatch(/from\('empresa_membros'\)\s*\.\s*(insert|upsert)/);
  });
});
