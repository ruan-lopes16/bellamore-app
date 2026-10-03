import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const mob = join(__dirname, '..', '..', '..', 'mobile');
const ler = (p: string) => readFileSync(join(mob, p), 'utf8');

describe('app: permissões na sessão', () => {
  it('authStore carrega e recarrega as permissões efetivas', () => {
    const s = ler('stores/authStore.ts');
    expect(s).toContain('carregarMinhasPermissoes(');
    expect(s).toContain('recarregarPermissoes');
  });
  it('authStore expõe permissoesCarregadas e as telas que expulsam esperam por ela', () => {
    expect(ler('stores/authStore.ts')).toContain('permissoesCarregadas');
    expect(ler('lib/permissions.ts')).toContain('permissoesCarregadas');
    for (const arq of ['app/(empresa)/cliente/[id]/editar.tsx', 'app/(empresa)/cliente/[id]/anamnese.tsx', 'app/(empresa)/novo-cliente.tsx']) {
      expect(ler(arq)).toContain('permissoesCarregadas');
    }
  });
  it('_layout raiz recarrega ao voltar ao app', () => {
    expect(ler('app/_layout.tsx')).toMatch(/AppState[\s\S]*recarregarPermissoes/);
  });
  it('lib/permissions não tem mais a matriz fixa', () => {
    const s = ler('lib/permissions.ts');
    expect(s).not.toContain('temPermissao');
    expect(s).toContain('usePermissoes');
  });
});

describe('app: botões consultam a chave certa', () => {
  const esperado: [string, string[]][] = [
    ['app/(empresa)/_layout.tsx', ['financeiro.ver']],
    ['app/(empresa)/agendamento/[id].tsx', ['agenda.excluir']],
    ['app/(empresa)/comissoes.tsx', ['comissoes.ver_todas', 'comissoes.pagar']],
    ['app/(empresa)/agenda.tsx', ['agenda.ver_equipe']],
    ['app/(empresa)/configuracoes.tsx', ['config.taxas']],
    ['app/(empresa)/dashboard.tsx', ['estoque.acessar', 'financeiro.ver', 'comanda.fechar']],
    ['app/(empresa)/mais.tsx', ['financeiro.ver', 'comissoes.ver_todas']],
    ['app/(empresa)/pacotes.tsx', ['pacotes.gerenciar']],
    ['app/(empresa)/relatorios.tsx', ['comissoes.pagar']],
    ['app/(empresa)/servicos.tsx', ['servicos.gerenciar']],
    ['app/(empresa)/novo-agendamento.tsx', ['clientes.cadastrar']],
    ['app/(empresa)/cliente/[id].tsx', ['clientes.arquivar', 'clientes.excluir', 'clientes.editar']],
    ['app/(empresa)/nova-comanda.tsx', ['comanda.desconto', 'pacotes.vender']],
    ['hooks/useAgenda.ts', ['agenda.aprovar_bloqueios']],
  ];
  for (const [arq, chaves] of esperado) {
    for (const c of chaves) it(`${arq} usa ${c}`, () => expect(ler(arq)).toContain(`pode('${c}')`));
  }
  it('área da profissional não ganhou telas novas', () => {
    expect(readdirSync(join(mob, 'app', '(profissional)')).sort()).toEqual(
      ['_layout.tsx', 'agenda.tsx', 'agendamento', 'comissoes.tsx', 'configuracoes.tsx', 'inicio.tsx', 'pacotes.tsx', 'servicos.tsx'].sort(),
    );
  });
});
