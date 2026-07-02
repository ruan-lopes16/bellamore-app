-- Permite excluir pacotes do catalogo (nao havia policy de DELETE)
-- e possibilita pacotes vendidos sem data de validade fixa
-- (quando o pacote de origem nao tem validade_dias definido).

do $$ begin
  create policy "pacotes: membro exclui"
    on public.pacotes
    for delete
    using (empresa_id in (select minha_empresas()));
exception when duplicate_object then null; end $$;

alter table public.pacote_clientes
  alter column data_validade drop not null;
