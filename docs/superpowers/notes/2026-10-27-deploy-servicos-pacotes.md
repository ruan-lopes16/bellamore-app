# Deploy — Paridade Serviços e Pacotes (migration 096)

Branch `feat/paridade-servicos-pacotes`. Migration única: `supabase/migrations/096_pacotes_venda_unica.sql`.
Rodar à mão no SQL Editor (https://supabase.com/dashboard/project/qpiepxolyqmoankeyeva/sql/new). Nunca `supabase db push`.
Ela é idempotente (pode rodar 2x) e se recusa a rodar sem a 090 e a 093 ("Rode as migrations 090 e 093 antes da 096.").

## Ordem recomendada: 096 ANTES do deploy, e o deploy logo em seguida

0. **Antes de tudo (somente leitura):** confirmar que as fases anteriores já estão no banco e anotar policies
   feitas à mão que a 096 não derruba.
   ```sql
   -- 090/093/094 aplicadas (3 linhas)
   select proname from pg_proc where proname in ('fechar_comanda', 'conferir_vinculos_empresa', 'fn_desfaz_conclusao_sem_comanda');
   -- policies atuais de pacote_clientes e pagamentos
   select tablename, policyname, cmd from pg_policies
    where schemaname = 'public' and tablename in ('pacote_clientes', 'pagamentos') order by 1, 3;
   -- esperado em pacote_clientes: "membro ve" (SELECT), "vender" (INSERT), "membro atualiza" (UPDATE),
   -- "membro exclui" (DELETE, a 096 troca por "gestor exclui"). Se aparecer outra (ex.: "membro gerencia"
   -- FOR ALL), anote o nome: ela continua valendo depois da 096 e precisa ser derrubada pelo nome exato.
   ```
1. **Rodar a 096.**
2. **Conferências** (abaixo, somente leitura).
3. **Merge e deploy do web** (Vercel **Ready**) logo depois.
4. **Pedir à equipe para fechar e abrir o PWA** (ou recarregar a página). Até recarregar, a tela antiga
   recusa vender pacote com "Pacote vendido só é gravado pela venda de pacote. Recarregue a tela e tente de
   novo." — sem gravar nada.
5. Teste com a equipe (abaixo).
6. App nativo: entra no próximo build (não publicado ainda).

**Por que a 096 antes:**
- **A tela antiga, com a 096, é recusada sem gravar nada.** A Agenda antiga (web e app) grava o pacote antes da
  venda: a 096 recusa o pacote e a tela para ali (nem a venda nem o agendamento são gravados). A venda pelo
  catálogo do web antigo — que gravava o pacote **sem** a venda (receita sumia do faturamento) — também para.
  A Comanda antiga funciona (a `fechar_comanda` da 096 aceita o mesmo JSON). A gestora/dona da tela antiga não
  consegue apagar direto um pacote ligado a uma venda (guarda da revisão final), então não sobra venda órfã.
- **A tela nova sem a 096 vende pelo caminho antigo**, e esse pacote fica sem `venda_id` (vira "pacote
  antigo"). Excluí-lo depois tira só o pacote: a venda dele continua no faturamento. Quanto menos tempo entre
  a 096 e o deploy, melhor; mas o deploy antes da 096 abre essa janela, a 096 antes não.
- O custo da ordem escolhida: entre a 096 e o recarregamento do PWA, ninguém vende pacote pela Agenda nem pelo
  catálogo (a tela pede para recarregar). Por isso o deploy vem logo em seguida.

**Ainda vale com a tela antiga aberta (até recarregar):** "Excluir venda" da tela antiga feito por quem não é
gestora/dona desvincula os atendimentos e não apaga o pacote (a policy de DELETE passou a ser só da
gestora/dona), mostrando "Venda excluída". Se alguém relatar isso, refazer a exclusão na tela nova.

## Conferências depois da 096 (somente leitura)

```sql
-- 1) Colunas novas (3 linhas) e backfill: todo pacote que já existia fica 'paga'
select column_name, data_type, is_nullable, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'pacote_clientes' and column_name in ('cobranca', 'venda_id', 'comanda_id');
-- cobranca text NO 'paga'::text; venda_id uuid YES; comanda_id uuid YES
select cobranca, count(*) from public.pacote_clientes group by 1;   -- só 'paga'

-- 2) Funções: invoker nas que gravam venda; definer nas exclusões e na guarda da venda; search_path fixo
select proname, prosecdef, proconfig from pg_proc
 where proname in ('vender_pacote', 'fechar_comanda', 'excluir_pacote_cliente', 'excluir_servico',
                   'guarda_cobranca_pacote', 'guarda_venda_de_pacote') order by 1;
-- excluir_pacote_cliente t, excluir_servico t, fechar_comanda f, guarda_cobranca_pacote f,
-- guarda_venda_de_pacote t, vender_pacote f; proconfig = {search_path=public} em todas

-- 3) Só quem está logado chama as funções novas
select f, has_function_privilege('anon', f, 'execute') anon, has_function_privilege('authenticated', f, 'execute') autenticado
  from unnest(array['public.vender_pacote(jsonb)', 'public.excluir_pacote_cliente(uuid, uuid)',
                    'public.excluir_servico(uuid, uuid)']) f;
-- anon false, autenticado true nas 3

-- 4) Triggers de guarda (2 linhas, habilitados 'O'); a de pacote_clientes cobre INSERT, UPDATE e DELETE
select tgrelid::regclass t, tgname, tgenabled, pg_get_triggerdef(oid) from pg_trigger
 where tgname in ('trg_guarda_cobranca_pacote', 'trg_guarda_venda_de_pacote');

-- 5) Policies
select tablename, policyname, cmd from pg_policies
 where schemaname = 'public' and tablename = 'pacote_clientes' order by cmd;
-- DELETE só "pacote_clientes: gestor exclui" (nenhuma "membro exclui")
select pg_get_expr(polwithcheck, polrelid) from pg_policy where polname = 'pagamentos: quem fecha insere';
-- contém app.pacote_rpc e pacotes.vender
```

## Teste com a equipe (depois do deploy)

1. **Pacotes → Vender, "Cobrar agora"** (PIX, R$ do catálogo): aparece em Vendidos e no Financeiro de hoje.
2. **Agenda → vender pacote "Cobrar na comanda"**: o pacote aparece "A cobrar" em Pacotes; na comanda da
   cliente entra o item "Pacote X — a cobrar"; fechar a comanda (com ou sem desconto) cobra uma vez, e o
   pacote vira pago.
3. **Excluir** um pacote "Cobrar agora" sem sessão usada: some de Vendidos e o valor sai do Financeiro.
4. **Serviços → Excluir** um serviço já usado: "Este serviço já foi usado. Desative em vez de excluir."

## Conferências de faturamento (somente leitura, depois de alguns dias)

Troque `'2026-10-27'` pela data em que a 096 rodou.

```sql
-- A) Nenhum pacote cobrado depois da 096 sem venda (esperado 0)
select count(*) from public.pacote_clientes
 where cobranca = 'paga' and venda_id is null and created_at >= timestamptz '2026-10-27 03:00:00+00';

-- B) Nenhuma venda de pacote depois da 096 sem pacote (esperado 0)
select count(*) from public.vendas v
 where v.observacao in ('Pacote', 'Pacote(s) via comanda') and v.created_at >= timestamptz '2026-10-27 03:00:00+00'
   and not exists (select 1 from public.pacote_clientes pc where pc.venda_id = v.id);

-- C) Relatório de Pacotes = Financeiro: para cada venda ligada a pacote, soma dos valor_pago = valor_final
--    (esperado 0 linhas)
select v.id, v.valor_final, sum(pc.valor_pago) pacotes
  from public.vendas v join public.pacote_clientes pc on pc.venda_id = v.id
 group by v.id, v.valor_final
having v.valor_final <> sum(pc.valor_pago);

-- D) Pacotes "a cobrar" em aberto (informativo: aparecem na próxima comanda da cliente)
select pc.id, pc.cliente_id, pc.valor_pago, pc.created_at from public.pacote_clientes pc
 where pc.cobranca = 'pendente' and pc.status <> 'cancelado' order by pc.created_at;
```

## Rollback

No cabeçalho da 096 (os dados ficam). Atenção: depois do rollback, os pacotes "a cobrar" (`cobranca =
'pendente'`) não têm mais como ser cobrados pela comanda; confira a consulta D antes e cobre-os por fora.
