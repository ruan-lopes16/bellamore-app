import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  montarPayloadFechamento, montarPayloadEdicao, itensTelaACobrar, mesclarItensACobrar, exigeVenderPacote,
  type EstadoFechamentoComanda, type ItemComandaTela,
} from '@shared/comanda-gravacao';
import { configLegada } from '@shared/taxas-cartao';

// Task 7 (web) da Paridade Serviços e Pacotes: Agenda vende pelo VenderPacoteModal e a Comanda
// cobra o pacote "a cobrar" (contrato: docs/superpowers/notes/2026-10-23-contrato-pacotes.md).
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

const pendentes = [
  { id: 'PC1', pacote_id: 'PK1', nome: 'Drenagem 10x', valor_pago: 450 },
  { id: 'PC2', pacote_id: 'PK2', nome: 'Limpeza 3x', valor_pago: 0 },
];

const estado = (e: Partial<EstadoFechamentoComanda>): EstadoFechamentoComanda => ({
  comandaId: 'C1', empresaId: 'E1', clienteId: 'CL1', desconto: 0, itens: [], pacoteLinks: {},
  splits: [], config: configLegada(null), ...e,
});

describe('itensTelaACobrar — itens "Pacote X — a cobrar" no formato da tela', () => {
  it('um item por pendente: pacote existente, valor combinado, quantidade 1', () => {
    expect(itensTelaACobrar(pendentes)).toEqual([
      { tipo: 'pacote', descricao: 'Pacote Drenagem 10x — a cobrar', valor: 450, quantidade: 1, pacote_id: 'PK1', pacote_cliente_id: 'PC1' },
      { tipo: 'pacote', descricao: 'Pacote Limpeza 3x — a cobrar', valor: 0, quantidade: 1, pacote_id: 'PK2', pacote_cliente_id: 'PC2' },
    ]);
  });
  it('sem pendentes (inclusive sem a 096) → nenhum item', () => {
    expect(itensTelaACobrar([])).toEqual([]);
  });
});

describe('mesclarItensACobrar — não repete o pendente já na comanda', () => {
  it('acrescenta só os pendentes que ainda não estão', () => {
    const atuais: ItemComandaTela[] = [
      { tipo: 'agendamento', descricao: 'Corte', valor: 80, quantidade: 1, agendamento_id: 'AG1' },
      ...itensTelaACobrar([pendentes[0]]),
    ];
    const novos = itensTelaACobrar(pendentes);
    const r = mesclarItensACobrar(atuais, novos);
    expect(r).toHaveLength(3);
    expect(r.filter(i => i.pacote_cliente_id === 'PC1')).toHaveLength(1);
    expect(r[2].pacote_cliente_id).toBe('PC2');
  });
  it('nada novo → devolve a mesma lista', () => {
    const atuais = itensTelaACobrar(pendentes);
    expect(mesclarItensACobrar(atuais, itensTelaACobrar(pendentes))).toBe(atuais);
  });
});

describe('exigeVenderPacote — "a cobrar" exige só comanda.fechar', () => {
  it('pacote novo exige pacotes.vender; "a cobrar" não', () => {
    expect(exigeVenderPacote(itensTelaACobrar(pendentes))).toBe(false);
    expect(exigeVenderPacote([{ tipo: 'pacote', descricao: 'Novo', valor: 300, quantidade: 1, pacote_id: 'PK1' }])).toBe(true);
    expect(exigeVenderPacote([{ tipo: 'produto', descricao: 'Óleo', valor: 30, quantidade: 1, produto_id: 'P1' }])).toBe(false);
  });
});

describe('montarPayloadFechamento — item "a cobrar" com pacote_cliente_id (contrato)', () => {
  it('vai com pacote_cliente_id, pacote_id, quantidade 1 e o valor combinado', () => {
    const p = montarPayloadFechamento(estado({
      itens: itensTelaACobrar([pendentes[0]]), splits: [{ metodo: 'pix', valor: 450 }],
    }));
    expect(p.itens).toEqual([{
      tipo: 'pacote', descricao: 'Pacote Drenagem 10x — a cobrar', quantidade: 1, valor_unit: 450,
      servico_id: null, profissional_id: null, produto_id: null, pacote_id: 'PK1', pacote_cliente_id: 'PC1',
    }]);
  });
  it('pacote novo (sem pendente) não leva a chave pacote_cliente_id', () => {
    const p = montarPayloadFechamento(estado({
      itens: [{ tipo: 'pacote', descricao: 'Drenagem 10x', valor: 450, quantidade: 2, pacote_id: 'PK1' }],
    }));
    expect(p.itens[0]).not.toHaveProperty('pacote_cliente_id');
    expect(p.itens[0].quantidade).toBe(2);
  });
  it('"a cobrar" vai sempre com quantidade 1, mesmo que a tela tenha outra', () => {
    const [i] = itensTelaACobrar([pendentes[0]]);
    const p = montarPayloadFechamento(estado({ itens: [{ ...i, quantidade: 3 }] }));
    expect(p.itens[0].quantidade).toBe(1);
  });
  it('item de outro tipo nunca leva pacote_cliente_id', () => {
    const p = montarPayloadFechamento(estado({
      itens: [{ tipo: 'produto', descricao: 'Óleo', valor: 30, quantidade: 1, produto_id: 'P1', pacote_cliente_id: 'PC9' }],
    }));
    expect(p.itens[0]).not.toHaveProperty('pacote_cliente_id');
  });
  it('tirar o item = não mandar: o pacote continua pendente', () => {
    const p = montarPayloadFechamento(estado({ itens: [] }));
    expect(p.itens).toEqual([]);
  });
});

