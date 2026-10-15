-- ============================================================
-- MIGRATION 089 — Permissões: tela e banco de acordo
-- Matriz: docs/superpowers/notes/2026-10-14-matriz-permissoes.md
--
-- Revisão das 27 chaves (web/PWA × app × policies). Cada item abaixo é um caso em que a tela
-- libera a ação para quem tem a chave e o banco recusava (ou o contrário). Idempotente:
-- `create or replace` e `drop policy if exists` + `create policy` com o MESMO nome.
-- A dona não muda em nada: em todas as condições ela já passava (is_gestor_ou_owner ou
-- tem_permissao, que devolve true para a dona). Nenhum security definer novo.
--
-- 1) comanda_pertence_ao_profissional(comanda): passa a valer também para quem FECHOU a
--    comanda (comandas.profissional_id = auth.uid(); gravado desde o commit 4088486). Antes
--    só olhava agendamentos.comanda_id: na comanda só com extras (venda sem atendimento)
--    fechada pela profissional, ela via a comanda, mas não os itens nem os pagamentos — ao
--    editar, a tela abria vazia, o DELETE dos pagamentos acertava 0 linhas em silêncio, a
--    contagem de conferência (também invisível) dava 0 e os pagamentos eram reinseridos em
--    dobro. A função já era security definer (045/073/075); só o corpo muda.
-- 2) comandas (SELECT/UPDATE), comanda_itens (SELECT/UPDATE/DELETE) e pagamentos (DELETE):
--    ganham o ramo "agenda.gerenciar_outras". A tela (web e app) deixa fechar e editar a
--    comanda de outra profissional com essa chave (podeMexerNoAgendamento), e pagamentos
--    SELECT e taxas_reserva SELECT já tinham esse ramo desde a 083 — mas quem tinha a chave
--    sem ser gestora (exceção por pessoa) não lia os itens nem conseguia salvar a edição.
--    O ramo is_gestor_ou_owner continua (a gestora segue exatamente como antes).
-- 3) estoque_movimentos INSERT: saída ligada a atendimento de OUTRA profissional para quem
--    tem "agenda.gerenciar_outras" (produto extra na comanda da colega). Antes só o ramo do
--    próprio atendimento: a baixa era recusada e a tela só avisava. Ramos anteriores iguais.
-- 4) servico_produtos (receita de insumos): a escrita era só da dona (008: owner_id =
--    auth.uid()), mas a tela de Serviços oferece os insumos a quem tem "servicos.gerenciar" —
--    a gestora via "salvo" e nada mudava. Passa a exigir servicos.gerenciar (= tela).
-- 5) agendamento_servicos: era "membro gerencia" FOR ALL (qualquer membro alterava os
--    serviços de qualquer atendimento). A escrita passa a seguir a policy de agendamentos:
--    o próprio atendimento ou "agenda.gerenciar_outras". Leitura continua para membro.
--
-- Rollback (recria o estado anterior):
--   create or replace function public.comanda_pertence_ao_profissional(p_comanda_id uuid)
--     returns boolean language sql stable security definer set search_path = public as $$
--     select exists (select 1 from public.agendamentos a
--                    where a.comanda_id = p_comanda_id and a.profissional_id = auth.uid()); $$;
--   comandas/comanda_itens/pagamentos: recriar as policies como na 073 (comandas) e 075
--     (comanda_itens, pagamentos DELETE), sem o ramo tem_permissao(..., 'agenda.gerenciar_outras').
--   estoque_movimentos: recriar "estoque_movimentos: gestor pode inserir" como na 083.
--   servico_produtos: recriar "servico_produtos: gestor gerencia" como na 008.
--   agendamento_servicos: drop das 4 policies novas e recriar "agendamento_servicos: membro
--     gerencia" como na 020.
--   notify pgrst, 'reload schema';
-- ============================================================

-- ── 1. Quem fechou a comanda também é "dona" dela ─────────────
create or replace function public.comanda_pertence_ao_profissional(p_comanda_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.agendamentos a
    where a.comanda_id = p_comanda_id and a.profissional_id = auth.uid()
  ) or exists (
    select 1 from public.comandas c
    where c.id = p_comanda_id and c.profissional_id = auth.uid()
  );
$$;

-- ── 2. Comanda de outra profissional com agenda.gerenciar_outras ──
drop policy if exists "comandas: profissional ou gestor ve" on public.comandas;
create policy "comandas: profissional ou gestor ve" on public.comandas for select using (
  is_gestor_ou_owner(empresa_id)
  or profissional_id = auth.uid()
  or comanda_pertence_ao_profissional(id)
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras')
);
drop policy if exists "comandas: profissional ou gestor atualiza" on public.comandas;
create policy "comandas: profissional ou gestor atualiza" on public.comandas for update using (
  is_gestor_ou_owner(empresa_id)
  or profissional_id = auth.uid()
  or comanda_pertence_ao_profissional(id)
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras')
);

