-- ============================================================
-- MIGRATION 093 — Alinhamentos finais: vínculo ativo, empresa conferida nas funções e policies amplas
-- Spec: docs/superpowers/specs/2026-10-15-correcoes-pontuais-design.md (itens 7, 9, 10, 11 e 16)
-- Plano: docs/superpowers/plans/2026-10-15-correcoes-pontuais.md (Task 1)
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
-- Idempotente: `create or replace function` e `drop policy if exists` + `create policy` com o
-- MESMO nome. Requer 083 (tem_permissao), 086 (cartao_maquininhas e policies de vendas), 089 e 090.
-- Ordem: SEMPRE depois da 090 (a seção 0 recusa rodar sem ela). Em relação ao deploy é livre:
-- nenhuma tela muda; as telas em passos (JS antigo/PWA em cache) continuam passando nas policies
-- novas (conferido caller a caller, ver cada parte). Ordem completa:
-- docs/superpowers/notes/2026-10-16-ordem-deploy-pendencias.md.
--
-- POR QUE CADA PARTE
--
-- 1) Item 9 — comanda_pertence_ao_profissional (F10 da matriz de 2026-10-14): os dois ramos
--    (comandas.profissional_id = quem fechou; agendamentos.profissional_id = atendimento dela)
--    passam a exigir vínculo ATIVO na empresa da comanda (ou ser a dona). Antes uma profissional
--    desativada continuava lendo e editando as comandas que fechou, pela API.
--    As policies de comandas (SELECT/UPDATE/DELETE) tinham também o ramo direto
--    `profissional_id = auth.uid()`, que anularia a correção: ele sai, porque a função já cobre
--    esse caso (com o vínculo ativo). Os demais ramos ficam iguais (089 para SELECT/UPDATE, 073 para
--    DELETE). A função continua security definer (045/073/075/089); só o corpo muda.
--
-- 2) Item 10 — fechar_comanda, editar_comanda e registrar_venda_avulsa_v2 (corpos ATUAIS da 090,
--    que a 091 e a 092 não recriaram; mesma assinatura, security invoker, search_path, revoke e
--    grant) conferem que cliente, maquininha e profissional do serviço extra são da MESMA empresa.
--    Antes um id de outra empresa era gravado sem erro (as FKs não olham empresa).
--    A conferência é feita pelo helper conferir_vinculos_empresa (security definer): conferir pela
--    RLS de quem chama recusaria vínculos legítimos que ela não enxerga (cliente de outra
--    profissional com clientes.ver_todas desligado). O helper devolve só uma mensagem (nada da
--    linha) e só responde para empresas de quem chama.
--    - fechar_comanda: cliente, maquininhas dos pagamentos no cartão e profissionais dos extras.
--    - editar_comanda: maquininhas e os profissionais de extras novos ou trocados (o cliente não muda
--      na edição; extra antigo sem troca não é reconferido — profissional desativada depois não
--      trava a edição). Profissional = qualquer vínculo na empresa (ativo ou não) ou a dona.
--    - registrar_venda_avulsa_v2: cliente e maquininhas.
--    A 087 (registrar_venda_avulsa, só para quem ainda não tem a 090) NÃO é recriada.
--
-- 3) Item 11 — vendas e venda_itens. Produção (2026-10-15): só "membro gerencia" (ALL) + as da 086;
--    a 046 nunca rodou — qualquer membro via, alterava e apagava vendas pela API.
--    - INSERT: membro da empresa. A comanda da profissional grava a venda dos produtos/pacotes
--      (fechar_comanda é invoker; o caminho antigo das telas grava sem RETURNING).
--    - SELECT: vendas.acessar (086, mantida) OU financeiro.ver OU gestora/dona (nova policy).
--      Financeiro, Dashboard e Relatórios (financeiro.ver) e a tela Vendas (vendas.acessar) continuam
--      lendo. registrar_venda_avulsa(_v2) exigem vendas.acessar, então a releitura da chave segue.
--    - UPDATE e DELETE: só gestora/dona; o "vendas.acessar deleta" da 086 (desfazer venda recém-criada
--      sem itens, shared/venda.ts) continua.
--    - As policies da 046 (se um dia rodaram) são substituídas pelas de mesmo papel.
--    MUDA: a profissional sem vendas.acessar e sem financeiro.ver deixa de ver as vendas no perfil da
--    cliente (web, aba de compras) e a contagem de vendas em "excluir cliente" (só a dona tem
--    clientes.excluir no padrão, e ela vê tudo).
--
-- 4) Item 16 — policies amplas de produção (consulta de 2026-10-15):
--    - pacote_uso "membro gerencia" (ALL) → SELECT para membro; INSERT/UPDATE/DELETE com
--      pacotes.vender OU sessão ligada a atendimento da própria agenda OU agenda.gerenciar_outras.
--      Callers: tela Pacotes (web e app: sessão avulsa, vincular atendimento, editar, excluir) — no
--      padrão todas têm pacotes.vender, nada muda. O consumo automático é o trigger
--      fn_registrar_uso_pacote (078), security definer: não passa pela RLS. Exclusão de pacote vendido
--      apaga pacote_uso por cascata (FK), que também não passa pela RLS.
--    - pagamentos "membro insere" → comanda que pertence a ela, agenda.gerenciar_outras ou gestora;
--      ou venda (venda_id) com vendas.acessar. A comanda/venda tem de ser da mesma empresa do
--      pagamento. Callers: fechar_comanda/editar_comanda (comanda fechada por quem chama), caminho
--      antigo da comanda web e app (comanda criada com profissional_id = quem fecha), edição antiga
--      (mesmas regras do UPDATE/DELETE da 089), registrar_venda_avulsa(_v2) e caminho antigo de
--      shared/venda.ts (vendas.acessar). A venda via comanda não grava pagamento com venda_id.
--    - comanda_itens "membro insere" → comanda que pertence a ela, agenda.gerenciar_outras ou
--      gestora, na mesma empresa (mesmas regras do UPDATE/DELETE da 089).
--
-- 5) Item 7 — taxa de cartão 0%: fechar_comanda e editar_comanda gravavam `nullif(taxa_perc, 0)`,
--    então o 0% configurado (que shared/comanda-fechamento.ts#montarPagamentos agora manda como 0)
--    virava null ("taxa não cadastrada" ao reabrir). Agora 0 grava 0 e valor_liquido = valor; null
--    continua sendo "sem taxa cadastrada". registrar_venda_avulsa_v2 já gravava o que a tela manda.
--    Telas antigas mandam null para 0% (como antes), então nada muda para elas.
--
-- Rollback (volta ao estado anterior; os dados não mudam):
--   comanda_pertence_ao_profissional: recriar como na 089.
--   comandas: recriar "... ve"/"... atualiza" como na 089 e "... deleta" como na 073 (com o ramo
--     `or profissional_id = auth.uid()`).
--   fechar_comanda, editar_comanda, registrar_venda_avulsa_v2: rodar de novo a seção 3, 4 e 5 da 090;
--     drop function if exists public.conferir_vinculos_empresa(uuid, uuid, uuid[], uuid[]);
--   vendas/venda_itens: drop das policies "membro insere", "financeiro ou gestor ve",
--     "gestor ou owner atualiza", "gestor ou owner deleta" e
--     create policy "vendas: membro gerencia" on public.vendas for all
--       using (empresa_id in (select minha_empresas())) with check (empresa_id in (select minha_empresas()));
--     (idem "venda_itens: membro gerencia").
--   pacote_uso: drop das 4 policies novas e create policy "pacote_uso: membro gerencia" como na 010.
--   pagamentos / comanda_itens: drop "... quem fecha insere" e recriar "... membro insere" como na 075.
--   notify pgrst, 'reload schema';
-- ============================================================

-- ── 0. Pré-requisito: a 090 ───────────────────────────────────
-- O corpo das funções de plpgsql não é conferido ao criar: sem esta trava a 093 rodaria sem a 090,
-- criaria fechar_comanda/editar_comanda/registrar_venda_avulsa_v2 sem as colunas e funções da 090
-- (desconto_rateado, ratear_desconto_centavos, estoque_movimentos.comanda_id), e as telas, que
-- usam a função quando ela existe, passariam a falhar em todo fechamento.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'agendamentos' and column_name = 'desconto_rateado')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'estoque_movimentos' and column_name = 'comanda_id')
     or to_regprocedure('public.ratear_desconto_centavos(bigint, bigint[])') is null then
    raise exception 'Rode a migration 090 antes da 093.';
  end if;
