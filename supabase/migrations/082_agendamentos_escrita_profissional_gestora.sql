-- ============================================================
-- 082 — Profissional e gestora gravam agendamentos
-- ============================================================
-- Bug de produção (confirmado em 2026-10-02 lendo pg_policies do banco real):
-- em public.agendamentos (RLS ligado) não existe policy de INSERT nem de UPDATE
-- versionada. A única que cobre escrita é "gestor pode gerenciar agendamentos"
-- (FOR ALL), criada à mão fora das migrations, que apesar do nome só libera a
-- DONA (`empresa_id in (select id from empresas where owner_id = auth.uid())`).
-- Consequências, para profissional e gestora:
--   • criar agendamento → recusado ("new row violates row-level security policy");
--   • concluir atendimento / fechar comanda / mudar status → UPDATE afeta 0
--     linhas EM SILÊNCIO: a comanda é criada, mas o agendamento fica sem
--     comanda_id e status antigo (alerta de "comanda não fechada", comanda em dobro).
--
-- Regra nova (aditiva — policies RLS são OR entre si):
--   • gestor/owner: grava qualquer agendamento da empresa;
--   • profissional: grava só agendamentos em que ela é a profissional, e o
--     WITH CHECK impede repassar o agendamento para outra pessoa.
-- DELETE intocado (066). A policy antiga da dona também fica (redundante, inofensiva).
-- Os triggers que rodam ao concluir (comissão 065, pacote 078, taxa de reserva 061,
-- taxa de cancelamento 052, bloqueio 074) já são SECURITY DEFINER.
--
-- Rollback:
--   drop policy "agendamentos: equipe insere"  on public.agendamentos;
--   drop policy "agendamentos: equipe atualiza" on public.agendamentos;

drop policy if exists "agendamentos: equipe insere"  on public.agendamentos;
drop policy if exists "agendamentos: equipe atualiza" on public.agendamentos;

create policy "agendamentos: equipe insere"
  on public.agendamentos for insert
  with check (
    empresa_id in (select minha_empresas())
    and (is_gestor_ou_owner(empresa_id) or profissional_id = auth.uid())
  );

create policy "agendamentos: equipe atualiza"
  on public.agendamentos for update
  using (
    empresa_id in (select minha_empresas())
    and (is_gestor_ou_owner(empresa_id) or profissional_id = auth.uid())
  )
  with check (
    empresa_id in (select minha_empresas())
    and (is_gestor_ou_owner(empresa_id) or profissional_id = auth.uid())
  );

notify pgrst, 'reload schema';
