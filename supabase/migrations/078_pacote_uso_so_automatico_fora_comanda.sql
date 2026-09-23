-- ============================================================
-- MIGRATION 078 — busca automatica de pacote so fora da Comanda
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations sao manuais).
--
-- PROBLEMA
-- fn_registrar_uso_pacote() (migration 037) sempre busca um pacote
-- automaticamente por servico_id quando NEW.pacote_cliente_id e NULL. Isso
-- nao distingue "a Comanda decidiu explicitamente nao usar pacote" (usuario
-- clicou em "Desvincular", ou simplesmente nunca vinculou e fechou cobrando
-- o valor cheio) de "esse atendimento nunca passou pela Comanda" (ex.:
-- marcado concluido direto pela Agenda, ou pelo atalho "Marcar como
-- concluido" do app mobile, sem nunca criar uma comanda financeira).
--
-- Resultado: desvincular um pacote na Comanda grava pacote_cliente_id=null,
-- mas o trigger encontra o MESMO pacote de novo pela busca automatica e
-- consome uma sessao assim mesmo — a cliente paga o valor cheio E perde a
-- sessao. E o inverso tambem ja acontecia silenciosamente, desde a
-- migration 011: qualquer comanda fechada cobrando valor cheio, sem nunca
-- tocar na tela de pacote, ja consumia uma sessao da cliente sempre que ela
-- tinha algum pacote ativo elegivel pro servico — sem nenhum aviso.
--
-- CORRECAO
-- fn_registrar_uso_pacote() so faz a busca automatica quando o fechamento
-- NAO veio de uma comanda (NEW.comanda_id IS NULL). Web e mobile sempre
-- gravam comanda_id no MESMO UPDATE que muda o status para 'concluido' (ver
-- shared/comanda.ts e comanda/page.tsx / nova-comanda.tsx), entao o trigger
-- ja enxerga esse valor no momento certo. A Comanda passa a ser de fato a
-- unica fonte de verdade sobre usar pacote ou nao: com comanda_id
-- preenchido e pacote_cliente_id nulo, nenhuma sessao e consumida.
--
-- O caminho que marca "concluido" direto (sem nunca criar uma comanda —
-- comanda_id fica NULL) mantem o comportamento automatico de sempre,
-- inalterado. Corrigir esse caminho especifico esta fora do escopo desta
-- entrega.
--
-- DESVIO DO SQL PROPOSTO NO PLANO (achado na auto-revisao, antes do commit)
-- O texto do plano (.superpowers/sdd/task-10-brief.md) baseou o corpo desta
-- function na migration 036, anterior ao modo "combo" que a migration 037
-- introduziu (pacotes.controla_sessoes). Copiar aquele texto ao pe da letra
-- reverteria o fix da 037: pacotes combo (controla_sessoes = false)
-- voltariam a ter sessao rastreada/consumida em pacote_uso, tanto por
-- vinculo explicito quanto pela busca automatica. Esta migration preserva o
-- filtro "p.controla_sessoes = true" (identico ao da 037, JOIN com
-- public.pacotes nas duas ramificacoes) e soma a ele a nova condicao
-- "NEW.comanda_id IS NULL" na busca automatica — a unica mudanca de
-- comportamento desta migration.
--
-- Nao faz backfill: sessoes de pacote_uso ja registradas continuam como
-- estao (mesma decisao da migration 065, de nao reescrever historico).
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
    -- Vínculo explícito escolhido no agendamento ou na comanda
    SELECT pc.id, pc.empresa_id
      INTO v_pc_id, v_empresa_id
    FROM public.pacote_clientes pc
    JOIN public.pacotes p ON p.id = pc.pacote_id
    WHERE pc.id = NEW.pacote_cliente_id
      AND pc.empresa_id = NEW.empresa_id
      AND p.controla_sessoes = true;
  ELSIF NEW.comanda_id IS NULL THEN
    -- Busca automática por serviço — só quando o atendimento NÃO passou
    -- pela Comanda (ela é quem decide, quando passa por lá).
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
  -- ELSE (pacote_cliente_id nulo E comanda_id preenchido): a Comanda
  -- decidiu não usar pacote neste atendimento — v_pc_id fica NULL, nenhuma
  -- sessão é consumida.

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

DROP TRIGGER IF EXISTS trg_uso_pacote ON public.agendamentos;

CREATE TRIGGER trg_uso_pacote
  AFTER UPDATE ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION fn_registrar_uso_pacote();
