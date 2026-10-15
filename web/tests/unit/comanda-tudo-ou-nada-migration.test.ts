import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Migration 090 lida como texto: fechar/editar comanda e venda avulsa v2 "tudo ou nada",
 * desconto rateado e triggers de comissão com a base nova.
 * Contrato do payload: docs/superpowers/notes/2026-10-15-contrato-fechar-comanda.md
 */
const ler = (nome: string) =>
  readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', nome), 'utf8').toLowerCase().replace(/\r\n/g, '\n');

const sql = ler('090_comanda_tudo_ou_nada.sql');
// Corpo sem comentários: as checagens não podem passar por causa de um texto no cabeçalho.
const corpo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

/** Corpo de uma função: do `create or replace function public.<nome>(` até o `$$;` que a fecha. */
function funcao(nome: string): string {
  const ini = corpo.indexOf(`create or replace function public.${nome}(`);
  expect(ini, `função ${nome} não encontrada`).toBeGreaterThanOrEqual(0);
  const fim = corpo.indexOf('$$;', corpo.indexOf('as $$', ini) + 5);
  return corpo.slice(ini, fim);
}

/** Posição de um trecho dentro de um texto, exigindo que exista. */
function pos(texto: string, trecho: string): number {
  const i = texto.indexOf(trecho);
  expect(i, `trecho não encontrado: ${trecho}`).toBeGreaterThanOrEqual(0);
  return i;
}

