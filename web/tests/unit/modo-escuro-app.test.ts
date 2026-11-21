import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

/**
 * Varredura do modo escuro do app: toda tela usa o tema do usuário e nenhum arquivo define
 * paleta própria. `PENDENTES` lista o que ainda falta migrar (Tasks 2 a 5 do plano
 * `docs/superpowers/plans/2026-11-21-modo-escuro-app.md`); cada task tira os seus da lista
 * e a Task 6 deixa a lista vazia.
 */
const RAIZ = path.resolve(__dirname, '../../../mobile');

function listar(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = path.join(dir, nome);
    if (nome === 'node_modules') return [];
    return statSync(p).isDirectory() ? listar(p) : /\.tsx?$/.test(nome) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(RAIZ, p).split(path.sep).join('/');

/** Arquivos (relativos a `mobile/`) ainda com paleta própria ou sem `comTemaDoUsuario`. */
const PENDENTES = new Set<string>([
  // Task 2 — entrada e equipe
  'app/(auth)/esqueci-senha.tsx', 'app/(auth)/login.tsx', 'app/(auth)/register.tsx', 'app/(auth)/verificar-email.tsx',
  'app/criar-empresa.tsx', 'app/index.tsx', 'app/(empresa)/equipe.tsx', 'app/(empresa)/convidar-profissional.tsx',
  'app/(empresa)/editar-profissional/[id].tsx',
  'components/EquipeConvites.tsx', 'components/BannerConvites.tsx', 'components/PermissoesPanel.tsx',
  // Task 3 — dinheiro
  'app/(empresa)/financeiro.tsx', 'app/(empresa)/nova-despesa.tsx', 'app/(empresa)/nova-retirada.tsx',
  'app/(empresa)/relatorios.tsx', 'app/(empresa)/comissoes.tsx',
  'components/CalendarioMesFinanceiro.tsx', 'components/SparkLinha.tsx',
  // Task 4 — catálogo e estoque
  'app/(empresa)/estoque.tsx', 'app/(empresa)/novo-produto.tsx', 'app/(empresa)/editar-produto/[id].tsx',
  'app/(empresa)/vendas.tsx', 'app/(empresa)/servicos.tsx', 'app/(empresa)/pacotes.tsx',
  'app/(empresa)/novo-servico.tsx', 'app/(empresa)/editar-servico/[id].tsx',
  'app/(empresa)/novo-pacote.tsx', 'app/(empresa)/editar-pacote/[id].tsx',
  'components/servicos/DuracaoSeletor.tsx', 'components/servicos/InsumosEditor.tsx', 'components/servicos/ServicoForm.tsx',
  'components/pacotes/PacoteForm.tsx', 'components/pacotes/VenderPacoteSheet.tsx',
  'components/UnidadesEstoqueModal.tsx', 'components/CategoriaPicker.tsx', 'components/CategoriasManagerModal.tsx',
  // Task 5 — atendimento e clientes
  'app/(empresa)/agendamento/[id].tsx', 'app/(profissional)/agendamento/[id].tsx',
  'app/(empresa)/cliente/[id].tsx', 'app/(empresa)/cliente/[id]/anamnese.tsx', 'app/(empresa)/cliente/[id]/editar.tsx',
  'app/(empresa)/novo-cliente.tsx', 'app/(empresa)/novo-agendamento.tsx',
  'components/atendimento/AvaliacaoAtendimento.tsx', 'components/atendimento/BotoesStatus.tsx',
  'components/agenda/LinhasServicoEditor.tsx', 'components/agenda/SeletorHorario.tsx',
]);

const TELAS = listar(path.join(RAIZ, 'app')).filter((p) => {
  const nome = path.basename(p);
  if (nome === '_layout.tsx') return false;
  const src = readFileSync(p, 'utf8');
  // reexportações (`export { default } from ...`) herdam o tema da tela original
  return !/^\s*export (\{ default \}|\*) from /m.test(src);
});
const ARQUIVOS = [...TELAS, ...listar(path.join(RAIZ, 'components'))];

describe('modo escuro do app', () => {
  it('toda tela usa comTemaDoUsuario(', () => {
    const faltam = TELAS.map(rel).filter((r) => !PENDENTES.has(r) && !readFileSync(path.join(RAIZ, r), 'utf8').includes('comTemaDoUsuario('));
    expect(faltam).toEqual([]);
  });

  it('nenhuma tela nem componente define paleta própria', () => {
    const com = ARQUIVOS.map(rel).filter((r) => {
      if (PENDENTES.has(r) || r === 'lib/tema.tsx') return false;
      const src = readFileSync(path.join(RAIZ, r), 'utf8');
      return /const C = \{(?!\s*\.\.\.)/.test(src) || /bg: '#F4F1EE'/.test(src);
    });
    expect(com).toEqual([]);
  });

  it('a lista de pendentes só tem arquivos que existem', () => {
    for (const r of PENDENTES) expect(() => readFileSync(path.join(RAIZ, r), 'utf8')).not.toThrow();
  });

  it('as 12 telas já migradas usam as chaves *Texto e não mantêm paleta própria', () => {
    for (const r of ['app/(empresa)/dashboard.tsx', 'app/(empresa)/agenda.tsx', 'app/(empresa)/clientes.tsx', 'app/(empresa)/mais.tsx']) {
      const src = readFileSync(path.join(RAIZ, r), 'utf8');
      expect(src).toContain('comTemaDoUsuario(');
      expect(src).not.toMatch(/(?<![A-Za-z])color: C\.(primary|green|amber|red)\b(?!Texto|Soft)/);
    }
  });
});
