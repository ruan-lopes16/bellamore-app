-- ============================================================
-- MIGRATION 068 — agenda_bloqueios: tipos, motivo e aprovacao
--
-- 1. Colunas novas (aditivas; o codigo atual segue inserindo sem
--    elas gracas aos defaults / nullability):
--      escopo       'profissional' | 'geral'  (default 'profissional')
--      motivo       folga|feriado|almoco|reuniao|manutencao|outro
--                   (nullable; obrigatorio so na aplicacao)
--      situacao     'aprovado' | 'pendente'   (default 'aprovado')
--      criado_por   users(id)  — quem criou/pediu
--      revisado_por users(id)  — quem aprovou
--      revisado_em  timestamptz
--
-- 2. Backfill: linhas antigas viram escopo='geral' quando
--    profissional_id IS NULL; as demais pegam o default. Todas ficam
--    situacao='aprovado' (default) -> seguem visiveis a todos.
--
-- 3. Reescrita das 4 policies. A 033 usava um padrao incorreto com ANY
--    em vez de IN (SELECT ...). Corrigido para `IN (SELECT minha_empresas())`.
--    A novidade e a regra de papel/situacao; o recorte por empresa fica igual
--    ou melhor.
--
-- IMPACTO no unico consumidor (web .../agenda/page.tsx):
--   • SELECT — linhas atuais sao 'aprovado' -> seguem visiveis a todo
--     membro. Sem mudanca.
--   • INSERT de gestor/owner (modal atual) — passa por is_gestor_ou_owner;
--     defaults preenchem o resto. Sem regressao.
--   • INSERT de profissional pelo modal antigo — passa a ser negado
--     (falta criado_por/situacao/motivo). E a trava pedida; migration
--     e frontend sobem no mesmo PR.
--   • Hoje o codigo so faz INSERT e DELETE em agenda_bloqueios. Apos a
--     migration, profissional so apaga o PROPRIO bloqueio pendente; o
--     botao "X" da Timeline e ajustado no mesmo PR. Nenhum dado e perdido.
--
-- ⚠️ Conferir no painel se ha policies extras com outros nomes.
-- ============================================================

alter table public.agenda_bloqueios
  add column if not exists escopo       text not null default 'profissional'
    check (escopo in ('profissional', 'geral')),
  add column if not exists motivo       text
    check (motivo in ('folga', 'feriado', 'almoco', 'reuniao', 'manutencao', 'outro')),
  add column if not exists situacao     text not null default 'aprovado'
    check (situacao in ('aprovado', 'pendente')),
  add column if not exists criado_por   uuid references public.users(id) on delete set null,
  add column if not exists revisado_por uuid references public.users(id) on delete set null,
  add column if not exists revisado_em  timestamptz;

-- Backfill: bloqueios gerais antigos tinham profissional_id NULL
update public.agenda_bloqueios set escopo = 'geral' where profissional_id is null;

-- ── RLS reescrita (empresa_id IN (SELECT minha_empresas())) ──
drop policy if exists "bloqueios_select" on public.agenda_bloqueios;
drop policy if exists "bloqueios_insert" on public.agenda_bloqueios;
drop policy if exists "bloqueios_update" on public.agenda_bloqueios;
drop policy if exists "bloqueios_delete" on public.agenda_bloqueios;

create policy "bloqueios: ver" on public.agenda_bloqueios
  for select using (
    empresa_id in (select minha_empresas())
    and (
      situacao = 'aprovado'
      or criado_por = auth.uid()
      or is_gestor_ou_owner(empresa_id)
    )
  );

create policy "bloqueios: criar" on public.agenda_bloqueios
  for insert with check (
    empresa_id in (select minha_empresas())
    and (
      is_gestor_ou_owner(empresa_id)
      or (
        escopo        = 'profissional'
        and profissional_id = auth.uid()
        and criado_por      = auth.uid()
        and situacao        = 'pendente'
        and motivo is not null
      )
    )
  );

create policy "bloqueios: aprovar" on public.agenda_bloqueios
  for update using      (is_gestor_ou_owner(empresa_id))
             with check (is_gestor_ou_owner(empresa_id));

create policy "bloqueios: excluir" on public.agenda_bloqueios
  for delete using (
    is_gestor_ou_owner(empresa_id)
    or (criado_por = auth.uid() and situacao = 'pendente')
  );

create index if not exists idx_bloqueios_pendentes
  on public.agenda_bloqueios (empresa_id, situacao, data_inicio);
