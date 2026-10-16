// web/tests/unit/convites-telas-app.test.ts
// Trava as telas do app da Entrega 3 (convite com aceite + histórico da Equipe, migration 092):
// banner da convidada nos layouts e na criação de empresa, seções da Equipe e mensagens do convite.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

describe('banner da convidada (app)', () => {
  const banner = ler('mobile/components/BannerConvites.tsx');

  it('usa as funções de shared e nunca mexe em empresa_membros', () => {
    expect(banner).toContain('carregarMeusConvites(');
    expect(banner).toContain('aceitarConvite(');
    expect(banner).toContain('recusarConvite(');
    expect(banner).not.toMatch(/from\('empresa_membros'\)\s*\.(insert|upsert)/);
    expect(banner).not.toMatch(/\bupsert\(/);
  });

  it('texto igual ao do web, com Aceitar e Recusar', () => {
    expect(banner).toContain('Você foi convidada para entrar na equipe de');
    expect(banner).toContain('Aceitar');
    expect(banner).toContain('Recusar');
    expect(banner).toContain('rotuloPapelEquipe(');
  });

  it('aceitar troca a empresa ativa e recarrega sessão e dados', () => {
    expect(banner).toMatch(/carregarSessao\(\{\s*manterEmpresaId:\s*empresaId/);
    expect(banner).toContain('invalidateQueries()');
    expect(banner).toContain('rotaInicial(');
  });

  it('erros em português e trava de duplo toque', () => {
    expect(banner).toMatch(/Alert\.alert\('Erro'/);
    expect(banner).toContain('ocupadoRef');
  });

  it('só consulta com usuário logado e some quando não há convite (sem a 092 a lista vem vazia)', () => {
    expect(banner).toMatch(/enabled:\s*!!user\?\.id/);
    expect(banner).toContain('if (convites.length === 0) return null');
  });

  it.each([
    'mobile/app/(empresa)/_layout.tsx',
    'mobile/app/(profissional)/_layout.tsx',
    'mobile/app/criar-empresa.tsx',
  ])('%s mostra o banner', (arq) => {
    const src = ler(arq);
    expect(src).toContain("import { BannerConvites } from '@/components/BannerConvites'");
    expect(src).toContain('<BannerConvites');
  });
});

describe('Equipe do app: convites pendentes e histórico', () => {
  const tela = ler('mobile/app/(empresa)/equipe.tsx');
  const secoes = ler('mobile/components/EquipeConvites.tsx');

  it('a tela renderiza as duas seções só com equipe.gerenciar ou dona', () => {
    expect(tela).toContain("from '@/components/EquipeConvites'");
    expect(tela).toContain('<ConvitesPendentesSecao');
    expect(tela).toContain('<HistoricoEquipeSecao');
    expect(tela).toMatch(/\(podeGerenciarEquipe \|\| isOwner\)/);
  });

  it('convites pendentes: carrega por shared, cancela com confirmação e erro em português', () => {
    expect(secoes).toContain('carregarConvitesPendentes(');
    expect(secoes).toContain('cancelarConvite(');
    expect(secoes).toContain('Convites pendentes');
    expect(secoes).toMatch(/Alert\.alert\(\s*'Cancelar convite'/);
    expect(secoes).toContain('Manter convite');
    expect(secoes).toMatch(/Alert\.alert\('Erro'/);
    expect(secoes).toContain('rotuloPapelEquipe(');
  });

  it('histórico: paginado com Mostrar mais, frases de shared e some sem a 092', () => {
    expect(secoes).toContain('carregarHistoricoEquipe(');
    expect(secoes).toContain('descreverHistoricoEquipe(');
    expect(secoes).toContain('quandoHistoricoEquipe(');
    expect(secoes).toContain('Mostrar mais');
    expect(secoes).toContain('Histórico');
    expect(secoes).toContain('disponivel');
  });

  it('nunca grava em empresa_membros pelas seções', () => {
    expect(secoes).not.toMatch(/\.(insert|upsert)\(/);
  });
});

describe('convidar-profissional (app)', () => {
  const src = ler('mobile/app/(empresa)/convidar-profissional.tsx');

  it("trata 'convite_pendente' com o texto da spec", () => {
    expect(src).toContain("resultado.status === 'convite_pendente'");
    expect(src).toContain('MENSAGEM_CONVITE_PENDENTE');
  });

  it('a explicação da tela não promete mais vínculo imediato', () => {
    expect(src).not.toContain('será adicionada imediatamente');
  });

  it('mostra o erro da API (403 da gestora e 503 da 092) em vez de genérico', () => {
    expect(src).toContain('resultado.error');
    expect(src).toContain('resposta.status === 503');
  });

  it('invalida a lista de convites pendentes depois de convidar', () => {
    expect(src).toContain("queryKey: ['convites-pendentes']");
    expect(src).toContain("queryKey: ['equipe-historico']");
  });
});
