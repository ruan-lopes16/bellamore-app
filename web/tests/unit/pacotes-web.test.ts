import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assinaturaVendaPacote, chaveVendaPacote, vendaPacoteFoiGravada, venderPacoteSem096, MSG_VENDA_JA_GRAVADA, ErroPacote,
} from '@shared/pacotes-venda';
import { filtrarVendidos, lerValidadeDias, quantidadeValida, ratearValorPago } from '@shared/pacotes';
import { tem096 as detectarMigration096, marcarComboUtilizado, sincronizarServicosPacote } from '@shared/pacotes-consultas';
import { configIndisponivel } from '@shared/taxas-cartao';

// ── Client falso: cada chamada grava a cadeia; `responder` decide a resposta do await ─────────
type Op = [string, unknown[]];
type Resp = { data: unknown[] | null; error: { code?: string; message: string } | null };
function db(responder: (tabela: string, ops: Op[]) => Resp = () => ({ data: [{ id: 'x' }], error: null })) {
  const chamadas: { tabela: string; ops: Op[] }[] = [];
  return {
    chamadas,
    db: {
      from(tabela: string) {
        const c = { tabela, ops: [] as Op[] };
        chamadas.push(c);
        const b: Record<string, unknown> = new Proxy({}, {
          get(_a, prop) {
            if (prop === 'then') return (ok: (v: Resp) => unknown) => ok(responder(tabela, c.ops));
            return (...args: unknown[]) => { c.ops.push([String(prop), args]); return b; };
          },
        });
        return b;
      },
    },
  };
}
const temOp = (ops: Op[], m: string) => ops.some(([x]) => x === m);
async function falha(fn: () => Promise<unknown>) { try { await fn(); } catch (e) { return e as Error; } return null; }

const base = { empresaId: 'e', clienteId: 'c', pacoteId: 'p', quantidade: 2, valorUnit: 100, desconto: 0, cobranca: 'agora' as const, pagamentos: [] };

describe('chave da venda de pacote', () => {
  it('assinatura ignora a chave e muda com o conteúdo', () => {
    expect(assinaturaVendaPacote(base)).toBe(assinaturaVendaPacote({ ...base }));
    expect(assinaturaVendaPacote(base)).not.toBe(assinaturaVendaPacote({ ...base, quantidade: 3 }));
    expect(assinaturaVendaPacote(base)).not.toBe(assinaturaVendaPacote({ ...base, cobranca: 'comanda' }));
    expect(assinaturaVendaPacote(base)).not.toContain('"venda_id"');
  });
  it('1ª tentativa usa a chave da abertura; mesma venda reaproveita; mudou → nova; mudou após sem resposta → bloqueia', () => {
    const gerar = () => 'nova';
    expect(chaveVendaPacote(null, 'k0', 'a', gerar)).toBe('k0');
    expect(chaveVendaPacote({ chave: 'k0', assinatura: 'a', semResposta: true }, 'k0', 'a', gerar)).toBe('k0');
    expect(chaveVendaPacote({ chave: 'k0', assinatura: 'a', semResposta: false }, 'k0', 'b', gerar)).toBe('nova');
    expect(chaveVendaPacote({ chave: 'k0', assinatura: 'a', semResposta: true }, 'k0', 'b', gerar)).toBeNull();
  });
  it('conferência: pacote_clientes com id = chave (096) ou vendas (caminho antigo)', async () => {
    const f = db((t) => ({ data: t === 'vendas' ? [{ id: 'k' }] : [], error: null }));
    expect(await vendaPacoteFoiGravada(f.db, 'k')).toBe(true);
    expect(f.chamadas.map(c => c.tabela)).toEqual(['pacote_clientes', 'vendas']);
    expect(await vendaPacoteFoiGravada(db(() => ({ data: [], error: null })).db, 'k')).toBe(false);
    expect(await falha(() => vendaPacoteFoiGravada(db(() => ({ data: null, error: { message: 'x' } })).db, 'k'))).toBeInstanceOf(Error);
  });
});

