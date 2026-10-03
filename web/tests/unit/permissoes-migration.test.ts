// web/tests/unit/permissoes-migration.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CATALOGO_PERMISSOES, permissoesPadrao } from '@shared/permissoes';

const root = join(__dirname, '..', '..', '..');
const sql = readFileSync(join(root, 'supabase/migrations/083_permissoes_configuraveis.sql'), 'utf8');

/** Extrai a lista literal de `array[...]` logo depois de um marcador. */
function arrayDepois(marcador: string): string[] {
  const i = sql.indexOf(marcador);
  expect(i, `marcador ${marcador}`).toBeGreaterThan(-1);
  const trecho = sql.slice(i, sql.indexOf(']', i));
  return [...trecho.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]).sort();
}

describe('migration 083 ↔ catálogo', () => {
  it('permissoes_chaves() lista exatamente as chaves do catálogo', () => {
    expect(arrayDepois('-- @chaves')).toEqual(CATALOGO_PERMISSOES.map(p => p.chave).sort());
  });
  it('padrão da profissional igual ao catálogo', () => {
    expect(arrayDepois('-- @padrao-profissional')).toEqual(permissoesPadrao('profissional').sort());
  });
  it('padrão da gestora = tudo menos as chaves negadas, iguais ao catálogo', () => {
    const negadasCatalogo = CATALOGO_PERMISSOES.filter(p => !p.padrao.gestor).map(p => p.chave).sort();
    expect(arrayDepois('-- @padrao-gestor-negado')).toEqual(negadasCatalogo);
  });
});

