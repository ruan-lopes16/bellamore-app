# Permissões da profissional: agenda própria, sem estoque/despesas, serviços/pacotes só-leitura, dashboard pessoal

**Data:** 2026-09-24
**Status:** Aprovado para planejamento

## Contexto

A spec [2026-07-23-controle-acesso-roles-design.md](2026-07-23-controle-acesso-roles-design.md)
já introduziu a matriz de permissões (`lib/permissions.ts`, `is_gestor_ou_owner()`,
reforço de RLS em `despesas`/`agendamentos`/`comissoes`) e a maior parte já está em produção. Esta
entrega fecha 4 pontas que ficaram fora daquela primeira rodada, a pedido do
usuário:

1. Agenda da profissional deve mostrar só a própria, sem seletor de equipe.
2. Estoque e despesas não devem aparecer pra ela em nenhuma notificação/alerta.
3. Serviços passa a ser visível (hoje é escondido por completo) mas continua
   não-editável. Pacotes já é visível; só a edição do catálogo passa a ser
   restrita.
4. Dashboard deixa de ser bloqueado pra ela — ganha uma versão pessoal, que
   passa a ser a página inicial após login.

### Estado atual levantado (achados, não suposições)

- **Despesas já não aparece pra profissional.** A migration 042
  (`is_gestor_ou_owner(empresa_id)` no SELECT de `despesas`) já bloqueia isso
  no banco. A tela de Notificações e o badge da sidebar computam a contagem
  de despesas direto da tabela — sem filtro de role na query — mas como o
  RLS já nega a leitura, o resultado já vem vazio pra ela hoje. **Estoque não
  tem essa proteção**: `produtos`/`estoque_movimentos` só têm a policy
  original "membro vê" (qualquer role), então o badge e a tela de
  Notificações mostram estoque baixo pra profissional hoje.
