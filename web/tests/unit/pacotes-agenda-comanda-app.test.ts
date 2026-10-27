import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Task 7 (app) da Paridade Serviços e Pacotes: a Agenda do app vende pelo VenderPacoteSheet (padrão
// "Cobrar na comanda") e a Comanda do app cobra o pacote "a cobrar" — mesmo comportamento do web
// (pacotes-agenda-comanda-web.test.ts). Contrato: docs/superpowers/notes/2026-10-23-contrato-pacotes.md.
// As regras puras (itensTelaACobrar, mesclarItensACobrar, exigeVenderPacote, payload) já estão
// testadas no teste do web; aqui se trava que o app as consome, sem cópias inline.
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

describe('Agenda app: venda pelo VenderPacoteSheet, padrão "Cobrar na comanda"', () => {
  const app = ler('mobile/app/(empresa)/novo-agendamento.tsx');
  it('usa a venda única com padraoCobranca="comanda" e a cliente travada', () => {
    expect(app).toContain("from '@/components/pacotes/VenderPacoteSheet'");
    expect(app).toMatch(/<VenderPacoteSheet[\s\S]*?padraoCobranca="comanda"/);
    expect(app).toMatch(/<VenderPacoteSheet[\s\S]*?cliente=\{/);
  });
  it('vincula o atendimento ao pacoteClienteId devolvido e preenche os serviços', () => {
    expect(app).toMatch(/r\.pacoteClienteId/);
    const i = app.indexOf('function onPacoteVendido(');
    expect(i).toBeGreaterThan(0);
    expect(app.slice(i, i + 1500)).toContain('preencherServicosDoPacote(');
  });
  it('não grava mais a venda direto no salvar (pacote_clientes / vendas)', () => {
    expect(app).not.toMatch(/from\('pacote_clientes'\)\s*\.insert/);
    expect(app).not.toContain('Venda de pacote:');
    expect(app).not.toContain('pacoteVendidoRef');
    expect(app).not.toContain('pacoteVenderId');
  });
  it('elegibilidade pela regra única no dia de Brasília (sem a cópia inline)', () => {
    expect(app).toContain('carregarCandidatosVinculo(');
    expect(app).toMatch(/calcularPacotesAtivosCliente\([^)]*hojeBRT\(\)\)/);
    expect(app).not.toMatch(/new Date\(pc\.data_validade\)/);
    expect(app).not.toMatch(/type PacoteClienteOpt\s*=\s*\{/);
  });
});

describe('Comanda app: pacote "a cobrar"', () => {
  const app = ler('mobile/app/(empresa)/nova-comanda.tsx');
  const corpoAbrir = () => {
    const i = app.indexOf('function abrirComanda(');
    return app.slice(i, app.indexOf('async function abrirComandaFechada(', i));
  };
  it('carrega os pendentes ao abrir a comanda nova e acrescenta os itens', () => {
    const corpo = corpoAbrir();
    expect(corpo).toContain('carregarPendentesCliente(');
    expect(corpo).toContain('itensTelaACobrar(');
    expect(corpo).toContain('mesclarItensACobrar(');
    expect(corpo).toMatch(/cliente\.id !== '__sem__'/);
  });
  it('resposta de uma abertura antiga é descartada (aberturaRef)', () => {
    const corpo = corpoAbrir();
    expect(corpo).toMatch(/const abertura = \+\+aberturaRef\.current/);
    expect(corpo).toMatch(/aberturaRef\.current !== abertura/);
  });
  it('a edição de comanda fechada não acrescenta pendentes', () => {
    const i = app.indexOf('async function abrirComandaFechada(');
    const fim = app.indexOf('\n  }\n', i);
    expect(app.slice(i, fim)).not.toContain('carregarPendentesCliente(');
  });
  it('permissão: só pacote novo exige pacotes.vender', () => {
    expect(app).toContain('exigeVenderPacote(itens)');
    expect(app).not.toMatch(/!podeVenderPacote && itens\.some\(i => i\.tipo === 'pacote'\)/);
  });
  it('item "a cobrar": valor e quantidade só leitura, mas removível', () => {
    expect(app).toMatch(/const aCobrar = item\.tipo === 'pacote' && !!item\.pacote_cliente_id/);
    expect(app).toMatch(/valorSoLeitura = itemSoLeitura \|\| cobertoPorPacote \|\| aCobrar/);
    expect(app).toMatch(/qtdSoLeitura = emEdicao \|\| aCobrar/);
    expect(app).toContain('o pacote continua a cobrar');
  });
  it('elegibilidade do vínculo pela carga única e data de Brasília', () => {
    expect(app).toContain('carregarCandidatosVinculo(');
    expect(app).toMatch(/calcularPacotesAtivosCliente\([^)]*hojeBRT\(\)\)/);
    expect(app).not.toMatch(/calcularPacotesAtivosCliente\([^)]*format\(new Date\(\)/);
  });
  it('caminho antigo (sem a 090) recusa item "a cobrar" (venderia o pacote de novo)', () => {
    const i = app.indexOf("if (resultadoFechamento.via === 'funcao')");
    const j = app.indexOf("from('comandas').insert", i);
    const trecho = app.slice(i, j);
    expect(trecho).toMatch(/itens\.some\(i => i\.pacote_cliente_id\)/);
    expect(trecho).toContain('Não foi possível cobrar o pacote a cobrar nesta versão do banco. Tire o item da comanda para fechar.');
  });
});
