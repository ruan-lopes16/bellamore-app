import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Migration 093 lida como texto (itens 9, 10, 11 e 16 da spec
 * docs/superpowers/specs/2026-10-15-correcoes-pontuais-design.md). O comportamento é exercitado
 * no PGlite em alinhamentos-093-pglite.test.ts.
 */
const ler = (nome: string) =>
  readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', nome), 'utf8').toLowerCase().replace(/\r\n/g, '\n');

const sql = ler('093_alinhamentos_finais.sql');
const sql090 = ler('090_comanda_tudo_ou_nada.sql');
const semComentario = (s: string) => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const corpo = semComentario(sql);
const corpo090 = semComentario(sql090);

function funcao(texto: string, nome: string): string {
  const ini = texto.indexOf(`create or replace function public.${nome}(`);
  expect(ini, `função ${nome} não encontrada`).toBeGreaterThanOrEqual(0);
  const fim = texto.indexOf('$$;', texto.indexOf('as $$', ini) + 5);
  return texto.slice(ini, fim + 3);
}

/** Texto de uma policy criada: do `create policy "<nome>"` até o `;`. */
function policy(nome: string): string {
  const ini = corpo.indexOf(`create policy "${nome}"`);
  expect(ini, `policy ${nome} não encontrada`).toBeGreaterThanOrEqual(0);
  return corpo.slice(ini, corpo.indexOf(';', ini));
}

/** Toda policy criada é precedida pelo drop condicional do MESMO nome, na mesma tabela. */
function dropAntes(nome: string, tabela: string) {
  const drop = corpo.indexOf(`drop policy if exists "${nome}" on public.${tabela};`);
  expect(drop, `drop de ${nome}`).toBeGreaterThanOrEqual(0);
  expect(drop).toBeLessThan(corpo.indexOf(`create policy "${nome}" on public.${tabela}`));
}

