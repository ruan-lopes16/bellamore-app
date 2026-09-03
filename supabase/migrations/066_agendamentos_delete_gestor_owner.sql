-- ============================================================
-- MIGRATION 066 — agendamentos: policy de DELETE (gestor/owner)
--
-- Hoje NENHUMA policy de INSERT/UPDATE/DELETE de agendamentos está
-- versionada — só a de SELECT (001, reescrita na 042). As de escrita
-- foram criadas no painel do Supabase. Com RLS ligado (001) e sem
-- policy de DELETE, o cliente não apaga agendamento nenhum — estado
-- atual. Não existe nenhum .from('agendamentos').delete() no código.
--
-- Esta migration cria a policy de DELETE explícita e restrita a
-- gestor/owner (is_gestor_ou_owner, da 003). Só ABRE a ação nova
-- (Tasks 6 e 7); não altera nenhum fluxo existente.
--
-- O USING também exclui linhas `concluido`: defesa em profundidade
-- atrás do guard de cliente `podeExcluirAgendamento`. O backstop de
-- FK é só CONDICIONAL — um profissional owner/CLT a 0% de comissão
-- não gera linha em `comissoes`, então um `concluido` criado direto
-- pela agenda, sem comanda/estoque/pacote, poderia ser apagado
-- limpo e levar em cascata as `taxas_reserva` já pagas. O predicado
-- `status <> 'concluido'` fecha esse buraco no próprio banco.
--
-- ⚠️ Conferir no painel do Supabase se sobrou alguma policy de DELETE
--    em public.agendamentos com outro nome (policies permissivas se
--    somam com OR — não quebraria nada, só afrouxaria a trava).
-- ============================================================

alter table public.agendamentos enable row level security;

drop policy if exists "agendamentos: excluir"                on public.agendamentos;
drop policy if exists "agendamentos: gestor exclui"          on public.agendamentos;
drop policy if exists "agendamentos: membro exclui"          on public.agendamentos;
drop policy if exists "agendamentos: gestor ou owner exclui" on public.agendamentos;

create policy "agendamentos: gestor ou owner exclui"
  on public.agendamentos
  for delete
  using (is_gestor_ou_owner(empresa_id) and status <> 'concluido');
