-- ============================================================
-- MIGRATION 075 — Edição de comanda fechada: persistência do valor
--
--   (1) RLS de escrita de `pagamentos` / `comanda_itens`
--       -> conserta os PAGAMENTOS DUPLICANDO a cada "Salvar edição"
--   (2) trigger `sincronizar_comissao_valor`
--       -> valor de procedimento editado passa a refletir na COMISSÃO
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations deste projeto são manuais —
-- NÃO usar `supabase db push`).
--
-- Idempotente: seguro rodar em qualquer estado do banco
-- (só 009, 045 aplicada, ou 073 aplicada).
-- ============================================================


-- ------------------------------------------------------------
-- PROBLEMA 1 — `pagamentos` duplicando ao "Salvar edição" de uma comanda
-- ------------------------------------------------------------
-- editarComanda() (web/app/(app)/comanda/page.tsx) troca os pagamentos da
-- comanda com DELETE + INSERT. A migration 045, que criaria a policy de
-- DELETE em `pagamentos`, provavelmente NUNCA foi aplicada neste banco — a
-- própria 073 foi escrita por causa disso e só consertou `comandas`.
--
-- Com RLS habilitado e sem policy de DELETE, o DELETE não afeta nenhuma
-- linha (sucesso silencioso) e o INSERT seguinte empilha os splits a cada
-- save: 3x "PIX R$110" num total de R$100 => "Recebido R$330", inflando o
-- faturamento em Dashboard / Financeiro / Relatórios.
--
-- Esta migration recria, de forma idempotente, o conjunto de policies de
-- `pagamentos` e `comanda_itens` que a 045 pretendia deixar (gestor/owner
-- OU profissional dona do agendamento vinculado à comanda).
--
-- NÃO limpa as duplicatas já gravadas. Para localizá-las:
--
--   SELECT comanda_id, metodo, valor, parcelas, bandeira,
--          count(*) AS copias, array_agg(id ORDER BY created_at) AS ids
--   FROM public.pagamentos
--   WHERE comanda_id IS NOT NULL
--   GROUP BY comanda_id, metodo, valor, parcelas, bandeira
--   HAVING count(*) > 1
--   ORDER BY copias DESC;
--
-- Para apagar as cópias de UMA comanda (mantém a linha mais antiga de cada
-- grupo — revise a lista acima antes; um split repetido pode ser legítimo,
-- ex.: dois PIX do mesmo valor de pessoas diferentes):
--
--   DELETE FROM public.pagamentos p USING (
--     SELECT id, row_number() OVER (
--       PARTITION BY comanda_id, metodo, valor, parcelas, bandeira
--       ORDER BY created_at
--     ) AS rn
--     FROM public.pagamentos WHERE comanda_id = '<uuid-da-comanda>'
--   ) d
--   WHERE p.id = d.id AND d.rn > 1;
-- ------------------------------------------------------------

-- Helper de dono da comanda (idêntico ao da 045/073; recriado aqui para a
-- 075 poder rodar sozinha num banco onde a 073 não passou).
CREATE OR REPLACE FUNCTION public.comanda_pertence_ao_profissional(p_comanda_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agendamentos a
    WHERE a.comanda_id = p_comanda_id AND a.profissional_id = auth.uid()
  );
$$;

-- pagamentos --------------------------------------------------
DROP POLICY IF EXISTS "pagamentos: membro insere"                 ON public.pagamentos;
DROP POLICY IF EXISTS "pagamentos: membro ve"                     ON public.pagamentos;
DROP POLICY IF EXISTS "pagamentos: membro seleciona"              ON public.pagamentos;
DROP POLICY IF EXISTS "pagamentos: profissional ou gestor ve"     ON public.pagamentos;
DROP POLICY IF EXISTS "pagamentos: profissional ou gestor deleta" ON public.pagamentos;

CREATE POLICY "pagamentos: membro insere"
  ON public.pagamentos FOR INSERT
  WITH CHECK (empresa_id IN (SELECT minha_empresas()));

