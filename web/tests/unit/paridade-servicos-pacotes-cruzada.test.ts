/**
 * Paridade Serviços e Pacotes (web × app) — varredura cruzada (spec
 * docs/superpowers/specs/2026-10-23-paridade-servicos-pacotes-design.md, Task 8;
 * contrato docs/superpowers/notes/2026-10-23-contrato-pacotes.md).
 *
 * Trava:
 * - as telas nas funções de shared e nas RPCs da 096 (pelos wrappers de shared, nunca `.rpc` direto);
 * - nenhum INSERT direto em `pacote_clientes` fora do caminho antigo (sem a 096 / sem a 090);
 * - nenhuma cópia de validade (`?? 90`, `isPast(parseISO(validade))`, `new Date(validade) >= hoje`, `addDays(..., validade_dias)`);
 * - os mesmos textos nas duas plataformas (constantes e funções de shared + rótulos literais iguais);
 * - as mesmas abas e os mesmos filtros em Pacotes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (f: string) => readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n');
/** Código sem comentários (o que vale é o que roda; comentário pode citar a regra antiga). */
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const codigo = (f: string) => semComentarios(ler(f));
/** Texto que a pessoa vê: entidades do JSX do web normalizadas. */
const texto = (s: string) => s.replace(/&quot;/g, '"');

// ── Telas por lado ──────────────────────────────────────────────────────────
const WEB_PACOTES = [
  'web/app/(app)/pacotes/page.tsx', 'web/components/pacotes/PacoteForm.tsx',
  'web/components/pacotes/GerenciarSessoes.tsx', 'web/components/pacotes/RelatorioPacotes.tsx',
];
const APP_PACOTES = [
  'mobile/app/(empresa)/pacotes.tsx', 'mobile/components/pacotes/PacoteForm.tsx', 'mobile/hooks/usePacotes.ts',
];
const WEB_VENDA = 'web/components/pacotes/VenderPacoteModal.tsx';
const APP_VENDA = 'mobile/components/pacotes/VenderPacoteSheet.tsx';
const WEB_SERVICOS = ['web/app/(app)/servicos/page.tsx'];
const APP_SERVICOS = [
  'mobile/app/(empresa)/servicos.tsx', 'mobile/components/servicos/ServicoForm.tsx',
  'mobile/components/servicos/servicos-gravacao.ts', 'mobile/components/servicos/DuracaoSeletor.tsx',
];
const WEB_AGENDA = 'web/app/(app)/agenda/page.tsx';
const APP_AGENDA = 'mobile/app/(empresa)/novo-agendamento.tsx';
const WEB_COMANDA = 'web/app/(app)/comanda/page.tsx';
const APP_COMANDA = 'mobile/app/(empresa)/nova-comanda.tsx';

const junta = (fs: string[]) => fs.map(codigo).join('\n');
const LADOS = {
  pacotes: { web: junta([...WEB_PACOTES, WEB_VENDA]), app: junta([...APP_PACOTES, APP_VENDA]) },
  servicos: { web: junta(WEB_SERVICOS), app: junta(APP_SERVICOS) },
  agenda: { web: codigo(WEB_AGENDA), app: codigo(APP_AGENDA) },
  comanda: { web: codigo(WEB_COMANDA), app: codigo(APP_COMANDA) },
};
const nasDuas = (lado: keyof typeof LADOS, trechos: string[]) => {
  for (const [plataforma, src] of Object.entries(LADOS[lado])) {
    for (const t of trechos) expect(src, `${lado} ${plataforma}: ${t}`).toContain(t);
  }
};

/** Todos os .ts/.tsx de código das duas plataformas e de shared (sem node_modules/.next/testes). */
function arquivosDeCodigo(): string[] {
  const out: string[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      if (nome === 'node_modules' || nome === '.next' || nome === 'tests' || nome.startsWith('.')) continue;
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) andar(p);
      else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) out.push(relative(root, p).replace(/\\/g, '/'));
    }
  };
  for (const d of ['web/app', 'web/components', 'web/lib', 'mobile/app', 'mobile/components', 'mobile/hooks', 'mobile/lib', 'shared']) {
    andar(join(root, d));
  }
  return out;
}
const TODOS = arquivosDeCodigo();

describe('varredura: o conjunto de arquivos é o esperado', () => {
  it('encontra as telas e shared', () => {
    for (const f of [...WEB_PACOTES, ...APP_PACOTES, WEB_VENDA, APP_VENDA, ...WEB_SERVICOS, ...APP_SERVICOS,
      WEB_AGENDA, APP_AGENDA, WEB_COMANDA, APP_COMANDA, 'shared/pacotes.ts', 'shared/pacotes-venda.ts']) {
      expect(TODOS).toContain(f);
    }
  });
});