end $$;

-- ── 1. Item 9: pertencer à comanda exige vínculo ativo ────────
create or replace function public.comanda_pertence_ao_profissional(p_comanda_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.comandas c
     where c.id = p_comanda_id
       and (exists (select 1 from public.empresa_membros m
                     where m.empresa_id = c.empresa_id
                       and m.user_id = auth.uid()
                       and m.ativo = true)
            or exists (select 1 from public.empresas e
                        where e.id = c.empresa_id and e.owner_id = auth.uid()))
       and (c.profissional_id = auth.uid()
            or exists (select 1 from public.agendamentos a
                        where a.comanda_id = c.id
                          and a.empresa_id = c.empresa_id
                          and a.profissional_id = auth.uid()))
  );
$$;

drop policy if exists "comandas: profissional ou gestor ve" on public.comandas;
create policy "comandas: profissional ou gestor ve" on public.comandas for select using (
  is_gestor_ou_owner(empresa_id)
  or comanda_pertence_ao_profissional(id)
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras')
);
drop policy if exists "comandas: profissional ou gestor atualiza" on public.comandas;
create policy "comandas: profissional ou gestor atualiza" on public.comandas for update using (
  is_gestor_ou_owner(empresa_id)
  or comanda_pertence_ao_profissional(id)
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras')
);
drop policy if exists "comandas: profissional ou gestor deleta" on public.comandas;
create policy "comandas: profissional ou gestor deleta" on public.comandas for delete using (
  is_gestor_ou_owner(empresa_id)
  or comanda_pertence_ao_profissional(id)
);

