# Controle de acesso por role (dona / gestora / profissional)

**Data:** 2026-07-23
**Status:** Aprovado para planejamento

## Contexto

Hoje o app tem apenas 1 papel em uso de fato: a dona, que é `owner` em tudo. O
schema, a matriz de permissões (`lib/permissions.ts`) e o roteamento no mobile
já modelam três roles — `owner`, `gestor`, `profissional` — mas a web nunca
aplicou essa matriz em lugar nenhum, e nem web nem mobile permitem escolher o
role de quem está sendo convidado, ou promover/rebaixar alguém depois.

Quando o negócio crescer e a dona tiver equipe (gestoras administrando o
salão, profissionais atendendo clientes), o app precisa: (1) restringir o que
cada role vê e faz, e (2) dar à dona uma forma de atribuir e ajustar esses
roles.

### Estado atual levantado (achados, não suposições)

- `empresa_membros` guarda `empresa_id + user_id + role`. O enum de banco
  `perfil_role` (migration 001) só declara `('gestor', 'profissional',
  'cliente')` — **não tem `'owner'`**, mas migration 032 e todo o código já
  gravam/leem `role = 'owner'`. Isso só funciona porque, na prática, o RLS
  nunca confiou nesse valor: a função `is_gestor_ou_owner()`
  ([003_despesas_policies.sql](../../../supabase/migrations/003_despesas_policies.sql))
  decide "é dona" checando `empresas.owner_id = auth.uid()`, não a coluna
  `role`. O mobile faz o mesmo (deriva `isOwner` de `empresas.owner_id` em
  `authStore.ts`, não do enum). Ou seja: `role = 'owner'` funciona hoje por
  schema drift (enum alterado direto no Supabase, nunca capturado numa
  migration rastreada) — não é usado por nenhuma policy de segurança, só pela
  UI (badge "Dono(a)", chave em `permissions.ts`).
- `web/lib/permissions.ts` e `mobile/lib/permissions.ts` já têm a mesma matriz
  de permissões por role (`temPermissao`, `rotaInicial`), mas:
  - No mobile, `temPermissao`/`rotaInicial` **já estão em uso**: roteamento
    inicial por role em `app/_layout.tsx`, e a aba Financeiro escondida por
    permissão em `(empresa)/_layout.tsx`.
  - Na web, nenhuma das duas funções é chamada fora do teste unitário. A
    página de Dashboard busca `role` via `getAppContext()` e descarta o
    valor sem usar.
- RLS: `agendamentos: ver` e `comissoes: ver`
  ([001_initial_schema.sql:381-394](../../../supabase/migrations/001_initial_schema.sql))
  dizem no comentário "profissional vê só as suas", mas a condição real é um
  `OR` que libera todas as linhas da empresa pra **qualquer** membro ativo,
  independente do role. `despesas: membro ve` tem o mesmo padrão — qualquer
  membro lê despesas, mesmo sem a permissão `ver_despesas`.
- Convite de profissional (web:
  [api/profissionais/route.ts](../../../web/app/api/profissionais/route.ts),
  mobile:
  [convidar-profissional.tsx](../../../mobile/app/(empresa)/convidar-profissional.tsx))
  sempre grava `role: 'profissional'` — não existe opção de convidar como
  gestora, nem ação de promover/rebaixar um membro já existente.

## Objetivo

1. Corrigir o gap de schema do enum `perfil_role`.
2. Reforçar RLS nas 3 tabelas onde o mapeamento permissão → role é
   inequívoco: `despesas`, `agendamentos`, `comissoes`.
3. Aplicar a matriz de permissões já existente na web (paridade com o
   mobile): esconder navegação, bloquear rotas por URL direta, filtrar
   conteúdo compartilhado (Agenda/Comissões) pra profissional ver só o
   próprio.
4. Permitir escolher o role ao convidar (gestora vs. profissional) e
   promover/rebaixar um membro existente, em web e mobile.

## Fora de escopo (decisão explícita, não esquecimento)

- **RLS de `vendas`, `comandas`, `pagamentos`**: profissional precisa de
  escrita nessas tabelas para `fechar_comanda` (permissão que ela tem). Restringir
  SELECT ali sem mapear todo o fluxo de comanda é risco de quebrar a operação
  do dia a dia — fica como item futuro, tratado com mais cuidado e
  isoladamente.
- Role `cliente` (portal do cliente na web) — mobile já tem rotas
  `(cliente)/*`, web não tem nada equivalente ainda; não faz parte desta
  entrega.
- Migração de dados existentes: como hoje só existe a dona (`owner`), não há
  membros `gestor`/`profissional` reais em produção pra migrar.

## Design

### 1. Schema

