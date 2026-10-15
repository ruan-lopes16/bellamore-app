-- ============================================================
-- MIGRATION 090 — Comanda "tudo ou nada", desconto rateado e venda avulsa com chave
-- Spec:       docs/superpowers/specs/2026-10-15-comanda-tudo-ou-nada-design.md
-- Inventário: docs/superpowers/notes/2026-10-15-inventario-gravacoes-comanda.md
-- Contrato:   docs/superpowers/notes/2026-10-15-contrato-fechar-comanda.md (payload campo a campo + erros)
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
-- Idempotente: `add column if not exists`, `create or replace`, `drop ... if exists` + `create`.
-- Ordem de deploy livre: sem a 090 as telas recebem PGRST202 e usam o caminho em passos.
-- Requer 083 (tem_permissao), 085 (comissão do extra), 086 (pagamentos.maquininha_id) e 089.
--
-- POR QUE CADA PARTE
--
-- 1) Colunas `desconto_rateado` (agendamentos, agendamento_servicos, comanda_itens).
--    Decisão do dono (2026-10-15): o desconto manual é da comanda inteira e é rateado entre
--    as partes (atendimento, linha de multi-serviço, extra); a comissão e a receita passam a
--    sair do valor COM desconto. `agendamentos.valor` continua o valor de tabela (é reaberto
--    assim na edição — gravar o líquido aplicaria o desconto duas vezes). A taxa de reserva
--    paga NÃO entra no rateio (é pagamento adiantado). Sem backfill: o histórico fica com 0.
--    `estoque_movimentos.comanda_id`: liga a baixa do produto à comanda (ramo novo de RLS).
--
-- 2) fechar_comanda(jsonb) / editar_comanda(jsonb): uma transação cada, no modelo da 087.
--    Antes eram 10+ chamadas soltas: falha no meio deixava comanda órfã, atendimento concluído
--    sem pagamento, venda sem itens, pagamentos apagados sem reinserção.
--    - SECURITY INVOKER: valem as policies de sempre. Sem RETURNING (exigiria SELECT); ids
--      gerados aqui. UPDATE/DELETE conferidos com GET DIAGNOSTICS (RLS devolve 0 linhas calada).
--    - `comanda_id` (uuid gerado na tela) é a chave de idempotência: comanda já existente nesta
--      empresa → devolve o id sem gravar nada (queda de rede depois do commit não duplica).
--    - Fechamento em dobro: UPDATE de agendamentos com `comanda_id is null` e contagem — atômico,
--      fecha a corrida que o SELECT separado das telas deixava.
--    - Permissões conferidas no banco (antes só na tela): comanda.fechar, comanda.editar_fechada,
--      comanda.desconto (desconto ou cortesia com valor) e pacotes.vender.
--    - Nada que o banco calcula vem da tela: subtotal, desconto da reserva (lido de
--      taxas_reserva pagas), total, cobertura do total, rateio, valor_liquido do cartão,
--      fechada_at (now()) e datas do pacote (Brasília). profissional_id da comanda = auth.uid().
--    - Ordem das gravações preserva os triggers: comandas → agendamento_servicos → agendamentos
--      (valor, desconto_rateado, pacote_cliente_id, comanda_id e status no MESMO UPDATE, porque
--      065/078 só olham a transição para 'concluido') → comanda_itens (085 lê fechada_at da
--      comanda) → pacotes vendidos → produtos (trava + baixa + venda) → pagamentos.
--    - Estoque: mesma trava da 087/088 (`venda_estoque:` por produto, em ordem de id) antes do
--      1º INSERT em estoque_movimentos — sem deadlock com venda avulsa/movimentação manual.
--      Saldo NÃO bloqueia (decisão de 29/09).
--    - Edição: produtos, pacotes e quantidades deles continuam só leitura; a parte do desconto
--      já dada a eles fica congelada (a venda via comanda não tem vínculo com a comanda para ser
--      corrigida). Pagamentos apagados e reinseridos na mesma transação; o reaberto sem mudança
--      (`pagamento_id` + mesmo método/parcelas/bandeira/maquininha) mantém taxa_perc,
--      maquininha_id e created_at gravados; os novos nascem com created_at = fechada_at.
--    - Edição só re-rateia quando algo de dinheiro muda (desconto manual, valor/quantidade de
--      atendimento, linha ou extra, inclusão/remoção de extra). Sem mudança (ex.: só trocar a forma
--      de pagamento ou a profissional do extra), o desconto_rateado gravado fica como está e os
--      limites do congelado não se aplicam — a comanda anterior à 090 (desconto > 0, rateio 0)
--      continua sem rateio. Assim centavos não mudam de profissional e comissão paga não muda à toa.
--    - Edição exige ver a comanda inteira: helpers definer comanda_qtd_atendimentos / _itens /
--      _pagamentos devolvem só a contagem real; se quem edita enxerga menos (atendimento de colega
--      sem agenda.ver_equipe), recusa com 42501 em vez de gravar subtotal/rateio parciais.
--    - Atendimento cancelado/faltou é recusado no fechamento; atendimentos e linhas são
--      atualizados em ordem de id (sem deadlock entre duas comandas).
--
-- 3) registrar_venda_avulsa_v2: a 087 com chave contra repetição (`p_venda_id`). Função NOVA:
--    mudar a assinatura da 087 faria clientes antigos receberem PGRST202 (regra da 087).
--
-- 4) Triggers de comissão (corpo atual copiado; só a base e a data mudam):
--    - gerar_comissao (065): base = valor − desconto_rateado. Filtro de sessão de pacote mantido.
--    - sincronizar_comissao_valor (075): reage também a desconto_rateado (lista de colunas do
--      trigger ampliada). Continua valendo para comissão pendente E paga (regra da 075).
--    - gerar_comissao_item / sincronizar_comissao_item (085): base = valor_unit × quantidade −
--      desconto_rateado; created_at da comissão = comandas.fechada_at (decisão 3: item incluído
--      na edição de comanda de outro mês fica no mês do fechamento). Trava da comissão paga da
--      085 preservada. Mudança SÓ de desconto nunca cria comissão retroativa (extra anterior à
--      085): só atualiza a existente. apagar_comissao_item não muda (não recriado).
--    - fn_registrar_uso_pacote (078) NÃO é recriada (filtro controla_sessoes da 037 intacto);
--      ela e notificar_estoque_baixo (028) só ganham `search_path` fixo por ALTER FUNCTION.
--
-- 5) RLS:
--    - estoque_movimentos INSERT: os 4 ramos da 089 iguais + saída ligada a uma comanda que
--      pertence a quem grava (comanda_pertence_ao_profissional — inclui quem a fechou, 089).
--      Antes a baixa da comanda só com extras era recusada para a profissional.
--    - Drop de "comissoes: membro insere" (015; ainda em produção, CSV de 02/10): qualquer
--      membro inseria comissão pela API. Comissões só nascem pelos triggers (security definer),
--      que não dependem de policy; nenhuma tela insere em comissoes. "gestor pode gerenciar
--      comissoes" (dona, manual de produção) fica como está.
--
-- ATENÇÃO: alterar o desconto (ou um valor) de uma comanda com comissão PAGA muda o valor_servico
-- dela (mesma regra da 075 para mudança de valor). Numa comanda antiga (antes da 090) com desconto,
-- isso só acontece se a edição mexer no dinheiro: aí o desconto passa a ser rateado e reduz as
-- comissões dela (inclusive pagas). Editar sem mexer no dinheiro não rateia nada.
--
-- Rollback (volta ao estado da 089; colunas ficam, com 0, para não perder dado):
--   drop function if exists public.fechar_comanda(jsonb);
--   drop function if exists public.editar_comanda(jsonb);
--   drop function if exists public.registrar_venda_avulsa_v2(uuid, uuid, uuid, numeric, jsonb, jsonb);
--   drop function if exists public.ratear_desconto_centavos(bigint, bigint[]);
--   drop function if exists public.comanda_qtd_atendimentos(uuid), public.comanda_qtd_itens(uuid),
--     public.comanda_qtd_pagamentos(uuid);
--   recriar gerar_comissao como na 065, sincronizar_comissao_valor + trigger
--     (`after update of valor`) como na 075, gerar_comissao_item e sincronizar_comissao_item
--     como na 085;
--   recriar "estoque_movimentos: gestor pode inserir" como na 089;
--   create policy "comissoes: membro insere" on public.comissoes for insert
--     with check (empresa_id in (select minha_empresas()));
--   (opcional) alter table ... drop column if exists desconto_rateado / estoque_movimentos.comanda_id;
--   notify pgrst, 'reload schema';
-- ============================================================