-- ── 2. Item 10: vínculos da mesma empresa ─────────────────────
-- Devolve a mensagem do primeiro vínculo de outra empresa, ou null. Só responde para empresas de
-- quem chama (nada de sondar outras empresas). Ids nulos são ignorados.
create or replace function public.conferir_vinculos_empresa(
  p_empresa uuid,
  p_cliente uuid,
  p_maquininhas uuid[],
  p_profissionais uuid[]
) returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_empresa is null or not (p_empresa in (select minha_empresas()))
      then 'Você não faz parte desta empresa.'
    when p_cliente is not null
         and not exists (select 1 from public.clientes cl where cl.id = p_cliente and cl.empresa_id = p_empresa)
      then 'Cliente não encontrada nesta empresa.'
    when exists (select 1 from unnest(coalesce(p_maquininhas, '{}'::uuid[])) as x(id)
                  where x.id is not null
                    and not exists (select 1 from public.cartao_maquininhas cm
                                     where cm.id = x.id and cm.empresa_id = p_empresa))
      then 'Maquininha não encontrada nesta empresa.'
    when exists (select 1 from unnest(coalesce(p_profissionais, '{}'::uuid[])) as x(id)
                  where x.id is not null
                    and not exists (select 1 from public.empresa_membros m
                                     where m.user_id = x.id and m.empresa_id = p_empresa)
                    and not exists (select 1 from public.empresas e
                                     where e.id = p_empresa and e.owner_id = x.id))
      then 'Profissional do serviço extra não faz parte desta empresa.'
  end;
$$;