describe('migration 093 — regras gerais', () => {
  it('cabeçalho com rollback, termina com notify e não usa db push', () => {
    expect(sql).toContain('rollback');
    expect(sql).toContain('não usar `supabase db push`');
    expect(corpo.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it('nenhum create policy sem drop if exists antes', () => {
    for (const m of corpo.matchAll(/create policy "([^"]+)" on public\.(\w+)/g)) dropAntes(m[1], m[2]);
  });
});

describe('item 9 — comanda_pertence_ao_profissional com vínculo ativo', () => {
  const f = () => funcao(corpo, 'comanda_pertence_ao_profissional');

  it('continua security definer, stable e com search_path', () => {
    expect(f()).toMatch(/language sql\s+stable\s+security definer\s+set search_path = public/);
  });

  it('os dois ramos (quem fechou e atendimento dela) exigem vínculo ativo ou ser a dona', () => {
    expect(f()).toMatch(/m\.user_id = auth\.uid\(\)\s+and m\.ativo = true/);
    expect(f()).toMatch(/e\.owner_id = auth\.uid\(\)/);
    expect(f()).toContain('c.profissional_id = auth.uid()');
    expect(f()).toContain('a.profissional_id = auth.uid()');
  });

  it('comandas: SELECT/UPDATE/DELETE sem o ramo direto profissional_id = auth.uid() (passa pela função)', () => {
    for (const nome of ['comandas: profissional ou gestor ve', 'comandas: profissional ou gestor atualiza', 'comandas: profissional ou gestor deleta']) {
      const p = policy(nome);
      expect(p).toContain('comanda_pertence_ao_profissional(id)');
      expect(p).toContain('is_gestor_ou_owner(empresa_id)');
      expect(p).not.toMatch(/or profissional_id = auth\.uid\(\)/);
    }
    expect(policy('comandas: profissional ou gestor ve')).toContain("tem_permissao(empresa_id, 'agenda.gerenciar_outras')");
    expect(policy('comandas: profissional ou gestor atualiza')).toContain("tem_permissao(empresa_id, 'agenda.gerenciar_outras')");
  });
});

describe('item 10 — funções conferem cliente, maquininha e profissional contra a empresa', () => {
  const nomes = ['fechar_comanda', 'editar_comanda', 'registrar_venda_avulsa_v2'];

  it('helper definer devolve só a mensagem, restrito às empresas de quem chama', () => {
    const h = funcao(corpo, 'conferir_vinculos_empresa');
    expect(h).toContain('security definer');
    expect(h).toContain('set search_path = public');
    expect(h).toContain('select minha_empresas()');
    expect(h).toContain('public.clientes');
    expect(h).toContain('public.cartao_maquininhas');
    expect(h).toContain('public.empresa_membros');
    expect(corpo).toContain('revoke all on function public.conferir_vinculos_empresa(uuid, uuid, uuid[], uuid[]) from public, anon;');
    expect(corpo).toContain('grant execute on function public.conferir_vinculos_empresa(uuid, uuid, uuid[], uuid[]) to authenticated;');
  });

  it.each(nomes)('%s: mesma assinatura, invoker, search_path, revoke e grant da 090', nome => {
    const novo = funcao(corpo, nome);
    const velho = funcao(corpo090, nome);
    const assinatura = (s: string) => s.slice(0, s.indexOf('as $$'));
    expect(assinatura(novo)).toBe(assinatura(velho));
    expect(novo).toContain('security invoker');
    const grants = (t: string) => t.split('\n').filter(l => new RegExp(`(revoke|grant) .* function public\\.${nome}\\(`).test(l));
    expect(grants(corpo)).toEqual(grants(corpo090));
  });

  it.each(nomes)('%s: corpo da 090 preservado (só ganha a conferência)', nome => {
    // Tirando a declaração de v_erro e o bloco novo (de `v_erro := ...` até o `end if;` do raise),
    // o corpo é o da 090 linha a linha.
    // Item 7 (taxa 0%): as únicas linhas do corpo da 090 que mudam de propósito; o comentário
    // `-- 093:` no fim da linha nova sai antes de comparar.
    const item7 = (l: string) => l
      .replace("then nullif((x.j->>'taxa_perc')::numeric, 0) end as taxa_perc,", "then (x.j->>'taxa_perc')::numeric end as taxa_perc,")
      .replace('case when coalesce(case when o.id is not null then o.taxa_perc else n.taxa_perc end, 0) > 0',
        'case when (case when o.id is not null then o.taxa_perc else n.taxa_perc end) is not null');
    const novo = funcao(corpo, nome).split('\n').map(l => l.replace(/\s+-- 093:.*$/, ''));
    const velho = funcao(corpo090, nome).split('\n').map(item7);
    const semNovas: string[] = [];
    for (let i = 0; i < novo.length; i++) {
      if (/^\s+v_erro\s+text;$/.test(novo[i])) continue;
      if (novo[i].includes('v_erro := public.conferir_vinculos_empresa(')) {
        while (!novo[i].includes("raise exception '%', v_erro;")) i++;
        i++; // end if;
        expect(novo[i].trim()).toBe('end if;');
        continue;
      }
      semNovas.push(novo[i]);
    }
    const semBrancas = (ls: string[]) => ls.filter(l => l.trim() !== '');
    expect(semBrancas(semNovas)).toEqual(semBrancas(velho));
    expect(funcao(corpo, nome)).toContain('public.conferir_vinculos_empresa(');
    expect(funcao(corpo, nome)).toMatch(/if v_erro is not null then\s+raise exception '%', v_erro;/);
  });

  it('fechar_comanda confere cliente, maquininhas gravadas e profissionais dos extras antes de gravar', () => {
    const f = funcao(corpo, 'fechar_comanda');
    const chamada = f.slice(f.indexOf('public.conferir_vinculos_empresa('));
    expect(chamada.slice(0, 600)).toContain('v_cliente');
    expect(chamada.slice(0, 600)).toContain('i_prof');
    expect(chamada.slice(0, 600)).toContain("maquininha_id");
    expect(f.indexOf('conferir_vinculos_empresa')).toBeLessThan(f.indexOf('insert into public.comandas'));
  });

  it('editar_comanda confere maquininhas e profissionais novos/alterados antes de gravar', () => {
    const f = funcao(corpo, 'editar_comanda');
    const chamada = f.slice(f.indexOf('public.conferir_vinculos_empresa('));
    expect(chamada.slice(0, 700)).toContain('i_prof');
    expect(chamada.slice(0, 700)).toContain('ie_prof');
    expect(f.indexOf('conferir_vinculos_empresa')).toBeLessThan(f.indexOf('delete from public.comanda_itens'));
  });

  it('registrar_venda_avulsa_v2 confere cliente e maquininhas antes de gravar', () => {
    const f = funcao(corpo, 'registrar_venda_avulsa_v2');
    const chamada = f.slice(f.indexOf('public.conferir_vinculos_empresa('));
    expect(chamada.slice(0, 400)).toContain('p_cliente');
    expect(chamada.slice(0, 400)).toContain('maquininha_id');
    expect(f.indexOf('conferir_vinculos_empresa')).toBeLessThan(f.indexOf('insert into public.vendas'));
  });

  it('mensagens em português', () => {
    expect(sql).toContain('cliente não encontrada nesta empresa.');
    expect(sql).toContain('maquininha não encontrada nesta empresa.');
    expect(sql).toContain('profissional do serviço extra não faz parte desta empresa.');
  });
});

describe('item 11 — vendas e venda_itens', () => {
  it.each(['vendas', 'venda_itens'])('%s: derruba "membro gerencia" e não recria', t => {
    expect(corpo).toContain(`drop policy if exists "${t}: membro gerencia" on public.${t};`);
    expect(corpo).not.toContain(`create policy "${t}: membro gerencia"`);
  });

  it.each(['vendas', 'venda_itens'])('%s: INSERT de membro, SELECT financeiro.ver ou gestora, UPDATE/DELETE gestora', t => {
    expect(policy(`${t}: membro insere`)).toMatch(new RegExp(`on public\\.${t} for insert\\s+with check \\(empresa_id in \\(select minha_empresas\\(\\)\\)\\)`));
    const ve = policy(`${t}: financeiro ou gestor ve`);
    expect(ve).toContain('for select');
    expect(ve).toContain("tem_permissao(empresa_id, 'financeiro.ver')");
    expect(ve).toContain('is_gestor_ou_owner(empresa_id)');
    expect(policy(`${t}: gestor ou owner atualiza`)).toMatch(/for update\s+using \(is_gestor_ou_owner\(empresa_id\)\)\s+with check \(is_gestor_ou_owner\(empresa_id\)\)/);
    expect(policy(`${t}: gestor ou owner deleta`)).toMatch(/for delete\s+using \(is_gestor_ou_owner\(empresa_id\)\)/);
    // a policy da 046 de leitura só para gestora some (a nova cobre)
    expect(corpo).toContain(`drop policy if exists "${t}: gestor ou owner ve" on public.${t};`);
  });

  it('mantém as policies da 086 (vendas.acessar vê e desfaz a venda recém-criada sem itens)', () => {
    for (const n of ['vendas: vendas.acessar ve', 'vendas: vendas.acessar deleta', 'venda_itens: vendas.acessar ve']) {
      expect(corpo).not.toContain(`drop policy if exists "${n}"`);
    }
  });
});

describe('item 16 — pacote_uso, pagamentos e comanda_itens', () => {
  it('pacote_uso: derruba "membro gerencia"; SELECT membro; escrita com pacotes.vender ou atendimento dela/gerenciar_outras', () => {
    expect(corpo).toContain('drop policy if exists "pacote_uso: membro gerencia" on public.pacote_uso;');
    expect(policy('pacote_uso: membro ve')).toMatch(/for select\s+using \(empresa_id in \(select minha_empresas\(\)\)\)/);
    for (const [nome, cmd] of [['pacote_uso: registra', 'insert'], ['pacote_uso: altera', 'update'], ['pacote_uso: exclui', 'delete']] as const) {
      const p = policy(nome);
      expect(p).toContain(`for ${cmd}`);
      expect(p).toContain("tem_permissao(empresa_id, 'pacotes.vender')");
      expect(p).toContain('a.profissional_id = auth.uid()');
      expect(p).toContain("tem_permissao(empresa_id, 'agenda.gerenciar_outras')");
      expect(p).toContain('empresa_id in (select minha_empresas())');
    }
  });

  it('pagamentos INSERT: comanda dela/gerenciar_outras/gestora, ou venda com vendas.acessar', () => {
    expect(corpo).toContain('drop policy if exists "pagamentos: membro insere" on public.pagamentos;');
    const p = policy('pagamentos: quem fecha insere');
    expect(p).toContain('for insert');
    expect(p).toContain('is_gestor_ou_owner(empresa_id)');
    expect(p).toContain('comanda_pertence_ao_profissional(comanda_id)');
    expect(p).toContain("tem_permissao(empresa_id, 'agenda.gerenciar_outras')");
    expect(p).toContain("tem_permissao(empresa_id, 'vendas.acessar')");
    expect(p).toContain('c.empresa_id = pagamentos.empresa_id');
    expect(corpo).not.toContain('create policy "pagamentos: membro insere"');
  });

  it('comanda_itens INSERT: comanda dela/gerenciar_outras/gestora, na mesma empresa', () => {
    expect(corpo).toContain('drop policy if exists "comanda_itens: membro insere" on public.comanda_itens;');
    const p = policy('comanda_itens: quem fecha insere');
    expect(p).toContain('for insert');
    expect(p).toContain('is_gestor_ou_owner(empresa_id)');
    expect(p).toContain('comanda_pertence_ao_profissional(comanda_id)');
    expect(p).toContain("tem_permissao(empresa_id, 'agenda.gerenciar_outras')");
    expect(p).toContain('c.empresa_id = comanda_itens.empresa_id');
    expect(corpo).not.toContain('create policy "comanda_itens: membro insere"');
  });

  it('não recria o trigger de uso de pacote (security definer da 078 fica)', () => {
    expect(corpo).not.toMatch(/function (public\.)?fn_registrar_uso_pacote/);
  });
});

describe('item 7 — taxa de cartão 0% pela função', () => {
  it('fechar_comanda e editar_comanda não trocam mais 0 por null; null continua "sem taxa"', () => {
    for (const nome of ['fechar_comanda', 'editar_comanda']) {
      const f = funcao(corpo, nome);
      expect(f).not.toContain("nullif((x.j->>'taxa_perc')::numeric, 0)");
      expect(f).toContain("then (x.j->>'taxa_perc')::numeric end as taxa_perc");
    }
    expect(funcao(corpo, 'editar_comanda')).not.toMatch(/coalesce\(case when o\.id is not null then o\.taxa_perc else n\.taxa_perc end, 0\) > 0/);
  });
});