-- ── 1. Colunas ────────────────────────────────────────────────
alter table public.agendamentos
  add column if not exists desconto_rateado numeric(10,2) not null default 0 check (desconto_rateado >= 0);
alter table public.agendamento_servicos
  add column if not exists desconto_rateado numeric(10,2) not null default 0 check (desconto_rateado >= 0);
alter table public.comanda_itens
  add column if not exists desconto_rateado numeric(10,2) not null default 0 check (desconto_rateado >= 0);
alter table public.estoque_movimentos
  add column if not exists comanda_id uuid references public.comandas(id) on delete set null;
create index if not exists idx_estoque_movimentos_comanda
  on public.estoque_movimentos (comanda_id) where comanda_id is not null;

-- ── 2. Rateio em centavos ─────────────────────────────────────
-- Cota de cada parte = piso(desconto × peso / soma dos pesos). O resto de centavos vai para a
-- MAIOR parte (peso desc, depois a ordem de entrada), sem nunca passar do peso dela; o que não
-- couber passa para a próxima maior. Peso 0 (sessão de pacote) recebe 0.
create or replace function public.ratear_desconto_centavos(p_desconto bigint, p_pesos bigint[])
returns bigint[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_n     int := coalesce(array_length(p_pesos, 1), 0);
  v_soma  bigint := 0;
  v_cotas bigint[] := '{}';
  v_resto bigint;
  v_folga bigint;
  v_extra bigint;
  r       record;
  i       int;
begin
  if p_desconto is null or p_desconto < 0 then
    raise exception 'Desconto inválido.';
  end if;
  if v_n = 0 then
    if p_desconto > 0 then
      raise exception 'O desconto não pode ser maior que o subtotal.';
    end if;
    return v_cotas;
  end if;
  for i in 1..v_n loop
    if p_pesos[i] is null or p_pesos[i] < 0 then
      raise exception 'Valor inválido no rateio do desconto.';
    end if;
    v_soma := v_soma + p_pesos[i];
  end loop;
  if p_desconto > v_soma then
    raise exception 'O desconto não pode ser maior que o subtotal.';
  end if;

  v_resto := p_desconto;
  for i in 1..v_n loop
    v_cotas[i] := case when v_soma = 0 then 0
                       else floor(p_desconto::numeric * p_pesos[i] / v_soma)::bigint end;
    v_resto := v_resto - v_cotas[i];
  end loop;

  for r in
    select t.ord::int as ord from unnest(p_pesos) with ordinality as t(peso, ord)
     order by t.peso desc, t.ord
  loop
    exit when v_resto <= 0;
    v_folga := p_pesos[r.ord] - v_cotas[r.ord];
    if v_folga > 0 then
      v_extra := least(v_folga, v_resto);
      v_cotas[r.ord] := v_cotas[r.ord] + v_extra;
      v_resto := v_resto - v_extra;
    end if;
  end loop;

  return v_cotas;
end;
$$;

revoke all on function public.ratear_desconto_centavos(bigint, bigint[]) from public, anon;
grant execute on function public.ratear_desconto_centavos(bigint, bigint[]) to authenticated;

-- ── 2b. Contagens reais da comanda (para a edição) ────────────
-- editar_comanda é invoker: quem não tem agenda.ver_equipe não enxerga o atendimento da colega
-- que está na mesma comanda, e o subtotal/rateio sairiam só com os visíveis (gravação errada sem
-- aviso). Estes helpers definer devolvem SÓ a quantidade real (nenhum dado da linha), restritos a
-- comandas de empresas de quem chama; a edição compara com o que a pessoa enxerga e recusa se faltar.
create or replace function public.comanda_qtd_atendimentos(p_comanda uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.agendamentos a
    join public.comandas c on c.id = a.comanda_id
   where a.comanda_id = p_comanda
     and a.empresa_id = c.empresa_id
     and c.empresa_id in (select minha_empresas());
$$;

create or replace function public.comanda_qtd_itens(p_comanda uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.comanda_itens ci
    join public.comandas c on c.id = ci.comanda_id
   where ci.comanda_id = p_comanda
     and ci.empresa_id = c.empresa_id
     and c.empresa_id in (select minha_empresas());
$$;

create or replace function public.comanda_qtd_pagamentos(p_comanda uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.pagamentos pg
    join public.comandas c on c.id = pg.comanda_id
   where pg.comanda_id = p_comanda
     and pg.empresa_id = c.empresa_id
     and c.empresa_id in (select minha_empresas());
$$;

revoke all on function public.comanda_qtd_atendimentos(uuid) from public, anon;
grant execute on function public.comanda_qtd_atendimentos(uuid) to authenticated;
revoke all on function public.comanda_qtd_itens(uuid) from public, anon;
grant execute on function public.comanda_qtd_itens(uuid) to authenticated;
revoke all on function public.comanda_qtd_pagamentos(uuid) from public, anon;
grant execute on function public.comanda_qtd_pagamentos(uuid) to authenticated;

-- ── 3. fechar_comanda ─────────────────────────────────────────
create or replace function public.fechar_comanda(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_empresa      uuid;
  v_comanda      uuid;
  v_cliente      uuid;
  v_existente    uuid;
  v_ats          jsonb;
  v_itens        jsonb;
  v_pags         jsonb;
  v_ag           uuid;
  v_ln           uuid;
  v_pc           uuid;
  v_tipo         text;
  v_txt          text;
  v_val          numeric;
  v_qtd          numeric;
  v_tot          numeric;
  v_taxa         numeric;
  v_parc         int;
  v_n            int;
  v_m            int;
  v_np           int := 0;
  v_rows         int;
  v_subtotal     numeric := 0;
  v_desconto     numeric;
  v_reserva      numeric;
  v_reserva_aplic numeric;
  v_total        numeric;
  v_pago         numeric := 0;
  v_cortesia     numeric := 0;
  v_qtd_pag      int := 0;
  v_tem_pacote   boolean := false;
  v_tem_produto  boolean := false;
  v_tot_pacotes  numeric := 0;
  v_desc_pacotes numeric := 0;
  v_tot_produtos numeric := 0;
  v_desc_produtos numeric := 0;
  v_hoje         date;
  v_venda        uuid;
  v_cotas        bigint[];
  v_st           text;
  -- atendimentos
  a_id      uuid[]    := '{}';
  a_valor   numeric[] := '{}';
  a_linhas  boolean[] := '{}';
  a_tem_pac boolean[] := '{}';
  a_pacote  uuid[]    := '{}';
  a_cota    bigint[]  := '{}';
  -- linhas de agendamento_servicos (multi-serviço)
  l_id    uuid[]    := '{}';
  l_at    int[]     := '{}';
  l_valor numeric[] := '{}';
  l_cota  bigint[]  := '{}';
  -- itens extras
  i_id      uuid[]    := '{}';
  i_tipo    text[]    := '{}';
  i_desc    text[]    := '{}';
  i_servico uuid[]    := '{}';
  i_produto uuid[]    := '{}';
  i_pacote  uuid[]    := '{}';
  i_prof    uuid[]    := '{}';
  i_qtd     numeric[] := '{}';
  i_valor   numeric[] := '{}';
  i_cota    bigint[]  := '{}';
  -- partes do rateio
  r_peso bigint[] := '{}';
  r_tipo text[]   := '{}';
  r_idx  int[]    := '{}';
  r      record;
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

  if not tem_permissao(v_empresa, 'comanda.fechar') then
    raise exception 'Você não tem permissão para fechar a comanda.' using errcode = '42501';
  end if;

  -- Idempotência: nova tentativa da mesma comanda (queda de rede depois do commit).
  select empresa_id into v_existente from public.comandas where id = v_comanda;
  if found then
    if v_existente = v_empresa then
      return v_comanda;
    end if;
    raise exception 'Esta comanda pertence a outra empresa.';
  end if;

  v_cliente := nullif(p->>'cliente_id', '')::uuid;
  v_ats   := coalesce(p->'atendimentos', '[]'::jsonb);
  v_itens := coalesce(p->'itens', '[]'::jsonb);
  v_pags  := coalesce(p->'pagamentos', '[]'::jsonb);
  if jsonb_typeof(v_ats) <> 'array' or jsonb_typeof(v_itens) <> 'array' or jsonb_typeof(v_pags) <> 'array' then
    raise exception 'Dados da comanda inválidos.';
  end if;
  if jsonb_array_length(v_ats) = 0 and jsonb_array_length(v_itens) = 0 then
    raise exception 'Comanda vazia.';
  end if;

  -- Atendimentos ------------------------------------------------
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

    -- Vínculo de pacote: chave presente = gravar (uuid ou null = desvincular); ausente = mantém.
    if r.j ? 'pacote_cliente_id' then
      a_tem_pac[v_n] := true;
      a_pacote[v_n] := nullif(r.j->>'pacote_cliente_id', '')::uuid;
      if a_pacote[v_n] is not null and not exists (
        select 1 from public.pacote_clientes pc where pc.id = a_pacote[v_n] and pc.empresa_id = v_empresa
      ) then
        raise exception 'Pacote da cliente não encontrado.';
      end if;
    else
      a_tem_pac[v_n] := false;
      v_pc := null;
      select ag.pacote_cliente_id into v_pc
        from public.agendamentos ag where ag.id = v_ag and ag.empresa_id = v_empresa;
      a_pacote[v_n] := v_pc;
    end if;
    if a_pacote[v_n] is not null and a_valor[v_n] > 0 then
      raise exception 'Atendimento coberto por pacote deve ficar com valor R$ 0,00.';
    end if;
    v_st := null;
    select ag.status::text into v_st
      from public.agendamentos ag where ag.id = v_ag and ag.empresa_id = v_empresa;
    if v_st in ('cancelado', 'faltou') then
      raise exception 'Atendimento cancelado ou com falta não entra na comanda.';
    end if;

    v_subtotal := v_subtotal + a_valor[v_n];
  end loop;

  -- Itens extras ------------------------------------------------
  for r in select e.value as j from jsonb_array_elements(v_itens) e loop
    if jsonb_typeof(r.j) <> 'object' then
      raise exception 'Item da comanda inválido.';
    end if;
    v_tipo := r.j->>'tipo';
    v_qtd := round((r.j->>'quantidade')::numeric, 3);
    v_val := round((r.j->>'valor_unit')::numeric, 2);
    v_txt := btrim(coalesce(r.j->>'descricao', ''));
    if v_tipo is null or v_tipo not in ('servico', 'produto', 'pacote')
       or v_qtd is null or v_qtd <= 0 or v_val is null or v_val < 0 or v_txt = '' then
      raise exception 'Item da comanda inválido.';
    end if;
    v_m := coalesce(array_length(i_id, 1), 0) + 1;
    i_id[v_m] := gen_random_uuid();
    i_tipo[v_m] := v_tipo;
    i_desc[v_m] := v_txt;
    i_qtd[v_m] := v_qtd;
    i_valor[v_m] := v_val;
    i_cota[v_m] := 0;
    i_servico[v_m] := case when v_tipo = 'servico' then nullif(r.j->>'servico_id', '')::uuid end;
    i_produto[v_m] := case when v_tipo = 'produto' then nullif(r.j->>'produto_id', '')::uuid end;
    i_pacote[v_m]  := case when v_tipo = 'pacote'  then nullif(r.j->>'pacote_id', '')::uuid end;
    i_prof[v_m]    := case when v_tipo = 'servico' then nullif(r.j->>'profissional_id', '')::uuid end;

    if v_tipo = 'produto' then
      if i_produto[v_m] is null then
        raise exception 'Item da comanda inválido.';
      end if;
      if not exists (select 1 from public.produtos pr where pr.id = i_produto[v_m] and pr.empresa_id = v_empresa) then
        raise exception 'Produto não encontrado: %.', v_txt;
      end if;
      v_tem_produto := true;
      v_tot_produtos := v_tot_produtos + round(v_val * v_qtd, 2);
    elsif v_tipo = 'pacote' then
      if i_pacote[v_m] is null then
        raise exception 'Item da comanda inválido.';
      end if;
      if v_qtd <> trunc(v_qtd) then
        raise exception 'Quantidade de pacote deve ser um número inteiro.';
      end if;
      if not exists (select 1 from public.pacotes pk where pk.id = i_pacote[v_m] and pk.empresa_id = v_empresa) then
        raise exception 'Pacote não encontrado: %.', v_txt;
      end if;
      v_tem_pacote := true;
      v_tot_pacotes := v_tot_pacotes + round(v_val * v_qtd, 2);
    elsif i_servico[v_m] is not null
          and not exists (select 1 from public.servicos s where s.id = i_servico[v_m] and s.empresa_id = v_empresa) then
      raise exception 'Serviço não encontrado: %.', v_txt;
    end if;

    v_subtotal := v_subtotal + round(v_val * v_qtd, 2);
  end loop;

  if v_tem_pacote then
    if not tem_permissao(v_empresa, 'pacotes.vender') then
      raise exception 'Você não tem permissão para vender pacotes.' using errcode = '42501';
    end if;
    if v_cliente is null then
      raise exception 'Para vender pacote, escolha uma cliente cadastrada.';
    end if;
  end if;

  -- Totais (recalculados aqui; nada vem da tela) ----------------
  v_desconto := round(coalesce((p->>'desconto')::numeric, 0), 2);
  if v_desconto < 0 then
    raise exception 'Desconto inválido.';
  end if;
  if v_desconto > v_subtotal then
    raise exception 'O desconto não pode ser maior que o subtotal.';
  end if;

  select coalesce(sum(t.valor), 0) into v_reserva
    from public.taxas_reserva t
   where t.empresa_id = v_empresa and t.agendamento_id = any(a_id) and t.status = 'pago';
  v_reserva_aplic := least(v_reserva, greatest(v_subtotal - v_desconto, 0));
  v_total := greatest(v_subtotal - v_desconto - v_reserva_aplic, 0);

  -- Pagamentos ---------------------------------------------------
  for r in select e.value as j from jsonb_array_elements(v_pags) e loop
    if jsonb_typeof(r.j) <> 'object' then
      raise exception 'Pagamento inválido.';
    end if;
    v_val := round((r.j->>'valor')::numeric, 2);
    v_txt := r.j->>'metodo';
    v_parc := coalesce((r.j->>'parcelas')::int, 1);
    v_taxa := (r.j->>'taxa_perc')::numeric;
    if v_val is null or v_val < 0 or v_txt is null
       or v_txt not in ('dinheiro', 'pix', 'credito', 'debito', 'cortesia') or v_parc < 1 then
      raise exception 'Pagamento inválido.';
    end if;
    if v_taxa is not null and (v_taxa < 0 or v_taxa >= 1) then
      raise exception 'Taxa do cartão inválida.';
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

  -- Desconto e cortesia com valor (a cortesia automática de R$ 0 passa).
  if (v_desconto > 0 or v_cortesia > 0) and not tem_permissao(v_empresa, 'comanda.desconto') then
    raise exception 'Você não tem permissão para dar desconto ou cortesia.' using errcode = '42501';
  end if;

  -- Rateio do desconto manual -----------------------------------
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
    v_np := v_np + 1;
    r_peso[v_np] := (round(i_valor[k] * i_qtd[k], 2) * 100)::bigint;
    r_tipo[v_np] := 'i';
    r_idx[v_np] := k;
  end loop;
  v_cotas := public.ratear_desconto_centavos((v_desconto * 100)::bigint, r_peso);
  for k in 1..v_np loop
    if r_tipo[k] = 'a' then
      a_cota[r_idx[k]] := v_cotas[k];
    elsif r_tipo[k] = 'l' then
      l_cota[r_idx[k]] := v_cotas[k];
      a_cota[l_at[r_idx[k]]] := a_cota[l_at[r_idx[k]]] + v_cotas[k];
    else
      i_cota[r_idx[k]] := v_cotas[k];
      if i_tipo[r_idx[k]] = 'produto' then
        v_desc_produtos := v_desc_produtos + v_cotas[k]::numeric / 100;
      elsif i_tipo[r_idx[k]] = 'pacote' then
        v_desc_pacotes := v_desc_pacotes + v_cotas[k]::numeric / 100;
      end if;
    end if;
  end loop;

  -- ── Gravação (ordem preserva os triggers) ──────────────────

  -- (1) Comanda. profissional_id = quem fecha (policy de SELECT e comanda_pertence_ao_profissional).
  begin
    insert into public.comandas
      (id, empresa_id, clientes_id, profissional_id, status, valor_total, desconto, desconto_reserva, fechada_at)
    values
      (v_comanda, v_empresa, v_cliente, auth.uid(), 'fechada', v_subtotal,
       v_desconto + v_reserva_aplic, v_reserva_aplic, now());
  exception when unique_violation then
    -- Duas tentativas iguais ao mesmo tempo: a segunda espera a primeira e cai aqui.
    select empresa_id into v_existente from public.comandas where id = v_comanda;
    if found and v_existente = v_empresa then
      return v_comanda;
    end if;
    raise exception 'Este código de comanda já foi usado. Recarregue a tela e tente de novo.';
  end;

  -- (2) Linhas de multi-serviço (nenhum trigger lê esta tabela). Em ordem de id: duas comandas com
  --     as mesmas linhas/atendimentos em ordens diferentes não travam uma à outra (deadlock).
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

  -- (3) Atendimentos: tudo no MESMO UPDATE da transição para 'concluido' (065, 078, 061), em ordem de id.
  for k in select g.ix from generate_subscripts(a_id, 1) as g(ix) order by a_id[g.ix] loop
    update public.agendamentos a
       set valor = a_valor[k],
           desconto_rateado = a_cota[k]::numeric / 100,
           pacote_cliente_id = case when a_tem_pac[k] then a_pacote[k] else a.pacote_cliente_id end,
           comanda_id = v_comanda,
           status = 'concluido'
     where a.id = a_id[k]
       and a.empresa_id = v_empresa
       and a.comanda_id is null
       and a.status not in ('cancelado', 'faltou');
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      if exists (select 1 from public.agendamentos x where x.id = a_id[k] and x.comanda_id is not null) then
        raise exception 'Este atendimento já teve a comanda fechada.';
      end if;
      if exists (select 1 from public.agendamentos x where x.id = a_id[k] and x.status in ('cancelado', 'faltou')) then
        raise exception 'Atendimento cancelado ou com falta não entra na comanda.';
      end if;
      raise exception 'Você não tem permissão para fechar a comanda deste atendimento.' using errcode = '42501';
    end if;
  end loop;

  -- (4) Itens extras (085 cria a comissão do serviço com profissional, datada por fechada_at).
  if coalesce(array_length(i_id, 1), 0) > 0 then
    insert into public.comanda_itens
      (id, comanda_id, empresa_id, tipo, descricao, servico_id, produto_id, pacote_id,
       profissional_id, quantidade, valor_unit, desconto_rateado)
    select i_id[g.ix], v_comanda, v_empresa, i_tipo[g.ix], i_desc[g.ix], i_servico[g.ix], i_produto[g.ix], i_pacote[g.ix],
           i_prof[g.ix], i_qtd[g.ix], i_valor[g.ix], i_cota[g.ix]::numeric / 100
      from generate_subscripts(i_id, 1) as g(ix)
     order by g.ix;
  end if;

  -- (5) Pacotes vendidos: um pacote_clientes por unidade; venda com o desconto rateado deles.
  if v_tem_pacote then
    v_hoje := (now() at time zone 'America/Sao_Paulo')::date;
    insert into public.pacote_clientes
      (empresa_id, pacote_id, cliente_id, data_inicio, data_validade, valor_pago, status)
    select v_empresa, i_pacote[g.ix], v_cliente, v_hoje,
           case when pk.validade_dias is not null then v_hoje + pk.validade_dias end,
           i_valor[g.ix], 'ativo'
      from generate_subscripts(i_id, 1) as g(ix)
      join public.pacotes pk on pk.id = i_pacote[g.ix]
      cross join lateral generate_series(1, greatest(1, round(i_qtd[g.ix])::int)) as u(n)
     where i_tipo[g.ix] = 'pacote'
     order by g.ix, u.n;
    if v_tot_pacotes > 0 then
      insert into public.vendas (id, empresa_id, cliente_id, valor_total, desconto, observacao)
      values (gen_random_uuid(), v_empresa, v_cliente, v_tot_pacotes, v_desc_pacotes, 'Pacote(s) via comanda');
    end if;
  end if;

  -- (6) Produtos: trava (mesma chave da 087/088, em ordem de id) → baixa → venda.
  if v_tem_produto then
    for r in
      select i_produto[g.ix] as produto_id
        from generate_subscripts(i_id, 1) as g(ix)
       where i_tipo[g.ix] = 'produto'
       group by i_produto[g.ix]
       order by i_produto[g.ix]
    loop
      perform pg_advisory_xact_lock(hashtextextended('venda_estoque:' || r.produto_id::text, 0));
    end loop;

    insert into public.estoque_movimentos (empresa_id, produto_id, tipo, quantidade, motivo, agendamento_id, comanda_id)
    select v_empresa, i_produto[g.ix], 'saida', i_qtd[g.ix], 'Produto via comanda — ' || i_desc[g.ix], a_id[1], v_comanda
      from generate_subscripts(i_id, 1) as g(ix)
     where i_tipo[g.ix] = 'produto'
     order by i_produto[g.ix], g.ix;

    v_venda := gen_random_uuid();
    insert into public.vendas (id, empresa_id, cliente_id, valor_total, desconto, observacao)
    values (v_venda, v_empresa, v_cliente, v_tot_produtos, v_desc_produtos, 'Via comanda');
    insert into public.venda_itens (empresa_id, venda_id, produto_id, quantidade, preco_unitario)
    select v_empresa, v_venda, i_produto[g.ix], i_qtd[g.ix], i_valor[g.ix]
      from generate_subscripts(i_id, 1) as g(ix)
     where i_tipo[g.ix] = 'produto'
     order by i_produto[g.ix], g.ix;
  end if;

  -- (7) Pagamentos. Total R$ 0 sem pagamento com valor = uma Cortesia R$ 0.
  if v_qtd_pag = 0 then
    insert into public.pagamentos
      (empresa_id, comanda_id, valor, metodo, bandeira, parcelas, taxa_perc, valor_liquido, maquininha_id, status)
    values (v_empresa, v_comanda, 0, 'cortesia', null, 1, null, null, null, 'pago');
  else
    insert into public.pagamentos
      (empresa_id, comanda_id, valor, metodo, bandeira, parcelas, taxa_perc, valor_liquido, maquininha_id, status)
    select v_empresa, v_comanda, n.valor, n.metodo::pagamento_metodo, n.bandeira, n.parcelas, n.taxa_perc,
           case when n.taxa_perc is not null then round(n.valor * (1 - n.taxa_perc), 2) end,
           n.maquininha_id, 'pago'
      from (
        select round((x.j->>'valor')::numeric, 2) as valor,
               x.j->>'metodo' as metodo,
               case when x.j->>'metodo' in ('credito', 'debito') then nullif(btrim(x.j->>'bandeira'), '') end as bandeira,
               case when x.j->>'metodo' = 'credito' then coalesce((x.j->>'parcelas')::int, 1) else 1 end as parcelas,
               case when x.j->>'metodo' in ('credito', 'debito') then nullif((x.j->>'taxa_perc')::numeric, 0) end as taxa_perc,
               case when x.j->>'metodo' in ('credito', 'debito') then nullif(x.j->>'maquininha_id', '')::uuid end as maquininha_id,
               x.ord
          from jsonb_array_elements(v_pags) with ordinality as x(j, ord)
         where round((x.j->>'valor')::numeric, 2) > 0
      ) as n
     order by n.ord;
  end if;

  return v_comanda;
end;
$$;

revoke all on function public.fechar_comanda(jsonb) from public, anon;
grant execute on function public.fechar_comanda(jsonb) to authenticated;

-- ── 4. editar_comanda ─────────────────────────────────────────
create or replace function public.editar_comanda(p jsonb)
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

  -- Atendimentos: os mesmos da comanda (tirar atendimento é proibido; vínculo de pacote não muda).
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
    select ag.pacote_cliente_id, ag.valor, ag.desconto_rateado into v_pc, v_db_valor, v_db_desc
      from public.agendamentos ag where ag.id = v_ag;
    ad_desc[v_n] := coalesce(v_db_desc, 0);
    if v_db_valor is distinct from a_valor[v_n] then
      v_mudou := true;
      -- Só recusa quando a mudança vem agora: comanda antiga já gravada com pacote e valor > 0
      -- continua editável enquanto o valor dela não muda.
      if v_pc is not null and a_valor[v_n] > 0 then
        raise exception 'Atendimento coberto por pacote deve ficar com valor R$ 0,00.';
      end if;
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
           desconto_rateado = a_cota[k]::numeric / 100
     where a.id = a_id[k] and a.empresa_id = v_empresa and a.comanda_id = v_comanda;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'Você não tem permissão para editar o atendimento desta comanda.' using errcode = '42501';
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
           case when coalesce(case when o.id is not null then o.taxa_perc else n.taxa_perc end, 0) > 0
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
               case when x.j->>'metodo' in ('credito', 'debito') then nullif((x.j->>'taxa_perc')::numeric, 0) end as taxa_perc,
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

revoke all on function public.editar_comanda(jsonb) from public, anon;
grant execute on function public.editar_comanda(jsonb) to authenticated;

-- ── 5. registrar_venda_avulsa_v2 (087 + chave contra repetição) ──
-- Corpo da 087 sem mudança de regra; só o id vem de p_venda_id e a venda já existente nesta
-- empresa devolve o id sem gravar (antes de conferir estoque: a repetição não pode falhar por
-- "estoque insuficiente" do próprio produto que ela já baixou).
create or replace function public.registrar_venda_avulsa_v2(
  p_venda_id uuid,
  p_empresa uuid,
  p_cliente uuid,
  p_desconto numeric,
  p_itens jsonb,
  p_pagamentos jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existente uuid;
  v_total    numeric(10,2);
  v_desconto numeric(10,2) := round(coalesce(p_desconto, 0), 2);
  v_pago     numeric(10,2);
  v_nome     text;
  v_saldo    numeric;
  v_vendavel boolean;
  r          record;
begin
  if not tem_permissao(p_empresa, 'vendas.acessar') then
    raise exception 'Você não tem permissão para registrar vendas avulsas.' using errcode = '42501';
  end if;
  if p_venda_id is null then
    raise exception 'Venda sem identificador.';
  end if;

  -- Idempotência: nova tentativa da mesma venda (queda de rede depois do commit).
  select empresa_id into v_existente from public.vendas where id = p_venda_id;
  if found then
    if v_existente = p_empresa then
      return p_venda_id;
    end if;
    raise exception 'Esta venda pertence a outra empresa.';
  end if;

  -- Itens
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Carrinho vazio.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade numeric, preco_unitario numeric)
    where i.produto_id is null or coalesce(i.quantidade, 0) <= 0 or i.preco_unitario is null or i.preco_unitario < 0
  ) then
    raise exception 'Item da venda inválido.';
  end if;
  select round(sum(round(i.preco_unitario, 2) * i.quantidade), 2) into v_total
    from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade numeric, preco_unitario numeric);

  if v_desconto < 0 then
    raise exception 'Desconto inválido.';
  end if;
  if v_desconto > v_total then
    raise exception 'O desconto não pode ser maior que o subtotal.';
  end if;

  -- Pagamentos
  if p_pagamentos is null or jsonb_typeof(p_pagamentos) <> 'array' or jsonb_array_length(p_pagamentos) = 0 then
    raise exception 'Pagamento não informado.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_pagamentos) as p(valor numeric, metodo text)
    where p.valor is null or p.valor < 0 or p.metodo is null
  ) then
    raise exception 'Pagamento inválido.';
  end if;
  select round(coalesce(sum(p.valor), 0), 2) into v_pago
    from jsonb_to_recordset(p_pagamentos) as p(valor numeric);
  if v_pago < (v_total - v_desconto) - 0.005 then
    raise exception 'O pagamento não cobre o total da venda.';
  end if;

  -- Desconto e cortesia com valor: mesma permissão da comanda (a cortesia automática de R$ 0 passa)
  if (v_desconto > 0 or exists (
        select 1 from jsonb_to_recordset(p_pagamentos) as p(valor numeric, metodo text)
        where p.metodo = 'cortesia' and p.valor > 0))
     and not tem_permissao(p_empresa, 'comanda.desconto') then
    raise exception 'Você não tem permissão para dar desconto ou cortesia.' using errcode = '42501';
  end if;

  -- Estoque: trava todos os produtos (em ordem de id) antes de conferir qualquer saldo.
  for r in
    select i.produto_id
      from jsonb_to_recordset(p_itens) as i(produto_id uuid)
     group by i.produto_id
     order by i.produto_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('venda_estoque:' || r.produto_id::text, 0));
  end loop;

  -- Releitura depois das travas: numa repetição simultânea, a 1ª tentativa gravou enquanto esta
  -- esperava. Devolve o id em vez de conferir o saldo que ela mesma já baixou.
  select empresa_id into v_existente from public.vendas where id = p_venda_id;
  if found then
    if v_existente = p_empresa then
      return p_venda_id;
    end if;
    raise exception 'Esta venda pertence a outra empresa.';
  end if;

  -- Saldo (mesma regra da 087)
  for r in
    select i.produto_id, sum(i.quantidade) as qtd
      from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade numeric)
     group by i.produto_id
     order by i.produto_id
  loop
    select pr.nome, pr.estoque_atual, (pr.tipo = 'venda' and pr.ativo) into v_nome, v_saldo, v_vendavel
      from public.produtos pr
     where pr.id = r.produto_id and pr.empresa_id = p_empresa;
    if not found then
      raise exception 'Produto indisponível para venda.';
    end if;
    if not coalesce(v_vendavel, false) then  -- ativo/tipo nulos = indisponível
      raise exception 'Produto indisponível para venda: %.', v_nome;
    end if;
    if coalesce(v_saldo, 0) < r.qtd then
      raise exception 'Estoque insuficiente: % (restam %)', v_nome, trim_scale(coalesce(v_saldo, 0));
    end if;
  end loop;

  -- Gravação (id da tela; sem RETURNING)
  begin
    insert into public.vendas (id, empresa_id, cliente_id, valor_total, desconto)
    values (p_venda_id, p_empresa, p_cliente, v_total, v_desconto);
  exception when unique_violation then
    -- Duas tentativas iguais ao mesmo tempo: a segunda espera a primeira e cai aqui.
    select empresa_id into v_existente from public.vendas where id = p_venda_id;
    if found and v_existente = p_empresa then
      return p_venda_id;
    end if;
    raise exception 'Este código de venda já foi usado. Recarregue a tela e tente de novo.';
  end;

  insert into public.venda_itens (empresa_id, venda_id, produto_id, quantidade, preco_unitario)
  select p_empresa, p_venda_id, i.produto_id, i.quantidade, round(i.preco_unitario, 2)
    from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade numeric, preco_unitario numeric)
   order by i.produto_id;

  insert into public.estoque_movimentos (empresa_id, produto_id, tipo, quantidade, motivo)
  select p_empresa, i.produto_id, 'saida', i.quantidade, 'Venda avulsa'
    from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade numeric)
   order by i.produto_id;

  insert into public.pagamentos
    (empresa_id, venda_id, valor, metodo, bandeira, parcelas, taxa_perc, valor_liquido, maquininha_id, status)
  select p_empresa, p_venda_id, round(p.valor, 2), p.metodo::pagamento_metodo, p.bandeira, coalesce(p.parcelas, 1),
         p.taxa_perc, p.valor_liquido, p.maquininha_id, 'pago'
    from jsonb_to_recordset(p_pagamentos) as p(
      valor numeric, metodo text, bandeira text, parcelas integer,
      taxa_perc numeric, valor_liquido numeric, maquininha_id uuid
    );

  return p_venda_id;
