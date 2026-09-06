import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { agruparValoresPorAgendamento, type ItemComandaValor } from '@shared/comanda';

// ── Helper puro: agrupar valores por agendamento ──────────────

function item(over: Partial<ItemComandaValor>): ItemComandaValor {
  return { tipo: 'agendamento', valor: 100, quantidade: 1, ...over };
}

describe('agruparValoresPorAgendamento', () => {
  it('agendamento legado (servico unico) — so o total, sem linhas de servico', () => {
    const r = agruparValoresPorAgendamento([
      item({ agendamento_id: 'ag1', servico_id: 's1', valor: 150 } as Partial<ItemComandaValor>),
    ]);
    expect(r).toEqual([
      { agendamentoId: 'ag1', novoValorTotal: 150, linhasServico: [] },
    ]);
  });

  it('agendamento multi-servico — total somado e uma linha por agendamento_servicos', () => {
    const r = agruparValoresPorAgendamento([
      item({ agendamento_id: 'ag1', ag_servico_id: 'as1', valor: 80 }),
      item({ agendamento_id: 'ag1', ag_servico_id: 'as2', valor: 45 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].agendamentoId).toBe('ag1');
    expect(r[0].novoValorTotal).toBe(125);
    expect(r[0].linhasServico).toEqual([
      { agServicoId: 'as1', valor: 80 },
      { agServicoId: 'as2', valor: 45 },
    ]);
  });

  it('reflete o valor EDITADO, nao o original', () => {
    // usuario trocou 100 -> 130 na linha
    const r = agruparValoresPorAgendamento([
      item({ agendamento_id: 'ag1', ag_servico_id: 'as1', valor: 130 }),
    ]);
    expect(r[0].novoValorTotal).toBe(130);
    expect(r[0].linhasServico[0]).toEqual({ agServicoId: 'as1', valor: 130 });
  });

  it('separa agendamentos diferentes', () => {
    const r = agruparValoresPorAgendamento([
      item({ agendamento_id: 'ag1', ag_servico_id: 'as1', valor: 100 }),
      item({ agendamento_id: 'ag2', ag_servico_id: 'as2', valor: 200 }),
    ]);
    expect(r.map(g => g.agendamentoId).sort()).toEqual(['ag1', 'ag2']);
    expect(r.find(g => g.agendamentoId === 'ag2')?.novoValorTotal).toBe(200);
  });

  it('ignora itens extras (servico/produto/pacote avulsos)', () => {
    const r = agruparValoresPorAgendamento([
      item({ agendamento_id: 'ag1', ag_servico_id: 'as1', valor: 100 }),
      { tipo: 'servico', valor: 50, quantidade: 1, servico_id: 'x' } as ItemComandaValor,
      { tipo: 'produto', valor: 30, quantidade: 2, produto_id: 'y' } as ItemComandaValor,
      { tipo: 'pacote', valor: 500, quantidade: 1, pacote_id: 'z' } as ItemComandaValor,
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].novoValorTotal).toBe(100);
  });

  it('ignora item de agendamento sem agendamento_id (defensivo)', () => {
    const r = agruparValoresPorAgendamento([
      item({ agendamento_id: null, ag_servico_id: 'as1', valor: 100 }),
    ]);
    expect(r).toEqual([]);
  });

  it('quantidade <= 0 conta como 1', () => {
    const r = agruparValoresPorAgendamento([
      item({ agendamento_id: 'ag1', valor: 90, quantidade: 0 }),
    ]);
    expect(r[0].novoValorTotal).toBe(90);
  });

  it('nao acumula erro de ponto flutuante no total', () => {
    const r = agruparValoresPorAgendamento([
      item({ agendamento_id: 'ag1', ag_servico_id: 'as1', valor: 0.1 }),
      item({ agendamento_id: 'ag1', ag_servico_id: 'as2', valor: 0.2 }),
    ]);
    expect(r[0].novoValorTotal).toBe(0.3);
  });
});

// ── Migration 075 ────────────────────────────────────────────

const sql = readFileSync(
  join(process.cwd(), '..', 'supabase', 'migrations', '075_comanda_edicao_valor_e_rls_pagamentos.sql'),
  'utf8',
).toLowerCase();

describe('Migration 075 — pagamentos duplicando + comissao nao sincroniza', () => {
  it('recria a policy de DELETE de pagamentos (a 045 nunca foi aplicada)', () => {
    expect(sql).toMatch(/create policy "pagamentos: profissional ou gestor deleta"\s+on public\.pagamentos\s+for delete/);
    expect(sql).toContain('is_gestor_ou_owner(empresa_id)');
    expect(sql).toContain('comanda_pertence_ao_profissional(comanda_id)');
  });

  it('remove os nomes antigos de policy de pagamentos antes de recriar', () => {
    expect(sql).toContain('drop policy if exists "pagamentos: membro ve"');
    expect(sql).toContain('drop policy if exists "pagamentos: membro seleciona"');
    expect(sql).toContain('drop policy if exists "pagamentos: profissional ou gestor deleta"');
  });

  it('recria o conjunto de policies de comanda_itens (insert/select/update/delete)', () => {
    expect(sql).toContain('drop policy if exists "comanda_itens: membro gerencia"');
    expect(sql).toContain('create policy "comanda_itens: membro insere"');
    expect(sql).toContain('create policy "comanda_itens: profissional ou gestor ve"');
    expect(sql).toContain('create policy "comanda_itens: profissional ou gestor atualiza"');
    expect(sql).toContain('create policy "comanda_itens: profissional ou gestor deleta"');
  });

  it('cria o trigger de sincronizacao de valor da comissao', () => {
    expect(sql).toMatch(/create trigger trg_sincronizar_comissao_valor\s+after update of valor on public\.agendamentos/);
    expect(sql).toContain('create or replace function public.sincronizar_comissao_valor()');
    expect(sql).toContain('security definer');
  });

  it('sincroniza comissoes.valor_servico com o novo valor do agendamento', () => {
    expect(sql).toContain('update public.comissoes');
    expect(sql).toContain('set valor_servico = new.valor');
    expect(sql).toContain('where agendamento_id = new.id');
  });

  it('so age quando um agendamento JA concluido tem o valor alterado', () => {
    expect(sql).toContain("new.status = 'concluido'");
    expect(sql).toContain("old.status = 'concluido'");
    expect(sql).toContain('new.valor is distinct from old.valor');
  });

  it('nao limpa as duplicatas ja gravadas — deixa query de diagnostico', () => {
    expect(sql).toContain('having count(*) > 1');
  });
});
