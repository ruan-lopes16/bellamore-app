import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const web = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(web, p), 'utf8');

describe('rotas do web usam chaves do catálogo', () => {
  const guardas: [string, string][] = [
    ['app/(app)/equipe/layout.tsx', 'equipe.gerenciar'],
    ['app/(app)/estoque/layout.tsx', 'estoque.acessar'],
    ['app/(app)/financeiro/layout.tsx', 'financeiro.ver'],
    ['app/(app)/relatorios/layout.tsx', 'financeiro.ver'],
    ['app/(app)/vendas/layout.tsx', 'vendas.acessar'],
  ];
  for (const [arq, chave] of guardas) {
    it(`${arq} exige ${chave}`, () => expect(ler(arq)).toContain(`exigirAcesso(permissoes, '${chave}')`));
  }
  for (const arq of ['app/(app)/configuracoes/layout.tsx', 'app/(app)/servicos/layout.tsx', 'app/(app)/comissoes/layout.tsx', 'app/(app)/dashboard/layout.tsx']) {
    it(`${arq} liberado para todos`, () => expect(ler(arq)).not.toMatch(/exigir(Acesso|Permissao)\(/));
  }
  it('ninguém mais usa temPermissao', () => {
    for (const arq of ['components/Sidebar.tsx', 'app/(app)/dashboard/page.tsx', 'app/(app)/pacotes/page.tsx', 'app/(app)/servicos/page.tsx', 'app/(app)/notificacoes/page.tsx']) {
      expect(ler(arq)).not.toContain('temPermissao');
    }
  });
  it('APIs de equipe checam equipe.gerenciar', () => {
    for (const arq of ['app/api/convites/route.ts', 'app/api/profissionais/route.ts']) {
      const src = ler(arq);
      expect(src).toContain('carregarPermissoesDoMembro(');
      expect(src).toContain("'equipe.gerenciar'");
    }
  });
});
