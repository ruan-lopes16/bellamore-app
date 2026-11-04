# Deploy — Pendências de dinheiro e falhas silenciosas (migration 100)

Branch `feat/pendencias-dinheiro-falhas`. Migration única: `supabase/migrations/100_pendencias_dinheiro_falhas.sql`.
Rodar à mão no SQL Editor (https://supabase.com/dashboard/project/qpiepxolyqmoankeyeva/sql/new). Nunca `supabase db push`.
Ela é idempotente e se recusa a rodar sem a 096 ("Rode a 096 antes da 100.").

## Ordem: 100 ANTES do merge e do deploy

1. **Antes de rodar (somente leitura):** listar os atendimentos já concluídos com taxa de reserva retida,
   para o dono decidir sobre devoluções (a 100 não mexe neles).
   ```sql
   select c.nome as cliente, a.data_hora_inicio, t.valor as taxa, t.paga_em, a.comanda_id
     from public.taxas_reserva t
     join public.agendamentos a on a.id = t.agendamento_id
     left join public.clientes c on c.id = a.cliente_id
    where t.status = 'retida' and a.status = 'concluido'
    order by a.data_hora_inicio;
   ```
2. **Rodar a 100** no SQL Editor.
3. **Conferências (somente leitura):**
   ```sql
   -- 0 linhas: nenhuma taxa retida em atendimento agendado/confirmado (backfill)
   select count(*) from public.taxas_reserva t join public.agendamentos a on a.id = t.agendamento_id
    where t.status = 'retida' and a.status in ('agendado', 'confirmado');
   -- 5 linhas: prosecdef = true, exceto fn_trava_vinculo_comanda; search_path=public em todas (proconfig)
   select proname, prosecdef, proconfig from pg_proc where proname in
    ('reter_taxa_reserva', 'fn_registrar_uso_pacote', 'excluir_pacote_cliente', 'excluir_venda_pacotes',
     'fn_trava_vinculo_comanda');
   -- 3 linhas: os triggers de agendamentos
   select tgname from pg_trigger where tgrelid = 'public.agendamentos'::regclass
    and tgname in ('trg_reter_taxa_reserva', 'trg_uso_pacote', 'trg_trava_vinculo_comanda');
   ```
4. **Merge e deploy do web** (esperar a Vercel ficar **Ready**).
5. **Recarregar o PWA** (pedir à equipe para fechar e abrir o app instalado ou recarregar a página).

## App nativo

Sem dependência nativa nova nesta fase. O build nativo novo já pendente das fases anteriores continua valendo.

## Sem a 100

O botão "Excluir a venda inteira" mostra a mensagem de migration ("Atualize o sistema: falta a migration 100.").
O resto das telas funciona.

## Rollback

Ver o cabeçalho da `100_pendencias_dinheiro_falhas.sql`.
