-- Corrige o trigger gerar_comissao: remover filtro role='profissional'.
-- O filtro impedia que gestores/owners que também atendem como profissionais
-- gerassem comissões, pois seu role em empresa_membros é 'gestor', não 'profissional'.
-- A condição v_percentual > 0 já é suficiente para não criar comissões para membros
-- com percentual zerado.

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
$$ LANGUAGE plpgsql;
