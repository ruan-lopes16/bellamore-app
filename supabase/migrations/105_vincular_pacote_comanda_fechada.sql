-- 105 — Vincular ou desvincular pacote ao editar uma comanda já fechada (C8).
--
-- Antes: a edição de comanda fechada (editar_comanda, 093) ignorava o vínculo de pacote. Quem
-- esquecia de vincular a sessão no fechamento (cliente cobrada em dobro) ou vinculava por engano
-- não tinha como corrigir sem refazer tudo à mão. A UI travava o bloco de pacote na edição.
--
-- Por que uma função NOVA (editar_comanda_v2) e não um "create or replace" da editar_comanda:
-- a editar_comanda antiga ignora a chave `pacote_cliente_id`. Se a tela nova mandasse o vínculo
-- para um banco sem a 105, o atendimento ficaria com R$ 0,00 SEM o vínculo — receita perdida em
-- silêncio. Com o nome novo, a tela chama a v2; sem a 105 (PGRST202) ela recusa vincular e explica.
-- A editar_comanda (093) fica intocada para PWAs com JS antigo.
--
-- O que muda (editar_comanda_v2 = corpo da 093 + trechos marcados "105"):
-- 1) Atendimento com a chave `pacote_cliente_id`: uuid vincula, null desvincula; sem a chave,
--    mantém o gravado (contrato igual ao do fechar_comanda, 096).
-- 2) Vincular confere: pacote da mesma empresa e da MESMA cliente do atendimento; pacote já pago
--    (cobranca <> 'pendente' — o "a cobrar" só é cobrado no fechamento); atendimento com R$ 0,00.
-- 3) Mudar o vínculo é recusado se a comissão do atendimento já foi paga (mesma regra da 094 ao
--    tirar de Concluído): a sessão de pacote não gera comissão, e desfazer pagamento é com a dona.
-- 4) Gravação: pacote_cliente_id no mesmo UPDATE do valor; depois aplicar_vinculo_pacote_edicao
--    acerta sessão e comissão pelo estado gravado do atendimento:
--    - vinculado: apaga as comissões PENDENTES (sessão de pacote não gera comissão, como no
--      gerar_comissao da 090) e troca a linha de pacote_uso (a sessão é consumida do pacote novo;
--      combo/ilimitado sem controla_sessoes não grava pacote_uso, como o fn_registrar_uso_pacote);
--    - desvinculado: apaga a linha de pacote_uso (a sessão volta ao pacote) e cria a comissão sobre
--      valor − desconto_rateado com o percentual da profissional, datada no fechamento da comanda
--      (o período da comissão é por created_at, decisão de 30/09). Base zero não gera comissão.
--
-- Segurança: as duas funções auxiliares são security definer (a profissional não tem DELETE em
-- comissoes nem, sem permissão, em pacote_uso). São seguras se chamadas direto pela API: conferem
-- comanda.editar_fechada na empresa do atendimento e só aceitam atendimento de comanda FECHADA;
-- aplicar_vinculo_pacote_edicao só deixa sessão e comissão coerentes com o que já está gravado
-- (não muda valor nem vínculo).
--
-- Pré-requisitos: 090–104. Idempotente.
--
-- Conferências (só leitura):
--   select proname, prosecdef from pg_proc where proname in
--     ('editar_comanda_v2', 'comissao_paga_do_atendimento', 'aplicar_vinculo_pacote_edicao');
--   -- 3 linhas: editar_comanda_v2 = false; as outras duas = true
--
-- Rollback:
--   drop function if exists public.editar_comanda_v2(jsonb);
--   drop function if exists public.aplicar_vinculo_pacote_edicao(uuid, timestamptz);
--   drop function if exists public.comissao_paga_do_atendimento(uuid);

-- ── 1. Funções auxiliares (security definer) ──────────────────

