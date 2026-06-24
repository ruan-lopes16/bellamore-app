-- Corrige definitivamente a geração automática de comissões:
--
-- Problema 1 (migration 022): filtro role='profissional' impedia gestores/owners
--   que também atendem de gerar comissão. → Filtro removido.
--
-- Problema 2 (este arquivo): a função rodava como o usuário corrente, então
--   o INSERT em comissoes precisava passar pelo RLS (policy "comissoes: membro insere").
--   Em certos contextos de auth (ex: update via service role, revalidação, etc.)
--   auth.uid() pode ser NULL, fazendo o CHECK falhar silenciosamente e a comissão
--   nunca ser criada.
--
-- Solução: SECURITY DEFINER + SET search_path = public
--   A função passa a rodar como owner do banco (bypassa RLS), garantindo que o
--   INSERT sempre ocorre quando as condições de negócio são atendidas.

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
