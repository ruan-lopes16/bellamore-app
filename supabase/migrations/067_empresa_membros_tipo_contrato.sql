-- ============================================================
-- MIGRATION 067 — empresa_membros: tipo de contrato
--
-- Coluna opcional para registrar o vínculo do profissional:
--   'pj'  → "PJ / Comissionada"
--   'clt' → "CLT"
--   NULL  → não informado
--
-- Aditiva e nullable: linhas existentes ficam NULL, nada quebra. O
-- CHECK só rejeita valor não-nulo fora da lista. Sem policy nova:
-- empresa_membros já tem UPDATE restrito a gestor/owner (043); o
-- trigger bloquear_alteracao_role (043) só inspeciona
-- role/user_id/empresa_id e ignora esta coluna.
--
-- Hoje NÃO ramifica o fluxo de bloqueio (PJ e CLT caem os dois em
-- aprovação) — registro de cadastro para diferenciação futura.
-- ============================================================

alter table public.empresa_membros
  add column if not exists tipo_contrato text
    check (tipo_contrato in ('pj', 'clt'));

comment on column public.empresa_membros.tipo_contrato is
  'Vinculo: pj (PJ/Comissionada) | clt | NULL. Registro de cadastro; nao altera regras de bloqueio.';
