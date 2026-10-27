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

  it('composição por diferença pela função única de shared (upsert e depois o delete, conferidos)', () => {
    const form = ler(`${DIR_COMP}/PacoteForm.tsx`);
    expect(form).toContain('sincronizarServicosPacote(supabase, id, originais, gravar)');
    expect(form).not.toMatch(/from\('pacote_servicos'\)/);
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

  it('nenhum insert direto em pacote_clientes: o caminho sem a 096 é o de shared', () => {
    const sheet = ler(SHEET);
    for (const f of [sheet, tela, novo, editar, hook]) expect(f).not.toMatch(/from\('pacote_clientes'\)\s*\.insert\(/);
    expect(sheet).toContain('SemMigration096');
    expect(sheet).toContain('venderPacoteSem096(supabase');
    // Sem a 096 "Cobrar na comanda" fica escondido (null = não deu para saber: mostra, igual ao web)
    expect(sheet).toMatch(/tem096 !== false &&/);
  });

  it('vendidos: filtro "A cobrar" e selo', () => {
    expect(tela).toContain("key: 'a_cobrar'");
    expect(tela).toContain('A cobrar');
    expect(tela).toContain('filtrarVendidos(');
    expect(tela).toContain('estaACobrar(v)');
  });

  it('excluir venda pela função, com confirmação; sem a 096 a exclusão fica indisponível', () => {
    expect(tela).toContain('excluirPacoteCliente(supabase');
    expect(tela).toContain('SemMigration096');
    expect(tela).toContain('TITULO_EXCLUIR_VENDIDO');
    expect(tela).toContain('MSG_EXCLUSAO_SEM_096');
    expect(tela).not.toMatch(/from\('pacote_clientes'\)\s*\.delete\(\)/);
  });

  it('marcar combo como utilizado pela função conferida de shared', () => {
    expect(tela).toContain('marcarComboUtilizado(supabase, empresaId, pcId)');
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

const MSG_VENDIDO_ERRO = 'MSG_VENDIDO_NAO_CONFERIDO';