describe('valores', () => {
  it('rateia o líquido em centavos, o resto nas primeiras unidades', () => {
    expect(ratearValorPago(100, 3, 0.01)).toEqual([100, 100, 99.99]);
    expect(ratearValorPago(10, 3, 0)).toEqual([10, 10, 10]);
    expect(ratearValorPago(100, 3, 100)).toEqual([66.67, 66.67, 66.66]);
    expect(ratearValorPago(50, 1, 50)).toEqual([0]);
    expect(ratearValorPago(100, 3, 100).reduce((s, v) => s + Math.round(v * 100), 0)).toBe(20000);
  });
  it('quantidade de 1 a 100, inteira', () => {
    expect([1, 100].every(quantidadeValida)).toBe(true);
    expect([0, 101, 1.5, NaN].some(quantidadeValida)).toBe(false);
  });
  it('validade: sem validade = null; senão inteiro ≥ 1', () => {
    expect(lerValidadeDias('', true)).toEqual({ valor: null, erro: null });
    expect(lerValidadeDias('30', false)).toEqual({ valor: 30, erro: null });
    expect(lerValidadeDias('', false).erro).toMatch(/Sem validade/);
    expect(lerValidadeDias('0', false).erro).not.toBeNull();
  });
});

describe('detecção da 096', () => {
  it('coluna cobranca existe → true; inexistente → false; outro erro → null', async () => {
    expect(await detectarMigration096(db(() => ({ data: [], error: null })).db)).toBe(true);
    expect(await detectarMigration096(db(() => ({ data: null, error: { message: 'column pacote_clientes.cobranca does not exist' } })).db)).toBe(false);
    expect(await detectarMigration096(db(() => ({ data: null, error: { message: 'Failed to fetch' } })).db)).toBeNull();
  });
});

describe('venda sem a 096 (Cobrar agora)', () => {
  const venda = {
    vendaId: 'k1', empresaId: 'e', clienteId: 'c', pacote: { id: 'p', validade_dias: null },
    quantidade: 2, valorUnit: 100, desconto: 10, splits: [{ metodo: 'pix', valor: 190 }], config: configIndisponivel(),
  };
  it('grava vendas (receita), os pacotes rateados e os pagamentos da venda', async () => {
    const f = db();
    expect(await venderPacoteSem096(f.db, venda)).toEqual({ pacoteClienteId: 'x', aviso: null });
    expect(f.chamadas.map(c => c.tabela)).toEqual(['vendas', 'pacote_clientes', 'pagamentos']);
    const vendaIns = f.chamadas[0].ops.find(([m]) => m === 'insert')![1][0];
    expect(vendaIns).toEqual({ id: 'k1', empresa_id: 'e', cliente_id: 'c', valor_total: 200, desconto: 10, observacao: 'Pacote' });
    expect(temOp(f.chamadas[0].ops, 'select')).toBe(false); // sem RETURNING
    const pacotes = f.chamadas[1].ops.find(([m]) => m === 'insert')![1][0] as { valor_pago: number; data_validade: unknown }[];
    expect(pacotes.map(p => p.valor_pago)).toEqual([95, 95]);
    expect(pacotes[0].data_validade).toBeNull();
    const pags = f.chamadas[2].ops.find(([m]) => m === 'insert')![1][0] as { venda_id: string; valor: number }[];
    expect(pags).toMatchObject([{ venda_id: 'k1', valor: 190, metodo: 'pix' }]);
  });
  it('falha nos pacotes desfaz a venda', async () => {
    const f = db((t, ops) => (t === 'pacote_clientes' ? { data: null, error: { code: '23514', message: 'x' } } : { data: [{ id: 'k1' }], error: null }));
    const e = await falha(() => venderPacoteSem096(f.db, venda));
    expect(e).toBeInstanceOf(ErroPacote);
    expect(e!.message).toMatch(/Nada foi registrado/);
    const del = f.chamadas.find(c => c.tabela === 'vendas' && temOp(c.ops, 'delete'));
    expect(del && temOp(del.ops, 'select')).toBe(true);
  });
  it('chave repetida (23505) = já registrada; falha nos pagamentos vira aviso', async () => {
    const e = await falha(() => venderPacoteSem096(db(() => ({ data: null, error: { code: '23505', message: 'dup' } })).db, venda));
    expect(e!.message).toContain(MSG_VENDA_JA_GRAVADA);
    const r = await venderPacoteSem096(db(t => (t === 'pagamentos' ? { data: null, error: { code: '42501', message: 'rls' } } : { data: [], error: null })).db, venda);
    expect(r.aviso).toMatch(/Confira no Financeiro/);
  });
  it('quantidade e desconto inválidos são recusados antes do banco', async () => {
    const f = db();
    expect((await falha(() => venderPacoteSem096(f.db, { ...venda, quantidade: 0 })))!.message).toMatch(/de 1 a 100/);
    expect((await falha(() => venderPacoteSem096(f.db, { ...venda, desconto: 999 })))!.message).toMatch(/maior que o subtotal/);
    expect(f.chamadas).toEqual([]);
  });
});

