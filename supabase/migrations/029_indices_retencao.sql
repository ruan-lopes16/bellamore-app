-- ============================================================
-- Índices para queries de retenção de clientes
-- Dashboard: clientes inativos (última visita por cliente)
-- Dashboard: aniversariantes (clientes com data_nascimento)
-- Cliente/[id]: stats rápidos de visitas concluídas
-- ============================================================

-- Melhora a query de "última visita por cliente" no dashboard
CREATE INDEX IF NOT EXISTS idx_ags_empresa_status_cliente_data
  ON public.agendamentos(empresa_id, status, data_hora_inicio DESC, cliente_id)
  WHERE status = 'concluido';

-- Melhora a query de stats do perfil do cliente (/clientes/[id])
CREATE INDEX IF NOT EXISTS idx_ags_cliente_status_data
  ON public.agendamentos(cliente_id, status, data_hora_inicio DESC)
  WHERE status = 'concluido';

-- Melhora a query de aniversariantes (clientes com birthday, empresa + ativo)
CREATE INDEX IF NOT EXISTS idx_clientes_empresa_ativo_nascimento
  ON public.clientes(empresa_id, ativo, data_nascimento)
  WHERE ativo = TRUE AND data_nascimento IS NOT NULL;