describe('montarPayloadEdicao — pacotes congelados: pacote_cliente_id nunca vai', () => {
  it('descarta pacote_cliente_id na edição', () => {
    const p = montarPayloadEdicao({
      comandaId: 'C1', empresaId: 'E1', desconto: 0, splits: [], config: configLegada(null),
      itens: [{ ...itensTelaACobrar([pendentes[0]])[0], item_id: 'IT1' }],
    });
    expect(p.itens[0]).not.toHaveProperty('pacote_cliente_id');
    expect(p.itens[0].item_id).toBe('IT1');
  });
});

describe('Agenda web: venda pelo VenderPacoteModal, padrão "Cobrar na comanda"', () => {
  const web = ler('web/app/(app)/agenda/page.tsx');
  it('usa o modal único com padraoCobranca="comanda" e a cliente travada', () => {
    expect(web).toContain("from '@/components/pacotes/VenderPacoteModal'");
    expect(web).toMatch(/<VenderPacoteModal[\s\S]*?padraoCobranca="comanda"/);
    expect(web).toMatch(/<VenderPacoteModal[\s\S]*?travarCliente/);
  });
  it('vincula o atendimento ao pacoteClienteId devolvido', () => {
    expect(web).toMatch(/r\.pacoteClienteId/);
  });
  it('não grava mais a venda direto (pacote_clientes / vendas)', () => {
    expect(web).not.toMatch(/from\('pacote_clientes'\)\s*\.insert/);
    expect(web).not.toContain('Venda de pacote:');
    expect(web).not.toContain('pacoteVendidoRef');
  });
  it('elegibilidade pela regra única (sem a cópia inline)', () => {
    expect(web).toContain('calcularPacotesAtivosCliente(');
    expect(web).toContain('carregarCandidatosVinculo(');
    expect(web).not.toMatch(/isPast\(parseISO\(pc\.data_validade\)\)/);
    expect(web).not.toMatch(/type PacoteClienteOpt = \{/);
  });
});

describe('Comanda web: pacote "a cobrar"', () => {
  const web = ler('web/app/(app)/comanda/page.tsx');
  it('carrega os pendentes ao abrir a comanda nova e acrescenta os itens', () => {
    const i = web.indexOf('function abrirComanda(');
    const corpo = web.slice(i, web.indexOf('async function abrirComandaFechada('));
    expect(corpo).toContain('carregarPendentesCliente(');
    expect(corpo).toContain('itensTelaACobrar(');
    expect(corpo).toContain('mesclarItensACobrar(');
  });
  it('a edição de comanda fechada não acrescenta pendentes', () => {
    const i = web.indexOf('async function abrirComandaFechada(');
    const corpo = web.slice(i, web.indexOf('// ── Ler pagamentos', i) > 0 ? web.indexOf('// ── Ler pagamentos', i) : i + 4000);
    expect(corpo).not.toContain('carregarPendentesCliente(');
  });
  it('permissão: só pacote novo exige pacotes.vender', () => {
    expect(web).toContain('exigeVenderPacote(itens)');
    expect(web).not.toMatch(/!podeVenderPacote && itens\.some\(i => i\.tipo === 'pacote'\)/);
  });
  it('item "a cobrar": valor e quantidade só leitura, mas removível', () => {
    expect(web).toMatch(/const aCobrar = item\.tipo === 'pacote' && !!item\.pacote_cliente_id/);
    expect(web).toMatch(/valorSoLeitura = itemSoLeitura \|\| cobertoPorPacote \|\| aCobrar/);
  });
  it('elegibilidade do vínculo pela carga única e data de Brasília', () => {
    expect(web).toContain('carregarCandidatosVinculo(');
    expect(web).toMatch(/calcularPacotesAtivosCliente\([^)]*hojeBRT\(\)\)/);
  });
  it('caminho antigo (sem a 090) nunca recebe item "a cobrar" (venderia o pacote de novo)', () => {
    expect(web).toMatch(/itens\.some\(i => i\.pacote_cliente_id\)/);
  });
});