end;
$$;

revoke all on function public.registrar_venda_avulsa_v2(uuid, uuid, uuid, numeric, jsonb, jsonb) from public, anon;
grant execute on function public.registrar_venda_avulsa_v2(uuid, uuid, uuid, numeric, jsonb, jsonb) to authenticated;

-- ── 6. Triggers de comissão com a base nova ───────────────────

-- 065 + base com desconto. Resto idêntico (security definer, filtro de sessão de pacote).
create or replace function public.gerar_comissao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_percentual numeric(5,2);
begin
  if new.status = 'concluido' and old.status != 'concluido' then
    -- Sessão de pacote: já foi paga na venda do pacote, não gera comissão nova.
    if new.pacote_cliente_id is not null then
      return new;
    end if;

    select percentual_comissao into v_percentual
    from public.empresa_membros
    where empresa_id = new.empresa_id
      and user_id    = new.profissional_id;

    if v_percentual is not null and v_percentual > 0 then
      insert into public.comissoes
        (empresa_id, profissional_id, agendamento_id, valor_servico, percentual)
      values
        (new.empresa_id, new.profissional_id, new.id,
         greatest(new.valor - coalesce(new.desconto_rateado, 0), 0), v_percentual);
    end if;
  end if;
  return new;
end;
$$;
-- trg_gerar_comissao (065) continua apontando para esta função: nada a recriar.

