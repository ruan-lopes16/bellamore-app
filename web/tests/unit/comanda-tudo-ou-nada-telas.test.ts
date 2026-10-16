import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = join(process.cwd(), '..');
const ler = (...p: string[]) => readFileSync(join(raiz, ...p), 'utf8');

describe('web', () => {
  const comanda = ler('web', 'app', '(app)', 'comanda', 'page.tsx');
  const vendas = ler('web', 'app', '(app)', 'vendas', 'page.tsx');

  it('fechar: monta o payload pela regra única e chama a função antes do caminho antigo', () => {
    expect(comanda).toMatch(/from '@shared\/comanda-gravacao'/);
    expect(comanda).toContain('montarPayloadFechamento(');
    const iFuncao = comanda.indexOf('fecharComandaNoBanco(supabase,');
    expect(iFuncao).toBeGreaterThan(-1);
    // Duplicidade e INSERT antigo só quando a função não existe (PGRST202).
    expect(comanda.indexOf(".not('comanda_id', 'is', null)")).toBeGreaterThan(iFuncao);
    expect(comanda.indexOf(".from('comandas').insert(")).toBeGreaterThan(iFuncao);
    expect(comanda).toMatch(/via === 'funcao'/);
    // Trava da configuração de cartões continua antes de qualquer gravação.
    expect(comanda.indexOf("if (!configPronta)")).toBeLessThan(iFuncao);
  });

  it('comanda_id: um por cartão aberto, reaproveitado na nova tentativa e trocado só no sucesso ou ao abrir outra', () => {
    expect(comanda).toContain('const chavesFechamentoRef = useRef<Record<string, string>>({})');
    expect(comanda).toMatch(/comandaId: chave,/);
    // Gerado só quando não existe para o cartão; apagado no sucesso pela função.
    expect(comanda).toMatch(/chavesFechamentoRef\.current\[c\.chave\] \?\?= novoUuid\(\)|chavesFechamentoRef\.current\[cliente\.chave\] = novoUuid\(\)/);
    expect(comanda).toContain('delete chavesFechamentoRef.current[');
  });

  it('editar: estado completo pela função, extra novo com id da tela e pagamento reaberto com id', () => {
    expect(comanda).toContain('montarPayloadEdicao(');
    expect(comanda).toContain('editarComandaNoBanco(supabase,');
    expect(comanda).toMatch(/item_id: i\.item_id \?\? i\.uid/);
    expect(comanda).toMatch(/pagamentoId: +p\.id/);
    expect(comanda).toMatch(/const base = 'id,metodo,valor/);
    // O caminho antigo em passos continua lá para quando a função não existe.
    const iFuncao = comanda.indexOf('editarComandaNoBanco(supabase,');
    expect(comanda.indexOf('diffItensComanda(itensOriginais')).toBeGreaterThan(iFuncao);
  });

  it('erros da função na tela em português; já fechada recarrega o dia', () => {
    expect(comanda).toContain('ErroGravacaoComanda');
    expect(comanda).toMatch(/function mensagemFalhaGravacao\(/);
    expect(comanda).toContain('já teve a comanda fechada');
    expect(comanda).toContain('Recarregue o dia');
  });

  it('sucesso pela função: mesmo pós-sucesso + recarga do dia (totalDia com desconto rateado)', () => {
    const i = comanda.indexOf('function concluirFechamento(');
    expect(i).toBeGreaterThan(-1);
    const corpo = comanda.slice(i, i + 2500);
    for (const t of ['marcarAgendamentosFechados(', 'setSucesso(', 'fetchBacklog(', 'setProximoCliente(']) expect(corpo).toContain(t);
    expect(comanda).toMatch(/function concluirEdicao\(/);
    expect(comanda.match(/recarregarDia\(\)/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('M7: fechamento manda linha tirada com R$ 0 e a reabertura junta linhas que não somam o valor', () => {
    expect(comanda).toMatch(/from '@\/lib\/comanda-linhas'/);
    expect(comanda).toContain('completarLinhasTiradas(');
    const i = comanda.indexOf('async function abrirComandaFechada(');
    expect(comanda.slice(i, i + 3000)).toContain('linhasConferemComValor(');
  });

  it('Vendas: vendaId um por carrinho, limpo só no sucesso ou em "Nova venda"', () => {
    expect(vendas).toMatch(/import \{ novoUuid \} from '@shared\/uuid'/);
    expect(vendas).toMatch(/const vendaIdRef = useRef<string>\(novoUuid\(\)\)/);
    expect(vendas).toContain('vendaId: vendaIdRef.current');
    expect(vendas.match(/vendaIdRef\.current = novoUuid\(\)/g)?.length).toBe(1);
    const iLimpar = vendas.indexOf('function limparVenda()');
    expect(vendas.slice(iLimpar, iLimpar + 400)).toContain('vendaIdRef.current = novoUuid()');
  });

  it('o web nunca importa mobile/ e preserva CRLF', () => {
    for (const f of [comanda, vendas]) {
      expect(f).not.toMatch(/from '[^']*mobile\//);
      expect(f.replace(/\r\n/g, '')).not.toContain('\n');
    }
  });
});

import { completarLinhasTiradas, linhasConferemComValor } from '@/lib/comanda-linhas';

describe('web: linhas de multi-serviço (M7)', () => {
  const ag = {
    id: 'AG1', valor: 120,
    agendamento_servicos: [
      { id: 'AS1', valor: 80, ordem: 1, servico: { id: 'S1', nome: 'Corte' } },
      { id: 'AS2', valor: 40, ordem: 2, servico: { id: 'S2', nome: 'Escova' } },
    ],
  };
  const linha = (as: string, valor: number) => ({ tipo: 'agendamento' as const, descricao: as, valor, quantidade: 1, agendamento_id: 'AG1', ag_servico_id: as });

  it('linha tirada de um atendimento que ficou na comanda vai com R$ 0', () => {
    const r = completarLinhasTiradas([linha('AS1', 80)], [ag]);
    expect(r).toHaveLength(2);
    expect(r[1]).toMatchObject({ tipo: 'agendamento', agendamento_id: 'AG1', ag_servico_id: 'AS2', valor: 0, quantidade: 1, descricao: 'Escova' });
  });
  it('atendimento tirado inteiro não volta; sem linha tirada nada muda', () => {
    expect(completarLinhasTiradas([], [ag])).toEqual([]);
    const ambos = [linha('AS1', 80), linha('AS2', 40)];
    expect(completarLinhasTiradas(ambos, [ag])).toEqual(ambos);
  });
  it('atendimento sem linhas (valor único) não ganha linhas', () => {
    const it1 = { tipo: 'agendamento' as const, descricao: 'X', valor: 120, quantidade: 1, agendamento_id: 'AG1' };
    expect(completarLinhasTiradas([it1], [ag])).toEqual([it1]);
  });
  it('linhasConferemComValor: soma das linhas = valor do atendimento (centavos)', () => {
    expect(linhasConferemComValor(ag)).toBe(true);
    expect(linhasConferemComValor({ ...ag, valor: 80 })).toBe(false);
    expect(linhasConferemComValor({ ...ag, valor: '120.00' })).toBe(true);
    expect(linhasConferemComValor({ ...ag, agendamento_servicos: [] })).toBe(false);
  });
});
