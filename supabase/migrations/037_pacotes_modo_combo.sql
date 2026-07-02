-- ============================================================
-- Pacotes: modo "combo" (sem controle de sessões) além do modo
-- "com sessões" (comportamento padrão, já existente).
--
-- Um pacote combo agrupa serviços para uso conjunto (ex: "Musa
-- Express" = spa dos lábios + design de sobrancelha + buço, tudo
-- em um único atendimento) e não deve ter nenhum rastreio de
-- sessões restantes/consumo — é só um agrupamento de serviços.
-- ============================================================

alter table public.pacotes
  add column if not exists controla_sessoes boolean not null default true;

-- Corrige o trigger para ignorar pacotes em modo combo
-- (nunca registrar/consumir sessão para eles)
CREATE OR REPLACE FUNCTION fn_registrar_uso_pacote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pc_id      uuid;
  v_empresa_id uuid;
BEGIN
  IF NEW.status <> 'concluido' OR OLD.status = 'concluido' THEN
    RETURN NEW;
  END IF;

  IF NEW.pacote_cliente_id IS NOT NULL THEN
    -- Vínculo explícito escolhido no agendamento
    SELECT pc.id, pc.empresa_id
      INTO v_pc_id, v_empresa_id
    FROM public.pacote_clientes pc
    JOIN public.pacotes p ON p.id = pc.pacote_id
    WHERE pc.id = NEW.pacote_cliente_id
      AND pc.empresa_id = NEW.empresa_id
      AND p.controla_sessoes = true;
  ELSE
    -- Busca automática por serviço (comportamento padrão)
    SELECT pc.id, pc.empresa_id
      INTO v_pc_id, v_empresa_id
    FROM public.pacote_clientes pc
    JOIN public.pacotes p
      ON p.id = pc.pacote_id
     AND p.controla_sessoes = true
    JOIN public.pacote_servicos ps
      ON ps.pacote_id = pc.pacote_id
     AND ps.servico_id = NEW.servico_id
    WHERE pc.cliente_id    = NEW.cliente_id
      AND pc.empresa_id    = NEW.empresa_id
      AND pc.status        = 'ativo'
      AND (pc.data_validade IS NULL OR pc.data_validade >= CURRENT_DATE)
      AND (
        ps.quantidade IS NULL  -- sessões ilimitadas para este serviço
        OR (
          SELECT COUNT(*) FROM public.pacote_uso pu WHERE pu.pacote_cliente_id = pc.id
        ) < (
          SELECT COALESCE(SUM(ps2.quantidade), 0)
            FROM public.pacote_servicos ps2
           WHERE ps2.pacote_id = pc.pacote_id AND ps2.quantidade IS NOT NULL
        )
      )
    ORDER BY pc.data_validade ASC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_pc_id IS NOT NULL THEN
    INSERT INTO public.pacote_uso
      (empresa_id, pacote_cliente_id, servico_id, agendamento_id)
    VALUES
      (v_empresa_id, v_pc_id, NEW.servico_id, NEW.id)
    ON CONFLICT (agendamento_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