describe('Pacotes: as duas telas pelas funções de shared', () => {
  it('cargas, status, saldo e filtros', () => {
    nasDuas('pacotes', [
      'carregarCatalogoPacotes(', 'carregarPacotesVendidos(', 'statusPacoteCliente(', 'saldoSessoes(',
      'filtrarVendidos(', 'rotuloStatusVendido(', 'estaACobrar(', 'rotuloValidade(',
    ]);
  });
  it('relatório de utilização pela regra única (web carrega e calcula em shared; app calcula dos vendidos)', () => {
    expect(LADOS.pacotes.web).toContain('carregarRelatorioUtilizacao(');
    expect(LADOS.pacotes.app).toContain('calcularRelatorioUtilizacao(');
  });
  it('cadastro: validação e composição únicas', () => {
    nasDuas('pacotes', ['validarPacote(', 'sincronizarServicosPacote(']);
    for (const src of Object.values(LADOS.pacotes)) {
      expect(src).not.toMatch(/from\('pacote_servicos'\)\s*\.(insert|upsert|delete)/);
    }
  });
  it('sessões: permissões, escrita conferida e desfazer vínculo pelas funções de shared', () => {
    nasDuas('pacotes', ['acoesPacoteVendido(', 'atendimentosVinculaveis(', 'erroEscritaPacoteUso(', 'desfazerVinculoPacote(', 'marcarComboUtilizado(']);
  });
  it('excluir vendido pela função (096) e venda pelo modal único com "Cobrar agora" de padrão', () => {
    nasDuas('pacotes', ['excluirPacoteCliente(', 'padraoCobranca="agora"']);
    expect(LADOS.pacotes.web).toContain('<VenderPacoteModal');
    expect(LADOS.pacotes.app).toContain('<VenderPacoteSheet');
  });
  it('venda: mesma regra de bloqueio, chave, caminho antigo, valor e rótulos', () => {
    nasDuas('pacotes', [
      'venderPacote(', 'venderPacoteSem096(', 'motivoBloqueioVendaPacote(', 'assinaturaVendaPacote(', 'chaveVendaPacote(',
      'valorPacoteEditavel(', 'textoBotaoVenderPacote(', 'subtotalVendaPacote(', 'dataValidade(',
    ]);
  });
});

