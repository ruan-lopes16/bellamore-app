-- Migration 028: notificação automática quando estoque atinge mínimo
-- Dispara após qualquer INSERT em estoque_movimentos (saída ou ajuste que zera estoque)

create or replace function notificar_estoque_baixo()
returns trigger as $$
declare
  v_estoque_atual  numeric;
  v_estoque_minimo numeric;
  v_nome           text;
  v_empresa_id     uuid;
  v_owner_id       uuid;
begin
  -- Buscar estado atual do produto
  select p.estoque_atual, p.estoque_minimo, p.nome, p.empresa_id
    into v_estoque_atual, v_estoque_minimo, v_nome, v_empresa_id
  from public.produtos p
  where p.id = NEW.produto_id;

  -- Só notifica em saída ou ajuste que deixou abaixo do mínimo
  if (NEW.tipo in ('saida', 'ajuste')) and (v_estoque_atual <= v_estoque_minimo) then
    -- Buscar owner da empresa para receber a notificação
    select owner_id into v_owner_id from public.empresas where id = v_empresa_id;

    if v_owner_id is not null then
      insert into public.notificacoes (user_id, empresa_id, tipo, titulo, mensagem)
      values (
        v_owner_id,
        v_empresa_id,
        'estoque_baixo',
        'Estoque baixo: ' || v_nome,
        'Restam ' || round(v_estoque_atual, 2) || ' unidades. Mínimo configurado: ' || round(v_estoque_minimo, 2) || '.'
      );
    end if;
  end if;

  return NEW;
end;
$$ language plpgsql security definer;

-- Remover trigger anterior se existir
drop trigger if exists trg_notif_estoque_baixo on public.estoque_movimentos;

create trigger trg_notif_estoque_baixo
  after insert on public.estoque_movimentos
  for each row execute function notificar_estoque_baixo();