describe('escritas conferidas', () => {
  it('combo utilizado confere as linhas', async () => {
    expect(await marcarComboUtilizado(db().db, 'e', 'pc')).toBeNull();
    expect(await marcarComboUtilizado(db(() => ({ data: [], error: null })).db, 'e', 'pc')).toMatch(/não tem permissão/);
  });
  it('composição por diferença: upsert do que fica, depois apaga só os que saíram, linhas conferidas', async () => {
    const f = db((t, ops) => ({ data: temOp(ops, 'delete') ? [{ servico_id: 'a' }] : [{ servico_id: 'b' }, { servico_id: 'c' }], error: null }));
    expect(await sincronizarServicosPacote(f.db, 'p', ['a', 'b'], [{ servico_id: 'b', quantidade: 2 }, { servico_id: 'c', quantidade: null }])).toBeNull();
    expect(temOp(f.chamadas[0].ops, 'upsert')).toBe(true);
    const del = f.chamadas[1].ops.find(([m]) => m === 'in')![1];
    expect(del).toEqual(['servico_id', ['a']]);
    expect(await sincronizarServicosPacote(db(() => ({ data: [], error: null })).db, 'p', [], [{ servico_id: 'b', quantidade: 1 }])).toMatch(/não tem permissão/);
    expect(await sincronizarServicosPacote(db(() => ({ data: null, error: { code: '23503', message: 'fk' } })).db, 'p', ['a'], [])).not.toBeNull();
  });
});

describe('filtro A cobrar', () => {
  const v = (statusExibido: 'ativo' | 'concluido' | 'expirado' | 'cancelado', cobranca: 'paga' | 'pendente') => ({ statusExibido, cobranca });
  const lista = [v('ativo', 'pendente'), v('ativo', 'paga'), v('cancelado', 'pendente'), v('expirado', 'paga')];
  it('a cobrar = pendente fora cancelado; cancelado só em Todos', () => {
    expect(filtrarVendidos(lista, 'a_cobrar')).toEqual([lista[0]]);
    expect(filtrarVendidos(lista, 'ativo')).toHaveLength(2);
    expect(filtrarVendidos(lista, 'todos')).toHaveLength(4);
  });
});

// ── Telas ─────────────────────────────────────────────────────────────────────────────────────
const ler = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const pagina = ler('app/(app)/pacotes/page.tsx');
const modal = ler('components/pacotes/VenderPacoteModal.tsx');
const sessoes = ler('components/pacotes/GerenciarSessoes.tsx');
const form = ler('components/pacotes/PacoteForm.tsx');
const relatorio = ler('components/pacotes/RelatorioPacotes.tsx');

describe('tela de Pacotes (web)', () => {
  it('cargas e regras de shared', () => {
    expect(pagina).toContain('carregarCatalogoPacotes(supabase');
    expect(pagina).toContain('carregarPacotesVendidos(supabase');
    expect(pagina).toContain('carregarRelatorioUtilizacao(supabase');
    expect(pagina).toContain('statusPacoteCliente(');
    expect(pagina).toContain('rotuloValidade(');
    expect(pagina).not.toContain("from('pacote_clientes')");
  });
  it('Vendidos: filtro e selo "A cobrar"', () => {
    expect(pagina).toContain("key: 'a_cobrar'");
    expect(pagina).toMatch(/A cobrar/);
    expect(pagina).toContain('filtrarVendidos(');
    expect(pagina).toContain('Cancelado');
  });
  it('excluir vendido pela função, com confirmação; sem a 096 a exclusão fica indisponível', () => {
    expect(pagina).toContain('excluirPacoteCliente(supabase');
    expect(pagina).toContain('instanceof SemMigration096');
    expect(pagina).toContain('MSG_EXCLUSAO_SEM_096');
    expect(pagina).not.toContain('excluirVendidoSem096');
    expect(pagina).toMatch(/<ConfirmDialog[\s\S]*?excluirVenda/);
  });
  it('combo utilizado conferido (sem flip otimista)', () => {
    expect(pagina).toContain('marcarComboUtilizado(supabase');
  });
  it('erro de carga mostra "—" e aviso, nunca zeros', () => {
    expect(pagina).toMatch(/erroCarga/);
    expect(pagina).toContain("'—'");
  });
  it('permissões: catálogo pacotes.gerenciar, vender pacotes.vender, vendido por acoesPacoteVendido', () => {
    expect(pagina).toContain("pode('pacotes.gerenciar')");
    expect(pagina).toContain("pode('pacotes.vender')");
    expect(pagina).toContain('acoesPacoteVendido(pode)');
  });
});