revoke all on function public.conferir_vinculos_empresa(uuid, uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.conferir_vinculos_empresa(uuid, uuid, uuid[], uuid[]) to authenticated;

-- ── 3. fechar_comanda (corpo da 090 + conferência) ────────────
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
  v_erro         text;
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

  -- 093: cliente, maquininhas gravadas e profissionais dos extras da MESMA empresa.
  v_erro := public.conferir_vinculos_empresa(
    v_empresa,
    v_cliente,
    array(select nullif(x.j->>'maquininha_id', '')::uuid
            from jsonb_array_elements(v_pags) as x(j)
           where jsonb_typeof(x.j) = 'object' and x.j->>'metodo' in ('credito', 'debito')),
    i_prof
  );
  if v_erro is not null then
    raise exception '%', v_erro;
  end if;

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
  --     valor_pago = o que a cliente pagou de fato por unidade: (valor × qtd − cota do desconto) do
  --     item, dividido em centavos entre as unidades (o resto, 1 centavo cada, vai nas primeiras) —
  --     a soma bate com vendas.valor_final dos pacotes (relatório de Pacotes = Financeiro).
  if v_tem_pacote then
    v_hoje := (now() at time zone 'America/Sao_Paulo')::date;
    insert into public.pacote_clientes
      (empresa_id, pacote_id, cliente_id, data_inicio, data_validade, valor_pago, status)
    select v_empresa, i_pacote[g.ix], v_cliente, v_hoje,
           case when pk.validade_dias is not null then v_hoje + pk.validade_dias end,
           ((pl.liquido / pl.q) + case when u.n <= pl.liquido % pl.q then 1 else 0 end)::numeric / 100,
           'ativo'
      from generate_subscripts(i_id, 1) as g(ix)
      join public.pacotes pk on pk.id = i_pacote[g.ix]
      cross join lateral (
        select greatest(1, round(i_qtd[g.ix])::int) as q,
               (round(i_valor[g.ix] * i_qtd[g.ix], 2) * 100)::bigint - i_cota[g.ix] as liquido
      ) as pl
      cross join lateral generate_series(1, pl.q) as u(n)
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
               case when x.j->>'metodo' in ('credito', 'debito') then (x.j->>'taxa_perc')::numeric end as taxa_perc,  -- 093: 0% grava 0
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

-- ── 4. editar_comanda (corpo da 090 + conferência) ────────────
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

revoke all on function public.editar_comanda(jsonb) from public, anon;
grant execute on function public.editar_comanda(jsonb) to authenticated;

-- ── 5. registrar_venda_avulsa_v2 (corpo da 090 + conferência) ──
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
  v_erro     text;
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

  -- 093: cliente e maquininhas da MESMA empresa.
  v_erro := public.conferir_vinculos_empresa(
    p_empresa,
    p_cliente,
    array(select p.maquininha_id from jsonb_to_recordset(p_pagamentos) as p(maquininha_id uuid)),
    null
  );
  if v_erro is not null then
    raise exception '%', v_erro;
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

-- ── 6. Item 11: vendas e venda_itens ──────────────────────────
drop policy if exists "vendas: membro gerencia" on public.vendas;
drop policy if exists "vendas: gestor ou owner ve" on public.vendas;
drop policy if exists "vendas: membro insere" on public.vendas;
create policy "vendas: membro insere" on public.vendas for insert
  with check (empresa_id in (select minha_empresas()));
drop policy if exists "vendas: financeiro ou gestor ve" on public.vendas;
create policy "vendas: financeiro ou gestor ve" on public.vendas for select
  using (tem_permissao(empresa_id, 'financeiro.ver') or is_gestor_ou_owner(empresa_id));
drop policy if exists "vendas: gestor ou owner atualiza" on public.vendas;
create policy "vendas: gestor ou owner atualiza" on public.vendas for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));
drop policy if exists "vendas: gestor ou owner deleta" on public.vendas;
create policy "vendas: gestor ou owner deleta" on public.vendas for delete
  using (is_gestor_ou_owner(empresa_id));
-- "vendas: vendas.acessar ve" e "vendas: vendas.acessar deleta" (086) continuam.

drop policy if exists "venda_itens: membro gerencia" on public.venda_itens;
drop policy if exists "venda_itens: gestor ou owner ve" on public.venda_itens;
drop policy if exists "venda_itens: membro insere" on public.venda_itens;
create policy "venda_itens: membro insere" on public.venda_itens for insert
  with check (empresa_id in (select minha_empresas()));
drop policy if exists "venda_itens: financeiro ou gestor ve" on public.venda_itens;
create policy "venda_itens: financeiro ou gestor ve" on public.venda_itens for select
  using (tem_permissao(empresa_id, 'financeiro.ver') or is_gestor_ou_owner(empresa_id));
drop policy if exists "venda_itens: gestor ou owner atualiza" on public.venda_itens;
create policy "venda_itens: gestor ou owner atualiza" on public.venda_itens for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));
drop policy if exists "venda_itens: gestor ou owner deleta" on public.venda_itens;
create policy "venda_itens: gestor ou owner deleta" on public.venda_itens for delete
  using (is_gestor_ou_owner(empresa_id));
-- "venda_itens: vendas.acessar ve" (086) continua.