CREATE POLICY "pagamentos: profissional ou gestor ve"
  ON public.pagamentos FOR SELECT
  USING (
    is_gestor_ou_owner(empresa_id)
    OR (comanda_id IS NOT NULL AND comanda_pertence_ao_profissional(comanda_id))
  );

CREATE POLICY "pagamentos: profissional ou gestor deleta"
  ON public.pagamentos FOR DELETE
  USING (
    is_gestor_ou_owner(empresa_id)
    OR (comanda_id IS NOT NULL AND comanda_pertence_ao_profissional(comanda_id))
  );

-- comanda_itens ---------------------------------------------------
DROP POLICY IF EXISTS "comanda_itens: membro gerencia"                ON public.comanda_itens;
DROP POLICY IF EXISTS "comanda_itens: membro insere"                  ON public.comanda_itens;
DROP POLICY IF EXISTS "comanda_itens: profissional ou gestor ve"      ON public.comanda_itens;
DROP POLICY IF EXISTS "comanda_itens: profissional ou gestor atualiza" ON public.comanda_itens;
DROP POLICY IF EXISTS "comanda_itens: profissional ou gestor deleta"  ON public.comanda_itens;

CREATE POLICY "comanda_itens: membro insere"
  ON public.comanda_itens FOR INSERT
  WITH CHECK (empresa_id IN (SELECT minha_empresas()));

CREATE POLICY "comanda_itens: profissional ou gestor ve"
  ON public.comanda_itens FOR SELECT
  USING (
    is_gestor_ou_owner(empresa_id)
    OR comanda_pertence_ao_profissional(comanda_id)
  );

CREATE POLICY "comanda_itens: profissional ou gestor atualiza"
  ON public.comanda_itens FOR UPDATE
  USING (
    is_gestor_ou_owner(empresa_id)
    OR comanda_pertence_ao_profissional(comanda_id)
  );

CREATE POLICY "comanda_itens: profissional ou gestor deleta"
  ON public.comanda_itens FOR DELETE
  USING (
    is_gestor_ou_owner(empresa_id)
    OR comanda_pertence_ao_profissional(comanda_id)
  );


-- ------------------------------------------------------------
-- PROBLEMA 2 — valor de procedimento editado não chega na comissão
-- ------------------------------------------------------------
-- Ao "Salvar edição" de uma comanda já fechada, o novo valor de um serviço
-- passa a ser gravado em `agendamentos.valor` (+ `agendamento_servicos.valor`)
-- pelo cliente. A comissão, porém, já foi gerada no fechamento original —
-- `trg_gerar_comissao` (migrations 001/022/024/065) só usa NEW.valor na
-- transição para 'concluido' e não reage a mudanças posteriores.
--
-- Este trigger mantém `comissoes.valor_servico` em dia quando o valor de um
-- agendamento JÁ concluído muda. Atinge comissões PENDENTES e PAGAS
-- (decisão do usuário — se a comissão já foi repassada, ajuste o repasse).
-- `valor_comissao` é coluna gerada (round(valor_servico*percentual/100,2)),
-- recalcula sozinha; `percentual` não é tocado.
--
-- Não colide com `trg_gerar_comissao`: aquele exige OLD.status <> 'concluido';
-- este exige OLD.status = 'concluido'. No fechamento normal (novo), só o
-- `trg_gerar_comissao` age, e o cliente já grava `valor` no mesmo UPDATE do
-- `status`, então ele nasce com o valor certo.
--
-- SECURITY DEFINER: funciona mesmo quando quem dispara o UPDATE é a
-- profissional editando a própria comanda (RLS de UPDATE de `comissoes` é
-- restrito a gestor/owner desde a 042).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sincronizar_comissao_valor()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'concluido'
     AND OLD.status = 'concluido'
     AND NEW.valor IS DISTINCT FROM OLD.valor THEN
    UPDATE public.comissoes
       SET valor_servico = NEW.valor
     WHERE agendamento_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sincronizar_comissao_valor ON public.agendamentos;

CREATE TRIGGER trg_sincronizar_comissao_valor
  AFTER UPDATE OF valor ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.sincronizar_comissao_valor();
