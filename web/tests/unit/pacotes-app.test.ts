import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Task 6 da paridade de Serviços e Pacotes: a tela de Pacotes do app fica igual à do web
// (cadastro completo, venda única "agora" ou "na comanda", filtro "A cobrar", exclusão pela
// função, aba Relatório com exportação; saldo e status pelas funções de shared).
const raiz = join(process.cwd(), '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8').replace(/\r\n/g, '\n');

const TELA = 'mobile/app/(empresa)/pacotes.tsx';
const NOVO = 'mobile/app/(empresa)/novo-pacote.tsx';
const EDITAR = 'mobile/app/(empresa)/editar-pacote/[id].tsx';
const HOOK = 'mobile/hooks/usePacotes.ts';
const DIR_COMP = 'mobile/components/pacotes';
const SHEET = `${DIR_COMP}/VenderPacoteSheet.tsx`;

function componentes(): string {
  const dir = join(raiz, DIR_COMP);
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map(f => ler(`${DIR_COMP}/${f}`))
    .join('\n');
}

describe('app: Pacotes (paridade com o web)', () => {
  const tela = ler(TELA);
  const novo = ler(NOVO);
  const editar = ler(EDITAR);
  const hook = ler(HOOK);
  const comp = componentes();
  const tudo = [tela, novo, editar, hook, comp].join('\n');

  it('saldo e status pela regra única de shared (sem cópia no hook)', () => {
    expect(hook).toContain("from '@shared/pacotes-consultas'");
    expect(hook).toContain('carregarCatalogoPacotes(supabase');
    expect(hook).toContain('carregarPacotesVendidos(supabase');
    expect(hook).toContain('statusPacoteCliente(');
    expect(hook).toContain('saldoSessoes(');
    expect(hook).toContain('hojeBRT(');
    expect(hook).not.toMatch(/isPast|parseISO/);
    expect(hook).not.toMatch(/usadas >= totalSessoes/);
  });

  it('sem validade continua sem validade: nenhum "?? 90", nem regra de data local', () => {
    for (const f of [tela, novo, editar, hook, comp]) {
      expect(f).not.toMatch(/validade_dias \?\? 90/);
      expect(f).not.toMatch(/isPast\(parseISO\(/);
      expect(f).not.toMatch(/new Date\(\w*validade\w*\) >= /);
    }
    expect(comp).toContain('Sem validade');
    expect(tela).toContain('rotuloValidade(');
  });

  it('cadastro: tipo Com sessões/Combo, ∞ por serviço, validade livre, num componente único', () => {
    expect(novo).toContain('<PacoteForm');
    expect(editar).toContain('<PacoteForm');
    const form = ler(`${DIR_COMP}/PacoteForm.tsx`);
    expect(form).toContain('Com sessões');
    expect(form).toContain('Combo');
    expect(form).toContain('controla_sessoes');
    expect(form).toContain('∞');
    expect(form).toMatch(/accessibilityLabel="Validade em dias"/);
    // A tela sempre envia a validade explícita (null = sem validade)
    expect(form).toMatch(/validade_dias: validadeN/);
  });

  it('composição por diferença, com o erro conferido (upsert + delete do que saiu, com .select)', () => {
    const form = ler(`${DIR_COMP}/PacoteForm.tsx`);
    expect(form).toMatch(/from\('pacote_servicos'\)\s*\.upsert\([\s\S]*?onConflict: 'pacote_id,servico_id'[\s\S]*?\.select\('servico_id'\)/);
    expect(form).toMatch(/from\('pacote_servicos'\)\s*\.delete\(\)[\s\S]*?\.in\('servico_id', aRemover\)[\s\S]*?\.select\('servico_id'\)/);
    expect(form).not.toMatch(/from\('pacote_servicos'\)\.delete\(\)\.eq\('pacote_id', id\);/);
    expect(form).not.toMatch(/from\('pacote_servicos'\)\.insert\(/);
  });

  it('erro na contagem de "já vendido" bloqueia a composição até recarregar', () => {
    const form = ler(`${DIR_COMP}/PacoteForm.tsx`);
    expect(form).toContain("select('id', { count: 'exact', head: true })");
    expect(form).toContain('erroVendido');
    expect(form).toContain(MSG_VENDIDO_ERRO);
    expect(form).toMatch(/const composicaoTravada = jaVendido \|\| !!erroVendido/);
  });

  it('venda pelo catálogo: VenderPacoteSheet exportável, com cobrança agora ou na comanda', () => {
    expect(tela).toContain("from '@/components/pacotes/VenderPacoteSheet'");
    expect(tela).toContain('<VenderPacoteSheet');
    expect(tela).toContain("pode('pacotes.vender')");
    const sheet = ler(SHEET);
    expect(sheet).toMatch(/export function VenderPacoteSheet\(/);
    expect(sheet).toContain("padraoCobranca: 'agora' | 'comanda'");
    expect(sheet).toContain('Cobrar agora');
    expect(sheet).toContain('Cobrar na comanda');
    expect(sheet).toContain('venderPacote(supabase');
    expect(sheet).toContain('PagamentosEditor');
    expect(sheet).toContain('montarPagamentos(');
    expect(sheet).toContain('calcularDesconto(');
    expect(sheet).toContain('resumoComanda(');
    expect(sheet).toContain("pode('comanda.desconto')");
    expect(sheet).toContain('carregarConfigCartoes(supabase');
    expect(sheet).toContain('invalidarFinanceiro(qc)');
  });

  it('chave da venda: novoUuid uma vez por abertura, reaproveitada na nova tentativa', () => {
    const sheet = ler(SHEET);
    expect(sheet).toContain("from '@shared/uuid'");
    expect((sheet.match(/novoUuid\(\)/g) ?? []).length).toBe(1);
    expect(sheet).toMatch(/useState\(\(\) => novoUuid\(\)\)/);
    expect(sheet).toContain('semResposta');
  });

  it('nenhum insert direto em pacote_clientes fora do caminho sem a 096', () => {
    const sheet = ler(SHEET);
    const inserts = [...sheet.matchAll(/from\('pacote_clientes'\)\.insert\(/g)];
    expect(inserts.length).toBe(1);
    const ini = sheet.indexOf('async function venderSem096');
    expect(ini).toBeGreaterThan(-1);
    expect(inserts[0].index!).toBeGreaterThan(ini);
    expect(sheet).toContain('SemMigration096');
    // Sem a 096 "Cobrar na comanda" fica escondido
    expect(sheet).toMatch(/tem096 &&/);
    for (const f of [tela, novo, editar, hook]) expect(f).not.toMatch(/from\('pacote_clientes'\)\s*\.insert\(/);
  });

  it('sem a 096, "Cobrar agora" grava também vendas e pagamentos', () => {
    const sheet = ler(SHEET);
    const ini = sheet.indexOf('async function venderSem096');
    const corpo = sheet.slice(ini, sheet.indexOf('\n}\n', ini));
    expect(corpo).toContain("from('vendas').insert(");
    expect(corpo).toContain("observacao: 'Pacote'");
    expect(corpo).toContain("from('pagamentos').insert(");
    expect(corpo).toContain('ratearDescontoCentavos(');
  });

  it('vendidos: filtro "A cobrar" e selo', () => {
    expect(tela).toContain("key: 'a_cobrar'");
    expect(tela).toContain('A cobrar');
    expect(tela).toMatch(/cobranca === 'pendente'/);
  });

  it('excluir venda pela função, com confirmação; sem a 096 o caminho antigo conferido', () => {
    expect(tela).toContain('excluirPacoteCliente(supabase');
    expect(tela).toContain('SemMigration096');
    expect(tela).toContain("'Excluir venda?'");
    expect(tela).toMatch(/from\('pacote_clientes'\)\s*\.delete\(\)[\s\S]*?\.select\('id'\)/);
  });

  it('marcar combo como utilizado confere as linhas', () => {
    const ini = tela.indexOf('async function marcarComboUtilizado');
    const corpo = tela.slice(ini, tela.indexOf('\n  }', ini));
    expect(corpo).toContain(".update({ status: 'concluido' })");
    expect(corpo).toContain(".select('id')");
    expect(corpo).toMatch(/length === 0/);
  });

  it('aba Relatório com exportação pela definição única', () => {
    expect(tela).toContain("key: 'relatorio'");
    expect(tela).toContain('Relatório');
    expect(tela).toContain('calcularRelatorioUtilizacao(');
    expect(tela).toContain('definicaoPacotesUtilizacao(');
    expect(tela).toContain('definicaoPacotesCatalogo(');
    expect(tela).toContain('definicaoPacotesVendidos(');
  });

  it('cargas com erro mostram "—" e aviso, nunca zeros', () => {
    expect(tela).toContain("'—'");
    expect(tela).toMatch(/isError/);
  });

  it('textos em português, sem error.message cru nas telas de pacote', () => {
    expect(tudo).not.toMatch(/Alert\.alert\('Erro', \w+\.message\)/);
    expect(tudo).not.toMatch(/setErro\(e0\.message\)/);
  });
});

const MSG_VENDIDO_ERRO = 'Não foi possível conferir se este pacote já foi vendido. Os serviços ficam travados até recarregar.';
