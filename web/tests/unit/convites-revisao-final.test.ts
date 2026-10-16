// web/tests/unit/convites-revisao-final.test.ts
// Entrega 3, revisão final: textos únicos em shared, empresa depois do aceite no web,
// trava de duplo clique no cancelar e mesma regra de "quem cancela" nas duas plataformas.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MENSAGEM_CONVITE_PENDENTE, mensagemConviteAceitoOutraEmpresa, podeCancelarConvite,
} from '@shared/convites-consultas';
import { mensagemCadastroEquipe } from '@/lib/convites-web';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

describe('texto do convite pendente (único, da spec)', () => {
  it('shared tem o texto da spec e o web usa o mesmo', () => {
    expect(MENSAGEM_CONVITE_PENDENTE).toBe('Convite enviado. Ela precisa aceitar no app ou no site.');
    expect(mensagemCadastroEquipe('convite_pendente', 'Ana')).toBe(MENSAGEM_CONVITE_PENDENTE);
    expect(ler('web/lib/convites-web.ts')).toContain("from '@shared/convites-consultas'");
  });
  it('o app usa a constante de shared, sem texto próprio', () => {
    const src = ler('mobile/app/(empresa)/convidar-profissional.tsx');
    expect(src).toContain('MENSAGEM_CONVITE_PENDENTE');
    expect(src).not.toContain("'Convite enviado. Ela precisa aceitar no app ou no site.'");
  });
});

describe('quem cancela o convite (web e app)', () => {
  it('convite de gestora só a dona; de profissional quem gerencia a equipe', () => {
    expect(podeCancelarConvite('gestor', true)).toBe(true);
    expect(podeCancelarConvite('gestor', false)).toBe(false);
    expect(podeCancelarConvite('profissional', false)).toBe(true);
  });
  it('as duas telas usam a mesma regra', () => {
    expect(ler('web/app/(app)/equipe/page.tsx')).toContain('podeCancelarConvite(');
    expect(ler('mobile/components/EquipeConvites.tsx')).toContain('podeCancelarConvite(');
    expect(ler('mobile/app/(empresa)/equipe.tsx')).toMatch(/<ConvitesPendentesSecao[^>]*isOwner=/);
  });
});

describe('cancelar convite no web: trava de duplo clique', () => {
  const src = ler('web/app/(app)/equipe/page.tsx');
  it('ignora o segundo clique e desliga o diálogo enquanto grava', () => {
    expect(src).toContain('cancelandoRef');
    expect(src).toMatch(/if \(!c \|\| !empresaId \|\| cancelandoRef\.current\) return;/);
    expect(src).toMatch(/<ConfirmDialog[\s\S]*?loading=\{cancelandoOcupado\}/);
  });
});

describe('empresa depois do aceite no web', () => {
  const banner = ler('web/components/ConvitesRecebidosBanner.tsx');
  it('quem não tem empresa (/criar-empresa) vai para o painel da empresa nova', () => {
    expect(ler('web/app/criar-empresa/page.tsx')).toMatch(/<ConvitesRecebidosBanner\s+semEmpresa\s*\/>/);
    expect(banner).toContain("window.location.assign('/dashboard')");
  });
  it('quem já tem empresa vê o aviso, sem recarregar para a empresa errada', () => {
    expect(ler('web/components/AppLayout.tsx')).toMatch(/<ConvitesRecebidosBanner\s*\/>/);
    expect(banner).toContain('mensagemConviteAceitoOutraEmpresa(');
    expect(banner).not.toContain('window.location.reload');
    expect(mensagemConviteAceitoOutraEmpresa('Bellamore')).toBe(
      'Convite aceito. Você agora faz parte da equipe de Bellamore. O site ainda não troca de empresa '
      + 'e continua mostrando a empresa em que você já estava. No app, você escolhe a empresa em Mais.',
    );
  });
  it('trava de duplo clique por ref', () => {
    expect(banner).toContain('ocupadoRef');
  });
});
