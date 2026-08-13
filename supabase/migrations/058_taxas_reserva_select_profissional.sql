-- ============================================================
-- TAXAS_RESERVA — SELECT liberado tambem para o profissional dono
--
-- A comanda (fechamento) precisa ler taxas_reserva pagas para
-- descontar do total cobrado. Profissionais ja podem ver/fechar suas
-- proprias comandas (migration 045), mas a policy de SELECT de
-- taxas_reserva so liberava gestor/owner — a comanda de uma
-- profissional lia uma lista vazia via RLS e o desconto nunca era
-- aplicado. UPDATE continua restrito a gestor/owner (marcar como
-- paga continua exclusivo do Financeiro).
-- ============================================================

drop policy if exists "taxas_reserva: gestor ou owner ve" on public.taxas_reserva;

create policy "taxas_reserva: profissional ou gestor ve"
  on public.taxas_reserva for select
  using (
    is_gestor_ou_owner(empresa_id)
    or exists (
      select 1 from public.agendamentos a
      where a.id = taxas_reserva.agendamento_id and a.profissional_id = auth.uid()
    )
  );