describe('migration 083 — estrutura', () => {
  it('cria as 3 tabelas com RLS e só SELECT para membros', () => {
    for (const t of ['permissoes_papel', 'permissoes_membro', 'permissoes_historico']) {
      expect(sql).toContain(`create table if not exists public.${t}`);
      expect(sql).toContain(`alter table public.${t} enable row level security`);
      expect(sql).toMatch(new RegExp(`on public\\.${t} for select`));
      expect(sql).not.toMatch(new RegExp(`on public\\.${t} for (insert|update|delete|all)`));
    }
  });

  it('tem_permissao: dona → exceção → papel → padrão; membro inativo → false', () => {
    const corpo = sql.slice(sql.indexOf('function public.tem_permissao'), sql.indexOf('function public.minhas_permissoes'));
    const ordem = ['owner_id = auth.uid()', 'ativo', 'permissoes_membro', 'permissoes_papel', 'permissao_padrao('];
    let ultimo = -1;
    for (const t of ordem) {
      const i = corpo.indexOf(t, ultimo + 1);
      expect(i, t).toBeGreaterThan(ultimo);
      ultimo = i;
    }
    expect(corpo).toMatch(/security definer/);
  });

  it('salvar_permissoes valida a regra da gestora e grava histórico', () => {
    const corpo = sql.slice(sql.indexOf('function public.salvar_permissoes'));
    expect(corpo).toMatch(/coalesce\(v_papel_editor, ''\) <> 'gestor'/);
    expect(corpo).toMatch(/v_alvo <> 'profissional'/);
    expect(corpo).toMatch(/v_alvo_papel <> 'profissional'/);
    expect(corpo).toMatch(/v_alvo_user = auth\.uid\(\)/);
    expect(corpo).toMatch(/insert into public\.permissoes_historico/);
    expect(corpo).toMatch(/errcode = '42501'/);
  });

  it('mudar papel de alguém continua só com a dona (trigger)', () => {
    expect(sql).toMatch(/before update of role on public\.empresa_membros/);
  });

  it('clientes ganha criado_por e índice para "só as que atendeu"', () => {
    expect(sql).toMatch(/alter table public\.clientes add column if not exists criado_por uuid default auth\.uid\(\)/);
    expect(sql).toMatch(/create index if not exists idx_agendamentos_cliente_profissional/);
  });

  it('termina recarregando o schema do PostgREST', () => {
    expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});

describe('migration 083 — cada chave "Banco" aparece numa policy', () => {
  const chavesBanco = [
    'agenda.ver_equipe', 'agenda.gerenciar_outras', 'agenda.excluir', 'agenda.aprovar_bloqueios',
    'clientes.ver_todas', 'clientes.cadastrar', 'clientes.editar', 'clientes.arquivar', 'clientes.excluir',
    'anamnese.ver', 'anamnese.editar', 'comanda.fechar', 'servicos.gerenciar', 'pacotes.gerenciar',
    'pacotes.vender', 'financeiro.ver', 'despesas.gerenciar', 'taxas.marcar_pagas',
    'financeiro.fechamentos', 'equipe.gerenciar', 'comissoes.ver_todas', 'comissoes.pagar',
    // Revisão final: deixaram de ser só "Tela" (o painel deixava ligar e o banco recusava).
    'estoque.acessar', 'vendas.acessar', 'config.taxas',
  ];
  for (const c of chavesBanco) {
    it(c, () => expect(sql).toMatch(new RegExp(`tem_permissao\\((old\\.|p\\.)?(empresa_id|id), '${c.replace('.', '\\.')}'\\)`)));
  }

  it('chaves "Tela" não aparecem em policy', () => {
    for (const c of ['comanda.desconto', 'comanda.editar_fechada']) {
      expect(sql).not.toContain(`tem_permissao(empresa_id, '${c}')`);
    }
  });
});

/** Trecho do SQL entre `create policy "<nome>"` e o próximo `;`. */
function policy(nome: string): string {
  const i = sql.indexOf(`create policy "${nome}"`);
  expect(i, `policy ${nome}`).toBeGreaterThan(-1);
  expect(sql, `drop antes de ${nome}`).toContain(`drop policy if exists "${nome}"`);
  return sql.slice(i, sql.indexOf(';', i));
}

describe('migration 083 — correções da revisão final', () => {
  it('produtos: inserir/atualizar com estoque.acessar (nomes de produção)', () => {
    expect(policy('produtos: gestor pode inserir')).toContain("tem_permissao(empresa_id, 'estoque.acessar')");
    expect(policy('produtos: gestor pode atualizar')).toContain("tem_permissao(empresa_id, 'estoque.acessar')");
  });

  it('estoque_movimentos INSERT: estoque.acessar, saída do próprio atendimento preservada e saída de venda', () => {
    const p = policy('estoque_movimentos: gestor pode inserir');
    expect(p).toContain("tem_permissao(empresa_id, 'estoque.acessar')");
    // Ramo de produção: saída ligada ao próprio agendamento (comanda da profissional).
    expect(p).toMatch(/tipo = 'saida'::movimento_tipo[\s\S]*agendamento_id is not null[\s\S]*agendamentos\.profissional_id = auth\.uid\(\)[\s\S]*agendamentos\.empresa_id = estoque_movimentos\.empresa_id/);
    expect(p).toMatch(/tipo = 'saida'::movimento_tipo and tem_permissao\(empresa_id, 'vendas\.acessar'\)/);
    expect(policy('estoque_movimentos: gestor pode atualizar')).toContain("tem_permissao(empresa_id, 'estoque.acessar')");
  });

  it('baixa de estoque (trigger) roda como definer para quem já passou na policy', () => {
    const corpo = sql.slice(sql.indexOf('function public.atualizar_estoque'));
    expect(corpo.slice(0, 900)).toMatch(/security definer set search_path = public/);
  });

  it('empresas: UPDATE de não-dona via config.taxas + trigger que só deixa mudar taxa_*', () => {
    expect(policy('empresas: gestor pode atualizar')).toContain("tem_permissao(id, 'config.taxas')");
    const corpo = sql.slice(sql.indexOf('function public.fn_empresas_nao_dona_so_taxas'));
    expect(corpo).toMatch(/security definer set search_path = public/);
    expect(corpo).toMatch(/auth\.uid\(\) is null/);
    expect(corpo).toMatch(/eh_dona_da_empresa\(old\.id\)/);
    expect(corpo).toMatch(/like 'taxa\\_%'/);
    expect(corpo).toMatch(/errcode = '42501'/);
    expect(sql).toContain('drop trigger if exists trg_empresas_nao_dona_so_taxas on public.empresas');
    expect(sql).toMatch(/create trigger trg_empresas_nao_dona_so_taxas\s+before update on public\.empresas/);
  });

  it('pagamentos SELECT: financeiro.ver, mantendo o ramo da comanda própria', () => {
    const p = policy('pagamentos: profissional ou gestor ve');
    expect(p).toContain("tem_permissao(empresa_id, 'financeiro.ver')");
    expect(p).toContain('comanda_pertence_ao_profissional(comanda_id)');
    expect(p).not.toContain('is_gestor_ou_owner');
  });

  it('salvar_permissoes: não-dona não liga chave que ela mesma não tem', () => {
    const corpo = sql.slice(sql.indexOf('function public.salvar_permissoes'), sql.indexOf('grant execute on function public.salvar_permissoes'));
    const recusas = corpo.match(/not v_owner and v_para is true and not public\.tem_permissao\(p_empresa, v_chave\)/g) ?? [];
    expect(recusas.length).toBe(2); // papel e membro
  });

  it('empresa_membros UPDATE: não-dona só em profissionais que não sejam ela', () => {
    const p = policy('membros: gestor ou owner atualiza');
    expect(p).toContain("tem_permissao(empresa_id, 'equipe.gerenciar')");
    expect(p).toMatch(/eh_dona_da_empresa\(empresa_id\)[\s\S]*role = 'profissional'::perfil_role and user_id <> auth\.uid\(\)/);
    expect(p).toMatch(/using[\s\S]*with check/);
  });

  it('eh_dona_da_empresa: dona por owner_id ou papel owner, security definer', () => {
    const corpo = sql.slice(sql.indexOf('function public.eh_dona_da_empresa'));
    expect(corpo.slice(0, 700)).toMatch(/security definer set search_path = public/);
    expect(corpo.slice(0, 700)).toContain('owner_id = auth.uid()');
    expect(corpo.slice(0, 700)).toMatch(/role::text = 'owner'/);
  });
});
