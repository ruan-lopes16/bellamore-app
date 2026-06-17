-- ============================================================
-- PACOTE_USO AUTOMÁTICO
-- Quando um agendamento muda para 'concluido', verifica se o
-- cliente tem um pacote ativo que inclui aquele serviço e
-- ainda tem sessões restantes. Se sim, registra o uso automaticamente.
--
-- Prioridade: pacote que vence primeiro (para não deixar expirar).
-- Fallback: se não há pacote compatível, não faz nada.
-- ============================================================

-- 1. Garantir que cada agendamento só gere 1 uso (evita duplicata
--    caso o status seja atualizado 2x ou o botão manual seja usado)
ALTER TABLE public.pacote_uso
  ADD CONSTRAINT pacote_uso_agendamento_unico
  UNIQUE (agendamento_id);

-- 2. Função do trigger
CREATE OR REPLACE FUNCTION fn_registrar_uso_pacote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pc_id      uuid;
  v_empresa_id uuid;
BEGIN
  -- Só age quando status muda PARA 'concluido' (e não já estava)
  IF NEW.status <> 'concluido' OR OLD.status = 'concluido' THEN
    RETURN NEW;
  END IF;

  -- Busca pacote_clientes ativo que:
  --   a) pertence ao mesmo cliente + empresa do agendamento
  --   b) inclui o serviço realizado (pacote_servicos)
  --   c) ainda tem sessões restantes (usadas < total)
  --   d) não está vencido
  -- Ordena pelo que vence primeiro para priorizar consumo
  SELECT pc.id, pc.empresa_id
    INTO v_pc_id, v_empresa_id
  FROM public.pacote_clientes pc
  JOIN public.pacote_servicos ps
    ON ps.pacote_id = pc.pacote_id
   AND ps.servico_id = NEW.servico_id
  WHERE pc.cliente_id    = NEW.cliente_id
    AND pc.empresa_id    = NEW.empresa_id
    AND pc.status        = 'ativo'
    AND pc.data_validade >= CURRENT_DATE
    AND (
      -- sessões usadas até agora
      SELECT COUNT(*)
        FROM public.pacote_uso pu
       WHERE pu.pacote_cliente_id = pc.id
    ) < (
      -- total de sessões do pacote
      SELECT COALESCE(SUM(ps2.quantidade), 0)
        FROM public.pacote_servicos ps2
       WHERE ps2.pacote_id = pc.pacote_id
    )
  ORDER BY pc.data_validade ASC
  LIMIT 1;

  -- Se encontrou um pacote compatível, registra o uso
  IF v_pc_id IS NOT NULL THEN
    INSERT INTO public.pacote_uso
      (empresa_id, pacote_cliente_id, servico_id, agendamento_id)
    VALUES
      (v_empresa_id, v_pc_id, NEW.servico_id, NEW.id)
    ON CONFLICT (agendamento_id) DO NOTHING;  -- idempotente
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Criar o trigger na tabela agendamentos
DROP TRIGGER IF EXISTS trg_uso_pacote ON public.agendamentos;

CREATE TRIGGER trg_uso_pacote
  AFTER UPDATE ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION fn_registrar_uso_pacote();
