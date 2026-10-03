import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const web = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(web, p), 'utf8');

describe('Configurações → Permissões (web)', () => {
  const cfg = ler('app/(app)/configuracoes/page.tsx');
  const painel = ler('components/permissoes/PermissoesPanel.tsx');

  it('três abas: Empresa (dona ou config.taxas), Permissões (dona/gestora), Meu perfil (todos)', () => {
    expect(cfg).toContain("{ key: 'permissoes', label: 'Permissões' }");
    expect(cfg).toContain("{ key: 'perfil', label: 'Meu perfil' }");
    expect(cfg).toMatch(/pode\('dona'\) \|\| pode\('config\.taxas'\)/);
    expect(cfg).toContain('<PermissoesPanel');
  });

  it('painel tem as 3 sub-abas, salva via salvarPermissoes e mostra histórico', () => {
    expect(painel).toContain("'Por papel'");
    expect(painel).toContain("'Por pessoa'");
    expect(painel).toContain("'Histórico'");
    expect(painel).toContain('salvarPermissoes(');
    expect(painel).toContain('carregarHistoricoPermissoes(');
    expect(painel).toContain('descreverHistorico(');
    expect(painel).toContain('podeEditarAlvo(');
    expect(painel).toContain('mensagemErroBanco(');
    expect(painel).toMatch(/alterações? não salvas?/);
  });

  it('Equipe mostra selo de exceções com atalho para Configurações', () => {
    const eq = ler('app/(app)/equipe/page.tsx');
    expect(eq).toContain('contarExcecoes(');
    expect(eq).toContain('/configuracoes?aba=permissoes&membro=');
  });
});