describe('VenderPacoteModal', () => {
  it('exportável, com padraoCobranca e cliente opcional', () => {
    expect(modal).toMatch(/export function VenderPacoteModal\(/);
    expect(modal).toContain("padraoCobranca: 'agora' | 'comanda'");
    expect(modal).toContain('clienteInicial?:');
  });
  it('chave gerada uma vez por abertura e reaproveitada na nova tentativa', () => {
    expect(modal).toMatch(/useState\(\(\) => novoUuid\(\)\)|useRef\(novoUuid\(\)\)/);
    expect(modal).toContain('chaveVendaPacote(');
    expect(modal).toContain('vendaPacoteFoiGravada(supabase');
  });
  it('grava por venderPacote; sem a 096 cai no caminho antigo e esconde "Cobrar na comanda"', () => {
    expect(modal).toContain('venderPacote(supabase');
    expect(modal).toContain('instanceof SemMigration096');
    expect(modal).toContain('venderPacoteSem096(supabase');
    expect(modal).toMatch(/import \{[^}]*\btem096\b[^}]*\} from '@shared\/pacotes-consultas'/);
    expect(modal).toMatch(/\{tem096 !== false && \([\s\S]{0,600}Cobrar na comanda/);
  });
  it('bloco de pagamento da Venda avulsa: maquininha, bandeira, parcelas, taxa', () => {
    expect(modal).toContain('carregarConfigCartoes(supabase');
    expect(modal).toContain('montarPagamentos(');
    expect(modal).toContain('resumoComanda(');
    expect(modal).toContain('calcularDesconto(');
    expect(modal).toContain('BlocoPagamento');
    const bloco = ler('components/pacotes/BlocoPagamento.tsx');
    for (const f of ['maquininhasAtivas(', 'bandeirasAtivas(', 'parcelasDisponiveis(', 'taxaDoSplit(', 'Taxa não cadastrada para esta combinação']) expect(bloco).toContain(f);
  });
  it('desconto e cortesia só com comanda.desconto; clientes paginadas', () => {
    expect(modal).toContain("pode('comanda.desconto')");
    expect(modal).toContain('buscarTodasOuLancar');
  });
});

describe('GerenciarSessoes', () => {
  it('pede confirmação ao excluir uma sessão', () => {
    expect(sessoes).toContain('<ConfirmDialog');
    expect(sessoes).toMatch(/Excluir sessão\?/);
  });
  it('cargas com erro conferido', () => {
    expect(sessoes).toMatch(/rUso\.error/);
    expect(sessoes).toMatch(/rAg\.error/);
  });
});

describe('PacoteForm', () => {
  it('tipo, ∞, preço e validade livre ou "Sem validade"; composição por diferença', () => {
    expect(form).toContain('Combo');
    expect(form).toContain('∞');
    expect(form).toContain('Sem validade');
    expect(form).toContain('validarPacote(');
    expect(form).toContain('sincronizarServicosPacote(supabase');
    expect(form).not.toContain('lerPrecoServico('); // o preço é lido dentro de validarPacote (shared)
  });
  it('composição bloqueada se a contagem de vendidos falhou', () => {
    expect(form).toContain('vendidosIndisponivel');
  });
});

describe('RelatorioPacotes', () => {
  it('mostra "A cobrar" e a receita só dos pagos', () => {
    expect(relatorio).toContain('aCobrar');
    expect(relatorio).toContain('receitaTotal');
  });
});
