-- Migration 031: rollback parcial dos danos da migration 027
--
-- A migration 027 assumiu erroneamente que colunas como agendamentos.cliente_id
-- referenciavam public.users, mas na prática referenciavam public.clientes e
-- public.empresa_membros. Os UPDATEs zeraram todos esses campos.
--
-- Este script restaura o máximo possível dos dados e corrige as FKs.

-- ── 1. Garantir perfil de Ana Clara em public.users ──────────────
INSERT INTO public.users (id, nome)
SELECT id, email
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ── 2. Restaurar owner_id das empresas sem dono ──────────────────
-- (Assume owner = primeiro gestor cadastrado na empresa)
UPDATE public.empresas e
SET owner_id = (
  SELECT em.user_id
  FROM public.empresa_membros em
  WHERE em.empresa_id = e.id
    AND em.role = 'gestor'
    AND em.ativo = true
  ORDER BY em.created_at
  LIMIT 1
)
WHERE e.owner_id IS NULL;

-- ── 3. Restaurar profissional_id nos agendamentos ────────────────
-- Usa o único profissional ativo da empresa de cada agendamento
UPDATE public.agendamentos a
SET profissional_id = (
  SELECT em.user_id
  FROM public.empresa_membros em
  WHERE em.empresa_id = a.empresa_id
    AND em.ativo = true
  ORDER BY em.created_at
  LIMIT 1
)
WHERE a.profissional_id IS NULL;

-- ── 4. Restaurar profissional_id nas comissões ───────────────────
UPDATE public.comissoes c
SET profissional_id = a.profissional_id
FROM public.agendamentos a
WHERE c.agendamento_id = a.id
  AND c.profissional_id IS NULL
  AND a.profissional_id IS NOT NULL;

-- ── 5. Corrigir FK de agendamentos.cliente_id → clientes ─────────
ALTER TABLE public.agendamentos
  DROP CONSTRAINT IF EXISTS agendamentos_cliente_id_fkey;

-- Recuperar cliente_id via comanda onde possível
UPDATE public.agendamentos a
SET cliente_id = c.clientes_id
FROM public.comandas c
WHERE a.comanda_id = c.id
  AND a.cliente_id IS NULL
  AND c.clientes_id IS NOT NULL;

ALTER TABLE public.agendamentos
  ADD CONSTRAINT agendamentos_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;

-- ── 6. Corrigir FK de anamnese_fichas.cliente_id → clientes ──────
ALTER TABLE public.anamnese_fichas
  DROP CONSTRAINT IF EXISTS anamnese_fichas_cliente_id_fkey;

ALTER TABLE public.anamnese_fichas
  ADD CONSTRAINT anamnese_fichas_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;
