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
  ['app/(app)/financeiro/page.tsx',    ['NovaDespesaModal', 'MarcarPagoModal', 'EditarDespesaModal']],
  ['app/(app)/pacotes/page.tsx',       ['PacoteModal', 'VenderModal', 'SessaoModal']],
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
