-- Limpeza de comandas duplicadas/órfãs — rodar UMA vez no SQL Editor (não é migration).
-- Levantamento feito em 2026-09-29/30 direto no banco de produção.
--
-- Causa (corrigida no commit 7754720): depois de fechar a comanda, a tela ainda
-- mostrava o atendimento como "aberto", e fechar de novo criava uma 2ª comanda.
--
-- Tudo roda numa transação. Cada comando só apaga se a comanda AINDA estiver
-- órfã (nenhum agendamento aponta para ela) — se algo mudou desde o
-- levantamento, o comando simplesmente não afeta a linha.
--
-- Conferência ANTES (esperado: 15 linhas, as listadas abaixo + a 91769b50 que fica):
--   select c.id, c.created_at, c.valor_final from public.comandas c
--   where not exists (select 1 from public.agendamentos a where a.comanda_id = c.id)
--   order by c.created_at;

begin;

-- 1) 11 comandas vazias de 25/06/2026 (tentativas repetidas; sem itens, sem pagamento).
delete from public.comandas c
 where c.id in (
   '1ce44c5c-d100-4fa2-af00-2e7eb1260133','71e2bf11-156d-4e70-a1ae-bec7ced7bc9f',
   '198eb2b7-bf62-4717-b514-4a5f051b523f','080abf2f-16de-482f-a9c4-91c210fa4fb6',
   'e3b5ad98-5e95-41bc-af3d-95bcddfcc6f2','8d096674-4e80-48fa-bfcc-7f74d6288fcf',
   '65d82822-cafd-417c-b5a1-bd20d5eaf3a1','4b85b959-a373-4524-891f-6a525f6459ea',
   '33c14619-b72b-41b9-9fc4-1fe9c8a0aecd','8825de82-f7c9-42f4-b3d6-4b8d924f65eb',
   'f0543b95-6cdd-4cc6-9f9e-516b9a05ad74')
   and not exists (select 1 from public.agendamentos a where a.comanda_id = c.id)
   and not exists (select 1 from public.pagamentos p where p.comanda_id = c.id)
   and not exists (select 1 from public.comanda_itens i where i.comanda_id = c.id);

-- 2) 28/09 23:17 e 23:18 — os mesmos 2 atendimentos fechados 2x. As comandas que
--    valem são as 2ª (cb51650d R$40 e 1d420a4f R$0), vinculadas aos agendamentos.
--    Apaga as 1ªs (909c3270 R$40 dinheiro — pagamento duplicado; d4d79df2 R$0).
delete from public.pagamentos p
 where p.comanda_id in ('909c3270-d408-4193-ae24-016d0fb92adb','d4d79df2-651c-4663-b392-471ac2a6076c')
   and not exists (select 1 from public.agendamentos a where a.comanda_id = p.comanda_id);
delete from public.comandas c
 where c.id in ('909c3270-d408-4193-ae24-016d0fb92adb','d4d79df2-651c-4663-b392-471ac2a6076c')
   and not exists (select 1 from public.agendamentos a where a.comanda_id = c.id);

-- 3) 25/09 — cliente 08667acf: deveria ser só uma sessão do pacote comprado em 23/07
--    (confirmado pelo dono), mas a comanda vendeu o pacote DE NOVO: criou um 2º
--    pacote ativo (8f8fc727, sem nenhuma sessão usada) e uma venda de R$315 que
--    entrou no faturamento de setembro. Apaga venda, pacote duplicado e comanda.
delete from public.vendas v
 where v.id = 'fd36c64b-5069-4293-8dd1-49f8a8ecf1c3'
   and not exists (select 1 from public.venda_itens vi where vi.venda_id = v.id);
delete from public.pacote_clientes pc
 where pc.id = '8f8fc727-cd16-4b0f-87b9-1c7f9fe8a6cf'
   and not exists (select 1 from public.pacote_uso u where u.pacote_cliente_id = pc.id)
   and not exists (select 1 from public.agendamentos a where a.pacote_cliente_id = pc.id);
delete from public.pagamentos p
 where p.comanda_id = 'e5724812-223a-42c2-afff-a1218dee19e5'
   and not exists (select 1 from public.agendamentos a where a.comanda_id = p.comanda_id);
delete from public.comanda_itens i
 where i.comanda_id = 'e5724812-223a-42c2-afff-a1218dee19e5'
   and not exists (select 1 from public.agendamentos a where a.comanda_id = i.comanda_id);
delete from public.comandas c
 where c.id = 'e5724812-223a-42c2-afff-a1218dee19e5'
   and not exists (select 1 from public.agendamentos a where a.comanda_id = c.id);

-- 4) Atendimento de 22/07 (d07716e9) — a sessão 1 do pacote, já consumida e com
--    comissão paga, mas nunca vinculado a uma comanda (por isso aparecia como
--    "comanda aberta" desde julho). Vincula à comanda de 23/07 em que o pacote
--    foi vendido e pago (91769b50: pix 50 + crédito 265). Só muda comanda_id:
--    status já é 'concluido', então nenhum trigger de comissão/pacote dispara.
update public.agendamentos
   set comanda_id = '91769b50-46af-47dc-bd5b-dc789fad8564'
 where id = 'd07716e9-2dc1-4d16-b02d-1e93eae519e3'
   and comanda_id is null;

-- Conferência DEPOIS (esperado: 0 linhas nas duas):
select c.id from public.comandas c
 where not exists (select 1 from public.agendamentos a where a.comanda_id = c.id)
   and not exists (select 1 from public.comanda_itens i where i.comanda_id = c.id);
select id from public.agendamentos
 where comanda_id is null and status not in ('cancelado','faltou') and data_hora_fim < now() - interval '1 day';

commit;