-- Comissão paga do atendimento? Só para quem pode editar comanda fechada na empresa dele.
create or replace function public.comissao_paga_do_atendimento(p_ag uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid;
begin
  select a.empresa_id into v_emp from public.agendamentos a where a.id = p_ag;
  if v_emp is null or not public.tem_permissao(v_emp, 'comanda.editar_fechada') then
    raise exception 'Você não tem permissão para editar comanda fechada.' using errcode = '42501';
  end if;
  return exists (select 1 from public.comissoes c where c.agendamento_id = p_ag and c.status = 'pago');
end;
$$;

-- Deixa sessão de pacote e comissão coerentes com o vínculo GRAVADO de um atendimento de comanda fechada.
create or replace function public.aplicar_vinculo_pacote_edicao(p_ag uuid, p_data timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a         record;
  v_ctrl    boolean;
  v_perc    numeric(5,2);
  v_base    numeric;
begin
  select ag.id, ag.empresa_id, ag.pacote_cliente_id, ag.servico_id, ag.profissional_id,
         ag.valor, ag.desconto_rateado, ag.comanda_id, ag.status::text as status
    into a
    from public.agendamentos ag where ag.id = p_ag
    for update;
  if not found or not public.tem_permissao(a.empresa_id, 'comanda.editar_fechada') then
    raise exception 'Você não tem permissão para editar comanda fechada.' using errcode = '42501';
  end if;
  if a.comanda_id is null or a.status <> 'concluido'
     or not exists (select 1 from public.comandas c where c.id = a.comanda_id and c.status::text = 'fechada') then
    raise exception 'O atendimento não está numa comanda fechada.';
  end if;
  if exists (select 1 from public.comissoes c where c.agendamento_id = p_ag and c.status = 'pago') then
    raise exception 'A comissão deste atendimento já foi paga. Não é possível mudar o vínculo de pacote.';
  end if;

  -- A sessão sai do pacote antigo (se havia) e, vinculado, entra no novo.
  delete from public.pacote_uso where agendamento_id = p_ag;

  if a.pacote_cliente_id is not null then
    delete from public.comissoes where agendamento_id = p_ag and status <> 'pago';
    select p.controla_sessoes into v_ctrl
      from public.pacote_clientes pc join public.pacotes p on p.id = pc.pacote_id
     where pc.id = a.pacote_cliente_id and pc.empresa_id = a.empresa_id;
    if coalesce(v_ctrl, false) then
      insert into public.pacote_uso (empresa_id, pacote_cliente_id, servico_id, agendamento_id)
      values (a.empresa_id, a.pacote_cliente_id, a.servico_id, p_ag)
      on conflict (agendamento_id) do nothing;
    end if;
  elsif not exists (select 1 from public.comissoes c where c.agendamento_id = p_ag) then
    select m.percentual_comissao into v_perc
      from public.empresa_membros m where m.empresa_id = a.empresa_id and m.user_id = a.profissional_id;
    v_base := greatest(coalesce(a.valor, 0) - coalesce(a.desconto_rateado, 0), 0);
    if v_perc is not null and v_perc > 0 and v_base > 0 then
      insert into public.comissoes (empresa_id, profissional_id, agendamento_id, valor_servico, percentual, created_at)
      values (a.empresa_id, a.profissional_id, p_ag, v_base, v_perc, coalesce(p_data, now()));
    end if;
  end if;
end;
$$;

revoke all on function public.comissao_paga_do_atendimento(uuid) from public, anon;
grant execute on function public.comissao_paga_do_atendimento(uuid) to authenticated;
revoke all on function public.aplicar_vinculo_pacote_edicao(uuid, timestamptz) from public, anon;
grant execute on function public.aplicar_vinculo_pacote_edicao(uuid, timestamptz) to authenticated;

-- ── 2. editar_comanda_v2 (corpo da 093 + vínculo de pacote, marcado "105") ──
create or replace function public.editar_comanda_v2(p jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_empresa       uuid;
  v_comanda       uuid;
  v_emp_cmd       uuid;
  v_status        text;
  v_fechada_at    timestamptz;
  v_desc_cmd      numeric;
  v_resv_cmd      numeric;
  v_desc_antigo   numeric;
  v_ag_comanda    uuid[];
  v_ats           jsonb;
  v_itens         jsonb;
  v_pags          jsonb;
  v_pag_orig      jsonb;
  v_qtd_orig      int;
  v_cortesia_orig numeric;
  v_ag            uuid;
  v_ln            uuid;
  v_pc            uuid;
  v_id            uuid;
  v_pid           uuid;
  v_pids          uuid[] := '{}';
  v_tipo          text;
  v_txt           text;
  v_val           numeric;
  v_qtd           numeric;
  v_tot           numeric;
  v_taxa          numeric;
  v_parc          int;
  v_n             int;
  v_m             int;
  v_np            int := 0;
  v_rows          int;
  v_subtotal      numeric := 0;
  v_congelado     numeric := 0;
  v_peso_congelado numeric := 0;
  v_desconto      numeric;
  v_reserva       numeric;
  v_reserva_aplic numeric;
  v_total         numeric;
  v_pago          numeric := 0;
  v_cortesia      numeric := 0;
  v_qtd_pag       int := 0;
  v_cotas         bigint[];
  e_tipo          text;
  e_valor         numeric;
  e_qtd           numeric;
  e_prof          uuid;
  e_desc          numeric;
  v_mudou         boolean := false;
  v_db_valor      numeric;
  v_db_desc       numeric;
  v_qtd_vis       int;
  v_erro          text;
  ad_desc  numeric[] := '{}';
  ld_desc  numeric[] := '{}';
  a_id     uuid[]    := '{}';
  a_valor  numeric[] := '{}';
  a_linhas boolean[] := '{}';
  a_cota   bigint[]  := '{}';
  l_id    uuid[]    := '{}';
  l_at    int[]     := '{}';
  l_valor numeric[] := '{}';
  l_cota  bigint[]  := '{}';
  i_id      uuid[]    := '{}';
  i_existe  boolean[] := '{}';
  i_tipo    text[]    := '{}';
  i_desc    text[]    := '{}';
  i_servico uuid[]    := '{}';
  i_prof    uuid[]    := '{}';
  i_qtd     numeric[] := '{}';
  i_valor   numeric[] := '{}';
  i_cota    bigint[]  := '{}';
  ie_valor  numeric[] := '{}';
  ie_qtd    numeric[] := '{}';
  ie_prof   uuid[]    := '{}';
  ie_desc   numeric[] := '{}';
  r_peso bigint[] := '{}';
  r_tipo text[]   := '{}';
  r_idx  int[]    := '{}';
  r      record;
  -- 105: vínculo de pacote por atendimento (antigo gravado, novo pedido, mudou?)
  a_pac_antigo uuid[]    := '{}';
  a_pac_novo   uuid[]    := '{}';
  a_tem_pac    boolean[] := '{}';
  v_cli_ag     uuid;
  v_cli_pc     uuid;
  v_cob_pc     text;
  r2     record;
  k      int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados da comanda inválidos.';
  end if;
  v_empresa := nullif(p->>'empresa_id', '')::uuid;
  v_comanda := nullif(p->>'comanda_id', '')::uuid;
  if v_empresa is null or v_comanda is null then
    raise exception 'Dados da comanda inválidos.';
  end if;

  if not tem_permissao(v_empresa, 'comanda.editar_fechada') then
    raise exception 'Você não tem permissão para editar comanda fechada.' using errcode = '42501';
  end if;

  select c.empresa_id, c.status::text, c.fechada_at, c.desconto, c.desconto_reserva
    into v_emp_cmd, v_status, v_fechada_at, v_desc_cmd, v_resv_cmd
    from public.comandas c where c.id = v_comanda;
  if not found then
    raise exception 'Comanda não encontrada.';
  end if;
  if v_emp_cmd <> v_empresa then
    raise exception 'Esta comanda pertence a outra empresa.';
  end if;
  if v_status <> 'fechada' then
    raise exception 'A comanda não está fechada.';
  end if;
  v_fechada_at := coalesce(v_fechada_at, now());
  v_desc_antigo := greatest(coalesce(v_desc_cmd, 0) - coalesce(v_resv_cmd, 0), 0);

  v_ats   := coalesce(p->'atendimentos', '[]'::jsonb);
  v_itens := coalesce(p->'itens', '[]'::jsonb);
  v_pags  := coalesce(p->'pagamentos', '[]'::jsonb);
  if jsonb_typeof(v_ats) <> 'array' or jsonb_typeof(v_itens) <> 'array' or jsonb_typeof(v_pags) <> 'array' then
    raise exception 'Dados da comanda inválidos.';
  end if;

  select coalesce(array_agg(a.id), '{}') into v_ag_comanda
    from public.agendamentos a where a.comanda_id = v_comanda and a.empresa_id = v_empresa;

  -- Quem edita precisa enxergar a comanda INTEIRA (atendimentos, itens e pagamentos): com parte
  -- invisível pela RLS, subtotal, rateio e pagamentos sairiam errados sem aviso. Os helpers definer
  -- devolvem só a quantidade real.
  if public.comanda_qtd_atendimentos(v_comanda) <> coalesce(array_length(v_ag_comanda, 1), 0) then
    raise exception 'Esta comanda tem atendimento de outra profissional que você não pode ver. Peça à dona ou à gestora para editar.'
      using errcode = '42501';
  end if;
  select count(*) into v_qtd_vis
    from public.comanda_itens ci where ci.comanda_id = v_comanda and ci.empresa_id = v_empresa;
  if public.comanda_qtd_itens(v_comanda) <> v_qtd_vis then
    raise exception 'Esta comanda tem item que você não pode ver. Peça à dona ou à gestora para editar.'
      using errcode = '42501';
  end if;
  select count(*) into v_qtd_vis
    from public.pagamentos pg where pg.comanda_id = v_comanda and pg.empresa_id = v_empresa;
  if public.comanda_qtd_pagamentos(v_comanda) <> v_qtd_vis then
    raise exception 'Esta comanda tem pagamento que você não pode ver. Peça à dona ou à gestora para editar.'
      using errcode = '42501';
  end if;

  -- Atendimentos: os mesmos da comanda (tirar atendimento é proibido). 105: o vínculo de pacote pode mudar.
  for r in select e.value as j from jsonb_array_elements(v_ats) e loop
    if jsonb_typeof(r.j) <> 'object' then
      raise exception 'Atendimento inválido.';
    end if;
    v_ag := nullif(r.j->>'agendamento_id', '')::uuid;
    if v_ag is null then
      raise exception 'Atendimento inválido.';
    end if;
    if v_ag = any(a_id) then
      raise exception 'Atendimento repetido na comanda.';
    end if;
    if not (v_ag = any(v_ag_comanda)) then
      raise exception 'Atendimento não pertence a esta comanda.';
    end if;
    v_n := coalesce(array_length(a_id, 1), 0) + 1;
    a_id[v_n] := v_ag;
    a_cota[v_n] := 0;

    if jsonb_typeof(r.j->'linhas') = 'array' and jsonb_array_length(r.j->'linhas') > 0 then
      v_tot := 0;
      for r2 in select e.value as j from jsonb_array_elements(r.j->'linhas') e loop
        v_ln := nullif(r2.j->>'ag_servico_id', '')::uuid;
        v_val := round((r2.j->>'valor')::numeric, 2);
        if v_ln is null or v_val is null or v_val < 0 then
          raise exception 'Serviço do atendimento inválido.';
        end if;
        if v_ln = any(l_id) then
          raise exception 'Serviço do atendimento repetido na comanda.';
        end if;
        v_m := coalesce(array_length(l_id, 1), 0) + 1;
        l_id[v_m] := v_ln;
        l_at[v_m] := v_n;
        l_valor[v_m] := v_val;
        l_cota[v_m] := 0;
        v_db_valor := null;
        v_db_desc := null;
        select s.valor, s.desconto_rateado into v_db_valor, v_db_desc
          from public.agendamento_servicos s where s.id = v_ln and s.agendamento_id = v_ag;
        ld_desc[v_m] := coalesce(v_db_desc, 0);
        if v_db_valor is distinct from v_val then
          v_mudou := true;
        end if;
        v_tot := v_tot + v_val;
      end loop;
      a_linhas[v_n] := true;
      a_valor[v_n] := v_tot;
    else
      v_val := round((r.j->>'valor')::numeric, 2);
      if v_val is null or v_val < 0 then
        raise exception 'Valor do atendimento inválido.';
      end if;
      a_linhas[v_n] := false;
      a_valor[v_n] := v_val;
    end if;

    v_pc := null;
    v_db_valor := null;
    v_db_desc := null;
    v_cli_ag := null;
    select ag.pacote_cliente_id, ag.valor, ag.desconto_rateado, ag.cliente_id into v_pc, v_db_valor, v_db_desc, v_cli_ag
      from public.agendamentos ag where ag.id = v_ag;
    ad_desc[v_n] := coalesce(v_db_desc, 0);

    -- 105: chave presente = gravar (uuid vincula, null desvincula); ausente = mantém o gravado.
    a_pac_antigo[v_n] := v_pc;
    if r.j ? 'pacote_cliente_id' then
      a_pac_novo[v_n] := nullif(r.j->>'pacote_cliente_id', '')::uuid;
    else
      a_pac_novo[v_n] := v_pc;
    end if;
    a_tem_pac[v_n] := a_pac_novo[v_n] is distinct from v_pc;
    if a_tem_pac[v_n] then
      v_mudou := true;
      if a_pac_novo[v_n] is not null then
        v_cli_pc := null;
        v_cob_pc := null;
        select pc.cliente_id, pc.cobranca into v_cli_pc, v_cob_pc
          from public.pacote_clientes pc where pc.id = a_pac_novo[v_n] and pc.empresa_id = v_empresa;
        if not found then
          raise exception 'Pacote da cliente não encontrado.';
        end if;
        if v_cli_pc is distinct from v_cli_ag then
          raise exception 'Este pacote é de outra cliente.';
        end if;
        if v_cob_pc = 'pendente' then
          raise exception 'Este pacote ainda está a cobrar. Cobre o pacote antes de usar a sessão numa comanda já fechada.';
        end if;
      end if;
      -- Comissão já paga não muda por vínculo (a sessão de pacote não gera comissão; desfazer
      -- pagamento é com a dona). Conferido por função definer: a RLS pode esconder a comissão.
      if public.comissao_paga_do_atendimento(v_ag) then
        raise exception 'A comissão deste atendimento já foi paga. Não é possível mudar o vínculo de pacote.';
      end if;
    end if;

    if v_db_valor is distinct from a_valor[v_n] then
      v_mudou := true;
    end if;
    -- Coberto por pacote = R$ 0,00. Só recusa quando algo muda agora (valor ou vínculo): comanda
    -- antiga já gravada com pacote e valor > 0 continua editável enquanto ninguém mexe nela.
    if a_pac_novo[v_n] is not null and a_valor[v_n] > 0
       and (a_tem_pac[v_n] or v_db_valor is distinct from a_valor[v_n]) then
      raise exception 'Atendimento coberto por pacote deve ficar com valor R$ 0,00.';
    end if;
    v_subtotal := v_subtotal + a_valor[v_n];
  end loop;
  if exists (select 1 from unnest(v_ag_comanda) as x(id) where not (x.id = any(a_id))) then
    raise exception 'Não é possível tirar um atendimento de uma comanda fechada.';
  end if;

  -- Itens: estado completo, cada um com item_id. Existente = altera; novo = inclui; ausente = remove.
  for r in select e.value as j from jsonb_array_elements(v_itens) e loop
    if jsonb_typeof(r.j) <> 'object' then
      raise exception 'Item da comanda inválido.';
    end if;
    v_id := nullif(r.j->>'item_id', '')::uuid;
    v_tipo := r.j->>'tipo';
    v_qtd := round((r.j->>'quantidade')::numeric, 3);
    v_val := round((r.j->>'valor_unit')::numeric, 2);
    v_txt := btrim(coalesce(r.j->>'descricao', ''));
    if v_id is null or v_tipo is null or v_tipo not in ('servico', 'produto', 'pacote')
       or v_qtd is null or v_qtd <= 0 or v_val is null or v_val < 0 or v_txt = '' then
      raise exception 'Item da comanda inválido.';
    end if;
    if v_id = any(i_id) then
      raise exception 'Item repetido na comanda.';
    end if;
    v_m := coalesce(array_length(i_id, 1), 0) + 1;
    i_id[v_m] := v_id;
    i_tipo[v_m] := v_tipo;
    i_desc[v_m] := v_txt;
    i_qtd[v_m] := v_qtd;
    i_valor[v_m] := v_val;
    i_cota[v_m] := 0;
    i_servico[v_m] := case when v_tipo = 'servico' then nullif(r.j->>'servico_id', '')::uuid end;
    i_prof[v_m]    := case when v_tipo = 'servico' then nullif(r.j->>'profissional_id', '')::uuid end;

    e_tipo := null;
    select ci.tipo, ci.valor_unit, ci.quantidade, ci.profissional_id, ci.desconto_rateado
      into e_tipo, e_valor, e_qtd, e_prof, e_desc
      from public.comanda_itens ci where ci.id = v_id and ci.comanda_id = v_comanda;
    if e_tipo is not null then
      if e_tipo <> v_tipo then
        raise exception 'Item da comanda inválido.';
      end if;
      i_existe[v_m] := true;
      if e_valor <> v_val or e_qtd <> v_qtd then
        v_mudou := true;
      end if;
      ie_valor[v_m] := e_valor;
      ie_qtd[v_m] := e_qtd;
      ie_prof[v_m] := e_prof;
      ie_desc[v_m] := e_desc;
      if v_tipo in ('produto', 'pacote') then
        if e_valor <> v_val or e_qtd <> v_qtd then
          raise exception 'Produtos e pacotes não podem ser alterados na edição.';
        end if;
        -- Parte do desconto congelada (a venda via comanda não é corrigida na edição).
        i_cota[v_m] := (coalesce(e_desc, 0) * 100)::bigint;
        v_congelado := v_congelado + coalesce(e_desc, 0);
        v_peso_congelado := v_peso_congelado + round(v_val * v_qtd, 2);
      end if;
    else
      if v_tipo in ('produto', 'pacote') then
        raise exception 'Produtos e pacotes não podem ser incluídos na edição.';
      end if;
      if exists (select 1 from public.comanda_itens ci where ci.id = v_id) then
        raise exception 'Item da comanda inválido.';
      end if;
      if i_servico[v_m] is not null
         and not exists (select 1 from public.servicos s where s.id = i_servico[v_m] and s.empresa_id = v_empresa) then
        raise exception 'Serviço não encontrado: %.', v_txt;
      end if;
      i_existe[v_m] := false;
      v_mudou := true;
    end if;
    v_subtotal := v_subtotal + round(v_val * v_qtd, 2);
  end loop;
  if exists (
    select 1 from public.comanda_itens ci
     where ci.comanda_id = v_comanda and ci.tipo in ('produto', 'pacote') and not (ci.id = any(i_id))
  ) then
    raise exception 'Produtos e pacotes não podem ser removidos na edição.';
  end if;
  if exists (select 1 from public.comanda_itens ci where ci.comanda_id = v_comanda and not (ci.id = any(i_id))) then
    v_mudou := true;  -- serviço extra removido
  end if;
  if coalesce(array_length(a_id, 1), 0) = 0 and coalesce(array_length(i_id, 1), 0) = 0 then
    raise exception 'Comanda vazia.';
  end if;
  -- 093: maquininhas e profissionais novos ou trocados da MESMA empresa (o cliente não muda na edição).
  v_erro := public.conferir_vinculos_empresa(
    v_empresa,
    null,
    array(select nullif(x.j->>'maquininha_id', '')::uuid
            from jsonb_array_elements(v_pags) as x(j)
           where jsonb_typeof(x.j) = 'object' and x.j->>'metodo' in ('credito', 'debito')),
    array(select i_prof[g.ix] from generate_subscripts(i_id, 1) as g(ix)
           where not i_existe[g.ix] or i_prof[g.ix] is distinct from ie_prof[g.ix])
  );
  if v_erro is not null then
    raise exception '%', v_erro;
  end if;

  -- Totais --------------------------------------------------------
  v_desconto := round(coalesce((p->>'desconto')::numeric, 0), 2);
  if v_desconto < 0 then
    raise exception 'Desconto inválido.';
  end if;
  if v_desconto > v_subtotal then
    raise exception 'O desconto não pode ser maior que o subtotal.';
  end if;
  -- Nada de dinheiro mudou (desconto manual igual e nenhum valor/quantidade/inclusão/remoção):
  -- mantém o desconto_rateado gravado e não aplica os limites do congelado. Inclui a comanda anterior
  -- à 090 (desconto > 0 e rateio 0): continua sem rateio enquanto ninguém mexer no dinheiro.
  v_mudou := v_mudou or v_desconto <> v_desc_antigo;
  if v_mudou and v_desconto < v_congelado then
    raise exception 'O desconto não pode ficar abaixo de R$ %: essa parte já foi lançada nos produtos e pacotes desta comanda.',
      translate(to_char(v_congelado, 'FM999,999,990.00'), ',.', '.,');
  end if;
  if v_mudou and v_desconto - v_congelado > v_subtotal - v_peso_congelado then
    raise exception 'O desconto não pode passar de R$ %: produtos e pacotes não ganham mais desconto na edição.',
      translate(to_char(v_congelado + v_subtotal - v_peso_congelado, 'FM999,999,990.00'), ',.', '.,');
  end if;

  select coalesce(sum(t.valor), 0) into v_reserva
    from public.taxas_reserva t
   where t.empresa_id = v_empresa and t.agendamento_id = any(a_id) and t.status = 'pago';
  v_reserva_aplic := least(v_reserva, greatest(v_subtotal - v_desconto, 0));
  v_total := greatest(v_subtotal - v_desconto - v_reserva_aplic, 0);

  -- Pagamentos atuais (antes de apagar): base para manter taxa/maquininha/data do reaberto.
  select coalesce(jsonb_agg(to_jsonb(pg)), '[]'::jsonb), count(*),
         coalesce(sum(pg.valor) filter (where pg.metodo = 'cortesia'), 0)
    into v_pag_orig, v_qtd_orig, v_cortesia_orig
    from public.pagamentos pg where pg.comanda_id = v_comanda and pg.empresa_id = v_empresa;

  for r in select e.value as j from jsonb_array_elements(v_pags) e loop
    if jsonb_typeof(r.j) <> 'object' then
      raise exception 'Pagamento inválido.';
    end if;
    v_val := round((r.j->>'valor')::numeric, 2);
    v_txt := r.j->>'metodo';
    v_parc := coalesce((r.j->>'parcelas')::int, 1);
    v_taxa := (r.j->>'taxa_perc')::numeric;
    v_pid := nullif(r.j->>'pagamento_id', '')::uuid;
    if v_val is null or v_val < 0 or v_txt is null
       or v_txt not in ('dinheiro', 'pix', 'credito', 'debito', 'cortesia') or v_parc < 1 then
      raise exception 'Pagamento inválido.';
    end if;
    if v_taxa is not null and (v_taxa < 0 or v_taxa >= 1) then
      raise exception 'Taxa do cartão inválida.';
    end if;
    if v_pid is not null then
      if v_pid = any(v_pids) then
        raise exception 'Pagamento repetido na comanda.';
      end if;
      v_pids := v_pids || v_pid;
    end if;
    if v_val > 0 then
      v_qtd_pag := v_qtd_pag + 1;
      v_pago := v_pago + v_val;
      if v_txt = 'cortesia' then
        v_cortesia := v_cortesia + v_val;
      end if;
    end if;
  end loop;
  if v_total >= 0.01 and v_pago < v_total - 0.005 then
    raise exception 'O pagamento não cobre o total da comanda.';
  end if;

  -- Mudar o desconto ou aumentar a cortesia exige comanda.desconto (manter o que já estava, não).
  if (v_desconto <> v_desc_antigo or v_cortesia > v_cortesia_orig)
     and not tem_permissao(v_empresa, 'comanda.desconto') then
    raise exception 'Você não tem permissão para dar desconto ou cortesia.' using errcode = '42501';
  end if;

  -- Rateio: atendimentos/linhas e serviços extras dividem o desconto menos a parte congelada —
  -- só quando algo de dinheiro mudou. Senão, as cotas gravadas ficam como estão.
  if not v_mudou then
    for k in 1..coalesce(array_length(a_id, 1), 0) loop
      a_cota[k] := (ad_desc[k] * 100)::bigint;
    end loop;
    for k in 1..coalesce(array_length(l_id, 1), 0) loop
      l_cota[k] := (ld_desc[k] * 100)::bigint;
    end loop;
    for k in 1..coalesce(array_length(i_id, 1), 0) loop
      i_cota[k] := (coalesce(ie_desc[k], 0) * 100)::bigint;
    end loop;
  else
  for k in 1..coalesce(array_length(a_id, 1), 0) loop
    if not a_linhas[k] then
      v_np := v_np + 1;
      r_peso[v_np] := (a_valor[k] * 100)::bigint;
      r_tipo[v_np] := 'a';
      r_idx[v_np] := k;
    end if;
  end loop;
  for k in 1..coalesce(array_length(l_id, 1), 0) loop
    v_np := v_np + 1;
    r_peso[v_np] := (l_valor[k] * 100)::bigint;
    r_tipo[v_np] := 'l';
    r_idx[v_np] := k;
  end loop;
  for k in 1..coalesce(array_length(i_id, 1), 0) loop
    if i_tipo[k] = 'servico' then
      v_np := v_np + 1;
      r_peso[v_np] := (round(i_valor[k] * i_qtd[k], 2) * 100)::bigint;
      r_tipo[v_np] := 'i';
      r_idx[v_np] := k;
    end if;
  end loop;
  v_cotas := public.ratear_desconto_centavos(((v_desconto - v_congelado) * 100)::bigint, r_peso);
  for k in 1..v_np loop
    if r_tipo[k] = 'a' then
      a_cota[r_idx[k]] := v_cotas[k];
    elsif r_tipo[k] = 'l' then
      l_cota[r_idx[k]] := v_cotas[k];
      a_cota[l_at[r_idx[k]]] := a_cota[l_at[r_idx[k]]] + v_cotas[k];
    else
      i_cota[r_idx[k]] := v_cotas[k];
    end if;
  end loop;
  end if;

  -- ── Gravação ───────────────────────────────────────────────

  -- (E1) Serviços extras tirados da comanda (085 recusa se a comissão já foi paga).
  for r in
    select ci.id from public.comanda_itens ci
     where ci.comanda_id = v_comanda and not (ci.id = any(i_id))
     order by ci.id
  loop
    delete from public.comanda_itens where id = r.id and comanda_id = v_comanda;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'Não foi possível remover o item da comanda.' using errcode = '42501';
    end if;
  end loop;

  -- (E2) Serviços extras alterados (valor, quantidade, profissional ou parte do desconto).
  for k in 1..coalesce(array_length(i_id, 1), 0) loop
    if i_existe[k] and i_tipo[k] = 'servico'
       and (i_valor[k] is distinct from ie_valor[k]
            or i_qtd[k] is distinct from ie_qtd[k]
            or i_prof[k] is distinct from ie_prof[k]
            or (i_cota[k]::numeric / 100) is distinct from ie_desc[k]) then
      update public.comanda_itens ci
         set valor_unit = i_valor[k],
             quantidade = i_qtd[k],
             profissional_id = i_prof[k],
             desconto_rateado = i_cota[k]::numeric / 100
       where ci.id = i_id[k] and ci.comanda_id = v_comanda;
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception 'Não foi possível salvar o item da comanda.' using errcode = '42501';
      end if;
    end if;
  end loop;

  -- (E3) Serviços extras novos (id da tela: nova tentativa não duplica).
  insert into public.comanda_itens
    (id, comanda_id, empresa_id, tipo, descricao, servico_id, produto_id, pacote_id,
     profissional_id, quantidade, valor_unit, desconto_rateado)
  select i_id[g.ix], v_comanda, v_empresa, 'servico', i_desc[g.ix], i_servico[g.ix], null, null,
         i_prof[g.ix], i_qtd[g.ix], i_valor[g.ix], i_cota[g.ix]::numeric / 100
    from generate_subscripts(i_id, 1) as g(ix)
   where not i_existe[g.ix]
   order by g.ix;

  -- (E4) Comanda (fechada_at não muda).
  update public.comandas c
     set valor_total = v_subtotal,
         desconto = v_desconto + v_reserva_aplic,
         desconto_reserva = v_reserva_aplic
   where c.id = v_comanda and c.empresa_id = v_empresa;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Você não tem permissão para editar esta comanda.' using errcode = '42501';
  end if;

  -- (E5) Linhas e atendimentos: só valor e parte do desconto (075 acerta as comissões), em ordem de id.
  for k in select g.ix from generate_subscripts(l_id, 1) as g(ix) order by l_id[g.ix] loop
    update public.agendamento_servicos s
       set valor = l_valor[k],
           desconto_rateado = l_cota[k]::numeric / 100
     where s.id = l_id[k] and s.agendamento_id = a_id[l_at[k]] and s.empresa_id = v_empresa;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'Não foi possível salvar o valor dos serviços do atendimento.';
    end if;
  end loop;
  for k in select g.ix from generate_subscripts(a_id, 1) as g(ix) order by a_id[g.ix] loop
    update public.agendamentos a
       set valor = a_valor[k],
           desconto_rateado = a_cota[k]::numeric / 100,
           pacote_cliente_id = case when a_tem_pac[k] then a_pac_novo[k] else a.pacote_cliente_id end  -- 105
     where a.id = a_id[k] and a.empresa_id = v_empresa and a.comanda_id = v_comanda;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'Você não tem permissão para editar o atendimento desta comanda.' using errcode = '42501';
    end if;
    -- 105: sessão e comissão acompanham o vínculo novo (depois do valor gravado: a comissão do
    -- desvinculado nasce sobre o valor cobrado menos a parte do desconto).
    if a_tem_pac[k] then
      perform public.aplicar_vinculo_pacote_edicao(a_id[k], v_fechada_at);
    end if;
  end loop;

  -- (E6) Pagamentos: apaga todos e confere.
  delete from public.pagamentos where comanda_id = v_comanda and empresa_id = v_empresa;
  get diagnostics v_rows = row_count;
  if v_rows < v_qtd_orig then
    raise exception 'Não foi possível substituir os pagamentos desta comanda.' using errcode = '42501';
  end if;

  -- (E7) Reinsere. Reaberto sem mudança mantém id, taxa_perc, maquininha_id e created_at gravados
  --      (o id mantido deixa uma nova tentativa igual reconhecer o mesmo pagamento);
  --      novo ou alterado: taxa da tela e created_at = fechada_at.
  if v_qtd_pag = 0 then
    insert into public.pagamentos
      (empresa_id, comanda_id, valor, metodo, bandeira, parcelas, taxa_perc, valor_liquido, maquininha_id, status, created_at)
    values (v_empresa, v_comanda, 0, 'cortesia', null, 1, null, null, null, 'pago', v_fechada_at);
  else
    insert into public.pagamentos
      (id, empresa_id, comanda_id, valor, metodo, bandeira, parcelas, taxa_perc, valor_liquido, maquininha_id, status, created_at)
    select coalesce(o.id, gen_random_uuid()), v_empresa, v_comanda, n.valor, n.metodo::pagamento_metodo, n.bandeira, n.parcelas,
           case when o.id is not null then o.taxa_perc else n.taxa_perc end,
           case when (case when o.id is not null then o.taxa_perc else n.taxa_perc end) is not null  -- 093: 0% → líquido = valor
                then round(n.valor * (1 - (case when o.id is not null then o.taxa_perc else n.taxa_perc end)), 2) end,
           case when o.id is not null then o.maquininha_id else n.maquininha_id end,
           'pago',
           case when o.id is not null then coalesce(o.created_at, v_fechada_at) else v_fechada_at end
      from (
        select nullif(x.j->>'pagamento_id', '')::uuid as pagamento_id,
               round((x.j->>'valor')::numeric, 2) as valor,
               x.j->>'metodo' as metodo,
               case when x.j->>'metodo' in ('credito', 'debito') then nullif(btrim(x.j->>'bandeira'), '') end as bandeira,
               case when x.j->>'metodo' = 'credito' then coalesce((x.j->>'parcelas')::int, 1) else 1 end as parcelas,
               case when x.j->>'metodo' in ('credito', 'debito') then (x.j->>'taxa_perc')::numeric end as taxa_perc,  -- 093: 0% grava 0
               case when x.j->>'metodo' in ('credito', 'debito') then nullif(x.j->>'maquininha_id', '')::uuid end as maquininha_id,
               x.ord
          from jsonb_array_elements(v_pags) with ordinality as x(j, ord)
         where round((x.j->>'valor')::numeric, 2) > 0
      ) as n
      left join jsonb_to_recordset(v_pag_orig) as o(
        id uuid, metodo text, parcelas integer, bandeira text, maquininha_id uuid,
        taxa_perc numeric, created_at timestamptz
      )
        on o.id = n.pagamento_id
       and o.metodo = n.metodo
       and coalesce(o.parcelas, 1) = n.parcelas
       and o.bandeira is not distinct from n.bandeira
       and o.maquininha_id is not distinct from n.maquininha_id
     order by n.ord;
  end if;
end;
$$;

revoke all on function public.editar_comanda_v2(jsonb) from public, anon;
grant execute on function public.editar_comanda_v2(jsonb) to authenticated;

notify pgrst, 'reload schema';
