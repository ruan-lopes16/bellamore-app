# Deploy — Paridade Agenda (migration 094)

Branch `feat/paridade-agenda`. Migration única: `supabase/migrations/094_agenda_status_avaliacao_preferencia.sql`.
Rodar à mão no SQL Editor (https://supabase.com/dashboard/project/qpiepxolyqmoankeyeva/sql/new). Nunca `supabase db push`.

## Ordem recomendada: 094 ANTES do deploy

1. **Antes de tudo (somente leitura):** conferir as policies atuais de `avaliacoes`.
   ```sql
   select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'avaliacoes';
   -- esperado hoje: só "empresa_all_avaliacoes" (030). Se aparecer outra (criada à mão), anote o nome:
   -- ela continua valendo depois da 094 e precisa ser derrubada pelo nome exato.
   ```
2. **Rodar a 094.** Ela é idempotente (pode rodar 2x).
3. **Conferências** (abaixo, somente leitura).
4. **Merge e deploy do web** (Vercel **Ready**).
5. Pedir a uma profissional: avaliar um atendimento concluído, concluir e voltar um atendimento sem comanda
   (a comissão some e volta uma só) e tentar tirar de Concluído um atendimento já fechado na comanda (recusa com
   "Já fechado na comanda. Para mudar, edite a comanda.").
6. App nativo: entra no próximo build (não publicado ainda).

**Por que antes:**
- **O web de hoje funciona com a 094.** A avaliação passa a gravar (o trigger troca o `profissional_id` errado
  que o web antigo manda pelo vínculo certo — hoje a FK recusa e nada é salvo); a trava de Concluído só recusa
  o que já não devia acontecer, com mensagem em português; a coluna nova tem default e ninguém do código
  antigo a lê; os triggers só agem em transições de status.
- **O código novo sem a 094 abre uma janela de dinheiro.** As duas plataformas deixam tirar de Concluído um
  atendimento sem comanda. Sem o trigger da 094, a comissão pendente e a sessão de pacote ficam presas, e
  concluir de novo gera uma **segunda comissão**. A avaliação do app gravaria com `profissional_id` nulo
  (fora do ranking).
- Ordem inversa não quebra nenhuma tela (o código novo detecta a falta da coluna `agenda_abre_em` (42703/PGRST204)
  e da função `salvar_preferencia_agenda` (PGRST202): esconde o campo "Minha agenda abre em" e abre na própria
  pessoa), mas deixa a janela acima aberta até a 094 rodar.

## Conferências depois da 094 (somente leitura)

```sql
-- 1) Triggers novos (3 linhas, todos habilitados 'O')
select tgrelid::regclass t, tgname, tgenabled from pg_trigger
 where tgname in ('trg_trava_concluido_com_comanda', 'trg_desfaz_conclusao_sem_comanda', 'trg_avaliacao_profissional');

-- 2) Funções: security definer só onde precisa, search_path fixo nas quatro
select proname, prosecdef, proconfig from pg_proc
 where proname in ('fn_trava_concluido_com_comanda', 'fn_desfaz_conclusao_sem_comanda',
                   'fn_avaliacao_profissional', 'salvar_preferencia_agenda');
-- esperado: fn_trava = false; as outras três = true; proconfig = {search_path=public}

-- 3) Policies de avaliacoes: exatamente estas 4 (e nenhuma "empresa_all_avaliacoes")
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'avaliacoes' order by cmd;
-- avaliacoes: gestor apaga (DELETE) / quem atende grava (INSERT) / membro ve (SELECT) / quem atende altera (UPDATE)

-- 4) Coluna da preferência
select column_name, data_type, is_nullable, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'empresa_membros' and column_name = 'agenda_abre_em';
-- text, NO, 'propria'::text
select agenda_abre_em, count(*) from public.empresa_membros group by 1;   -- todos 'propria'

-- 5) Função da preferência só para quem está logado
select has_function_privilege('anon', 'public.salvar_preferencia_agenda(uuid, text)', 'execute') anon,
       has_function_privilege('authenticated', 'public.salvar_preferencia_agenda(uuid, text)', 'execute') autenticado;
-- false, true
```

### Diagnóstico de dados antigos (somente leitura; a 094 não corrige o passado)

A 094 só age nas próximas mudanças de status. Estas consultas mostram o que ficou de antes; qualquer limpeza é
decisão do dono, numa etapa separada.

```sql
-- a) Atendimentos fora de Concluído com comissão de atendimento (sobras de "concluir e voltar")
select a.id, a.status, a.data_hora_inicio, c.status comissao, c.valor_comissao
  from public.comissoes c join public.agendamentos a on a.id = c.agendamento_id
 where c.comanda_item_id is null and a.status <> 'concluido'
 order by a.data_hora_inicio;

-- b) Mais de uma comissão de atendimento para o mesmo atendimento (concluído 2x)
select agendamento_id, count(*), sum(valor_comissao)
  from public.comissoes
 where agendamento_id is not null and comanda_item_id is null
 group by 1 having count(*) > 1;

-- c) Sessões de pacote consumidas por atendimento que não está concluído
select pu.id, pu.pacote_cliente_id, a.id agendamento, a.status
  from public.pacote_uso pu join public.agendamentos a on a.id = pu.agendamento_id
 where a.status <> 'concluido';

-- d) Avaliações (antes da 094 a FK recusava tudo: esperado 0; depois da 1ª, profissional_id preenchido)
select count(*), count(profissional_id) from public.avaliacoes;
```

## Rollback

No cabeçalho da 094 (bloco "Rollback"). Comissões e sessões já devolvidas pelo trigger não voltam; concluir de
novo as recria pelos triggers da 065/078.
