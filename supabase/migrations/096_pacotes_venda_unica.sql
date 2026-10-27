-- ============================================================
-- MIGRATION 096 — Venda única de pacote (agora ou na comanda) e exclusões conferidas
-- Spec: docs/superpowers/specs/2026-10-23-paridade-servicos-pacotes-design.md
-- Plano: Task 2 da Paridade Serviços e Pacotes. Contrato das funções:
--   docs/superpowers/notes/2026-10-23-contrato-pacotes.md
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
-- Idempotente: `add column if not exists`, `create or replace function`, `drop policy if exists` +
-- `create policy` com o MESMO nome. Requer 083 (tem_permissao), 090 (fechar_comanda, rateio) e 093
-- (conferir_vinculos_empresa, policies de pagamentos/vendas) — a seção 0 recusa rodar sem elas.
-- Ordem em relação ao deploy: rodar a 096 ANTES do deploy e fazer o deploy logo em seguida
-- (docs/superpowers/notes/2026-10-27-deploy-servicos-pacotes.md). As telas novas detectam a 096
-- (PGRST202) e, sem ela, seguem pelo caminho antigo, mas o pacote vendido assim fica sem venda_id
-- (vira "pacote antigo": excluí-lo depois deixaria a venda no faturamento). A tela antiga, com a 096,
-- é recusada sem gravar nada (guarda da seção 7) e pede para recarregar.
--
-- POR QUE CADA PARTE
--
-- 1) Colunas de pacote_clientes:
--    - cobranca ('paga' | 'pendente'), default 'paga'. Todos os pacotes que já existem ficam 'paga'
--      (backfill pelo default do ADD COLUMN: foram cobrados pelo caminho antigo, ou nunca saberemos).
--      'pendente' = vendido com "Cobrar na comanda": a cliente já pode usar as sessões (o trigger
--      fn_registrar_uso_pacote não olha a cobrança), mas nada entrou no faturamento ainda.
--    - venda_id → vendas (on delete set null): a venda que cobrou o pacote. Nulo nos antigos e nos
--      pendentes. Liga o pacote ao faturamento (excluir pacote acerta a venda certa).
--
-- 2) vender_pacote(p jsonb) — security invoker (as policies de quem chama valem), chave `venda_id`
--    contra repetição (padrão da 090). Exige pacotes.vender; desconto ou cortesia com valor exigem
--    comanda.desconto, e valor_unit diferente do preço do catálogo também (seria um desconto sem
--    permissão); cliente, pacote e maquininhas da MESMA empresa.
--    - 'agora': vendas (observacao 'Pacote', id = venda_id) + 1 pacote_clientes por unidade
--      (valor_pago = líquido rateado em centavos, venda_id ligado, cobranca 'paga') + pagamentos
--      (mesma regra da registrar_venda_avulsa_v2: total coberto, troco permitido, taxa e maquininha).
--    - 'comanda': 1 pacote_clientes por unidade com cobranca 'pendente', valor_pago = valor combinado
--      (líquido rateado), venda_id nulo; nada de vendas/pagamentos (entra ao fechar a comanda).
--    O 1º pacote_clientes recebe id = venda_id nos dois modos: é ele que a nova tentativa encontra
--    (a policy de SELECT de pacote_clientes vale para todo membro; a de vendas, não).
--
-- 3) fechar_comanda — corpo da 093 inteiro, com UMA mudança: o item `pacote` pode trazer
--    `pacote_cliente_id` (pacote "a cobrar"). Nesse caso NÃO cria outro pacote_clientes: o existente
--    (mesma empresa, mesma cliente, cobranca 'pendente', quantidade 1) passa a 'paga', com
--    valor_pago = líquido do rateio e venda_id = a venda dos pacotes da comanda. O valor entra nessa
--    venda e no rateio do desconto como qualquer item. Cobrar um pacote já vendido não exige
--    pacotes.vender (a venda foi decidida antes); só comanda.fechar, como o resto da comanda.
--    O pacote novo (sem pacote_cliente_id) passa a gravar venda_id. A venda dos pacotes da comanda é
--    gravada sempre que há item de pacote (antes só com total > 0): todo pacote cobrado tem venda.
--    editar_comanda NÃO muda: itens de pacote continuam congelados na edição (nem valor, nem
--    quantidade, nem incluir/remover — 090/093), então a cobrança do pacote nunca é refeita por ela;
--    `pacote_cliente_id` num item enviado à edição é ignorado.
--
-- 4) excluir_pacote_cliente(p_empresa, p_id) — security definer (precisa apagar a venda e os
--    pagamentos dela, que a RLS só deixa para gestora/dona, e conferir o uso pela tabela inteira).
--    Exige ser membro ativo (ou a dona) e pacotes.vender (ou gestora/dona). Recusa se houver sessão
--    usada ou se o pacote foi cobrado numa comanda (comanda_id, seção 7). Na mesma transação: desvincula os atendimentos, apaga o pacote e acerta a venda ligada
--    (só esse pacote → apaga venda, itens e pagamentos; outros pacotes → valor_total − valor_pago).
--
-- 5) excluir_servico(p_empresa, p_id) — security definer (o "nunca usado" precisa olhar a empresa
--    inteira; a RLS de agendamentos esconde os atendimentos de colegas). Exige servicos.gerenciar.
--    Recusa se o serviço aparece em atendimento, agendamento_servicos, item de comanda, pacote ou
--    pacote_uso — o CASCADE de pacote_servicos deixa de ser alcançável por esse caminho.
--
-- 6) Policies:
--    - pacote_clientes DELETE: "membro exclui" sai; delete direto só gestora/dona. As telas usam
--      excluir_pacote_cliente.
--    - pagamentos INSERT ("quem fecha insere", 093): o ramo de venda aceita também quem tem
--      pacotes.vender, só de dentro da vender_pacote (chave app.pacote_rpc, local à transação) e só
--      na venda "agora" (o 1º pacote_clientes dela tem id = venda_id) — vender_pacote é invoker.
--
-- 7) Guarda da cobrança (revisão): nenhum caminho cria ou deixa um pacote cobrado sem venda.
--    - pacote_clientes.comanda_id: a comanda que cobrou o pacote. excluir_pacote_cliente recusa esses
--      ("Este pacote foi cobrado numa comanda..."): a comanda manteria item e pagamentos.
--    - trigger trg_guarda_cobranca_pacote: pela API (authenticated/anon), INSERT em pacote_clientes e
--      mudança de cobranca/venda_id/comanda_id/valor_pago/empresa_id/pacote_id/cliente_id só de dentro
--      de vender_pacote e fechar_comanda (app.pacote_rpc); DELETE direto de pacote ligado a venda ou
--      comanda só por excluir_pacote_cliente (revisão final). O status continua livre. A tela antiga (insert direto) deixa
--      de vender pacote depois da 096, com mensagem e sem gravar nada: rode a 096 junto com o deploy.
--    - trigger trg_guarda_venda_de_pacote: venda ligada a pacote não é apagada direto.
--    - fechar_comanda: o valor do item "a cobrar" tem de ser o combinado na venda (valor_pago do
--      pendente); desconto só pelo desconto da comanda, que exige comanda.desconto.
--
-- Mensagens: todas em português; recusas de permissão com errcode 42501, as demais P0001
-- (shared/erros.ts#mensagemErroBanco mostra o texto como veio).
--
-- Rollback (os dados ficam):
--   drop trigger if exists trg_guarda_cobranca_pacote on public.pacote_clientes;
--   drop trigger if exists trg_guarda_venda_de_pacote on public.vendas;
--   drop function if exists public.guarda_cobranca_pacote();
--   drop function if exists public.guarda_venda_de_pacote();
--   drop function if exists public.vender_pacote(jsonb);
--   drop function if exists public.excluir_pacote_cliente(uuid, uuid);
--   drop function if exists public.excluir_servico(uuid, uuid);
--   fechar_comanda: rodar de novo a seção 3 da 093.
--   drop policy if exists "pacote_clientes: gestor exclui" on public.pacote_clientes;
--   create policy "pacote_clientes: membro exclui" on public.pacote_clientes for delete
--     using (empresa_id in (select minha_empresas()));
--   pagamentos: recriar "pagamentos: quem fecha insere" como na seção 8 da 093.
--   (as colunas cobranca/venda_id/comanda_id podem ficar; para tirar: alter table public.pacote_clientes
--    drop column if exists comanda_id, drop column if exists venda_id, drop column if exists cobranca;)
--   notify pgrst, 'reload schema';
-- ============================================================

-- ── 0. Pré-requisitos: 090 e 093 ──────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'agendamentos' and column_name = 'desconto_rateado')
     or to_regprocedure('public.ratear_desconto_centavos(bigint, bigint[])') is null
     or to_regprocedure('public.conferir_vinculos_empresa(uuid, uuid, uuid[], uuid[])') is null then
    raise exception 'Rode as migrations 090 e 093 antes da 096.';
  end if;
