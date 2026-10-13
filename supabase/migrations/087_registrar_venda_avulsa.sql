-- ============================================================
-- MIGRATION 087 — Venda avulsa gravada tudo ou nada
-- Spec: docs/superpowers/specs/2026-10-13-vendas-tudo-ou-nada-design.md
--
-- Antes: shared/venda.ts gravava vendas → venda_itens → estoque_movimentos → pagamentos
-- em 4 chamadas. Falha no meio deixava venda sem itens, sem baixa de estoque ou sem
-- pagamento (contando no faturamento). E duas vendas do último item ao mesmo tempo
-- deixavam o saldo negativo.
--
-- Agora: uma função, uma transação. Qualquer erro desfaz tudo.
--  - SECURITY INVOKER: as policies de sempre valem (vendas, venda_itens, estoque_movimentos,
--    pagamentos). Checagem explícita de vendas.acessar para a mensagem ficar clara.
--  - Desconto ou cortesia com valor exigem comanda.desconto (mesma regra da tela).
--  - valor_total calculado aqui pela soma dos itens (nunca vem da tela).
--  - Estoque: pg_advisory_xact_lock por produto (em ordem de id, sem deadlock) e conferência
--    do saldo. Não usa SELECT ... FOR UPDATE: exigiria a policy de UPDATE de produtos
--    (estoque.acessar), que quem só tem vendas.acessar não tem.
--  - Id da venda gerado aqui (sem RETURNING, que exigiria a policy de SELECT).
--  - A baixa do saldo continua no trigger atualizar_estoque (saida).
--  Requer a 086 (pagamentos.maquininha_id).
--
-- Rollback:
--   drop function if exists public.registrar_venda_avulsa(uuid, uuid, numeric, jsonb, jsonb);
--   notify pgrst, 'reload schema';
-- ============================================================

create or replace function public.registrar_venda_avulsa(
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
  v_venda    uuid;
  v_total    numeric(10,2);
  v_desconto numeric(10,2) := round(coalesce(p_desconto, 0), 2);
  v_pago     numeric(10,2);
  v_nome     text;
  v_saldo    numeric;
  r          record;
begin
  if not tem_permissao(p_empresa, 'vendas.acessar') then
    raise exception 'Você não tem permissão para registrar vendas avulsas.' using errcode = '42501';
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

  if v_desconto < 0 or v_desconto > v_total then
    raise exception 'O desconto não pode ser maior que o subtotal';
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

  -- Estoque: trava por produto e confere o saldo
  for r in
    select i.produto_id, sum(i.quantidade) as qtd
      from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade numeric)
     group by i.produto_id
     order by i.produto_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('venda_estoque:' || r.produto_id::text, 0));
    select pr.nome, pr.estoque_atual into v_nome, v_saldo
      from public.produtos pr
     where pr.id = r.produto_id and pr.empresa_id = p_empresa and pr.tipo = 'venda' and pr.ativo;
    if not found then
      raise exception 'Produto indisponível para venda.';
    end if;
    if coalesce(v_saldo, 0) < r.qtd then
      raise exception 'Estoque insuficiente: % (restam %)', v_nome, trim_scale(coalesce(v_saldo, 0));
    end if;
  end loop;

  -- Gravação
  v_venda := gen_random_uuid();

  insert into public.vendas (id, empresa_id, cliente_id, valor_total, desconto)
  values (v_venda, p_empresa, p_cliente, v_total, v_desconto);

  insert into public.venda_itens (empresa_id, venda_id, produto_id, quantidade, preco_unitario)
  select p_empresa, v_venda, i.produto_id, i.quantidade, round(i.preco_unitario, 2)
    from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade numeric, preco_unitario numeric);

  insert into public.estoque_movimentos (empresa_id, produto_id, tipo, quantidade, motivo)
  select p_empresa, i.produto_id, 'saida', i.quantidade, 'Venda avulsa'
    from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade numeric);

  insert into public.pagamentos
    (empresa_id, venda_id, valor, metodo, bandeira, parcelas, taxa_perc, valor_liquido, maquininha_id, status)
  select p_empresa, v_venda, round(p.valor, 2), p.metodo::pagamento_metodo, p.bandeira, coalesce(p.parcelas, 1),
         p.taxa_perc, p.valor_liquido, p.maquininha_id, 'pago'
    from jsonb_to_recordset(p_pagamentos) as p(
      valor numeric, metodo text, bandeira text, parcelas integer,
      taxa_perc numeric, valor_liquido numeric, maquininha_id uuid
    );

  return v_venda;
end;
$$;

revoke all on function public.registrar_venda_avulsa(uuid, uuid, numeric, jsonb, jsonb) from public, anon;
grant execute on function public.registrar_venda_avulsa(uuid, uuid, numeric, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
