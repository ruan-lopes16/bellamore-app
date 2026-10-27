import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  CATALOGO_PERMISSOES, CHAVES_PERMISSAO, podeArquivarCliente, podeEditarAnamnese,
  type Acesso, type ChavePermissao,
} from '@shared/permissoes';

/**
 * Matriz de permissões (docs/superpowers/notes/2026-10-14-matriz-permissoes.md): tela e banco
 * de acordo nas 27 chaves. Trava as correções da revisão de 2026-10-14 (migration 089).
 */
const raiz = join(process.cwd(), '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');

function arquivos(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(raiz, dir))) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const rel = `${dir}/${f}`;
    if (statSync(join(raiz, rel)).isDirectory()) arquivos(rel, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) out.push(rel);
  }
  return out;
}

const PASTAS_TELA = ['web/app', 'web/components', 'web/lib', 'mobile/app', 'mobile/components', 'mobile/lib', 'mobile/hooks'];
const fontes = PASTAS_TELA.flatMap(d => arquivos(d)).map(p => ({ p: p.split(sep).join('/'), src: ler(p) }));
const fontesComShared = [...fontes, ...arquivos('shared').map(p => ({ p: p.split(sep).join('/'), src: ler(p) }))];

const migrations = readdirSync(join(raiz, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
const sqlPermissoes = migrations
  .filter(f => Number(f.slice(0, 3)) >= 83)
  .map(f => ler(`supabase/migrations/${f}`))
  .join('\n');
const sql089 = ler('supabase/migrations/089_permissoes_alinhamento.sql');
const sql093 = ler('supabase/migrations/093_alinhamentos_finais.sql');
const matriz = ler('docs/superpowers/notes/2026-10-14-matriz-permissoes.md');

/**
 * Chaves que nenhuma policy/função confere, com o motivo. Vazio desde a 090: comanda.editar_fechada
 * (antes F1, só tela) passou a ser conferida em editar_comanda.
 */
const SO_TELA: Partial<Record<ChavePermissao, string>> = {};

describe('matriz de permissões — catálogo', () => {
  it('toda chave usada na tela (web e app) existe no catálogo', () => {
    const usadas = new Set<string>();
    const padroes = [
      /\bpode\(\s*(?:\w+\s*,\s*)?['"]([a-z_]+\.[a-z_]+)['"]\s*\)/g,
      /\bpermissao:\s*['"]([a-z_]+\.[a-z_]+)['"]/g,
      /\bexigirAcesso\(\s*\w+\s*,\s*['"]([a-z_]+\.[a-z_]+)['"]\s*\)/g,
      /\bresolverPermissao\([^)]*?['"]([a-z_]+\.[a-z_]+)['"]\s*\)/g,
    ];
    for (const { src } of fontes) for (const re of padroes) for (const m of src.matchAll(re)) usadas.add(m[1]);
    expect(usadas.size).toBeGreaterThan(15);
    for (const c of usadas) expect(CHAVES_PERMISSAO, c).toContain(c);
  });

  it('toda chave do catálogo aparece num tem_permissao do banco (083+) ou está marcada como só tela', () => {
    const noBanco = new Set([...sqlPermissoes.matchAll(/tem_permissao\([^,()]+,\s*'([a-z_]+\.[a-z_]+)'\)/g)].map(m => m[1]));
    for (const { chave } of CATALOGO_PERMISSOES) {
      if (SO_TELA[chave]) {
        // A marcação precisa ser verdadeira: se um dia o banco passar a conferir, sai da lista.
        expect(noBanco.has(chave), `${chave} está em SO_TELA mas aparece no banco`).toBe(false);
      } else {
        expect(noBanco.has(chave), `${chave} sem policy nem marcação "só tela"`).toBe(true);
      }
    }
  });

  it('a matriz tem uma linha por chave e registra as chaves só tela', () => {
    for (const { chave } of CATALOGO_PERMISSOES) expect(matriz, chave).toMatch(new RegExp(`\\| \`${chave.replace('.', '\\.')}\` \\|`));
    for (const chave of Object.keys(SO_TELA)) expect(matriz).toMatch(new RegExp(`\`${chave.replace('.', '\\.')}\`[^\\n]*Só tela`));
  });
});

describe('matriz de permissões — RETURNING que a policy de SELECT recusa', () => {
  /** Trecho do comando que começa no índice `i` (até o `;` de profundidade 0). */
  function comando(src: string, i: number): string {
    let prof = 0;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if ('({['.includes(c)) prof++;
      else if (')}]'.includes(c)) prof--;
      else if (c === ';' && prof <= 0) return src.slice(i, j);
    }
    return src.slice(i);
  }

  it.each(['comandas', 'agendamentos'])('nenhum INSERT em %s com RETURNING (.select) nas telas', tabela => {
    // comandas: a recém-criada não está ligada a atendimento (bug da Thalia, 4088486).
    // agendamentos: com agenda.gerenciar_outras e sem agenda.ver_equipe a linha da colega não é lida (D3).
    const re = new RegExp(`\\.from\\(\\s*['"]${tabela}['"]\\s*\\)\\s*\\.insert\\(`, 'g');
    const achados: string[] = [];
    for (const { p, src } of fontesComShared) {
      for (const m of src.matchAll(re)) {
        const cmd = comando(src, m.index!);
        if (/\.select\(/.test(cmd)) achados.push(`${p}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(achados).toEqual([]);
  });
});

describe('matriz de permissões — UPDATE/DELETE sempre com .select (sem sucesso falso)', () => {
  /**
   * Exceções conferidas uma a uma (F9 da matriz): linha da própria pessoa (RLS = ela mesma),
   * service role nas rotas de API, ou tabela sem chave no catálogo e liberada a todo membro.
   */
  const EXCECOES: Record<string, string> = {
    'web/app/(app)/agenda/page.tsx agendamento_servicos.delete': 'apagar 0 linhas é legítimo (atendimento sem linhas); erro conferido',
    'web/app/(app)/comanda/page.tsx pagamentos.delete': 'conferido logo depois por contagem (conferirDeleteVazio)',
    'web/app/(app)/configuracoes/page.tsx empresas.update': 'logo da empresa: só a dona chega aqui',
    'web/app/(app)/configuracoes/page.tsx users.update': 'perfil da própria pessoa',
    'web/app/(app)/notificacoes/page.tsx notificacoes.update': 'notificações da própria pessoa',
    'web/app/api/convites/route.ts users.update': 'service role',
    'web/app/api/cron/lembretes/route.ts web_push_subscriptions.delete': 'service role',
    'web/app/api/cron/lembretes/route.ts agendamentos.update': 'service role',
    'web/app/api/cron/resumo-diario/route.ts web_push_subscriptions.delete': 'service role',
    'web/app/api/profissionais/route.ts users.upsert': 'service role',
    'web/app/api/profissionais/route.ts users.update': 'service role',
    'web/app/api/profissionais/route.ts empresa_membros.update': 'service role',
    'web/app/api/push/subscribe/route.ts web_push_subscriptions.upsert': 'assinatura de push da própria pessoa',
    'mobile/app/(empresa)/novo-agendamento.tsx agendamento_servicos.delete': 'apagar 0 linhas é legítimo (atendimento sem linhas); erro conferido (igual ao web)',
    'mobile/app/(empresa)/configuracoes.tsx users.update': 'perfil da própria pessoa',
    'mobile/app/(empresa)/editar-pacote/[id].tsx pacote_servicos.delete': 'remover 0 serviços é legítimo; erro conferido',
    'mobile/app/(empresa)/pacotes.tsx agendamentos.update': 'excluir venda: desvincular 0 atendimentos é legítimo; o DELETE seguinte confere',
    'mobile/app/(empresa)/pacotes.tsx pacote_clientes.delete': 'pacote_clientes liberado a todo membro (F7)',
    'mobile/app/(empresa)/pacotes.tsx pacote_clientes.update': 'pacote_clientes liberado a todo membro (F7)',
    'mobile/app/(profissional)/configuracoes.tsx users.update': 'perfil da própria pessoa',
    'mobile/hooks/useNotificacoes.ts notificacoes.update': 'notificações da própria pessoa',
    'mobile/lib/notifications.ts users.update': 'token de push da própria pessoa',
  };

  it('toda escrita sem .select está na lista de exceções', () => {
    const re = /\.from\(\s*['"`](\w+)['"`]\s*\)\s*\.(update|delete|upsert)\(/g;
    const sem: string[] = [];
    for (const { p, src } of fontesComShared) {
      for (const m of src.matchAll(re)) {
        const resto = src.slice(m.index!);
        let prof = 0, fim = resto.length;
        for (let j = 0; j < resto.length; j++) {
          const c = resto[j];
          if ('({['.includes(c)) prof++;
          else if (')}]'.includes(c)) prof--;
          else if (c === ';' && prof <= 0) { fim = j; break; }
        }
        if (!/\.select\(/.test(resto.slice(0, fim))) sem.push(`${p} ${m[1]}.${m[2]}`);
      }
    }
    const fora = [...new Set(sem)].filter(k => !EXCECOES[k]);
    expect(fora).toEqual([]);
  });
});

describe('matriz de permissões — correções de tela', () => {
  const tela = (p: string) => fontes.find(f => f.p === p)!.src;

  it('ações compostas: arquivar exige editar; editar anamnese exige ver', () => {
    const com = (chaves: Acesso[]) => (a: Acesso) => chaves.includes(a);
    expect(podeArquivarCliente(com(['clientes.arquivar']))).toBe(false);
    expect(podeArquivarCliente(com(['clientes.arquivar', 'clientes.editar']))).toBe(true);
    expect(podeEditarAnamnese(com(['anamnese.editar']))).toBe(false);
    expect(podeEditarAnamnese(com(['anamnese.ver', 'anamnese.editar']))).toBe(true);
  });

  it('nenhuma tela usa clientes.arquivar ou anamnese.editar sozinha (D6, D7)', () => {
    const ignorar = new Set(['web/components/PermissoesProvider.tsx', 'mobile/lib/permissions.ts']); // só exemplo em comentário
    for (const { p, src } of fontes) {
      if (ignorar.has(p)) continue;
      expect(src, p).not.toMatch(/\bpode\(\s*['"](clientes\.arquivar|anamnese\.editar)['"]\s*\)/);
    }
  });

  it('excluir despesa só para a dona, com .select (D9)', () => {
    const web = tela('web/app/(app)/financeiro/page.tsx');
    const app = tela('mobile/app/(empresa)/financeiro.tsx');
    for (const src of [web, app]) {
      expect(src).toContain("const podeExcluir = pode('dona');");
      expect(src).toMatch(/\{podeExcluir && <(div|View)/);
      expect(src).toMatch(/from\('despesas'\)\.delete\(\)\.eq\('id', \w+\.id\)\.select\('id'\)/);
    }
    expect(app).not.toContain('Só gestores podem excluir despesas');
  });

  it('vincular atendimento ao pacote: vínculo conferido antes de lançar a sessão (D8)', () => {
    for (const p of ['web/components/pacotes/GerenciarSessoes.tsx', 'mobile/app/(empresa)/pacotes.tsx']) {
      const src = tela(p);
      const ini = src.indexOf('async function vincularAtendimento');
      const corpo = src.slice(ini, src.indexOf('\n  }', ini));
      const iUpd = corpo.indexOf(".update({ pacote_cliente_id: pc.id })");
      const iIns = corpo.indexOf(".from('pacote_uso').insert(");
      expect(iUpd, p).toBeGreaterThan(-1);
      expect(iUpd, p).toBeLessThan(iIns);
      expect(corpo.slice(iUpd, iIns)).toContain(".select('id')");
    }
  });

  it('badge de comandas da Sidebar exige comanda.fechar, como o Dashboard (D10)', () => {
    const src = tela('web/components/Sidebar.tsx');
    expect(src).toContain("const podeFecharComanda = pode(permissoes, 'comanda.fechar');");
    expect(src).toMatch(/podeFecharComanda\s*\?\s*aplicarFiltroComandasNaoFechadas/);
  });

  it('insumos do serviço conferem o erro (D5)', () => {
    // Gravação única em shared (web e app), por diferença e com o erro conferido.
    const shared = readFileSync(join(raiz, 'shared/servicos-consultas.ts'), 'utf8');
    expect(shared).toMatch(/export async function sincronizarInsumos\([\s\S]*?\): Promise<string \| null>/);
    for (const p of ['web/app/(app)/servicos/page.tsx', 'mobile/components/servicos/ServicoForm.tsx']) {
      expect(tela(p)).toMatch(/const errIns = await sincronizarInsumos\(supabase/);
    }
  });
});

describe('matriz de permissões — migration 093 (F7, F10)', () => {
  /** Corpo de uma policy criada na 093 (até o próximo drop/notify). */
  const policy = (nome: string, tabela: string) => {
    const i = sql093.indexOf(`create policy "${nome}" on public.${tabela}`);
    expect(i, nome).toBeGreaterThan(-1);
    expect(sql093).toContain(`drop policy if exists "${nome}" on public.${tabela};`);
    const fim = sql093.indexOf('drop policy', i);
    return sql093.slice(i, fim === -1 ? sql093.indexOf('notify pgrst', i) : fim);
  };

  it('pacote_uso: sem "membro gerencia"; leitura para membro; escrita com pacotes.vender ou atendimento dela (F7)', () => {
    expect(sql093).toContain('drop policy if exists "pacote_uso: membro gerencia" on public.pacote_uso;');
    expect(sql093).not.toMatch(/^create policy "pacote_uso: membro gerencia"/m); // só no rollback (comentário)
    const ver = policy('pacote_uso: membro ve', 'pacote_uso');
    expect(ver).toContain('for select');
    for (const [nome, cmd] of [['pacote_uso: registra', 'insert'], ['pacote_uso: altera', 'update'], ['pacote_uso: exclui', 'delete']]) {
      const pol = policy(nome, 'pacote_uso');
      expect(pol, nome).toContain(`for ${cmd}`);
      expect(pol, nome).toContain("tem_permissao(empresa_id, 'pacotes.vender')");
      expect(pol, nome).toContain("tem_permissao(empresa_id, 'agenda.gerenciar_outras')");
      expect(pol, nome).toContain('a.profissional_id = auth.uid()');
      expect(pol, nome).not.toMatch(/\busing \(true\)|with check \(true\)/);
    }
  });

  it('pagamentos e comanda_itens: INSERT só na comanda dela, com a chave ou gestora (F7)', () => {
    expect(sql093).toContain('drop policy if exists "pagamentos: membro insere" on public.pagamentos;');
    expect(sql093).toContain('drop policy if exists "comanda_itens: membro insere" on public.comanda_itens;');
    const pag = policy('pagamentos: quem fecha insere', 'pagamentos');
    const itens = policy('comanda_itens: quem fecha insere', 'comanda_itens');
    for (const pol of [pag, itens]) {
      expect(pol).toContain('for insert');
      expect(pol).toContain('comanda_pertence_ao_profissional(comanda_id)');
      expect(pol).toContain("tem_permissao(empresa_id, 'agenda.gerenciar_outras')");
      expect(pol).toContain('is_gestor_ou_owner(empresa_id)');
    }
    // pagamento de venda avulsa: vendas.acessar (ou gestora/dona)
    expect(pag).toContain("tem_permissao(empresa_id, 'vendas.acessar')");
  });

  it('vendas e venda_itens: sem "membro gerencia"; ler com financeiro.ver/gestora; mudar só gestora (F7)', () => {
    for (const t of ['vendas', 'venda_itens']) {
      expect(sql093).toContain(`drop policy if exists "${t}: membro gerencia" on public.${t};`);
      expect(policy(`${t}: membro insere`, t)).toContain('empresa_id in (select minha_empresas())');
      const ver = policy(`${t}: financeiro ou gestor ve`, t);
      expect(ver).toContain("tem_permissao(empresa_id, 'financeiro.ver')");
      expect(ver).toContain('is_gestor_ou_owner(empresa_id)');
      for (const p of [`${t}: gestor ou owner atualiza`, `${t}: gestor ou owner deleta`]) {
        const pol = policy(p, t);
        expect(pol, p).toContain('is_gestor_ou_owner(empresa_id)');
        expect(pol, p).not.toContain('minha_empresas');
      }
    }
  });

  it('quem fechou a comanda só mantém acesso com vínculo ativo (F10)', () => {
    const corpo = sql093.slice(sql093.indexOf('function public.comanda_pertence_ao_profissional'));
    expect(corpo.slice(0, corpo.indexOf('$$;'))).toMatch(/m\.user_id = auth\.uid\(\)\s+and m\.ativo = true/);
    for (const nome of ['comandas: profissional ou gestor ve', 'comandas: profissional ou gestor atualiza', 'comandas: profissional ou gestor deleta']) {
      const pol = policy(nome, 'comandas');
      expect(pol, nome).toContain('comanda_pertence_ao_profissional(id)');
      expect(pol, nome).not.toMatch(/profissional_id = auth\.uid\(\)/);
    }
  });

  it('a matriz registra as regras da 093', () => {
    expect(matriz).toMatch(/\| F7 \|[^\n]*093[^\n]*pacotes\.vender/);
    expect(matriz).toMatch(/\| F10 \|[^\n]*093[^\n]*ativo/);
  });
});

describe('matriz de permissões — migration 089', () => {
  it('quem fechou a comanda é dona dela (D1)', () => {
    const corpo = sql089.slice(sql089.indexOf('function public.comanda_pertence_ao_profissional'));
    expect(corpo).toMatch(/a\.comanda_id = p_comanda_id and a\.profissional_id = auth\.uid\(\)/);
    expect(corpo).toMatch(/from public\.comandas c\s+where c\.id = p_comanda_id and c\.profissional_id = auth\.uid\(\)/);
  });

  it('comanda de outra profissional com agenda.gerenciar_outras, sem tirar o ramo da gestora (D2)', () => {
    for (const [tabela, nome] of [
      ['comandas', 'comandas: profissional ou gestor ve'],
      ['comandas', 'comandas: profissional ou gestor atualiza'],
      ['comanda_itens', 'comanda_itens: profissional ou gestor ve'],
      ['comanda_itens', 'comanda_itens: profissional ou gestor atualiza'],
      ['comanda_itens', 'comanda_itens: profissional ou gestor deleta'],
      ['pagamentos', 'pagamentos: profissional ou gestor deleta'],
    ]) {
      const i = sql089.indexOf(`create policy "${nome}" on public.${tabela}`);
      expect(i, nome).toBeGreaterThan(-1);
      expect(sql089).toContain(`drop policy if exists "${nome}" on public.${tabela};`);
      const pol = sql089.slice(i, sql089.indexOf(');', i));
      expect(pol, nome).toContain('is_gestor_ou_owner(empresa_id)');
      expect(pol, nome).toContain("tem_permissao(empresa_id, 'agenda.gerenciar_outras')");
    }
  });

  it('estoque, insumos e serviços do atendimento alinhados às chaves (D4, D5, D14)', () => {
    const est = sql089.slice(sql089.indexOf('create policy "estoque_movimentos: gestor pode inserir"'));
    expect(est.slice(0, est.indexOf(');\n'))).toContain("tem_permissao(empresa_id, 'agenda.gerenciar_outras')");
    expect(sql089).toMatch(/"servico_produtos: gestor gerencia"[\s\S]*?tem_permissao\(s\.empresa_id, 'servicos\.gerenciar'\)/);
    expect(sql089).toContain('drop policy if exists "agendamento_servicos: membro gerencia"');
    // D14: a CONDIÇÃO de cada escrita segue a de agendamentos (atendimento próprio ou a chave),
    // não só o nome da policy; e a leitura continua para membro.
    const policyAs = (nome: string) => {
      const i = sql089.indexOf(`create policy "agendamento_servicos: ${nome}" on public.agendamento_servicos`);
      expect(i, nome).toBeGreaterThan(-1);
      const fim = sql089.indexOf('drop policy', i);
      return sql089.slice(i, fim === -1 ? sql089.indexOf('notify pgrst', i) : fim);
    };
    for (const [nome, cmd] of [['equipe insere', 'insert'], ['equipe atualiza', 'update'], ['equipe exclui', 'delete']]) {
      const pol = policyAs(nome);
      expect(pol, nome).toContain(`for ${cmd}`);
      expect(pol, nome).toContain('empresa_id in (select minha_empresas())');
      expect(pol, nome).toContain("tem_permissao(empresa_id, 'agenda.gerenciar_outras')");
      expect(pol, nome).toMatch(/a\.id = agendamento_servicos\.agendamento_id and a\.profissional_id = auth\.uid\(\)/);
      expect(pol, nome).not.toMatch(/\busing \(true\)|with check \(true\)/);
    }
    // UPDATE confere nos dois lados (using e with check).
    const upd = policyAs('equipe atualiza');
    expect(upd.match(/tem_permissao\(empresa_id, 'agenda\.gerenciar_outras'\)/g)?.length).toBe(2);
    expect(upd.match(/a\.profissional_id = auth\.uid\(\)/g)?.length).toBe(2);
    const ver = policyAs('membro ve');
    expect(ver).toContain('for select');
    expect(ver).toContain('empresa_id in (select minha_empresas())');
  });

  it('sem security definer novo, idempotente e recarrega o schema', () => {
    // Única ocorrência: a função que já era definer (045/073/075), só com o corpo novo.
    expect(sql089.match(/^\s*security definer/gim)?.length).toBe(1);
    const criadas = [...sql089.matchAll(/create policy "([^"]+)" on public\.(\w+)/g)];
    for (const [, nome, tabela] of criadas) expect(sql089).toContain(`drop policy if exists "${nome}" on public.${tabela};`);
    expect(sql089).toMatch(/-- Rollback/);
    expect(sql089.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