end $$;

-- ── 1. Colunas de pacote_clientes ─────────────────────────────
alter table public.pacote_clientes
  add column if not exists cobranca text not null default 'paga';
alter table public.pacote_clientes
  drop constraint if exists pacote_clientes_cobranca_check;
alter table public.pacote_clientes
  add constraint pacote_clientes_cobranca_check check (cobranca in ('paga', 'pendente'));
alter table public.pacote_clientes
  add column if not exists venda_id uuid references public.vendas(id) on delete set null;
-- Comanda que cobrou o pacote (novo pela comanda ou "a cobrar"). excluir_pacote_cliente recusa esses:
-- a comanda continuaria com o item e os pagamentos, e o faturamento (vendas) não bateria com ela.
alter table public.pacote_clientes
  add column if not exists comanda_id uuid references public.comandas(id) on delete set null;
create index if not exists idx_pacote_clientes_venda on public.pacote_clientes (venda_id) where venda_id is not null;
create index if not exists idx_pacote_clientes_pendentes on public.pacote_clientes (empresa_id, cliente_id)
  where cobranca = 'pendente';

-- ── 2. vender_pacote ──────────────────────────────────────────
create or replace function public.vender_pacote(p jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_chave     uuid;
  v_empresa   uuid;
  v_cliente   uuid;
  v_pacote    uuid;
  v_cobranca  text;
  v_qtd       numeric;
  v_q         int;
  v_unit      numeric;
  v_preco     numeric;
  v_desconto  numeric;
  v_subtotal  numeric;
  v_total     numeric;
  v_pago      numeric := 0;
  v_cortesia  numeric := 0;
  v_pags      jsonb;
  v_existente uuid;
  v_venda_exist uuid;
  v_validade  int;
  v_ativo     boolean;
  v_nome      text;
  v_hoje      date;
  v_liquido   bigint;
  v_val       numeric;
  v_txt       text;
  v_parc      int;
  v_taxa      numeric;
  v_erro      text;
  r           record;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados da venda do pacote inválidos.';
  end if;
  v_chave   := nullif(p->>'venda_id', '')::uuid;
  v_empresa := nullif(p->>'empresa_id', '')::uuid;
  v_cliente := nullif(p->>'cliente_id', '')::uuid;
  v_pacote  := nullif(p->>'pacote_id', '')::uuid;
  v_cobranca := p->>'cobranca';
  if v_chave is null then
    raise exception 'Venda sem identificador.';
  end if;
  if v_empresa is null or v_pacote is null or v_cobranca is null or v_cobranca not in ('agora', 'comanda') then
    raise exception 'Dados da venda do pacote inválidos.';
  end if;
  if v_cliente is null then
    raise exception 'Para vender pacote, escolha uma cliente cadastrada.';
  end if;

  if not tem_permissao(v_empresa, 'pacotes.vender') then
    raise exception 'Você não tem permissão para vender pacotes.' using errcode = '42501';
  end if;

  -- Idempotência: nova tentativa da mesma venda (queda de rede depois do commit). O 1º pacote da
  -- venda tem id = chave (pacote_clientes é visível a todo membro; vendas não).
  -- A mesma chave noutro modo de cobrança NÃO é a mesma venda: "agora" tem venda_id = chave; o
  -- pendente ("comanda") nunca tem (nulo, ou a venda da comanda que o cobrou depois).
  select empresa_id, venda_id into v_existente, v_venda_exist from public.pacote_clientes where id = v_chave;
  if found then
    if v_existente <> v_empresa then
      raise exception 'Esta venda pertence a outra empresa.';
    end if;
    if (v_cobranca = 'agora') <> (v_venda_exist is not distinct from v_chave) then
      raise exception 'Este código de venda já foi usado. Recarregue a tela e tente de novo.';
    end if;
    return;
  end if;

  -- Quantidade, valor e desconto -------------------------------
  v_qtd := (p->>'quantidade')::numeric;
  if v_qtd is null or v_qtd < 1 or v_qtd > 100 or v_qtd <> trunc(v_qtd) then
    raise exception 'Quantidade de pacotes inválida (de 1 a 100).';
  end if;
  v_q := v_qtd::int;
  v_unit := round((p->>'valor_unit')::numeric, 2);
  if v_unit is null or v_unit < 0 then
    raise exception 'Valor do pacote inválido.';
  end if;
  v_subtotal := round(v_unit * v_q, 2);
  v_desconto := round(coalesce((p->>'desconto')::numeric, 0), 2);
  if v_desconto < 0 then
    raise exception 'Desconto inválido.';
  end if;
  if v_desconto > v_subtotal then
    raise exception 'O desconto não pode ser maior que o subtotal.';
  end if;
  v_total := v_subtotal - v_desconto;

  -- Pacote do catálogo da empresa ------------------------------
  select pk.validade_dias, pk.ativo, pk.nome, pk.preco into v_validade, v_ativo, v_nome, v_preco
    from public.pacotes pk where pk.id = v_pacote and pk.empresa_id = v_empresa;
  if not found then
    raise exception 'Pacote não encontrado nesta empresa.';
  end if;
  if v_ativo is false then
    raise exception 'Pacote desativado: %. Ative no catálogo antes de vender.', coalesce(v_nome, 'sem nome');
  end if;

  -- Valor diferente do preço do catálogo (para baixo ou para cima, nos dois modos) é um desconto
  -- disfarçado: exige comanda.desconto, como o desconto em R$ e a cortesia com valor.
  if v_unit is distinct from round(v_preco, 2) and not tem_permissao(v_empresa, 'comanda.desconto') then
    raise exception 'Você não tem permissão para mudar o valor do pacote.' using errcode = '42501';
  end if;

  -- Pagamentos (mesma regra da registrar_venda_avulsa_v2) -------
  v_pags := coalesce(p->'pagamentos', '[]'::jsonb);
  if jsonb_typeof(v_pags) <> 'array' then
    raise exception 'Pagamento inválido.';
  end if;
  if v_cobranca = 'comanda' then
    if jsonb_array_length(v_pags) > 0 then
      raise exception 'Na cobrança pela comanda, o pagamento é lançado ao fechar a comanda.';
    end if;
  else
    if jsonb_array_length(v_pags) = 0 then
      raise exception 'Pagamento não informado.';
    end if;
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
      v_pago := v_pago + v_val;
      if v_txt = 'cortesia' then
        v_cortesia := v_cortesia + v_val;
      end if;
    end loop;
    if v_pago < v_total - 0.005 then
      raise exception 'O pagamento não cobre o total da venda.';
    end if;
  end if;

  -- Cliente e maquininhas da MESMA empresa (093).
  v_erro := public.conferir_vinculos_empresa(
    v_empresa,
    v_cliente,
    array(select nullif(x.j->>'maquininha_id', '')::uuid
            from jsonb_array_elements(v_pags) as x(j)
           where jsonb_typeof(x.j) = 'object' and x.j->>'metodo' in ('credito', 'debito')),
    null
  );
  if v_erro is not null then
    raise exception '%', v_erro;
  end if;

  -- Desconto e cortesia com valor: mesma permissão da comanda (a cortesia de R$ 0 passa).
  if (v_desconto > 0 or v_cortesia > 0) and not tem_permissao(v_empresa, 'comanda.desconto') then
    raise exception 'Você não tem permissão para dar desconto ou cortesia.' using errcode = '42501';
  end if;

  -- ── Gravação ───────────────────────────────────────────────
  -- Só dentro desta transação: libera a gravação em pacote_clientes (trigger de guarda) e o ramo de
  -- pagamentos de venda de pacote (policy). O cliente não consegue ligar esta chave por conta própria.
  perform set_config('app.pacote_rpc', 'on', true);
  v_hoje := (now() at time zone 'America/Sao_Paulo')::date;
  v_liquido := (v_total * 100)::bigint;

  if v_cobranca = 'agora' then
    begin
      insert into public.vendas (id, empresa_id, cliente_id, valor_total, desconto, observacao)
      values (v_chave, v_empresa, v_cliente, v_subtotal, v_desconto, 'Pacote');
    exception when unique_violation then
      -- Duas tentativas iguais ao mesmo tempo: a segunda espera a primeira e cai aqui.
      select empresa_id into v_existente from public.pacote_clientes where id = v_chave;
      if found and v_existente = v_empresa then
        return;
      end if;
      raise exception 'Este código de venda já foi usado. Recarregue a tela e tente de novo.';
    end;
  end if;

  -- 1 pacote_clientes por unidade. valor_pago = líquido dividido em centavos (o resto, 1 centavo
  -- cada, vai nas primeiras): a soma bate com vendas.valor_final.
  begin
    insert into public.pacote_clientes
      (id, empresa_id, pacote_id, cliente_id, data_inicio, data_validade, valor_pago, status, cobranca, venda_id)
    select case when u.n = 1 then v_chave else gen_random_uuid() end,
           v_empresa, v_pacote, v_cliente, v_hoje,
           case when v_validade is not null then v_hoje + v_validade end,
           ((v_liquido / v_q) + case when u.n <= v_liquido % v_q then 1 else 0 end)::numeric / 100,
           'ativo',
           case when v_cobranca = 'agora' then 'paga' else 'pendente' end,
           case when v_cobranca = 'agora' then v_chave end
      from generate_series(1, v_q) as u(n)
     order by u.n;
  exception when unique_violation then
    -- Em "agora" a repetição verdadeira já caiu na venda acima: aqui seria uma chave usada por um
    -- pendente ao mesmo tempo — devolver sucesso deixaria a venda gravada sem pacote.
    select empresa_id into v_existente from public.pacote_clientes where id = v_chave;
    if found and v_existente = v_empresa and v_cobranca = 'comanda' then
      return;
    end if;
    raise exception 'Este código de venda já foi usado. Recarregue a tela e tente de novo.';
  end;

  if v_cobranca = 'agora' then
    insert into public.pagamentos
      (empresa_id, venda_id, valor, metodo, bandeira, parcelas, taxa_perc, valor_liquido, maquininha_id, status)
    select v_empresa, v_chave, n.valor, n.metodo::pagamento_metodo, n.bandeira, n.parcelas, n.taxa_perc,
           case when n.taxa_perc is not null then round(n.valor * (1 - n.taxa_perc), 2) end,
           n.maquininha_id, 'pago'
      from (
        select round((x.j->>'valor')::numeric, 2) as valor,
               x.j->>'metodo' as metodo,
               case when x.j->>'metodo' in ('credito', 'debito') then nullif(btrim(x.j->>'bandeira'), '') end as bandeira,
               case when x.j->>'metodo' = 'credito' then coalesce((x.j->>'parcelas')::int, 1) else 1 end as parcelas,
               case when x.j->>'metodo' in ('credito', 'debito') then (x.j->>'taxa_perc')::numeric end as taxa_perc,
               case when x.j->>'metodo' in ('credito', 'debito') then nullif(x.j->>'maquininha_id', '')::uuid end as maquininha_id,
               x.ord
          from jsonb_array_elements(v_pags) with ordinality as x(j, ord)
      ) as n
     order by n.ord;
  end if;
end;
$$;

revoke all on function public.vender_pacote(jsonb) from public, anon;
grant execute on function public.vender_pacote(jsonb) to authenticated;

-- ── 3. excluir_pacote_cliente ─────────────────────────────────
create or replace function public.excluir_pacote_cliente(p_empresa uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda   uuid;
  v_valor   numeric;
  v_comanda uuid;
  v_rows    int;
begin
  if auth.uid() is null or p_empresa is null or not (p_empresa in (select minha_empresas())) then
    raise exception 'Você não faz parte desta empresa.' using errcode = '42501';
  end if;
  if not (tem_permissao(p_empresa, 'pacotes.vender') or is_gestor_ou_owner(p_empresa)) then
    raise exception 'Você não tem permissão para excluir pacote vendido.' using errcode = '42501';
  end if;

  select pc.venda_id, coalesce(pc.valor_pago, 0), pc.comanda_id into v_venda, v_valor, v_comanda
    from public.pacote_clientes pc
   where pc.id = p_id and pc.empresa_id = p_empresa
   for update;
  if not found then
    raise exception 'Pacote vendido não encontrado.';
  end if;
  -- Cobrado numa comanda (novo ou "a cobrar"): a comanda mantém o item e os pagamentos, e a edição da
  -- comanda não tira pacotes (090/093). Apagar daqui deixaria o faturamento diferente da comanda.
  if v_comanda is not null then
    raise exception 'Este pacote foi cobrado numa comanda e não pode ser excluído aqui. Para cancelar, fale com a dona.';
  end if;
  if exists (select 1 from public.pacote_uso pu where pu.pacote_cliente_id = p_id) then
    raise exception 'Este pacote já tem sessões usadas. Para cancelar, fale com a dona.';
  end if;

  -- Atendimentos ligados ao pacote voltam a ser atendimentos comuns (a FK não tem cascata).
  update public.agendamentos set pacote_cliente_id = null
   where pacote_cliente_id = p_id and empresa_id = p_empresa;

  delete from public.pacote_clientes where id = p_id and empresa_id = p_empresa;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Não foi possível excluir o pacote vendido.';
  end if;

  -- Venda ligada ("agora", a de comanda foi recusada acima): só este pacote → sai inteira (pagamentos
  -- e itens juntos); com outros pacotes → o valor_total cai pelo valor deste (o desconto da venda já
  -- está rateado no valor_pago de cada um). Os pagamentos dessa venda ficam (o dinheiro entrou; a
  -- devolução de uma unidade é manual) — o faturamento segue vendas.valor_final.
  if v_venda is not null then
    if exists (select 1 from public.pacote_clientes pc where pc.venda_id = v_venda) then
      update public.vendas
         set valor_total = greatest(valor_total - v_valor, desconto)
       where id = v_venda and empresa_id = p_empresa;
    else
      delete from public.pagamentos where venda_id = v_venda and empresa_id = p_empresa;
      delete from public.venda_itens where venda_id = v_venda and empresa_id = p_empresa;
      delete from public.vendas where id = v_venda and empresa_id = p_empresa;
    end if;
  end if;
end;
$$;

revoke all on function public.excluir_pacote_cliente(uuid, uuid) from public, anon;
grant execute on function public.excluir_pacote_cliente(uuid, uuid) to authenticated;

-- ── 4. excluir_servico ────────────────────────────────────────
create or replace function public.excluir_servico(p_empresa uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if auth.uid() is null or p_empresa is null or not (p_empresa in (select minha_empresas())) then
    raise exception 'Você não faz parte desta empresa.' using errcode = '42501';
  end if;
  if not tem_permissao(p_empresa, 'servicos.gerenciar') then
    raise exception 'Você não tem permissão para excluir serviços.' using errcode = '42501';
  end if;

  perform 1 from public.servicos s where s.id = p_id and s.empresa_id = p_empresa for update;
  if not found then
    raise exception 'Serviço não encontrado.';
  end if;

  if exists (select 1 from public.agendamentos a where a.servico_id = p_id)
     or exists (select 1 from public.agendamento_servicos x where x.servico_id = p_id)
     or exists (select 1 from public.comanda_itens ci where ci.servico_id = p_id)
     or exists (select 1 from public.pacote_servicos ps where ps.servico_id = p_id)
     or exists (select 1 from public.pacote_uso pu where pu.servico_id = p_id) then
    raise exception 'Este serviço já foi usado. Desative em vez de excluir.';
  end if;

  -- Insumos (servico_produtos) saem por cascata.
  delete from public.servicos where id = p_id and empresa_id = p_empresa;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Não foi possível excluir o serviço.';
  end if;
end;
$$;

revoke all on function public.excluir_servico(uuid, uuid) from public, anon;
grant execute on function public.excluir_servico(uuid, uuid) to authenticated;

-- ── 5. Policies ───────────────────────────────────────────────
drop policy if exists "pacote_clientes: membro exclui" on public.pacote_clientes;
drop policy if exists "pacote_clientes: gestor exclui" on public.pacote_clientes;
create policy "pacote_clientes: gestor exclui" on public.pacote_clientes for delete
  using (is_gestor_ou_owner(empresa_id));

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
    -- 096: venda de pacote "agora" por quem tem pacotes.vender, SÓ de dentro da vender_pacote (chave
    -- app.pacote_rpc, local à transação) e SÓ na venda "agora" daquela empresa (o 1º pacote dela tem
    -- id = venda_id; a venda dos pacotes da comanda não tem). Confere pelo pacote_clientes (visível a
    -- todo membro): a policy de SELECT de vendas não vale para quem só tem pacotes.vender.
    or (venda_id is not null
        and coalesce(current_setting('app.pacote_rpc', true), '') = 'on'
        and tem_permissao(empresa_id, 'pacotes.vender')
        and exists (select 1 from public.pacote_clientes pc
                     where pc.id = pagamentos.venda_id
                       and pc.venda_id = pagamentos.venda_id
                       and pc.empresa_id = pagamentos.empresa_id))
  )
);

-- Guarda da cobrança (revisão da 096): nenhum caminho cria ou deixa um pacote cobrado sem venda.
-- - pacote_clientes: escrita direta pela API (papéis authenticated/anon) não insere pacote, não apaga
--   pacote ligado a venda ou comanda e não muda cobranca, venda_id, comanda_id, valor_pago, empresa_id,
--   pacote_id ou cliente_id — só vender_pacote e fechar_comanda
--   (que ligam app.pacote_rpc) e funções security definer (current_user = dona da função). O status
--   continua livre (Pacotes marca "concluído"). SQL Editor/suporte (postgres) não passa por aqui.
--   Efeito no deploy: a tela ANTIGA (insert direto) deixa de vender pacote depois da 096, com esta
--   mensagem e sem gravar nada — rode a 096 junto com o deploy.
create or replace function public.guarda_cobranca_pacote()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon')
     or coalesce(current_setting('app.pacote_rpc', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Pacote vendido só é gravado pela venda de pacote. Recarregue a tela e tente de novo.';
  end if;
  -- Revisão final: o DELETE direto (a policy deixa a gestora/dona) de um pacote ligado a uma venda ou
  -- comanda deixaria a venda no faturamento sem o pacote. Esses saem só por excluir_pacote_cliente
  -- (definer: não cai aqui). Pendente e antigo (sem venda nem comanda) continuam saindo direto.
  if tg_op = 'DELETE' then
    if old.venda_id is not null or old.comanda_id is not null then
      raise exception 'Pacote vendido só é excluído em Pacotes (a venda dele sai junto). Recarregue a tela e tente de novo.';
    end if;
    return old;
  end if;
  -- pacote_id e cliente_id também: trocar o pacote (por um mais caro) ou a cliente de um pacote já
  -- vendido ou combinado mudaria o que foi cobrado sem passar pela venda.
  if new.cobranca is distinct from old.cobranca or new.venda_id is distinct from old.venda_id
     or new.comanda_id is distinct from old.comanda_id or new.valor_pago is distinct from old.valor_pago
     or new.empresa_id is distinct from old.empresa_id or new.pacote_id is distinct from old.pacote_id
     or new.cliente_id is distinct from old.cliente_id then
    raise exception 'A cobrança do pacote vendido só muda pela venda ou pela comanda.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guarda_cobranca_pacote on public.pacote_clientes;
create trigger trg_guarda_cobranca_pacote
  before insert or update or delete on public.pacote_clientes
  for each row execute function public.guarda_cobranca_pacote();

-- - vendas: a venda ligada a um pacote não é apagada direto (a policy de DELETE da 086 deixa quem tem
--   vendas.acessar apagar venda sem itens recente — a de pacote não tem venda_itens; a gestora apaga
--   qualquer uma). O pacote ficaria cobrado sem venda. excluir_pacote_cliente apaga a venda só depois
--   de tirar o último pacote dela, então não cai aqui. security definer: enxerga a tabela inteira.
create or replace function public.guarda_venda_de_pacote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.pacote_clientes pc where pc.venda_id = old.id) then
    raise exception 'Esta venda é de pacote e não pode ser apagada aqui. Para desfazer, exclua o pacote vendido em Pacotes.';
  end if;
  return old;
end;
$$;

revoke all on function public.guarda_cobranca_pacote() from public, anon, authenticated;
revoke all on function public.guarda_venda_de_pacote() from public, anon, authenticated;

drop trigger if exists trg_guarda_venda_de_pacote on public.vendas;
create trigger trg_guarda_venda_de_pacote
  before delete on public.vendas
  for each row execute function public.guarda_venda_de_pacote();

-- ── 6. fechar_comanda (corpo da 093 + pacote "a cobrar") ──────
-- Igual à 093, com o item `pacote` + `pacote_cliente_id` (marcado "096" abaixo).
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
  v_tem_pacote_novo boolean := false;  -- 096: pacote vendido agora (sem pacote_cliente_id)
  v_pc_emp       uuid;
  v_pc_cli       uuid;
  v_pc_pac       uuid;
  v_pc_cob       text;
  v_pc_st        text;
  v_pc_valor     numeric;
  v_venda_pac    uuid;
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
  i_pc      uuid[]    := '{}';  -- 096: pacote_clientes "a cobrar" do item (null = pacote novo)
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
    i_pc[v_m]      := case when v_tipo = 'pacote'  then nullif(r.j->>'pacote_cliente_id', '')::uuid end;

    if v_tipo = 'produto' then
      if i_produto[v_m] is null then
        raise exception 'Item da comanda inválido.';
      end if;
      if not exists (select 1 from public.produtos pr where pr.id = i_produto[v_m] and pr.empresa_id = v_empresa) then
        raise exception 'Produto não encontrado: %.', v_txt;
      end if;
      v_tem_produto := true;
      v_tot_produtos := v_tot_produtos + round(v_val * v_qtd, 2);
    elsif v_tipo = 'pacote' and i_pc[v_m] is not null then
      -- 096: pacote "a cobrar" (vendido com "Cobrar na comanda"). Nada de pacote novo: o existente
      -- é cobrado nesta comanda. Trava a linha: duas comandas não cobram o mesmo pacote.
      if i_pc[v_m] = any(i_pc[1:v_m - 1]) then
        raise exception 'Pacote a cobrar repetido na comanda.';
      end if;
      if v_qtd <> 1 then
        raise exception 'Pacote a cobrar entra na comanda com quantidade 1.';
      end if;
      v_pc_emp := null;
      select pc.empresa_id, pc.cliente_id, pc.pacote_id, pc.cobranca, pc.status, pc.valor_pago
        into v_pc_emp, v_pc_cli, v_pc_pac, v_pc_cob, v_pc_st, v_pc_valor
        from public.pacote_clientes pc where pc.id = i_pc[v_m]
         for update;
      if v_pc_emp is null or v_pc_emp <> v_empresa then
        raise exception 'Pacote a cobrar não encontrado: %.', v_txt;
      end if;
      if v_cliente is null or v_pc_cli <> v_cliente then
        raise exception 'Este pacote a cobrar é de outra cliente: %.', v_txt;
      end if;
      if v_pc_cob <> 'pendente' then
        raise exception 'Este pacote já foi cobrado: %. Tire o item da comanda.', v_txt;
      end if;
      if v_pc_st = 'cancelado' then
        raise exception 'Este pacote foi cancelado: %. Tire o item da comanda.', v_txt;
      end if;
      -- O valor é o combinado na venda (por quem tinha pacotes.vender e, com desconto, comanda.desconto).
      -- Baixá-lo aqui seria desconto sem a permissão: desconto só pelo desconto da comanda (rateado).
      if v_val <> round(coalesce(v_pc_valor, 0), 2) then
        raise exception 'O valor do pacote a cobrar não pode ser alterado: %. Para dar desconto, use o desconto da comanda.', v_txt;
      end if;
      i_pacote[v_m] := v_pc_pac;
      v_tem_pacote := true;
      v_tot_pacotes := v_tot_pacotes + round(v_val * v_qtd, 2);
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
      v_tem_pacote_novo := true;
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
    -- 096: cobrar um pacote "a cobrar" não é vender: só o pacote novo exige pacotes.vender.
    if v_tem_pacote_novo and not tem_permissao(v_empresa, 'pacotes.vender') then
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

  -- (5) Pacotes: venda com o desconto rateado deles (096: sempre que há item de pacote, mesmo R$ 0,
  --     para todo pacote cobrado ter venda_id); depois os pacotes, ligados a ela.
  --     Novo: um pacote_clientes por unidade. valor_pago = o que a cliente pagou de fato por unidade:
  --     (valor × qtd − cota do desconto) do item, dividido em centavos entre as unidades (o resto,
  --     1 centavo cada, vai nas primeiras) — a soma bate com vendas.valor_final dos pacotes
  --     (relatório de Pacotes = Financeiro).
  --     A cobrar (096): o pacote_clientes existente passa a 'paga', valor_pago = valor − cota.
  if v_tem_pacote then
    perform set_config('app.pacote_rpc', 'on', true);  -- libera a guarda de pacote_clientes (096)
    v_hoje := (now() at time zone 'America/Sao_Paulo')::date;
    v_venda_pac := gen_random_uuid();
    insert into public.vendas (id, empresa_id, cliente_id, valor_total, desconto, observacao)
    values (v_venda_pac, v_empresa, v_cliente, v_tot_pacotes, v_desc_pacotes, 'Pacote(s) via comanda');

    insert into public.pacote_clientes
      (empresa_id, pacote_id, cliente_id, data_inicio, data_validade, valor_pago, status, cobranca, venda_id, comanda_id)
    select v_empresa, i_pacote[g.ix], v_cliente, v_hoje,
           case when pk.validade_dias is not null then v_hoje + pk.validade_dias end,
           ((pl.liquido / pl.q) + case when u.n <= pl.liquido % pl.q then 1 else 0 end)::numeric / 100,
           'ativo', 'paga', v_venda_pac, v_comanda
      from generate_subscripts(i_id, 1) as g(ix)
      join public.pacotes pk on pk.id = i_pacote[g.ix]
      cross join lateral (
        select greatest(1, round(i_qtd[g.ix])::int) as q,
               (round(i_valor[g.ix] * i_qtd[g.ix], 2) * 100)::bigint - i_cota[g.ix] as liquido
      ) as pl
      cross join lateral generate_series(1, pl.q) as u(n)
     where i_tipo[g.ix] = 'pacote' and i_pc[g.ix] is null
     order by g.ix, u.n;

    for k in select g.ix from generate_subscripts(i_id, 1) as g(ix)
              where i_tipo[g.ix] = 'pacote' and i_pc[g.ix] is not null
              order by i_pc[g.ix]
    loop
      update public.pacote_clientes pc
         set cobranca = 'paga',
             valor_pago = ((round(i_valor[k] * i_qtd[k], 2) * 100)::bigint - i_cota[k])::numeric / 100,
             venda_id = v_venda_pac,
             comanda_id = v_comanda
       where pc.id = i_pc[k] and pc.empresa_id = v_empresa and pc.cobranca = 'pendente';
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception 'Não foi possível cobrar o pacote: %.', i_desc[k];
      end if;
    end loop;
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

notify pgrst, 'reload schema';
