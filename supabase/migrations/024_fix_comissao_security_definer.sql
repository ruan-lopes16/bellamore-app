-- Corrige definitivamente a geração automática de comissões.
--
-- EXECUTE ESTE ARQUIVO NO SUPABASE SQL EDITOR
-- (não há supabase/config.toml — as migrations são manuais)
--
-- Problemas corrigidos:
--   1. Filtro role='profissional' impedia gestores/owners de gerarem comissão
--   2. Função sem SECURITY DEFINER dependia de auth.uid() no contexto do trigger,
--      que pode ser NULL em certas chamadas → INSERT bloqueado silenciosamente pelo RLS
--   3. Trigger pode não existir se o banco foi criado sem rodar migration 001 completa

-- ── 1. Recria a função com SECURITY DEFINER ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.gerar_comissao()
RETURNS trigger AS $$
DECLARE
  v_percentual numeric(5,2);
BEGIN
  IF NEW.status = 'concluido' AND OLD.status != 'concluido' THEN
    SELECT percentual_comissao INTO v_percentual
    FROM public.empresa_membros
    WHERE empresa_id = NEW.empresa_id
      AND user_id    = NEW.profissional_id;

    IF v_percentual IS NOT NULL AND v_percentual > 0 THEN
      INSERT INTO public.comissoes
        (empresa_id, profissional_id, agendamento_id, valor_servico, percentual)
      VALUES
        (NEW.empresa_id, NEW.profissional_id, NEW.id, NEW.valor, v_percentual);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 2. Garante que o trigger existe ─────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_gerar_comissao ON public.agendamentos;

CREATE TRIGGER trg_gerar_comissao
  AFTER UPDATE ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.gerar_comissao();

-- ── 3. Diagnóstico: mostra membros sem percentual configurado ────────────────
-- (rode separadamente para verificar; não afeta nada)
-- SELECT user_id, role, percentual_comissao
-- FROM public.empresa_membros
-- WHERE ativo = true;