- **Agenda já não vaza dados de outros profissionais**, mas por acidente de
  RLS, não por design da tela: a policy de `agendamentos` (migration 042)
  já restringe SELECT a `profissional_id = auth.uid() OR is_gestor_ou_owner(...)`.
  A página web (`agenda/page.tsx`) nunca foi ajustada como a spec original
  pedia ("a query filtra por profissional_id quando a role não tem
  ver_todos_agendamentos") — ela ainda carrega a lista de todos os
  profissionais da empresa e desenha uma grade de equipe; pra uma
  profissional, essa grade só aparece com todas as colunas vazias (exceto a
  dela), o que é confuso, não inseguro.
- **Serviços foi deliberadamente escondido por completo** na spec anterior
  ("Serviços... somem para quem não é gestor/owner"). O pedido atual reverte
  essa decisão especificamente para Serviços: ela passa a ver a lista, sem
  poder editar. Não encontrei nenhuma policy de INSERT/UPDATE/DELETE pra
  `servicos` em nenhuma migration — só a de SELECT. Isso é suspeito (a
  feature de editar serviço funciona em produção hoje), então é possível que
  exista uma policy criada à mão no SQL editor que nunca voltou pra uma
  migration rastreada — vou tratar isso como incerteza a confirmar durante a
  implementação, não como fato.
- **Pacotes nunca foi restrito nem escondido.** `pacotes`/`pacote_servicos`
  têm policies de escrita abertas a "qualquer membro" (migrations 005, 010,
  034, 035) — qualquer profissional já pode criar/editar/excluir a definição
  de um pacote hoje, tanto na UI (a página não tem nenhum gate de
  permissão) quanto no banco.
- **Dashboard é bloqueado por completo hoje** (`ver_resumo_financeiro`,
  ausente do role `profissional`) — ela é redirecionada pra `/agenda`. O
  conteúdo do dashboard atual (`dashboard/page.tsx`) é 100% financeiro da
  empresa (faturamento líquido, despesas, retiradas da sócia) — não dá pra
  simplesmente "filtrar" essas mesmas queries por profissional, a maioria
  não tem esse conceito. Precisa de uma view nova.
- **Mobile hoje é mais restrito que o pedido**, não menos: `(profissional)/`
  só tem 3 abas (Agenda, Comissões, Ajustes) — nem Dashboard, nem Serviços,
  nem Pacotes existem pra esse papel lá. A agenda mobile já usa um hook
  dedicado (`useAgendaProfissional`) e já mostra só a agenda dela — não
  precisa de nenhuma mudança.
- `web/lib/permissions.ts` e `mobile/lib/permissions.ts` são dois arquivos
  separados com a mesma matriz (não compartilham um módulo `shared/`) — toda
  mudança de permissão/rota precisa ser espelhada nos dois.

## Objetivo

1. Agenda web: quando o role é `profissional`, a tela busca e mostra só a
   própria agenda — sem carregar a lista de profissionais da empresa nem
   desenhar a grade de equipe.
2. RLS de `produtos`/`estoque_movimentos` (SELECT) restrita a
   `is_gestor_ou_owner(empresa_id)`, espelhando o que a migration 042 já fez
   pra despesas. Sidebar e Notificações passam a ficar corretas pra
   profissional sem precisar de lógica de role na própria tela.
3. Nova permissão `ver_servicos` (todos os roles) substitui `gerenciar_servicos`
   como guarda de acesso à página de Serviços; `gerenciar_servicos`
   continua controlando os botões de criar/editar/excluir/ativar. RLS de
   escrita em `servicos` restrita a gestor/owner (nova policy).
4. Nova permissão `gerenciar_pacotes` (gestor/owner) controla só os botões
   de criar/editar/excluir a definição do pacote no catálogo. Vender pacote
   pra cliente e registrar/gerenciar sessões usadas continuam liberados pra
   qualquer membro ativo — como já são hoje. RLS de escrita em
   `pacotes`/`pacote_servicos` restrita a gestor/owner (hoje aberta a
   qualquer membro); `pacote_clientes`/`pacote_uso` sem mudança.
5. Dashboard pessoal nova (`DashboardProfissionalView`), acessível a quem
   tem `ver_proprios_agendamentos` sem `ver_resumo_financeiro`. Página
   inicial da profissional passa de `/agenda` para `/dashboard`.
6. Web e mobile em paridade nos 4 pontos acima.

## Fora de escopo (decisão explícita)

- RLS de `vendas`/`comandas`/`pagamentos` — mesma decisão da spec anterior,
  continua arriscado demais pra entrar de carona nesta entrega.
- Convite/promoção de role (gestora ↔ profissional) — já resolvido na spec
  anterior, não faz parte deste pedido.
- Ação de contato (WhatsApp/SMS) a partir da lista de reconquista do
  dashboard pessoal — é só uma lista pra ela agir manualmente.
- Bloqueio de horário, comissões e taxa de reserva — já filtrados
  corretamente por profissional hoje, não precisam de mudança.
- Badge de comissão pendente e alerta de "comanda não fechada" na sidebar —
  já saem corretamente escopados pra profissional como efeito colateral do
  RLS existente (comissoes/agendamentos), não precisam de mudança.

## Design

### 1. Agenda web — só a própria

Quando `meuRole === 'profissional'`:
- Não busca `profissionaisEmpresa` (lista de membros da empresa) — só o
  próprio usuário.
- A grade da Timeline renderiza uma única coluna (a dela), sem seletor de
  profissional.
- A query de agendamentos do dia/período já filtra por
  `profissional_id = meuUserId` explicitamente (não depende só do RLS
  silencioso) — deixa a intenção explícita no código, como a spec anterior
  já pedia.
- Bloqueio de horário: sem mudança (já é escopado pra ela).

### 2. RLS — estoque

Nova policy de SELECT em `produtos` e `estoque_movimentos`, restrita a
`is_gestor_ou_owner(empresa_id)`, mesmo padrão da migration 042. Como
`v_produtos_estoque_baixo` já é `security_invoker` (migration 039), ela
herda a restrição automaticamente. Depois disso, o badge da sidebar e a
seção "Alertas ativos" de Notificações passam a vir vazios de estoque pra
profissional sem precisar tocar nessas duas telas.

### 3. Serviços — visível, não editável

- `lib/permissions.ts` (web e mobile): nova permissão `ver_servicos`, presente
  em `owner`, `gestor` e `profissional`. `gerenciar_servicos` continua só
  em `owner`/`gestor`.
- `servicos/layout.tsx`: troca `exigirPermissao(role, 'gerenciar_servicos')`
  por `exigirPermissao(role, 'ver_servicos')`.
- `servicos/page.tsx`: botões de criar/editar/excluir/ativar-desativar
  escondidos quando `!temPermissao(role, 'gerenciar_servicos')`.
- `Sidebar.tsx`: item "Serviços" passa a exigir `ver_servicos` em vez de
  `gerenciar_servicos`.
- Nova policy de INSERT/UPDATE/DELETE em `servicos`, restrita a
  `is_gestor_ou_owner(empresa_id)`. **Atenção na implementação:** confirmar
  no SQL editor se já existe alguma policy de escrita não capturada em
  migration antes de assumir que a tabela está sem nenhuma — se existir uma
  permissiva solta, ela precisa ser dropada pelo nome real, não só
  substituída por uma nova (policies são somadas com OR).

### 4. Pacotes — catálogo travado, venda/sessão livre

- `lib/permissions.ts` (web e mobile): nova permissão `gerenciar_pacotes`
  (`owner`/`gestor`).
- `pacotes/page.tsx`: passa a buscar `role` (hoje não busca). Botões "Novo
  pacote", editar e excluir do **catálogo** ficam escondidos quando
  `!temPermissao(role, 'gerenciar_pacotes')`. Botão "Vender" e o modal de
  sessões (`SessoesModal`) continuam sempre visíveis.
- Sem mudança de navegação — Pacotes já é visível a todos.
- Novas policies de INSERT/UPDATE/DELETE em `pacotes` e `pacote_servicos`,
  restritas a `is_gestor_ou_owner(empresa_id)` — substituindo as policies
  "membro insere/atualiza/exclui" hoje abertas a qualquer role (precisa
  `DROP POLICY` pelos nomes exatos das migrations 005/010/034/035).
  `pacote_clientes` e `pacote_uso` continuam com a policy `FOR ALL` aberta a
  qualquer membro, sem mudança.

### 5. Dashboard pessoal

- `lib/permissions.ts` (web e mobile): `rotaInicial('profissional')` passa
  de `/agenda` para `/dashboard`. `dashboard/layout.tsx` deixa de exigir
  `ver_resumo_financeiro` sozinho — passa a aceitar quem tem
  `ver_resumo_financeiro` (owner/gestor) OU `ver_proprios_agendamentos`
  (inclui profissional).
- `dashboard/page.tsx` passa a decidir, pelo `role`, entre renderizar o
  conteúdo atual (extraído para `DashboardEmpresaView`, sem mudança de
  comportamento) ou o componente novo `DashboardProfissionalView`.
- **`DashboardProfissionalView` mostra:**
  - Agenda de hoje (lista dos atendimentos dela).
  - Faturamento de hoje e faturamento bruto do mês: soma de
    `comissoes.valor_servico` (preço do serviço, não a comissão) dos
    atendimentos concluídos dela no período — mesma tabela que já alimenta
    a tela de Comissões, sem query nova pesada.
  - Comissão do mês (paga/pendente) e nº de atendimentos concluídos no mês.
  - Meta pessoal: ela define um valor de meta mensal própria, distinta da
    `meta_mensal` da empresa (que é do dono). Nova coluna
    `empresa_membros.meta_mensal_pessoal` (nullable) e uma função
    `SECURITY DEFINER` (`definir_minha_meta_mensal(valor)`) que só altera
    essa coluna, só na própria linha do usuário autenticado — evita abrir
    uma policy de UPDATE genérica em `empresa_membros` que deixaria ela
    alterar `role`/`percentual_comissao`/`ativo` da própria linha. O
    dashboard mostra uma barra de progresso (faturamento bruto do mês ÷
    meta).
  - Reconquista de clientes: lista de clientes que ela atendeu e que estão
    "em risco" (45+ dias sem retornar) ou "nunca retornaram" (atenderam 1x
    com ela e não voltaram) — mesmo critério e limiares já usados em
    Clientes → Segmentos, só que a base de atendimentos é filtrada por
    `profissional_id = meuUserId`. Cada item leva ao perfil do cliente. Sem
    ação de contato automático.
- `Sidebar.tsx`: item "Dashboard" deixa de exigir `ver_resumo_financeiro` —
  passa a aparecer pra qualquer role autenticado (o conteúdo é quem decide
  a visão).

### 6. Mobile — paridade

- `(profissional)/_layout.tsx`: troca as 3 abas atuais por 4 — "Início"
  (dashboard pessoal, mesmas métricas do web), "Agenda" (sem mudança,
  hook já é dedicado), "Serviços" (lista só-leitura, tela nova), "Pacotes"
  (catálogo + vender + sessão, sem editar catálogo, tela nova) — mantendo
  "Comissões" e "Ajustes" como sub-navegação ou abas adicionais; a
  organização exata das abas (quantas cabem na tab bar vs. o que vira
  atalho dentro de "Início") fica pra decidir no plano de implementação.
- `mobile/lib/permissions.ts`: mesmas permissões novas (`ver_servicos`,
  `gerenciar_pacotes`) e mesma troca de `rotaInicial`.
- Telas novas de Serviços e Pacotes reaproveitam os componentes de
  visualização já existentes em `(empresa)/servicos.tsx` e
  `(empresa)/pacotes.tsx`, removendo as ações de edição.

## Riscos e mitigação

- **RLS de escrita em `servicos`/`pacotes` pode ter policy solta não
  rastreada em migration** (schema drift, já visto no projeto). Mitigação:
  conferir no SQL editor antes de aplicar a migration nova; se existir,
  dropar pelo nome real antes de criar a restritiva — policies permissivas
  se somam com OR, então só adicionar uma nova não revoga a antiga.
- **Meta pessoal em `empresa_membros` pode abrir uma brecha de escrita mais
  ampla se implementada como policy de UPDATE em vez de função dedicada.**
  Mitigação: usar função `SECURITY DEFINER` restrita a uma coluna e à
  própria linha, não uma policy de UPDATE geral na tabela.
- **Dashboard pessoal pode ficar pesado se cada card disparar sua própria
  query.** Mitigação: uma única leva de queries em paralelo (`Promise.all`),
  reaproveitando o mesmo intervalo de datas já calculado pra hoje/mês do
  dashboard atual.
- **Migrations são aplicadas à mão pelo usuário via SQL editor** (não há
  `supabase db push` automático neste projeto) — a entrega fica com as
  migrations pendentes de aplicação até o usuário confirmar, como já
  acontece com 062/063/066-069 hoje.
