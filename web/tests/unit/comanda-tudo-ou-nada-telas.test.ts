import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = join(process.cwd(), '..');
const ler = (...p: string[]) => readFileSync(join(raiz, ...p), 'utf8');

describe('app', () => {
  const comanda = ler('mobile', 'app', '(empresa)', 'nova-comanda.tsx');
  const vendas = ler('mobile', 'app', '(empresa)', 'vendas.tsx');

  it('fechar: monta o payload pela regra única e chama a função antes do caminho antigo', () => {
    expect(comanda).toMatch(/from '@shared\/comanda-gravacao'/);
    expect(comanda).toContain('montarPayloadFechamento(');
    const iFuncao = comanda.indexOf('fecharComandaNoBanco(supabase,');
    expect(iFuncao).toBeGreaterThan(-1);
    // A conferência de duplicidade e o INSERT antigo só rodam quando a função não existe:
    // na nova tentativa depois de "sem resposta", a função devolve a comanda já gravada.
    expect(comanda.indexOf(".in('id', agIdsNaComanda)")).toBeGreaterThan(iFuncao);
    expect(comanda.indexOf(".from('comandas').insert(")).toBeGreaterThan(iFuncao);
    expect(comanda).toMatch(/via === 'antigo'/);
  });

  it('I1: chave nova sem pendente; só "sem resposta" guarda a tentativa; conteúdo alterado bloqueia com Recarregar', () => {
    expect(comanda).not.toContain('chaveComandaRef');
    expect(comanda).toContain('useState<Record<string, TentativaSemResposta>>({})');
    const i = comanda.indexOf('async function fecharComanda(');
    const corpo = comanda.slice(i, i + 5000);
    expect(corpo).toContain('assinaturaGravacao(payload)');
    expect(corpo).toContain('chaveDaTentativa(pendentes[cartao] ?? null, cartao, assinatura)');
    expect(corpo).toMatch(/if \(!chave\) \{[\s\S]{0,120}AVISO_REPETIR_ALTERADO/);
    expect(corpo).toMatch(/e instanceof ErroGravacaoComanda && e\.semResposta\)[\s\S]{0,120}\[cartao\]: \{ chave, assinatura, cartao \}/);
    expect(corpo).toContain('{ ...payload, comanda_id: chave }');
    // Cartão inclui o dia: `cliente|aberta` se repete entre dias.
    expect(comanda).toContain('`${chaveDiaExibido(dataComanda)}|${c.chave}`');
    // abrirComanda não troca chave nenhuma (a pendência do cartão continua valendo ao reabrir).
    const iAbrir = comanda.indexOf('function abrirComanda(');
    expect(comanda.slice(iAbrir, iAbrir + 800)).not.toMatch(/novoUuid|setPendentes/);
  });

  it('I1: Recarregar confere no banco (tentativaFoiGravada); gravou → relê o dia, volta e avisa', () => {
    const i = comanda.indexOf('async function conferirTentativaPendente(');
    expect(i).toBeGreaterThan(-1);
    const corpo = comanda.slice(i, i + 1500);
    for (const t of ["tentativaFoiGravada(supabase, 'comandas', p.chave)", 'resolverPendente(cartao)', 'carregarDia()', 'voltarParaLista()', 'AVISO_COMANDA_JA_GRAVADA']) {
      expect(corpo).toContain(t);
    }
    expect(comanda).toContain("{conferindoPendente ? 'Conferindo...' : 'Recarregar'}");
  });

  it('M1: recarga do dia mantém a configuração de cartões boa numa falha passageira', () => {
    expect(comanda).toContain('const configCarregadaRef = useRef(false)');
    expect(comanda).toContain('if (!rCartoes.erro) { configCarregadaRef.current = true; setConfig(rCartoes.config); }');
    expect(comanda).toContain('else if (!configCarregadaRef.current) setConfig(rCartoes.config);');
  });

  it('M5: quantidade de pacote inteira na tela', () => {
    const i = comanda.indexOf('function atualizarQtd(');
    expect(comanda.slice(i, i + 400)).toContain("i.tipo === 'pacote' ? Math.max(1, Math.round(q)) : q");
  });

  it('editar: estado completo pela função, extra novo com id gerado na tela e pagamento reaberto com id', () => {
    expect(comanda).toContain('montarPayloadEdicao(');
    expect(comanda).toContain('editarComandaNoBanco(supabase,');
    expect(comanda).toMatch(/novo_item_id: novoUuid\(\)/);
    expect(comanda).toMatch(/item_id: i\.item_id \?\? i\.novo_item_id/);
    expect(comanda).toMatch(/pagamentoId: +p\.id/);
    expect(comanda).toMatch(/const base = 'id,metodo,valor/);
  });

  it('M2: erros da função pelo mesmo texto do web; título não repete a mensagem; relê só se já fechada', () => {
    const i = comanda.indexOf('function avisarErroFuncao(');
    const corpo = comanda.slice(i, i + 500);
    expect(corpo).toContain("Alert.alert(semResposta ? 'Atenção' : 'Erro', mensagemFalhaGravacao(e, acao))");
    expect(corpo).toContain('if (ehComandaJaFechada(e)) carregarDia()');
    expect(comanda).not.toContain("'Sem resposta do servidor'");
    expect(comanda).toContain("Alert.alert('Atenção', AVISO_COMANDA_JA_FECHADA)");
  });

  it('sucesso pela função: mesmo pós-sucesso e recarga do dia (totalDia com o desconto rateado)', () => {
    const i = comanda.indexOf('function concluirFechamento(');
    expect(i).toBeGreaterThan(-1);
    const corpo = comanda.slice(i, i + 3500);
    for (const t of ['invalidarFinanceiro(qc)', 'invalidarEstoque()', 'carregarBacklog()', 'carregarDia()', "setEtapa('sucesso')", 'marcarAgendamentosFechados(']) {
      expect(corpo).toContain(t);
    }
  });

  it('M7/M3: multi-serviço reaberto pela regra de shared (linhas que não somam viram uma linha "A + B")', () => {
    expect(comanda).not.toMatch(/function linhasConferemComValor\(/);
    const i = comanda.indexOf('async function abrirComandaFechada(');
    const corpo = comanda.slice(i, i + 3000);
    expect(corpo).toContain('linhasConferemComValor(');
    expect(corpo).toContain('descricaoLinhasAgrupadas(linhas, ag.servico)');
  });

  it('preserva CRLF', () => {
    expect(comanda.replace(/\r\n/g, '')).not.toContain('\n');
    expect(vendas.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('Vendas (I1): chave por chaveDaTentativa; trava completa com pendente; Nova venda e Recarregar conferem', () => {
    expect(vendas).not.toContain('vendaIdRef');
    expect(vendas).toContain('const travada = !!vendaIncompleta || !!pendente;');
    expect(vendas).toContain("chaveDaTentativa(pendente, 'venda', assinatura)");
    expect(vendas).toContain('gravarVenda(supabase, { ...dados, vendaId: chave })');
    expect(vendas).toContain("setPendente(e.semResposta ? { chave, assinatura, cartao: 'venda' } : null)");
    expect(vendas).toContain("tentativaFoiGravada(supabase, 'vendas', pendente.chave)");
    const iNova = vendas.indexOf('function novaVenda()');
    expect(vendas.slice(iNova, iNova + 200)).toContain('if (pendente) { conferirPendente(true); return; }');
    // Trava: cliente, desconto, pagamentos e "Limpar"
    expect(vendas).toContain("pointerEvents={travada ? 'none' : 'auto'} style={{ opacity: travada ? 0.6 : 1 }}");
    expect(vendas).toContain('desabilitado={travada}');
    expect(vendas).toContain('{cart.length > 0 && !travada && (');
  });
});

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

  it('I1: chave nova sem pendente (sem vazamento por cliente|aberta); só "sem resposta" guarda; alterado bloqueia', () => {
    expect(comanda).not.toContain('chavesFechamentoRef');
    expect(comanda).toContain('useState<Record<string, TentativaSemResposta>>({})');
    const i = comanda.indexOf('async function fecharComanda(');
    const corpo = comanda.slice(i, i + 5000);
    expect(corpo).toContain('assinaturaGravacao(payload)');
    expect(corpo).toContain('chaveDaTentativa(pendentes[cartao] ?? null, cartao, assinatura)');
    expect(corpo).toContain('if (!chave) { setErro(AVISO_REPETIR_ALTERADO); setFechando(false); return; }');
    expect(corpo).toMatch(/e instanceof ErroGravacaoComanda && e\.semResposta\)[\s\S]{0,120}\[cartao\]: \{ chave, assinatura, cartao \}/);
    expect(corpo).toContain('{ ...payload, comanda_id: chave }');
    expect(comanda).toContain('`${chaveDiaExibido(dataComanda)}|${c.chave}`');
  });

  it('I1: Recarregar confere no banco; gravou → relê o dia, fecha o painel e avisa', () => {
    const i = comanda.indexOf('async function conferirTentativaPendente(');
    expect(i).toBeGreaterThan(-1);
    const corpo = comanda.slice(i, i + 1500);
    for (const t of ["tentativaFoiGravada(supabase, 'comandas', p.chave)", 'resolverPendente(cartao)', 'setClienteSel(null)', 'setToast(AVISO_COMANDA_JA_GRAVADA)', 'recarregarDia()']) {
      expect(corpo).toContain(t);
    }
    expect(comanda).toContain("{conferindoPendente ? 'Conferindo...' : 'Recarregar'}");
  });

  it('I2: recarregarDia relê as taxas de reserva pagas e liga o bloqueio se a leitura falhar', () => {
    const i = comanda.indexOf('async function recarregarDia(');
    const corpo = comanda.slice(i, i + 1600);
    expect(corpo).toContain('consultarTaxasReservaPagas(empresaId, agsDoDia.map(ag => ag.id))');
    expect(corpo).toContain("setErroTaxasReserva(mensagemErroBanco(rTaxas.error, 'carregar as taxas de reserva pagas'))");
    expect(corpo).toContain('setTaxasReservaPagas(');
    expect(corpo).toContain('setErroTaxasReserva(null)');
    // Taxas antes de setAgDia: o atendimento novo nunca aparece sem a reserva dele.
    expect(corpo.indexOf('consultarTaxasReservaPagas(')).toBeLessThan(corpo.indexOf('setAgDia('));
  });

  it('M5: quantidade de pacote inteira na tela', () => {
    const i = comanda.indexOf('function atualizarQtd(');
    expect(comanda.slice(i, i + 500)).toContain("if (i.tipo === 'pacote') return { ...i, quantidade: Math.max(1, Math.round(n) || 1) };");
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

  it('M2: erros da função pelo texto de shared (igual ao app); já fechada recarrega o dia', () => {
    expect(comanda).toContain('ErroGravacaoComanda');
    expect(comanda).not.toMatch(/function mensagemFalhaGravacao\(/);
    expect(comanda).toContain("setErro(mensagemFalhaGravacao(e, 'fechar a comanda'))");
    expect(comanda).toContain('if (ehComandaJaFechada(e)) recarregarDia();');
    expect(comanda).toContain('setErro(AVISO_COMANDA_JA_FECHADA);');
  });

  it('sucesso pela função: mesmo pós-sucesso + recarga do dia (totalDia com desconto rateado)', () => {
    const i = comanda.indexOf('function concluirFechamento(');
    expect(i).toBeGreaterThan(-1);
    const corpo = comanda.slice(i, i + 2500);
    for (const t of ['marcarAgendamentosFechados(', 'setSucesso(', 'fetchBacklog(', 'setProximoCliente(']) expect(corpo).toContain(t);
    expect(comanda).toMatch(/function concluirEdicao\(/);
    expect(comanda.match(/recarregarDia\(\)/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('M7/M3: linha tirada com R$ 0 e reabertura agrupada pelas regras de shared/comanda', () => {
    expect(comanda).not.toMatch(/comanda-linhas/);
    expect(comanda).toContain('completarLinhasTiradas(');
    const i = comanda.indexOf('async function abrirComandaFechada(');
    const corpo = comanda.slice(i, i + 3000);
    expect(corpo).toContain('linhasConferemComValor(');
    expect(corpo).toContain('descricaoLinhasAgrupadas(servicos, ag.servico)');
  });

  it('Vendas (I1): chave por chaveDaTentativa; trava completa com pendente; Nova venda e Recarregar conferem', () => {
    expect(vendas).not.toContain('vendaIdRef');
    expect(vendas).toContain('const carrinhoTravado = !!vendaIncompleta || !!pendente;');
    expect(vendas).toContain("chaveDaTentativa(pendente, 'venda', assinatura)");
    expect(vendas).toContain('gravarVenda(supabase, { ...dados, vendaId: chave })');
    expect(vendas).toContain("setPendente(e.semResposta ? { chave, assinatura, cartao: 'venda' } : null)");
    expect(vendas).toContain("tentativaFoiGravada(supabase, 'vendas', pendente.chave)");
    const iNova = vendas.indexOf('function novaVenda()');
    expect(vendas.slice(iNova, iNova + 200)).toContain('if (pendente) { conferirPendente(true); return; }');
    // Trava: cliente + desconto e pagamentos em <fieldset disabled>, chips e "Limpar".
    expect(vendas.match(/<fieldset disabled=\{carrinhoTravado\}/g)?.length).toBe(2);
    expect(vendas).toContain('{cart.length > 0 && !carrinhoTravado && (');
  });

  it('o web nunca importa mobile/ e preserva CRLF', () => {
    for (const f of [comanda, vendas]) {
      expect(f).not.toMatch(/from '[^']*mobile\//);
      expect(f.replace(/\r\n/g, '')).not.toContain('\n');
    }
  });
});

import { completarLinhasTiradas, linhasConferemComValor, descricaoLinhasAgrupadas } from '@shared/comanda';

describe('shared/comanda: linhas de multi-serviço (M7/M3, web e app)', () => {
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
  it('descricaoLinhasAgrupadas: serviços na ordem, unidos por " + "; sem linhas, o serviço do atendimento', () => {
    expect(descricaoLinhasAgrupadas([...ag.agendamento_servicos].reverse())).toBe('Corte + Escova');
    expect(descricaoLinhasAgrupadas([], { nome: 'Corte' })).toBe('Corte');
    expect(descricaoLinhasAgrupadas(null)).toBe('Serviço');
  });
  it('linhasConferemComValor: soma das linhas = valor do atendimento (centavos)', () => {
    expect(linhasConferemComValor(ag)).toBe(true);
    expect(linhasConferemComValor({ ...ag, valor: 80 })).toBe(false);
    expect(linhasConferemComValor({ ...ag, valor: '120.00' })).toBe(true);
    expect(linhasConferemComValor({ ...ag, agendamento_servicos: [] })).toBe(false);
  });
});
