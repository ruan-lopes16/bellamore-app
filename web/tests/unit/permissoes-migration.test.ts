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
  ];
  for (const c of chavesBanco) {
    it(c, () => expect(sql).toMatch(new RegExp(`tem_permissao\\((old\\.|p\\.)?empresa_id, '${c.replace('.', '\\.')}'\\)`)));
  }

  it('chaves "Tela" não aparecem em policy', () => {
    for (const c of ['comanda.desconto', 'comanda.editar_fechada', 'vendas.acessar', 'estoque.acessar', 'config.taxas']) {
      expect(sql).not.toContain(`tem_permissao(empresa_id, '${c}')`);
    }
  });
});