Nova migration, aditiva e idempotente:

```sql
ALTER TYPE perfil_role ADD VALUE IF NOT EXISTS 'owner';
```

Só documenta formalmente o que já roda em produção. Sem mudança de
comportamento — `is_gestor_ou_owner()` continua sendo a fonte de verdade pra
RLS; o valor `'owner'` na coluna `role` continua sendo só rótulo de UI.

### 2. RLS

Reescrever as policies de SELECT em `despesas`, `agendamentos` e `comissoes`
para usar `is_gestor_ou_owner(empresa_id)` no lugar do "qualquer membro vê
tudo":

- `despesas`: SELECT só se `is_gestor_ou_owner(empresa_id)`.
- `agendamentos`: SELECT se `profissional_id = auth.uid()` OR
  `cliente_id = auth.uid()` OR `is_gestor_ou_owner(empresa_id)`.
- `comissoes`: SELECT se `profissional_id = auth.uid()` OR
  `is_gestor_ou_owner(empresa_id)`.

Isso troca o `empresa_id in (select minha_empresas())` genérico (que não
olha role) por uma checagem que de fato diferencia gestor/owner de
profissional — sem afetar owner/gestor, que continuam vendo tudo.

### 3. Web — aplicar a matriz de permissões

- **Navegação** (sidebar/layout do `(app)`): filtrar itens usando
  `temPermissao()` — Financeiro, Configurações, Equipe, Serviços, Estoque,
  Relatórios somem para quem não é gestor/owner.
- **Guarda por página**: nas páginas restritas, checar
  `temPermissao(role, <permissão>)` logo após `getAppContext()` e fazer
  `redirect()` (ex.: para `/agenda`) se a role não tiver a permissão —
  protege contra acesso direto por URL, não só esconder o menu.
- **Filtragem de conteúdo compartilhado**: Agenda e Comissões continuam
  acessíveis para profissional, mas a query filtra por
  `profissional_id = user.id` quando a role não tem
  `ver_todos_agendamentos` / `ver_comissoes_todas`.
- Reaproveitar `getAppContext()` (já busca `role` por request) — não é
  necessário criar um mecanismo novo de leitura de contexto.

### 4. Convite com escolha de role + promover/rebaixar

Regra de quem pode fazer o quê (evita gestora se autopromover ou reduzir o
acesso da dona):

- **Convidar como gestora** ou **promover/rebaixar** um membro: só `owner`.
- **Convidar como profissional**: `owner` ou `gestor`.
- Ninguém altera o próprio role (owner não se rebaixa, gestor não se
  autopromove).

**Web:**
- Modal de convite (`equipe/page.tsx`) ganha um seletor Gestora/Profissional
  — a opção "Gestora" só aparece se quem está logado é owner.
- `api/profissionais/route.ts` para de fixar `role: 'profissional'` no
  insert/upsert; usa o valor enviado pelo form, mas revalida no servidor
  que `role: 'gestor'` só é aceito se `req` vier de um owner (nunca confia
  só no que a UI escondeu).
- Nova ação na linha do membro (visível só para owner) para promover
  profissional → gestora ou rebaixar gestora → profissional.
- RLS: policy de UPDATE em `empresa_membros` restringindo alteração da
  coluna `role` a quem é owner da empresa (`empresas.owner_id = auth.uid()`).

**Mobile:**
- Mesmo seletor de role (condicionado a owner) na tela
  `convidar-profissional.tsx`.
- Ação de promover/rebaixar na tela `equipe.tsx`, mesmas regras acima —
  reforçadas pela mesma policy de RLS (compartilhada entre os dois apps).

### 5. Teste

- Estender `web/tests/unit/permissions.test.ts` (e o equivalente mobile, se
  existir) para cobrir os novos casos de gating.
- Verificação manual: criar uma segunda conta de teste com role
  `profissional` numa empresa de teste e confirmar visualmente que ela não
  vê Financeiro/Equipe/Configurações/Relatórios/Serviços/Estoque na web, e
  que Agenda/Comissões mostram só os dados dela — necessário porque hoje só
  existe a conta da dona, não há como validar isso sem criar o segundo
  usuário.

## Riscos e mitigação

- **RLS mais restritivo pode quebrar algo que hoje depende do acesso
  amplo.** Mitigação: escopo limitado a 3 tabelas com mapeamento limpo;
  vendas/comandas/pagamentos ficam de fora nesta entrega justamente por
  esse risco.
- **Quem pode promover/rebaixar quem**: resolvido na seção 4 — só owner
  define/altera role de gestora, ninguém altera o próprio role, e a regra é
  reforçada tanto na API (web) quanto em RLS (`empresa_membros` UPDATE),
  não só na UI.
