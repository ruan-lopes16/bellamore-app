import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

/**
 * Recorta o inicio do corpo de um componente para checar que a chamada do hook
 * esta nele, e nao em outro componente do mesmo arquivo. A janela de 3000
 * caracteres cobre com folga a assinatura mais longa do projeto (NovoAgModal da
 * Agenda) ate a primeira linha do corpo.
 */
function inicioDoComponente(src: string, nome: string): string {
  const inicio = src.indexOf(`function ${nome}(`);
  expect(inicio, `componente ${nome} nao encontrado no arquivo`).toBeGreaterThan(-1);
  return src.slice(inicio, inicio + 3000);
}

const modaisAutonomos: [string, string[]][] = [
  ['app/(app)/agenda/page.tsx',        ['NovoAgModal', 'NovoBloqueioModal', 'AvaliacaoModal']],
  ['app/(app)/clientes/page.tsx',      ['NovoClienteModal']],
  ['app/(app)/clientes/[id]/page.tsx', ['NovoAgModal']],
  ['app/(app)/equipe/page.tsx',        ['NovoProfModal', 'EditInfoModal']],
  ['app/(app)/estoque/page.tsx',       ['ProdutoModal', 'MovModal']],
  ['app/(app)/financeiro/page.tsx',    ['NovaDespesaModal', 'MarcarPagoModal', 'EditarDespesaModal', 'ConfirmarPagamentoTaxaModal']],
  ['app/(app)/pacotes/page.tsx',       ['PacoteModal', 'VenderModal', 'SessoesModal']],
  ['app/(app)/servicos/page.tsx',      ['ServicoModal']],
];

describe('trava de scroll nos modais autonomos', () => {
  it.each(modaisAutonomos)('%s importa o hook', (arquivo) => {
    expect(read(arquivo)).toContain("import { useScrollLock } from '@/lib/useScrollLock';");
  });

  it.each(modaisAutonomos.flatMap(([arquivo, comps]) =>
    comps.map((comp) => [arquivo, comp] as [string, string]),
  ))('%s: %s chama useScrollLock()', (arquivo, componente) => {
    expect(inicioDoComponente(read(arquivo), componente)).toContain('useScrollLock();');
  });
});

describe('trava de scroll nos modais embutidos', () => {
  it('condiciona a trava ao estado que abre cada modal', () => {
    // md:hidden — o modal nem existe no desktop, travar la seria bug
    expect(read('app/(app)/agenda/page.tsx'))
      .toContain('useScrollLock(!!agSel, { apenasMobile: true })');
    expect(read('components/Sidebar.tsx'))
      .toContain('useScrollLock(maisAberto, { apenasMobile: true })');

    expect(read('app/(app)/clientes/[id]/page.tsx'))
      .toContain('useScrollLock(modalRemover)');
    expect(read('app/(app)/comissoes/ComissoesGestorView.tsx'))
      .toContain('useScrollLock(!!pagando)');
    // ConfirmDialog faz `if (!open) return null` — o hook fica acima do early
    // return, senao viola as regras dos hooks.
    expect(read('components/ConfirmDialog.tsx'))
      .toContain('useScrollLock(open)');
  });

  it('nenhum componente com .bm-modal ficou sem a trava', () => {
    // 23 componentes: 17 autonomos (16 + ConfirmarPagamentoTaxaModal, forma
    // de pagamento das taxas) + 5 embutidos da entrega de zoom, mais o
    // DetalheAtendimentoModal do historico da cliente.
    const porArquivo: Record<string, number> = {
      'app/(app)/agenda/page.tsx':                   4,
      'app/(app)/clientes/page.tsx':                 1,
      'app/(app)/clientes/[id]/page.tsx':            3,
      'app/(app)/comissoes/ComissoesGestorView.tsx': 1,
      'app/(app)/equipe/page.tsx':                   2,
      'app/(app)/estoque/page.tsx':                  2,
      'app/(app)/financeiro/page.tsx':               8,
      'app/(app)/pacotes/page.tsx':                  3,
      'app/(app)/servicos/page.tsx':                 1,
      'components/ConfirmDialog.tsx':                1,
      'components/Sidebar.tsx':                      1,
    };

    for (const [arquivo, esperado] of Object.entries(porArquivo)) {
      const src = read(arquivo);
      expect(src, `${arquivo} nao importa o hook`)
        .toContain("import { useScrollLock } from '@/lib/useScrollLock';");
      // A linha de import nao casa: ela nao tem parentese depois do nome.
      const chamadas = src.match(/useScrollLock\(/g) ?? [];
      expect(chamadas.length, `${arquivo} deveria ter ${esperado} chamada(s)`)
        .toBe(esperado);
    }
  });
});
