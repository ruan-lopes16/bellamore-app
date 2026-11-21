/**
 * Permissões, banco e ajustes (B9, B11, B13, C7, C9–C12) — varredura cruzada web × app
 * (spec docs/superpowers/specs/2026-11-10-permissoes-pendencias-c-design.md).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const ler = (f: string) => semComentarios(readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n'));

describe('B11: Excluir pacote vendido pela regra única', () => {
  it.each(['web/app/(app)/pacotes/page.tsx', 'mobile/app/(empresa)/pacotes.tsx'])('%s', (f) => {
    expect(ler(f)).toContain('podeExcluirPacoteVendido(');
  });
});

describe('C9: saldo do pacote pelo texto único (sem "ilimitado" fixo)', () => {
  it.each([
    'web/app/(app)/comanda/page.tsx', 'web/app/(app)/agenda/page.tsx',
    'mobile/app/(empresa)/nova-comanda.tsx', 'mobile/app/(empresa)/novo-agendamento.tsx',
  ])('%s', (f) => {
    const s = ler(f);
    expect(s).toContain('p.saldoTexto');
    expect(s).not.toContain("p.restantes == null ? 'ilimitado'");
  });
  it.each(['web/app/(app)/pacotes/page.tsx', 'mobile/app/(empresa)/pacotes.tsx'])('%s', (f) => {
    expect(ler(f)).toContain('resumoSaldoPacote(');
  });
});

describe('C10: seletor de maquininha e exceções pela regra única', () => {
  it.each([
    'web/app/(app)/comanda/page.tsx', 'web/app/(app)/vendas/page.tsx',
    'web/components/pacotes/BlocoPagamento.tsx', 'mobile/components/comanda/PagamentosEditor.tsx',
  ])('%s usa opcoesMaquininha', (f) => {
    expect(ler(f)).toContain('opcoesMaquininha(');
  });
  it.each(['web/components/configuracoes/CartoesConfig.tsx', 'mobile/components/configuracoes/CartoesConfig.tsx'])(
    '%s propaga a padrão às exceções', (f) => {
      const s = ler(f);
      expect(s).toContain('propagarPadraoParaExcecoes(');
      expect(s).toContain('avisoExcecoesAcompanharam(');
    });
});

describe('C11: painel de permissões avisa antes de descartar o rascunho', () => {
  it.each(['web/components/permissoes/PermissoesPanel.tsx', 'mobile/components/PermissoesPanel.tsx'])('%s', (f) => {
    expect(ler(f)).toContain('Descartar as alterações não salvas?');
  });
  it('app mostra a dica da aba Pessoas', () => {
    expect(ler('mobile/components/PermissoesPanel.tsx')).toContain('Escolha uma pessoa para ver e ajustar as permissões dela');
  });
});

describe('C12: histórico da Equipe por cursor nas duas plataformas', () => {
  it.each(['web/app/(app)/equipe/page.tsx', 'mobile/components/EquipeConvites.tsx'])('%s', (f) => {
    expect(ler(f)).toContain('cursorHistoricoEquipe(');
  });
});