drop policy if exists "comanda_itens: profissional ou gestor ve" on public.comanda_itens;
create policy "comanda_itens: profissional ou gestor ve" on public.comanda_itens for select using (
  is_gestor_ou_owner(empresa_id)
  or comanda_pertence_ao_profissional(comanda_id)
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras')
);
drop policy if exists "comanda_itens: profissional ou gestor atualiza" on public.comanda_itens;
create policy "comanda_itens: profissional ou gestor atualiza" on public.comanda_itens for update using (
  is_gestor_ou_owner(empresa_id)
  or comanda_pertence_ao_profissional(comanda_id)
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras')
);
drop policy if exists "comanda_itens: profissional ou gestor deleta" on public.comanda_itens;
create policy "comanda_itens: profissional ou gestor deleta" on public.comanda_itens for delete using (
  is_gestor_ou_owner(empresa_id)
  or comanda_pertence_ao_profissional(comanda_id)
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras')
);

drop policy if exists "pagamentos: profissional ou gestor deleta" on public.pagamentos;
create policy "pagamentos: profissional ou gestor deleta" on public.pagamentos for delete using (
  is_gestor_ou_owner(empresa_id)
  or (comanda_id is not null and comanda_pertence_ao_profissional(comanda_id))
  or (comanda_id is not null and tem_permissao(empresa_id, 'agenda.gerenciar_outras'))
);

-- ── 3. Baixa de estoque do produto extra na comanda da colega ──
drop policy if exists "estoque_movimentos: gestor pode inserir" on public.estoque_movimentos;
create policy "estoque_movimentos: gestor pode inserir" on public.estoque_movimentos for insert with check (
  tem_permissao(empresa_id, 'estoque.acessar')
  or (tipo = 'saida'::movimento_tipo and agendamento_id is not null
      and exists (select 1 from public.agendamentos
                  where agendamentos.id = estoque_movimentos.agendamento_id
                    and agendamentos.profissional_id = auth.uid()
                    and agendamentos.empresa_id = estoque_movimentos.empresa_id))
  or (tipo = 'saida'::movimento_tipo and tem_permissao(empresa_id, 'vendas.acessar'))
  or (tipo = 'saida'::movimento_tipo and agendamento_id is not null
      and tem_permissao(empresa_id, 'agenda.gerenciar_outras')
      and exists (select 1 from public.agendamentos
                  where agendamentos.id = estoque_movimentos.agendamento_id
                    and agendamentos.empresa_id = estoque_movimentos.empresa_id))
);

-- ── 4. Receita de insumos com servicos.gerenciar ──────────────
drop policy if exists "servico_produtos: gestor gerencia" on public.servico_produtos;
create policy "servico_produtos: gestor gerencia" on public.servico_produtos for all
  using (exists (select 1 from public.servicos s
                 where s.id = servico_produtos.servico_id and tem_permissao(s.empresa_id, 'servicos.gerenciar')))
  with check (exists (select 1 from public.servicos s
                      where s.id = servico_produtos.servico_id and tem_permissao(s.empresa_id, 'servicos.gerenciar')));

-- ── 5. Serviços do atendimento seguem a policy de agendamentos ──
drop policy if exists "agendamento_servicos: membro gerencia" on public.agendamento_servicos;
drop policy if exists "agendamento_servicos: membro ve" on public.agendamento_servicos;
create policy "agendamento_servicos: membro ve" on public.agendamento_servicos for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "agendamento_servicos: equipe insere" on public.agendamento_servicos;
create policy "agendamento_servicos: equipe insere" on public.agendamento_servicos for insert with check (
  empresa_id in (select minha_empresas())
  and (tem_permissao(empresa_id, 'agenda.gerenciar_outras')
       or exists (select 1 from public.agendamentos a
                  where a.id = agendamento_servicos.agendamento_id and a.profissional_id = auth.uid()))
);
drop policy if exists "agendamento_servicos: equipe atualiza" on public.agendamento_servicos;
create policy "agendamento_servicos: equipe atualiza" on public.agendamento_servicos for update
  using (
    empresa_id in (select minha_empresas())
    and (tem_permissao(empresa_id, 'agenda.gerenciar_outras')
         or exists (select 1 from public.agendamentos a
                    where a.id = agendamento_servicos.agendamento_id and a.profissional_id = auth.uid()))
  )
  with check (
    empresa_id in (select minha_empresas())
    and (tem_permissao(empresa_id, 'agenda.gerenciar_outras')
         or exists (select 1 from public.agendamentos a
                    where a.id = agendamento_servicos.agendamento_id and a.profissional_id = auth.uid()))
  );
drop policy if exists "agendamento_servicos: equipe exclui" on public.agendamento_servicos;
create policy "agendamento_servicos: equipe exclui" on public.agendamento_servicos for delete using (
  empresa_id in (select minha_empresas())
  and (tem_permissao(empresa_id, 'agenda.gerenciar_outras')
       or exists (select 1 from public.agendamentos a
                  where a.id = agendamento_servicos.agendamento_id and a.profissional_id = auth.uid()))
);

notify pgrst, 'reload schema';
