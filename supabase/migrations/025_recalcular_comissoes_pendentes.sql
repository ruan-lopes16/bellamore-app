-- Quando o percentual_comissao de um membro muda, recalcula automaticamente
-- todas as comissões PENDENTES desse profissional nessa empresa.
-- Comissões já pagas (status = 'pago') NÃO são alteradas — valor já foi repassado.
-- valor_comissao é generated column (percentual × valor_servico / 100),
-- então basta atualizar o campo percentual.

CREATE OR REPLACE FUNCTION public.recalcular_comissoes_pendentes()
RETURNS trigger AS $$
BEGIN
  IF NEW.percentual_comissao IS DISTINCT FROM OLD.percentual_comissao THEN
    UPDATE public.comissoes
       SET percentual = NEW.percentual_comissao
     WHERE profissional_id = NEW.user_id
       AND empresa_id      = NEW.empresa_id
       AND status          = 'pendente';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_recalcular_comissoes_pendentes ON public.empresa_membros;
CREATE TRIGGER trg_recalcular_comissoes_pendentes
  AFTER UPDATE OF percentual_comissao ON public.empresa_membros
  FOR EACH ROW
  EXECUTE FUNCTION public.recalcular_comissoes_pendentes();