-- 075 + desconto_rateado: comissão (pendente ou paga) acompanha valor E parte do desconto.
create or replace function public.sincronizar_comissao_valor()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'concluido'
     and old.status = 'concluido'
     and (new.valor is distinct from old.valor
          or new.desconto_rateado is distinct from old.desconto_rateado) then
    update public.comissoes
       set valor_servico = greatest(new.valor - coalesce(new.desconto_rateado, 0), 0)
     where agendamento_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sincronizar_comissao_valor on public.agendamentos;
create trigger trg_sincronizar_comissao_valor
  after update of valor, desconto_rateado on public.agendamentos
  for each row
  execute function public.sincronizar_comissao_valor();

-- 085 + base com desconto + created_at = comandas.fechada_at.
create or replace function public.gerar_comissao_item()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_percentual numeric(5,2);
begin
  if new.tipo = 'servico' and new.profissional_id is not null and new.valor_unit * new.quantidade > 0 then
    select percentual_comissao into v_percentual
      from public.empresa_membros
     where empresa_id = new.empresa_id and user_id = new.profissional_id;
    if v_percentual is not null and v_percentual > 0 then
      insert into public.comissoes (empresa_id, profissional_id, comanda_item_id, valor_servico, percentual, created_at)
      values (new.empresa_id, new.profissional_id, new.id,
              greatest(round(new.valor_unit * new.quantidade, 2) - coalesce(new.desconto_rateado, 0), 0),
              v_percentual,
              coalesce((select c.fechada_at from public.comandas c where c.id = new.comanda_id), now()));
    end if;
  end if;
  return new;