describe('Serviços: as duas telas pelas funções de shared', () => {
  it('validação, preço, duração, insumos e exclusão conferida', () => {
    nasDuas('servicos', [
      'validarServico(', 'lerPrecoServico(', 'DURACOES_PADRAO', 'sincronizarInsumos(', 'mapearInsumosCarregados(',
      'excluirServicoConferido(',
    ]);
  });
  it('nenhum DELETE direto em servicos nas telas (só por excluirServicoConferido)', () => {
    for (const f of TODOS.filter(x => !x.startsWith('shared/'))) {
      expect(codigo(f), f).not.toMatch(/from\('servicos'\)\s*\.delete\(/);
    }
  });
});

describe('Agenda e Comanda: venda única e pacote "a cobrar" pelas mesmas funções', () => {
  it('Agenda: modal/sheet único com "Cobrar na comanda", elegibilidade pela regra única em Brasília, aviso único', () => {
    nasDuas('agenda', [
      'padraoCobranca="comanda"', 'carregarCandidatosVinculo(', 'calcularPacotesAtivosCliente(rows, hojeBRT())',
      'avisoVendaPacoteAgenda(r)', 'if (formTravado) return;',
    ]);
    expect(LADOS.agenda.web).toContain('<VenderPacoteModal');
    expect(LADOS.agenda.app).toContain('<VenderPacoteSheet');
  });
  it('Comanda: pendentes, itens "a cobrar", permissão e textos de shared', () => {
    nasDuas('comanda', [
      'carregarPendentesCliente(', 'itensTelaACobrar(', 'mesclarItensACobrar(', 'exigeVenderPacote(itens)',
      'carregarCandidatosVinculo(', 'hojeBRT()', 'TEXTO_ITEM_A_COBRAR', 'TITULO_TIRAR_A_COBRAR',
      'MSG_A_COBRAR_SEM_090', 'AVISO_PENDENTES_NAO_CARREGADOS',
    ]);
  });
  it('payload do fechamento pela função única (o pacote_cliente_id só vai no fechamento)', () => {
    nasDuas('comanda', ['montarPayloadFechamento(', 'montarPayloadEdicao(']);
    const g = codigo('shared/comanda-gravacao.ts');
    expect(g).toContain('.map(i => montarItem(i, true))');
    expect(g).toContain('...montarItem(i, false)');
  });
});

describe('RPCs da 096 só pelos wrappers de shared', () => {
  it('nenhuma tela chama vender_pacote, excluir_pacote_cliente, excluir_servico ou fechar_comanda direto', () => {
    for (const f of TODOS.filter(x => !x.startsWith('shared/'))) {
      expect(codigo(f), f).not.toMatch(/\.rpc\(\s*'(vender_pacote|excluir_pacote_cliente|excluir_servico|fechar_comanda|editar_comanda)'/);
    }
    const venda = codigo('shared/pacotes-venda.ts');
    for (const fn of ['vender_pacote', 'excluir_pacote_cliente', 'excluir_servico']) expect(venda).toContain(`'${fn}'`);
  });
});

describe('pacote_clientes: nenhuma gravação direta fora do caminho antigo', () => {
  /** Índices de cada `.from('pacote_clientes')` seguido de insert/upsert/update/delete. */
  const escritas = (src: string, op: string) =>
    [...src.matchAll(new RegExp(`from\\('pacote_clientes'\\)\\s*\\.${op}\\(`, 'g'))].map(m => m.index ?? -1);

  it('INSERT só em venderPacoteSem096 (shared) e no caminho sem a 090 da comanda (web e app)', () => {
    const permitidos = ['shared/pacotes-venda.ts', WEB_COMANDA, APP_COMANDA];
    for (const f of TODOS) {
      const src = codigo(f);
      const ins = [...escritas(src, 'insert'), ...escritas(src, 'upsert')];
      if (!permitidos.includes(f)) { expect(ins, f).toEqual([]); continue; }
      expect(ins.length, f).toBe(1);
    }
    // shared: dentro de venderPacoteSem096 (a venda "Cobrar agora" sem a 096, com `vendas` antes).
    const venda = codigo('shared/pacotes-venda.ts');
    const ini = venda.indexOf('export async function venderPacoteSem096(');
    expect(ini).toBeGreaterThan(0);
    const [i] = escritas(venda, 'insert');
    expect(i).toBeGreaterThan(ini);
    expect(venda.indexOf("db.from('vendas').insert(", ini)).toBeLessThan(i);
    // Comanda: depois da recusa do item "a cobrar" no caminho antigo (que só roda sem a 090).
    for (const f of [WEB_COMANDA, APP_COMANDA]) {
      const src = codigo(f);
      const m = /if \(itens\.some\(i => i\.pacote_cliente_id\)\) \{[^}]*MSG_A_COBRAR_SEM_090/.exec(src);
      expect(m, f).not.toBeNull();
      const guarda = m!.index;
      // A guarda fica depois do caminho da função (090): só o caminho antigo chega nela.
      const iFuncao = src.lastIndexOf("via === 'funcao'", guarda);
      expect(iFuncao, f).toBeGreaterThan(src.indexOf('montarPayloadFechamento('));
      expect(src.indexOf('montarPayloadFechamento('), f).toBeGreaterThan(0);
      expect(escritas(src, 'insert')[0], f).toBeGreaterThan(guarda);
    }
  });
  it('UPDATE e DELETE só em shared (marcar combo; exclusão pela função)', () => {
    for (const f of TODOS.filter(x => !x.startsWith('shared/'))) {
      const src = codigo(f);
      expect(escritas(src, 'update'), f).toEqual([]);
      expect(escritas(src, 'delete'), f).toEqual([]);
    }
  });
});

describe('validade: nenhuma cópia da regra fora de shared/pacotes', () => {
  it('sem `?? 90`, `isPast(parseISO(validade))`, `new Date(validade) >= hoje` nem `addDays(..., validade_dias)`', () => {
    for (const f of TODOS) {
      const src = codigo(f);
      expect(src, f).not.toMatch(/validade_dias\s*(\?\?|\|\|)\s*90/);
      expect(src, f).not.toMatch(/isPast\(\s*parseISO\([^)]*validade/);
      expect(src, f).not.toMatch(/new Date\([^)]*validade[^)]*\)\s*>=/);
      expect(src, f).not.toMatch(/addDays\([^)]*validade_dias/);
    }
  });
  it('a regra existe uma vez: pacoteValidoEm e dataValidade em shared/pacotes', () => {
    const p = codigo('shared/pacotes.ts');
    expect(p).toContain('export function pacoteValidoEm(');
    expect(p).toContain('export function dataValidade(');
    for (const f of TODOS.filter(x => x !== 'shared/pacotes.ts')) {
      expect(codigo(f), f).not.toMatch(/function (pacoteValidoEm|dataValidade)\(/);
    }
  });
});

describe('textos: os mesmos nas duas plataformas', () => {
  it('constantes e funções de texto de shared usadas nas duas telas de Pacotes', () => {
    nasDuas('pacotes', [
      'TEXTO_COBRANCA', 'MSG_COMANDA_INDISPONIVEL', 'DICA_VALOR_PACOTE_CATALOGO',
      'textoExcluirVendido(', 'TITULO_EXCLUIR_VENDIDO', 'MSG_SESSOES_USADAS', 'MSG_EXCLUSAO_SEM_096',
      'TITULO_EXCLUIR_SESSAO', 'textoExcluirSessao(', 'textoVendidosVazio(', 'MSG_VENDIDO_A_COBRAR',
      'tituloSucessoVendaPacote(', 'MSG_VENDIDO_NAO_CONFERIDO',
    ]);
  });
  it('rótulos literais iguais (o web e o app mostram exatamente o mesmo texto)', () => {
    const web = texto(LADOS.pacotes.web);
    const app = texto(LADOS.pacotes.app);
    for (const t of [
      'Vender pacote', 'Cobrar agora', 'Cobrar na comanda', 'Sem validade — vale enquanto houver sessões',
      'Gerenciar sessões', 'Nova sessão avulsa', 'Vincular atendimento concluído', 'Vincular atendimento já realizado',
      'Marcar como utilizado', 'Nenhuma sessão registrada.', 'Tipo de pacote', 'Com sessões', 'Combo',
      'Sessões ilimitadas', 'Editar pacote', 'Criar pacote',
      'Pacote já vendido — o tipo, os serviços e as quantidades não podem ser alterados.',
    ]) {
      expect(web, `web: ${t}`).toContain(t);
      expect(app, `app: ${t}`).toContain(t);
    }
  });
  it('Agenda: os mesmos textos da venda de pacote', () => {
    for (const src of Object.values(LADOS.agenda).map(texto)) {
      expect(src).toContain('Pacote vendido agora: ');
      expect(src).toContain('A venda abre com "Cobrar na comanda": o valor entra ao fechar a comanda.');
      expect(src).not.toContain('Escolha-o em "Pacote do cliente"');
    }
  });
  it('nenhuma cópia literal dos textos que vêm de shared', () => {
    const copias = [
      'O pacote fica "A cobrar" e entra na próxima comanda da cliente.',
      'Este pacote já tem sessões usadas. Para cancelar, fale com a dona.',
      'Excluir pacote vendido ainda não está disponível',
      'A sessão volta ao saldo do pacote',
      'Será cobrado ao fechar a comanda da cliente',
      'Valor combinado na venda do pacote',
      'O pacote foi vendido e fica a cobrar na próxima comanda.',
      'Este serviço já foi usado. Desative em vez de excluir.',
    ];
    for (const f of TODOS.filter(x => !x.startsWith('shared/'))) {
      const src = codigo(f);
      for (const c of copias) expect(src.includes(c), `${f}: ${c}`).toBe(false);
    }
  });
});

describe('Pacotes: mesmas abas e mesmos filtros', () => {
  /** Chaves e rótulos (até o primeiro número/parêntese) das SmoothTabs de um arquivo. */
  const abas = (f: string) => [...codigo(f).matchAll(/\{\s*key:\s*'(\w+)',\s*label:\s*[`']([^`'$(]*)/g)]
    .map(m => `${m[1]}:${m[2].trim()}`);
  it('web e app: Catálogo, Vendidos, Relatório e os filtros Todos, Ativos, Concluídos, Expirados, A cobrar', () => {
    const esperado = [
      'catalogo:Catálogo', 'vendidos:Vendidos', 'relatorio:Relatório',
      'todos:Todos', 'ativo:Ativos', 'concluido:Concluídos', 'expirado:Expirados', 'a_cobrar:A cobrar',
    ];
    expect(abas('web/app/(app)/pacotes/page.tsx')).toEqual(esperado);
    expect(abas('mobile/app/(empresa)/pacotes.tsx')).toEqual(esperado);
  });
  it('os filtros são os de filtrarVendidos (FiltroVendidos)', () => {
    expect(codigo('shared/pacotes.ts')).toMatch(/export type FiltroVendidos = 'todos' \| 'ativo' \| 'concluido' \| 'expirado' \| 'a_cobrar';/);
  });
});
