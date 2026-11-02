# Deploy — Paridade Configurações, Notificações e Papéis (migration 097)

Branch `feat/paridade-configuracoes`. Migration única: `supabase/migrations/097_push_dispositivos_e_notificacoes.sql`.
Rodar à mão no SQL Editor (https://supabase.com/dashboard/project/qpiepxolyqmoankeyeva/sql/new). Nunca `supabase db push`.
Ela é idempotente (pode rodar 2x) e só depende da 001 e da 005.

## Ordem recomendada: 097 ANTES do deploy

0. **Antes de tudo (somente leitura):** anotar as policies de `notificacoes` feitas à mão em produção.
   A 097 cria a policy nova "notificacoes: marcar propria como lida", mas não derruba a antiga (o nome dela não
   está versionado).
   ```sql
   select policyname, cmd, qual, with_check from pg_policies
    where schemaname = 'public' and tablename = 'notificacoes' order by cmd, policyname;
   ```
1. **Rodar a 097.**
2. **Conferências** (abaixo, somente leitura).
3. **Merge e deploy do web** (Vercel **Ready**).
4. **Pedir à equipe para fechar e abrir o PWA** (ou recarregar). Quem participa de mais de uma empresa passa a ver
   o seletor na Sidebar e no menu "Mais".
5. Testes com a equipe (abaixo).
6. App nativo: build novo (abaixo).

**Por que a 097 antes:**
- **O código antigo funciona com a 097.** O web e o app antigos só fazem `update({ lida: true })` em
  `notificacoes`, que o trigger novo aceita. Os crons antigos não leem `push_dispositivos`. O backfill copia
  `users.push_token` sem apagar nada, então o app antigo segue pelo caminho de sempre.
- **O código novo também funciona sem a 097, mas fica pela metade.** O cron de lembrete não manda nada para o
  app (de propósito, para não chegar dobrado com o lembrete local). O resumo usa `users.push_token`, só para
  quem tem vínculo em uma empresa só. O botão "Ativar notificações" do app novo cai no caminho antigo. Com a 097
  antes, o deploy já sai completo.
- **Risco aceito:** um app antigo com aparelho vindo do backfill pode receber o lembrete em dobro (local +
  servidor) depois do deploy, até atualizar o binário. Hoje não há app publicado, então ninguém é afetado.

## Conferências depois da 097 (somente leitura)

```sql
-- 1) Tabela e backfill: o 1º número fica perto do 2º (quem tem push_token e vínculo ativo)
select count(*) from public.push_dispositivos;
select count(*) from public.users where nullif(btrim(push_token), '') is not null;
select plataforma, count(*) from public.push_dispositivos group by 1;          -- só 'expo'

-- 2) RLS ligada e as 3 policies (ver, inserir, apagar; sem UPDATE)
select relrowsecurity from pg_class where oid = 'public.push_dispositivos'::regclass;  -- t
select policyname, cmd from pg_policies where tablename = 'push_dispositivos' order by cmd;
-- "apagar proprios" DELETE, "inserir proprios" INSERT, "ver proprios" SELECT

-- 3) Funções: registro como definer, trigger como invoker; execute só para authenticated
select proname, prosecdef, proconfig from pg_proc
 where proname in ('registrar_push_dispositivo', 'fn_notificacoes_so_lida');
-- registrar_push_dispositivo t {search_path=public}; fn_notificacoes_so_lida f {search_path=public}
select has_function_privilege('anon', 'public.registrar_push_dispositivo(uuid, text, text)', 'execute');          -- f
select has_function_privilege('authenticated', 'public.registrar_push_dispositivo(uuid, text, text)', 'execute'); -- t

-- 4) notificacoes: policy nova + trigger
select policyname, cmd, qual, with_check from pg_policies where tablename = 'notificacoes' order by cmd;
-- "notificacoes: marcar propria como lida" UPDATE (user_id = auth.uid()) / (user_id = auth.uid()).
-- Se a policy manual anotada no passo 0 for mais ampla (ex.: FOR ALL, ou UPDATE sem user_id = auth.uid()),
-- derrubar pelo nome exato: drop policy "<nome>" on public.notificacoes;
select tgname, tgenabled from pg_trigger where tgrelid = 'public.notificacoes'::regclass and not tgisinternal;
-- trg_notificacoes_so_lida O

-- 5) Nenhum aparelho ligado a empresa sem vínculo da pessoa (esperado 0)
select count(*) from public.push_dispositivos d
 where not exists (select 1 from public.empresa_membros m where m.user_id = d.user_id and m.empresa_id = d.empresa_id and m.ativo)
   and not exists (select 1 from public.empresas e where e.id = d.empresa_id and e.owner_id = d.user_id);
```

## Testes com a equipe, depois do deploy

1. Quem tem 2 empresas: trocar pelo seletor; a página recarrega e Agenda, Comanda, Financeiro, Clientes, Pacotes e
   Vendas mostram a empresa nova. Sair e entrar de novo: continua na última escolhida.
2. Notificações: o sino conta avisos não lidos + alertas; "Marcar todas como lidas" zera os avisos.
3. Configurações → Meu perfil → trocar senha (mínimo 8, com confirmação).
4. Web push: com as notificações ativadas, receber o lembrete de 30 min. Sair da conta e entrar com outra no mesmo
   navegador: os avisos da conta anterior param de chegar.
5. Login com link antigo (`/login?next=/agenda`): volta para a Agenda depois de entrar.

## App nativo — build novo obrigatório

Dependências nativas novas desde o último build:
- `expo-image-picker` (logo da empresa em Configurações; câmera e microfone desligados no plugin);
- `expo-system-ui` (modo "Sistema" do tema no Android; sem ele a Expo ignora `userInterfaceStyle`);
- já pendentes de fases anteriores: `expo-print`, `expo-sharing`, `expo-file-system`, `expo-crypto`.

```bash
cd mobile
npx expo install expo-image-picker expo-system-ui   # acerta as versões para o SDK 51
npx expo prebuild --clean   # ou eas build, que faz o prebuild
```

Conferir no aparelho:
- Configurações → "Notificações no celular" → "Ativar notificações": o sistema pede a permissão só nesse clique,
  nunca ao abrir o app. Depois disso, o lembrete de 30 min chega pelo servidor (uma vez só, sem o local junto).
- Trocar de empresa no menu "Mais": o lembrete passa a ser só da empresa nova.
- Sair da conta: o aparelho para de receber os avisos dessa conta.
- Tema Claro/Escuro/Sistema, inclusive "Sistema" no Android; alertas e seletores de data nativos acompanham o
  tema do sistema.
- Logo da empresa: escolher da galeria e salvar.

## Vercel — variável opcional

`EXPO_ACCESS_TOKEN`: só é necessária se o projeto na Expo exigir "Enhanced push security". Sem ela, os crons mandam
sem o header `Authorization`, e a Expo aceita. Se for criada: Vercel → Settings → Environment Variables →
Production, e depois um redeploy. O token nunca aparece nos logs.