end;
$$;

-- Reconcilia a comissão do item com o estado ATUAL dele (cria, atualiza ou remove).
create or replace function public.sincronizar_comissao_item()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_percentual numeric(5,2);
  v_qualifica boolean := false;
  v_mudou_dono boolean := new.profissional_id is distinct from old.profissional_id or new.tipo is distinct from old.tipo;
  v_mudou_valor boolean := new.valor_unit is distinct from old.valor_unit or new.quantidade is distinct from old.quantidade;
  v_mudou_desconto boolean := new.desconto_rateado is distinct from old.desconto_rateado;
  v_base numeric(10,2) := greatest(round(new.valor_unit * new.quantidade, 2) - coalesce(new.desconto_rateado, 0), 0);
begin
  -- Comissão já paga: nunca apaga; troca de dono é bloqueada, valor acompanha (regra da 075).
  if exists (select 1 from public.comissoes where comanda_item_id = new.id and status = 'pago') then
    if v_mudou_dono then
      raise exception 'Comissão deste serviço já foi paga';
    end if;
    if v_mudou_valor or v_mudou_desconto then
      update public.comissoes
         set valor_servico = v_base
       where comanda_item_id = new.id;
    end if;
    return new;
  end if;

  if new.tipo = 'servico' and new.profissional_id is not null and new.valor_unit * new.quantidade > 0 then
    select percentual_comissao into v_percentual
      from public.empresa_membros
     where empresa_id = new.empresa_id and user_id = new.profissional_id;
    v_qualifica := v_percentual is not null and v_percentual > 0;
  end if;

  if v_mudou_dono or not v_qualifica then
    delete from public.comissoes where comanda_item_id = new.id;
  end if;

  if v_qualifica then
    if exists (select 1 from public.comissoes where comanda_item_id = new.id) then
      if v_mudou_valor or v_mudou_desconto then
        update public.comissoes
           set valor_servico = v_base
         where comanda_item_id = new.id;
      end if;
    elsif v_mudou_dono or v_mudou_valor then
      -- Só cria quando algo relevante mudou: UPDATE sem efeito (ex.: descrição) ou só da parte do
      -- desconto em extra anterior à 085 não pode gerar comissão retroativa.
      insert into public.comissoes (empresa_id, profissional_id, comanda_item_id, valor_servico, percentual, created_at)
      values (new.empresa_id, new.profissional_id, new.id, v_base, v_percentual,
              coalesce((select c.fechada_at from public.comandas c where c.id = new.comanda_id), now()));
    end if;
  end if;
  return new;
