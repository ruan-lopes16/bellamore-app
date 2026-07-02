-- ============================================================
-- Pacotes: sessões ilimitadas por serviço + integração com
-- agendamento (vínculo explícito) e comanda (venda como item).
-- ============================================================

-- 1. Vincular um pacote_cliente específico a um agendamento
--    (controle explícito, em vez de só o match automático por serviço)
-- ============================================================
alter table public.agendamentos
  add column if not exists pacote_cliente_id uuid references public.pacote_clientes(id);

-- 2. Comanda: permitir vender um pacote como item extra
-- ============================================================
alter table public.comanda_itens
  add column if not exists pacote_id uuid references public.pacotes(id);

alter table public.comanda_itens
  drop constraint if exists comanda_itens_tipo_check;

alter table public.comanda_itens
  add constraint comanda_itens_tipo_check
  check (tipo in ('servico', 'produto', 'pacote'));

-- 3. Corrige o trigger de consumo automático de sessão:
--    a) pacotes sem validade (data_validade NULL) devem continuar valendo
--       (bug introduzido ao tornar a validade opcional)
--    b) serviços com quantidade NULL (sessões ilimitadas) nunca bloqueiam
--    c) se o agendamento já tem pacote_cliente_id definido (vínculo manual
--       feito na tela de agenda), usa ele diretamente em vez de buscar
-- ============================================================
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
    WHERE pc.id = NEW.pacote_cliente_id
      AND pc.empresa_id = NEW.empresa_id;
  ELSE
    -- Busca automática por serviço (comportamento padrão)
    SELECT pc.id, pc.empresa_id
      INTO v_pc_id, v_empresa_id
    FROM public.pacote_clientes pc
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
