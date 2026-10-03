// web/tests/unit/permissoes-painel-mobile.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const mob = join(__dirname, '..', '..', '..', 'mobile');
const ler = (p: string) => readFileSync(join(mob, p), 'utf8');

describe('app: Configurações → Permissões', () => {
  const painel = ler('components/PermissoesPanel.tsx');
  it('mesmas 3 sub-abas, rascunho, salvar e histórico do web', () => {
    for (const t of ["'Por papel'", "'Por pessoa'", "'Histórico'", 'salvarPermissoes(', 'carregarHistoricoPermissoes(', 'descreverHistorico(', 'podeEditarAlvo(', 'mensagemErroBanco(']) {
      expect(painel).toContain(t);
    }
    expect(painel).toMatch(/alterações? não salvas?/);
  });
  it('Configurações mostra a aba só para dona/gestora', () => {
    const cfg = ler('app/(empresa)/configuracoes.tsx');
    expect(cfg).toContain('<PermissoesPanel');
    expect(cfg).toMatch(/pode\('dona'\) \|\| papel === 'gestor'/);
  });
  it('Equipe mostra selo de exceções', () => {
    expect(ler('app/(empresa)/equipe.tsx')).toContain('contarExcecoes(');
  });
});