-- ── 7. Item 16: pacote_uso ────────────────────────────────────
drop policy if exists "pacote_uso: membro gerencia" on public.pacote_uso;
drop policy if exists "pacote_uso: membro ve" on public.pacote_uso;
create policy "pacote_uso: membro ve" on public.pacote_uso for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "pacote_uso: registra" on public.pacote_uso;
create policy "pacote_uso: registra" on public.pacote_uso for insert with check (
  empresa_id in (select minha_empresas())
  and exists (select 1 from public.pacote_clientes pc
               where pc.id = pacote_uso.pacote_cliente_id and pc.empresa_id = pacote_uso.empresa_id)
  and (
    tem_permissao(empresa_id, 'pacotes.vender')
    or (agendamento_id is not null
        and exists (select 1 from public.agendamentos a
                     where a.id = pacote_uso.agendamento_id
                       and a.empresa_id = pacote_uso.empresa_id
                       and (a.profissional_id = auth.uid()
                            or tem_permissao(empresa_id, 'agenda.gerenciar_outras'))))
  )
);
drop policy if exists "pacote_uso: altera" on public.pacote_uso;
create policy "pacote_uso: altera" on public.pacote_uso for update
  using (
    empresa_id in (select minha_empresas())
    and (
      tem_permissao(empresa_id, 'pacotes.vender')
      or (agendamento_id is not null
          and exists (select 1 from public.agendamentos a
                       where a.id = pacote_uso.agendamento_id
                         and a.empresa_id = pacote_uso.empresa_id
                         and (a.profissional_id = auth.uid()
                              or tem_permissao(empresa_id, 'agenda.gerenciar_outras'))))
    )
  )
  with check (
    empresa_id in (select minha_empresas())
    and (
      tem_permissao(empresa_id, 'pacotes.vender')
      or (agendamento_id is not null
          and exists (select 1 from public.agendamentos a
                       where a.id = pacote_uso.agendamento_id
                         and a.empresa_id = pacote_uso.empresa_id
                         and (a.profissional_id = auth.uid()
                              or tem_permissao(empresa_id, 'agenda.gerenciar_outras'))))
    )
  );
drop policy if exists "pacote_uso: exclui" on public.pacote_uso;
create policy "pacote_uso: exclui" on public.pacote_uso for delete using (
  empresa_id in (select minha_empresas())
  and (
    tem_permissao(empresa_id, 'pacotes.vender')
    or (agendamento_id is not null
        and exists (select 1 from public.agendamentos a
                     where a.id = pacote_uso.agendamento_id
                       and a.empresa_id = pacote_uso.empresa_id
                       and (a.profissional_id = auth.uid()
                            or tem_permissao(empresa_id, 'agenda.gerenciar_outras'))))
  )
);

-- ── 8. Item 16: pagamentos e comanda_itens (INSERT) ───────────
drop policy if exists "pagamentos: membro insere" on public.pagamentos;
drop policy if exists "pagamentos: quem fecha insere" on public.pagamentos;
create policy "pagamentos: quem fecha insere" on public.pagamentos for insert with check (
  empresa_id in (select minha_empresas())
  and (
    (comanda_id is not null
     and exists (select 1 from public.comandas c
                  where c.id = pagamentos.comanda_id and c.empresa_id = pagamentos.empresa_id)
     and (is_gestor_ou_owner(empresa_id)
          or comanda_pertence_ao_profissional(comanda_id)
          or tem_permissao(empresa_id, 'agenda.gerenciar_outras')))
    or (venda_id is not null
        and exists (select 1 from public.vendas v
                     where v.id = pagamentos.venda_id and v.empresa_id = pagamentos.empresa_id)
        and (is_gestor_ou_owner(empresa_id) or tem_permissao(empresa_id, 'vendas.acessar')))
  )
);

drop policy if exists "comanda_itens: membro insere" on public.comanda_itens;
drop policy if exists "comanda_itens: quem fecha insere" on public.comanda_itens;
create policy "comanda_itens: quem fecha insere" on public.comanda_itens for insert with check (
  empresa_id in (select minha_empresas())
  and exists (select 1 from public.comandas c
               where c.id = comanda_itens.comanda_id and c.empresa_id = comanda_itens.empresa_id)
  and (is_gestor_ou_owner(empresa_id)
       or comanda_pertence_ao_profissional(comanda_id)
       or tem_permissao(empresa_id, 'agenda.gerenciar_outras'))
);

notify pgrst, 'reload schema';