end;
$$;
-- Os triggers da 085 (after insert / after update / before delete) continuam apontando para
-- estas funções; apagar_comissao_item não muda.

-- search_path fixo nos dois triggers definer que ainda não tinham (corpo intacto: só usam public.*).
alter function public.fn_registrar_uso_pacote() set search_path = public;
alter function public.notificar_estoque_baixo() set search_path = public;

-- ── 7. RLS ────────────────────────────────────────────────────

-- estoque_movimentos INSERT: os 4 ramos da 089 iguais + (e) saída ligada a uma comanda dela.
drop policy if exists "estoque_movimentos: gestor pode inserir" on public.estoque_movimentos;
create policy "estoque_movimentos: gestor pode inserir" on public.estoque_movimentos for insert with check (
  tem_permissao(empresa_id, 'estoque.acessar')
  or (tipo = 'saida'::movimento_tipo and agendamento_id is not null
      and exists (select 1 from public.agendamentos
                  where agendamentos.id = estoque_movimentos.agendamento_id
                    and agendamentos.profissional_id = auth.uid()
                    and agendamentos.empresa_id = estoque_movimentos.empresa_id))
  or (tipo = 'saida'::movimento_tipo and tem_permissao(empresa_id, 'vendas.acessar'))
  or (tipo = 'saida'::movimento_tipo and agendamento_id is not null
      and tem_permissao(empresa_id, 'agenda.gerenciar_outras')
      and exists (select 1 from public.agendamentos
                  where agendamentos.id = estoque_movimentos.agendamento_id
                    and agendamentos.empresa_id = estoque_movimentos.empresa_id))
  or (tipo = 'saida'::movimento_tipo and comanda_id is not null
      and comanda_pertence_ao_profissional(comanda_id)
      and exists (select 1 from public.comandas
                  where comandas.id = estoque_movimentos.comanda_id
                    and comandas.empresa_id = estoque_movimentos.empresa_id))
);

-- comissoes: só nascem pelos triggers (security definer). Ninguém insere pela API.
drop policy if exists "comissoes: membro insere" on public.comissoes;

notify pgrst, 'reload schema';