describe('migration 090 — colunas', () => {
  it('desconto_rateado em agendamentos, agendamento_servicos e comanda_itens (default 0, nunca negativo)', () => {
    for (const t of ['agendamentos', 'agendamento_servicos', 'comanda_itens']) {
      expect(corpo).toMatch(new RegExp(String.raw`alter table public\.${t}\s+add column if not exists desconto_rateado numeric\(10,2\) not null default 0`));
    }
    expect(corpo.match(/check \(desconto_rateado >= 0\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
  it('estoque_movimentos.comanda_id com on delete set null', () => {
    expect(corpo).toMatch(/alter table public\.estoque_movimentos\s+add column if not exists comanda_id uuid references public\.comandas\(id\) on delete set null/);
  });
});

describe('migration 090 — assinaturas, invoker e grants', () => {
  it('fechar_comanda(jsonb) returns uuid', () => {
    expect(corpo).toMatch(/create or replace function public\.fechar_comanda\(\s*p jsonb\s*\)\s*returns uuid/);
  });
  it('editar_comanda(jsonb) returns void', () => {
    expect(corpo).toMatch(/create or replace function public\.editar_comanda\(\s*p jsonb\s*\)\s*returns void/);
  });
  it('registrar_venda_avulsa_v2 com a chave da venda primeiro', () => {
    expect(corpo).toMatch(/create or replace function public\.registrar_venda_avulsa_v2\(\s*p_venda_id uuid,\s*p_empresa uuid,\s*p_cliente uuid,\s*p_desconto numeric,\s*p_itens jsonb,\s*p_pagamentos jsonb\s*\)\s*returns uuid/);
  });
  it('não mexe na assinatura da 087 (função antiga não é recriada nem apagada)', () => {
    expect(corpo).not.toMatch(/function public\.registrar_venda_avulsa\(/);
  });
  it.each(['fechar_comanda', 'editar_comanda', 'registrar_venda_avulsa_v2'])('%s é security invoker com search_path', f => {
    const c = funcao(f);
    expect(c).toContain('security invoker');
    expect(c).not.toContain('security definer');
    expect(c).toContain('set search_path = public');
  });
  it.each([
    'fechar_comanda(jsonb)',
    'editar_comanda(jsonb)',
    'registrar_venda_avulsa_v2(uuid, uuid, uuid, numeric, jsonb, jsonb)',
    'ratear_desconto_centavos(bigint, bigint[])',
  ])('execução de %s só para authenticated', assinatura => {
    const a = assinatura.replace(/[()[\]]/g, m => `\\${m}`);
    expect(corpo).toMatch(new RegExp(String.raw`revoke all on function public\.${a} from public, anon`));
    expect(corpo).toMatch(new RegExp(String.raw`grant execute on function public\.${a} to authenticated`));
  });
  it('termina recarregando o schema do PostgREST', () => {
    expect(sql.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
  it('cabeçalho com rollback', () => {
    expect(sql).toContain('-- rollback');
    expect(sql).toMatch(/--\s+drop function if exists public\.fechar_comanda\(jsonb\)/);
  });
});

describe('migration 090 — fechar_comanda', () => {
  const f = () => funcao('fechar_comanda');

  it('permissões no banco: comanda.fechar, comanda.desconto e pacotes.vender (42501)', () => {
    const c = f();
    expect(c).toContain("tem_permissao(v_empresa, 'comanda.fechar')");
    expect(c).toContain("tem_permissao(v_empresa, 'comanda.desconto')");
    expect(c).toContain("tem_permissao(v_empresa, 'pacotes.vender')");
    expect(c).toContain("errcode = '42501'");
  });
  it('idempotência: comanda já existente nesta empresa devolve o id sem gravar; de outra empresa é erro', () => {
    const c = f();
    const idem = pos(c, 'from public.comandas where id = v_comanda');
    expect(c.slice(idem, idem + 400)).toContain('return v_comanda');
    expect(c).toContain("'esta comanda pertence a outra empresa.'");
    // A conferência de idempotência vem antes de qualquer validação de atendimento/estoque.
    expect(idem).toBeLessThan(pos(c, 'update public.agendamentos'));
    // Corrida entre duas tentativas iguais: a segunda cai no unique_violation e devolve o id.
    expect(c).toContain('when unique_violation');
  });
  it('profissional_id da comanda é quem chama (auth.uid()), nunca do payload', () => {
    const c = f();
    expect(c).toMatch(/insert into public\.comandas[\s\S]*?auth\.uid\(\)/);
    expect(c).not.toContain("p->>'profissional_id'");
  });
  it('fechamento em dobro: update ... comanda_id is null com contagem conferida', () => {
    const c = f();
    const up = c.slice(pos(c, 'update public.agendamentos'));
    expect(up).toMatch(/and a\.comanda_id is null/);
    expect(c).toContain('get diagnostics');
    expect(c).toContain("'este atendimento já teve a comanda fechada.'");
  });
  it('valor, desconto_rateado, pacote_cliente_id, comanda_id e status no MESMO update de agendamentos', () => {
    const c = f();
    const ini = pos(c, 'update public.agendamentos');
    const cmd = c.slice(ini, c.indexOf(';', ini));
    for (const col of ['valor =', 'desconto_rateado =', 'pacote_cliente_id =', 'comanda_id =', "status = 'concluido'"]) {
      expect(cmd).toContain(col);
    }
    expect(c.match(/update public\.agendamentos/g)?.length).toBe(1);
  });
  it('valores recalculados no banco: subtotal, desconto até o subtotal, reserva lida de taxas_reserva', () => {
    const c = f();
    expect(c).not.toContain("p->>'subtotal'");
    expect(c).not.toContain("p->>'total'");
    expect(c).toContain("'o desconto não pode ser maior que o subtotal.'");
    expect(c).toMatch(/from public\.taxas_reserva[\s\S]*?status = 'pago'/);
    expect(c).toContain("'o pagamento não cobre o total da comanda.'");
  });
  it('ordem das gravações preserva os triggers', () => {
    const c = f();
    const ordem = [
      'insert into public.comandas',
      'update public.agendamento_servicos',
      'update public.agendamentos',
      'insert into public.comanda_itens',
      'insert into public.pacote_clientes',
      'pg_advisory_xact_lock',
      'insert into public.estoque_movimentos',
      'insert into public.venda_itens',
      'insert into public.pagamentos',
    ].map(t => pos(c, t));
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    // venda do pacote antes da trava; venda dos produtos depois da baixa
    const vendas = [...c.matchAll(/insert into public\.vendas/g)].map(m => m.index!);
    expect(vendas.length).toBe(2);
    expect(vendas[0]).toBeLessThan(pos(c, 'pg_advisory_xact_lock'));
    expect(vendas[1]).toBeGreaterThan(pos(c, 'insert into public.estoque_movimentos'));
  });
  it('trava do estoque com a mesma chave da 087/088, por produto e em ordem de id; saldo não bloqueia', () => {
    const c = f();
    expect(c).toContain("hashtextextended('venda_estoque:' || r.produto_id::text, 0)");
    const trava = c.slice(c.lastIndexOf('for r in', pos(c, 'pg_advisory_xact_lock')), pos(c, 'pg_advisory_xact_lock'));
    expect(trava).toMatch(/group by[\s\S]*order by/);
    expect(c).not.toContain('estoque insuficiente');
    expect(c).not.toMatch(/for update/);
  });
  it('baixa de estoque ligada à comanda (comanda_id) e venda com o desconto rateado dos produtos', () => {
    const c = f();
    const est = c.slice(pos(c, 'insert into public.estoque_movimentos'));
    expect(est.slice(0, 200)).toContain('comanda_id');
    expect(c).toContain("'via comanda'");
    expect(c).toContain("'pacote(s) via comanda'");
    expect(c).toContain('v_desc_produtos');
    expect(c).toContain('v_desc_pacotes');
  });
  it('rateio feito pela função de centavos', () => {
    expect(f()).toContain('ratear_desconto_centavos(');
  });
  it('sem returning (ids gerados na função)', () => {
    expect(f()).not.toMatch(/\breturning\b/);
    expect(f()).toContain('gen_random_uuid()');
  });
  it('datas no banco: fechada_at = now() e pacote pela data de Brasília', () => {
    const c = f();
    expect(c).toContain('now()');
    expect(c).toContain("at time zone 'america/sao_paulo'");
  });
});

describe('migration 090 — rateio em centavos', () => {
  const r = () => funcao('ratear_desconto_centavos');
  it('proporcional com piso e resto para a maior parte, sem passar do peso de cada parte', () => {
    const c = r();
    expect(c).toContain('floor(');
    expect(c).toMatch(/order by t\.peso desc, t\.ord/);
    expect(c).toContain('least(');
    expect(c).toContain('immutable');
  });
});

describe('migration 090 — editar_comanda', () => {
  const e = () => funcao('editar_comanda');
  it('exige comanda.editar_fechada (e comanda.desconto ao mudar o desconto)', () => {
    const c = e();
    expect(c).toContain("tem_permissao(v_empresa, 'comanda.editar_fechada')");
    expect(c).toContain("tem_permissao(v_empresa, 'comanda.desconto')");
    expect(c).toContain("errcode = '42501'");
  });
  it('diff dos extras: apaga, atualiza e insere; produto e pacote só leitura', () => {
    const c = e();
    expect(c).toContain('delete from public.comanda_itens');
    expect(c).toContain('update public.comanda_itens');
    expect(c).toContain('insert into public.comanda_itens');
    expect(c).toContain("'produtos e pacotes não podem ser incluídos na edição.'");
    expect(c).not.toContain('insert into public.estoque_movimentos');
    expect(c).not.toContain('insert into public.vendas');
  });
  it('novo rateio e valores dos atendimentos (sem status nem vínculo)', () => {
    const c = e();
    expect(c).toContain('ratear_desconto_centavos(');
    const ini = pos(c, 'update public.agendamentos');
    const cmd = c.slice(ini, c.indexOf(';', ini));
    expect(cmd).toContain('desconto_rateado =');
    expect(cmd).not.toContain('status =');
    expect(cmd).not.toContain('pacote_cliente_id =');
  });
  it('pagamentos apagados e reinseridos na mesma transação; reabertos mantêm taxa, maquininha e data; novos com fechada_at', () => {
    const c = e();
    expect(pos(c, 'delete from public.pagamentos')).toBeLessThan(pos(c, 'insert into public.pagamentos'));
    expect(c).toContain("'pagamento_id'");
    expect(c).toContain('v_fechada_at');
    expect(c).toMatch(/taxa_perc[\s\S]*maquininha_id[\s\S]*created_at/);
  });
  it('confere a contagem de cada update/delete (sem sucesso falso por RLS)', () => {
    expect(e().match(/get diagnostics/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
  it('sem returning', () => {
    expect(e()).not.toMatch(/\breturning\b/);
  });
});

describe('migration 090 — correções da revisão (C1, I1, M1–M4, M7)', () => {
  it.each(['comanda_qtd_atendimentos', 'comanda_qtd_itens', 'comanda_qtd_pagamentos'])(
    'C1: helper %s é definer, devolve só a contagem, filtra pela empresa e só para authenticated', f => {
      const c = funcao(f);
      expect(c).toMatch(new RegExp(String.raw`public\.${f}\(p_comanda uuid\)\s+returns int`));
      expect(c).toContain('security definer');
      expect(c).toContain('set search_path = public');
      expect(c).toContain('select count(*)::int');
      expect(c).toContain('c.empresa_id in (select minha_empresas())');
      expect(corpo).toContain(`revoke all on function public.${f}(uuid) from public, anon`);
      expect(corpo).toContain(`grant execute on function public.${f}(uuid) to authenticated`);
    });
  it('C1: editar_comanda compara o visível com a contagem real ANTES de qualquer escrita e recusa com 42501', () => {
    const c = funcao('editar_comanda');
    const i = pos(c, 'public.comanda_qtd_atendimentos(v_comanda) <>');
    expect(c).toContain("'esta comanda tem atendimento de outra profissional que você não pode ver. peça à dona ou à gestora para editar.'");
    expect(c).toContain('public.comanda_qtd_itens(v_comanda) <>');
    expect(c).toContain('public.comanda_qtd_pagamentos(v_comanda) <>');
    for (const w of ['delete from public.comanda_itens', 'update public.comanda_itens', 'insert into public.comanda_itens',
      'update public.comandas', 'update public.agendamentos', 'delete from public.pagamentos']) {
      expect(i).toBeLessThan(pos(c, w));
    }
  });
  it('I1: sem mudança de dinheiro mantém o rateio gravado e não aplica os limites do congelado', () => {
    const c = funcao('editar_comanda');
    expect(c).toContain('v_mudou := v_mudou or v_desconto <> v_desc_antigo');
    expect(c).toContain('if v_mudou and v_desconto < v_congelado');
    expect(c).toContain('if v_mudou and v_desconto - v_congelado > v_subtotal - v_peso_congelado');
    const semMudanca = c.slice(pos(c, 'if not v_mudou then'), pos(c, 'public.ratear_desconto_centavos('));
    expect(semMudanca).toContain('a_cota[k] := (ad_desc[k] * 100)::bigint');
    expect(semMudanca).toContain('i_cota[k] := (coalesce(ie_desc[k], 0) * 100)::bigint');
  });
  it('M7: pacote com valor > 0 só é recusado na edição quando o valor muda', () => {
    const c = funcao('editar_comanda');
    expect(c).toMatch(/if v_db_valor is distinct from a_valor\[v_n\] then\s+v_mudou := true;[\s\S]{0,300}if v_pc is not null and a_valor\[v_n\] > 0 then/);
  });
  it('M1: venda v2 relê a venda depois das travas e antes de conferir o saldo', () => {
    const c = funcao('registrar_venda_avulsa_v2');
    const ultimaTrava = c.lastIndexOf('pg_advisory_xact_lock');
    const releitura = c.indexOf('from public.vendas where id = p_venda_id', ultimaTrava);
    expect(releitura).toBeGreaterThan(ultimaTrava);
    expect(releitura).toBeLessThan(pos(c, 'estoque insuficiente'));
  });
  it('M2: maquininha_id do fechamento com nullif (string vazia = null)', () => {
    const c = funcao('fechar_comanda');
    expect(c).toContain("nullif(x.j->>'maquininha_id', '')::uuid");
    expect(c).not.toMatch(/maquininha_id uuid\s*\)/);
  });
  it('M3: atendimentos e linhas atualizados em ordem de id (fechar e editar)', () => {
    for (const f of ['fechar_comanda', 'editar_comanda']) {
      const c = funcao(f);
      expect(c).toContain('for k in select g.ix from generate_subscripts(a_id, 1) as g(ix) order by a_id[g.ix] loop');
      expect(c).toContain('for k in select g.ix from generate_subscripts(l_id, 1) as g(ix) order by l_id[g.ix] loop');
    }
  });
  it('M4: atendimento cancelado/faltou é recusado no fechamento', () => {
    const c = funcao('fechar_comanda');
    expect(c).toContain("'atendimento cancelado ou com falta não entra na comanda.'");
    expect(c).toContain("and a.status not in ('cancelado', 'faltou')");
  });
});

describe('migration 090 — registrar_venda_avulsa_v2', () => {
  const v = () => funcao('registrar_venda_avulsa_v2');
  it('mesmas permissões da 087', () => {
    expect(v()).toContain("tem_permissao(p_empresa, 'vendas.acessar')");
    expect(v()).toContain("tem_permissao(p_empresa, 'comanda.desconto')");
  });
  it('venda já existente nesta empresa devolve o id sem gravar, antes de conferir estoque', () => {
    const c = v();
    const idem = pos(c, 'from public.vendas where id = p_venda_id');
    expect(c.slice(idem, idem + 300)).toContain('return p_venda_id');
    expect(idem).toBeLessThan(pos(c, 'pg_advisory_xact_lock'));
    expect(c).toContain('when unique_violation');
    expect(c).toContain("'esta venda pertence a outra empresa.'");
  });
  it('mantém a trava e a conferência de saldo da 087', () => {
    const c = v();
    expect(c).toContain("hashtextextended('venda_estoque:' || r.produto_id::text, 0)");
    expect(c).toContain('estoque insuficiente');
    expect(c.match(/order by i\.produto_id/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(c).not.toMatch(/\breturning\b/);
  });
});

describe('migration 090 — triggers de comissão com a base nova', () => {
  it('gerar_comissao (065): base valor − desconto_rateado, mesmo filtro de pacote', () => {
    const c = funcao('gerar_comissao');
    expect(c).toContain('new.pacote_cliente_id is not null');
    expect(c).toMatch(/new\.valor - coalesce\(new\.desconto_rateado, 0\)/);
    expect(c).toContain('security definer set search_path = public');
  });
  it('sincronizar_comissao_valor (075): reage também a desconto_rateado, inclusive comissão paga', () => {
    const c = funcao('sincronizar_comissao_valor');
    expect(c).toContain('new.desconto_rateado is distinct from old.desconto_rateado');
    expect(c).toMatch(/set valor_servico = greatest\(new\.valor - coalesce\(new\.desconto_rateado, 0\), 0\)/);
    expect(c).not.toContain("status = 'pendente'");
    expect(corpo).toMatch(/create trigger trg_sincronizar_comissao_valor\s+after update of valor, desconto_rateado on public\.agendamentos/);
  });
  it('085: base valor_unit × quantidade − desconto_rateado e created_at = comandas.fechada_at', () => {
    const g = funcao('gerar_comissao_item');
    const s = funcao('sincronizar_comissao_item');
    for (const c of [g, s]) {
      expect(c).toMatch(/round\(new\.valor_unit \* new\.quantidade, 2\) - coalesce\(new\.desconto_rateado, 0\)/);
      expect(c).toMatch(/select c\.fechada_at from public\.comandas c where c\.id = new\.comanda_id/);
    }
    // trava da comissão paga (085) preservada
    expect(s).toContain("raise exception 'comissão deste serviço já foi paga'");
    // desconto sozinho nunca cria comissão retroativa (só atualiza a existente)
    expect(s).toMatch(/elsif v_mudou_dono or v_mudou_valor then/);
    expect(s).toContain('v_mudou_desconto');
  });
  it('não recria o trigger de uso de pacote (filtro controla_sessoes da 037/078 intacto); só fixa o search_path', () => {
    expect(corpo).not.toMatch(/create or replace function (public\.)?fn_registrar_uso_pacote/);
    expect(corpo).toMatch(/alter function public\.fn_registrar_uso_pacote\(\) set search_path = public/);
    expect(corpo).toMatch(/alter function public\.notificar_estoque_baixo\(\) set search_path = public/);
  });
});

describe('migration 090 — RLS', () => {
  it('estoque_movimentos INSERT: ramos antigos da 089 + saída da comanda que ela fechou', () => {
    const ini = pos(corpo, 'create policy "estoque_movimentos: gestor pode inserir"');
    const pol = corpo.slice(ini, corpo.indexOf(';', ini));
    expect(pol).toContain("tem_permissao(empresa_id, 'estoque.acessar')");
    expect(pol).toContain("tem_permissao(empresa_id, 'vendas.acessar')");
    expect(pol).toContain("tem_permissao(empresa_id, 'agenda.gerenciar_outras')");
    expect(pol).toContain('agendamentos.profissional_id = auth.uid()');
    expect(pol).toMatch(/comanda_id is not null\s+and comanda_pertence_ao_profissional\(comanda_id\)/);
    expect(corpo).toContain('drop policy if exists "estoque_movimentos: gestor pode inserir" on public.estoque_movimentos');
  });
  it('drop de "comissoes: membro insere" (comissões só nascem por trigger)', () => {
    expect(corpo).toContain('drop policy if exists "comissoes: membro insere" on public.comissoes');
    expect(corpo).not.toMatch(/create policy "comissoes: membro insere"/);
  });
});
