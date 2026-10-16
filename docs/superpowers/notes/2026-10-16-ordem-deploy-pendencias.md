# Ordem de deploy — branch `feat/pendencias-registradas` (Entregas 1 a 4)

**Data:** 2026-10-16. **Banco de partida:** produção na 089 (`qpiepxolyqmoankeyeva`).

**Migrations da branch:**
- 090: comanda e venda "tudo ou nada";
- 091: taxa de cancelamento por atendimento;
- 092: convite com aceite e histórico da equipe;
- 093: alinhamentos finais.

Todas são aplicadas à mão no SQL Editor (https://supabase.com/dashboard/project/qpiepxolyqmoankeyeva/sql/new).
**Nunca use `supabase db push`.** As consultas abaixo são todas somente leitura.

A sequência 090 → 091 → 092 → 093 roda em PGlite numa fixture só (`web/tests/unit/cadeia-090-093-pglite.test.ts`). O teste cobre quatro pontos:
- nenhuma recriação desfaz a anterior;
- não sobra nenhuma policy ampla;
- os fluxos com as chaves padrão passam;
- a 093 se recusa a rodar sem a 090.

## Resumo da ordem

| Passo | O quê | Por quê |
|---|---|---|
| 0 | Conferência inicial | Confirmar que o banco está na 089 e sem nenhuma das 4 |
| 1 | **091** | Livre. Telas antigas e novas funcionam com ou sem ela (a coluna nova tem default `true`) |
| 2 | **092** | **Antes** do deploy. Sem ela, o código novo responde 503 ao convidar conta existente. O código em produção (rotas com service role) segue funcionando com ela |
| 3 | Merge e deploy do web (Vercel **Ready**) | O JS desta branch funciona sem a 090 e sem a 093 (cai no caminho em passos) |
| 4 | Esperar os PWAs atualizarem (1 dia, ou pedir para fechar e abrir o app) | JS antigo que edita comanda fechada pela 090 grava `comandas.desconto` sem refazer o rateio (`desconto_rateado` velho na receita e na comissão) |
| 5 | **090** | Depois do passo 4 |
| 6 | **093** | **Logo depois da 090**, na mesma sessão se quiser. Ela se recusa a rodar sem a 090 ("Rode a migration 090 antes da 093.") |
| 7 | App nativo: `cd mobile && npx expo install expo-crypto` e build nativo novo | `expo-crypto ~13.0.2` (SDK 51) é módulo nativo: atualização OTA ou binário antigo não o têm |
| 8 | Conferências de uso | Ver no fim |

### O que acontece se a ordem sair diferente

- **Web desta branch no ar sem a 092:** convidar uma conta que já existe responde 503 ("peça para rodar a migration 092"). Conta nova funciona. Equipe esconde "Convites pendentes" e "Histórico". Nada é vinculado sem aceite.
- **Web desta branch no ar sem a 093** (com ou sem a 090): tudo funciona. Continuam valendo as regras antigas:
  - as policies amplas de produção;
  - a desativada mantém acesso às comandas que fechou;
  - as funções sem conferência de empresa;
  - cartão com 0% gravado como `null` quando a comanda fecha pela função.
- **093 antes da 090:** é recusada no início e não cria nada. Sem essa trava, ela criaria `fechar_comanda` sem as colunas da 090, e o web passaria a falhar em todo fechamento.
- **090 com PWA de JS antigo ainda aberto:** é o risco do passo 4. O fechamento novo pelo JS antigo funciona, mas a edição de comanda fechada pela 090 deixa o rateio velho.
- **091 a qualquer momento:** sem efeito em tela antiga. O "Dispensar" das telas novas só aparece com ela.

## Passo 0: conferência inicial

```sql
-- 089 aplicada (comanda_pertence inclui quem fechou):
select position('c.profissional_id = auth.uid()' in prosrc) > 0 as tem_089
  from pg_proc where proname = 'comanda_pertence_ao_profissional';                       -- true
-- Nenhuma das 4 ainda:
select
  (select count(*) from information_schema.columns where table_schema = 'public'
     and table_name = 'agendamentos' and column_name in ('desconto_rateado', 'cobrar_taxa_cancelamento')) as colunas_090_091, -- 0
  to_regclass('public.convites_equipe') as tabela_092,                                   -- null
  to_regprocedure('public.conferir_vinculos_empresa(uuid, uuid, uuid[], uuid[])') as funcao_093; -- null
-- Policies que a 093 vai substituir (estado de 2026-10-15):
select tablename, policyname, cmd from pg_policies
 where schemaname = 'public' and tablename in ('vendas', 'venda_itens', 'pacote_uso', 'pagamentos', 'comanda_itens', 'comandas')
 order by 1, 3, 2;
```

Exporte o resultado da última consulta. Ele serve de rollback de referência.

## Passo 1: 091

```sql
select data_type, column_default, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'agendamentos' and column_name = 'cobrar_taxa_cancelamento';
                                                                -- boolean | true | NO
select tgname from pg_trigger
 where tgrelid = 'public.agendamentos'::regclass
   and tgname in ('trg_gerar_taxa_cancelamento', 'trg_resetar_cobrar_taxa_cancelamento') order by 1;  -- 2 linhas
select prosecdef, position('cobrar_taxa_cancelamento' in prosrc) > 0 as le_coluna
  from pg_proc where proname = 'gerar_taxa_cancelamento';       -- true | true
```

## Passo 2: 092

```sql
select to_regclass('public.convites_equipe') is not null as convites,
       to_regclass('public.equipe_historico') is not null as historico;              -- true | true
select count(*) from pg_policies
 where schemaname = 'public' and tablename = 'empresa_membros' and cmd = 'INSERT';     -- 0
select proname, prosecdef from pg_proc
 where proname in ('aceitar_convite', 'recusar_convite', 'cancelar_convite', 'meus_convites', 'listar_historico_equipe')
 order by 1;                                                                            -- 5 linhas, todas true
select has_table_privilege('authenticated', 'public.convites_equipe', 'INSERT') as insere_direto,
       has_function_privilege('anon', 'public.aceitar_convite(uuid)', 'EXECUTE') as anon_aceita;  -- false | false
select tgname from pg_trigger
 where tgname in ('trg_equipe_historico_membro', 'trg_equipe_historico_convite') order by 1;     -- 2 linhas
```

## Passo 3: deploy

1. Faça o merge do PR. Só com o "pode mergear" do dono.
2. Espere a Vercel ficar **Ready**.
3. Abra Comanda, Vendas, Financeiro, Relatórios e Equipe uma vez.

## Passo 5: 090

```sql
select table_name, column_name from information_schema.columns
 where table_schema = 'public'
   and ((column_name = 'desconto_rateado' and table_name in ('agendamentos', 'agendamento_servicos', 'comanda_itens'))
        or (table_name = 'estoque_movimentos' and column_name = 'comanda_id'))
 order by 1;                                                                            -- 4 linhas
select proname, prosecdef from pg_proc
 where proname in ('fechar_comanda', 'editar_comanda', 'registrar_venda_avulsa_v2', 'ratear_desconto_centavos')
 order by 1;                                       -- 4 linhas; fechar/editar/v2 = false (invoker)
select has_function_privilege('anon', 'public.fechar_comanda(jsonb)', 'EXECUTE') as anon_fecha;   -- false
select count(*) from pg_policies where schemaname = 'public' and tablename = 'comissoes' and cmd = 'INSERT';  -- 0
select position('comanda_pertence_ao_profissional' in with_check) > 0 as ramo_comanda
  from pg_policies where tablename = 'estoque_movimentos' and policyname = 'estoque_movimentos: gestor pode inserir';  -- true
```

## Passo 6: 093

```sql
select to_regprocedure('public.conferir_vinculos_empresa(uuid, uuid, uuid[], uuid[])') is not null as helper,
       (select prosecdef from pg_proc where proname = 'conferir_vinculos_empresa') as definer,
       has_function_privilege('anon', 'public.conferir_vinculos_empresa(uuid, uuid, uuid[], uuid[])', 'EXECUTE') as anon;
                                                                                        -- true | true | false
select position('m.ativo = true' in prosrc) > 0 as vinculo_ativo
  from pg_proc where proname = 'comanda_pertence_ao_profissional';                     -- true
select proname,
       position('conferir_vinculos_empresa' in prosrc) > 0 as confere_empresa,
       position('nullif((x.j->>''taxa_perc'')::numeric, 0)' in prosrc) = 0 as taxa_zero_grava_zero
  from pg_proc where proname in ('fechar_comanda', 'editar_comanda', 'registrar_venda_avulsa_v2') order by 1;
                                                                                        -- 3 linhas, true | true
select count(*) from pg_policies where schemaname = 'public' and policyname in
  ('vendas: membro gerencia', 'venda_itens: membro gerencia', 'pacote_uso: membro gerencia',
   'pagamentos: membro insere', 'comanda_itens: membro insere');                        -- 0
select count(*) from pg_policies
 where schemaname = 'public' and tablename = 'comandas' and qual like '%(profissional_id = auth.uid())%';  -- 0
select tablename, policyname, cmd from pg_policies
 where schemaname = 'public' and tablename in ('vendas', 'venda_itens', 'pacote_uso', 'pagamentos', 'comanda_itens')
 order by 1, 3, 2;
```

A última consulta deve listar **só** estas policies. Qualquer outra policy permissiva nessas tabelas reabre o acesso amplo. Derrube-a pelo nome exato, depois de conferir.

| Tabela | Policies esperadas |
|---|---|
| `comanda_itens` | `quem fecha insere` (INSERT), `profissional ou gestor ve` (SELECT), `... atualiza` (UPDATE), `... deleta` (DELETE) |
| `pacote_uso` | `membro ve` (SELECT), `registra` (INSERT), `altera` (UPDATE), `exclui` (DELETE) |
| `pagamentos` | `quem fecha insere` (INSERT), `profissional ou gestor ve` (SELECT), `profissional ou gestor deleta` (DELETE) |
| `venda_itens` | `membro insere`, `financeiro ou gestor ve`, `vendas.acessar ve`, `gestor ou owner atualiza`, `gestor ou owner deleta` |
| `vendas` | `membro insere`, `financeiro ou gestor ve`, `vendas.acessar ve`, `gestor ou owner atualiza`, `gestor ou owner deleta`, `vendas.acessar deleta` |

## Passo 8: conferências de uso, com as chaves padrão

1. **Profissional:** ela fecha uma comanda própria com um produto e um serviço extra, no cartão. Depois confira:
   - a comanda aparece no Histórico do dia;
   - o estoque baixou;
   - o cartão com 0% configurado mostra a taxa "0%" ao reabrir, e não "não cadastrada".
2. **Profissional:** ela cancela um atendimento com taxa ligada. A taxa aparece pendente no Financeiro da dona.
3. **Gestora:** ela faz uma venda avulsa no PIX. A venda aparece no Histórico de Vendas e no Estoque.
4. **Dona:** abra Financeiro, Dashboard e Relatórios do mês. Os números de vendas e serviços extras devem continuar os mesmos de antes da 093.
5. **No dia seguinte:** repita a última consulta do passo 6. Nenhuma policy nova deve ter aparecido.

## Rollback

Cada migration traz o próprio rollback no cabeçalho. Desfaça na ordem inversa: 093 → 090 → 092 → 091.
- Desfazer a 090 sem desfazer a 093 deixa as funções da 093 apontando para colunas que não existem. Por isso, desfaça a 093 primeiro.
