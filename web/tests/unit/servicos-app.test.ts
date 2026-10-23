import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Task 4 da paridade de Serviços e Pacotes: a tela de Serviços do app fica igual à do web
// (duração livre, insumos, exclusão conferida pela função, validação única, "+" do grupo, cargas conferidas).
const raiz = join(process.cwd(), '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8').replace(/\r\n/g, '\n');

const LISTA = 'mobile/app/(empresa)/servicos.tsx';
const NOVO = 'mobile/app/(empresa)/novo-servico.tsx';
const EDITAR = 'mobile/app/(empresa)/editar-servico/[id].tsx';
const DIR_COMP = 'mobile/components/servicos';

function componentes(): string {
  const dir = join(raiz, DIR_COMP);
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map(f => ler(`${DIR_COMP}/${f}`))
    .join('\n');
}

describe('app: Serviços (paridade com o web)', () => {
  const lista = ler(LISTA);
  const novo = ler(NOVO);
  const editar = ler(EDITAR);
  const comp = componentes();
  const cadastro = [novo, editar, comp].join('\n');

  it('duração: atalhos de shared e "Personalizada" em horas e minutos', () => {
    expect(cadastro).toContain('DURACOES_PADRAO');
    expect(cadastro).toContain("from '@shared/servicos'");
    expect(cadastro).toContain('Personalizada');
    expect(comp).toMatch(/accessibilityLabel="Horas"/);
    expect(comp).toMatch(/accessibilityLabel="Minutos"/);
    // Nenhuma lista local de durações nas telas.
    for (const f of [novo, editar, comp]) expect(f).not.toMatch(/const DURACOES\s*=/);
  });

  it('validação única: validarServico, sem a regra local de nome/preço', () => {
    expect(cadastro).toContain('validarServico(');
    for (const f of [novo, editar, comp]) {
      expect(f).not.toMatch(/nome\.trim\(\)\.length > 1 && parseFloat/);
      expect(f).not.toMatch(/parseFloat\(preco/);
    }
  });

  it('insumos: mesmo editor e mesma gravação do web (shared, por diferença), erros conferidos', () => {
    expect(comp).toContain("from('produtos').select('id, nome, unidade')");
    expect(comp).toContain("from '@shared/servicos-consultas'");
    expect(comp).toContain('sincronizarInsumos(supabase');
    expect(comp).toContain('SELECT_INSUMOS_SERVICO');
    expect(comp).toContain('mapearInsumosCarregados(');
    expect(comp).not.toContain(".from('servico_produtos').delete()");
    expect(comp).not.toContain(".from('servico_produtos').insert(");
    expect(comp).toContain('Insumos consumidos');
    expect(comp).toContain('mas os insumos não');
  });

  it('salvar fica bloqueado até os insumos carregarem (não apaga a receita)', () => {
    expect(comp).toMatch(/insumosOriginais/);
    expect(comp).toContain('if (carregando) {');
    expect(comp).toContain('if (!empresaId || salvando || carregando) return;');
  });

  it('excluir pela função (shared), com a mensagem exata, e o botão Desativar', () => {
    expect(cadastro).toContain('excluirServicoConferido(supabase');
    expect(cadastro).toContain('MSG_SERVICO_USADO');
    expect(cadastro).toMatch(/text: 'Desativar'/);
    expect(cadastro).toMatch(/Excluir serviço/);
    expect(comp).not.toContain(".from('servicos').delete()");
  });

  it('preço lido e validado pela regra única', () => {
    expect(comp).toContain('lerPrecoServico(');
    expect(comp).not.toMatch(/function precoDigitado/);
  });

  it('ativar/desativar na lista usa a mensagem traduzida', () => {
    expect(lista).not.toContain("Alert.alert('Erro', error.message)");
    expect(lista).toContain('definirAtivoServico(');
  });

  it('"+" do grupo abre o cadastro com a categoria do grupo', () => {
    expect(lista).toMatch(/novo-servico[\s\S]{0,200}categoriaId/);
    expect(lista).toMatch(/novo-servico[\s\S]{0,200}categoria:/);
    expect(novo).toMatch(/useLocalSearchParams<\{[^}]*categoria\?: string/);
    expect(novo).toMatch(/useLocalSearchParams<\{[^}]*categoriaId\?: string/);
  });

  it('cargas conferem o erro de cada consulta', () => {
    expect(lista).toContain('if (rCat.error) throw rCat.error');
    expect(lista).toContain('isError');
    // Nenhuma carga que lê só `data` e ignora o erro.
    for (const f of [lista, novo, editar, comp]) expect(f).not.toMatch(/\.then\(\(\{ data \}\)/);
    expect(comp).toContain("mensagemErroBanco(errServ, 'carregar o serviço')");
    expect(comp).toContain("mensagemErroBanco(errProd, 'carregar os produtos')");
    expect(comp).toContain("mensagemErroBanco(errInsumos, 'carregar os insumos do serviço')");
    expect(comp).toContain("mensagemErroBanco(errCat, 'carregar as categorias')");
    // Contadores nunca mostram zero com erro ou carregando.
    expect(lista).toContain("isError || isLoading ? '—' : total");
  });

  it('lista mostra a duração formatada', () => {
    expect(lista).not.toContain('{servico.duracao_minutos} min');
    expect(lista).toContain('formatarDuracao(servico.duracao_minutos)');
  });
});
