# Paridade Configurações, Notificações e Papéis (web × app) — design

**Data:** 2026-10-28 · **Branch:** `feat/paridade-configuracoes` · **Migration:** 097.

**Fontes:**
- inventário `docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md` (§ Configurações/Notificações/Papéis);
- conferência no código de 27/10: 11 itens ainda valem, 6 estão parciais e 5 já foram resolvidos.

## Proposta aprovada pelo dono (2026-10-28)

1. **Push no app nativo.** O servidor passa a enviar o lembrete de 30 min e o resumo diário também para o celular, respeitando as preferências de cada pessoa. A permissão de notificação só é pedida no clique em "Ativar notificações", igual ao web.
2. **Empresa escolhida.** Quem participa de mais de uma empresa troca pelo menu, nas duas plataformas, e a escolha fica salva. Todas as telas usam a empresa escolhida.
3. **Sino e Notificações iguais.**
   - O sino mostra avisos não lidos + alertas.
   - A tela tem duas seções: **Alertas** (calculados na hora) e **Avisos** (gravados no banco), com o filtro "Não lidas".
   - A profissional ganha essa tela no app, com os alertas que a permissão dela deixa ver.
4. **Configurações iguais.**
   - O app ganha logo, CNPJ/CEP com máscara e busca, endereço em campos, meta mensal, segmento, troca de e-mail e modo escuro.
   - O web ganha troca de senha logada e a correção do parse das taxas.
   - Continua valendo: "perfil para todos; dados da empresa só a dona" (29/09).
5. **Bugs de login e convite corrigidos**, e não é possível criar uma 2ª empresa por engano.

## Regras

### Empresa ativa

**`shared/empresa-ativa.ts`:**
- `COOKIE_EMPRESA_ATIVA = 'bm_empresa'`.
- `escolherEmpresaAtiva(vinculos, preferida)` devolve a preferida, se for um vínculo ativo da pessoa. Senão devolve a mais antiga (ordem `created_at`, depois `id`), de forma determinística e nunca arbitrária.

**Web:**
- `getAppContext` lê o cookie, valida contra `empresa_membros` ativos e cai no padrão determinístico.
- O helper novo `empresaAtivaCliente()` (lê `GET /api/empresa-ativa` ou o contexto já carregado) substitui as 17 ocorrências de `.limit(1)` nas telas.
- `POST /api/empresa-ativa` grava o cookie depois de validar o vínculo.
- O push subscribe passa a usar a empresa ativa.

**App:**
- A escolha fica salva em AsyncStorage (`bm_empresa`) e é lida em `carregarSessao`.
- A profissional também troca de empresa pelo menu dela.

**Seletor:**
- Aparece só com 2 ou mais vínculos.
- No web fica no menu do usuário/Sidebar. No app, no menu Mais e no da profissional.
- Ao trocar: o web recarrega a página; o app recarrega a sessão e invalida as queries.

### Notificações

- **`shared/notificacoes.ts`:**
  - `TIPOS_NOTIFICACAO` com rótulo e ícone: `agendamento`, `resumo`, `estoque_baixo`, `bloqueio_pendente`, `bloqueio_aprovado`, `bloqueio_recusado`. Os tipos mortos (`comissao`, `pagamento`, `cliente_sumido`) saem.
  - `alertasCalculados(dados, permissoes)` devolve os 5 alertas do web: agendamentos de hoje, estoque baixo, despesas vencendo, comissões pendentes e aniversariantes dos próximos 7 dias (hoje em destaque, todos, sem o teto de 8 do Dashboard), como o web já mostra. *Confirmado pelo dono em 02/11.* Cada alerta só aparece com a permissão correspondente (`estoque.acessar`, `financeiro.ver`, `comissoes.ver_todas` ou as próprias comissões, `agenda.ver_equipe` ou a própria agenda). Também entram as comandas não fechadas, com `comanda.fechar`.
  - `contagemSino(alertas, naoLidas)`.
  - Datas sempre em Brasília: corrige o `hojeStr` do web, que hoje sai em UTC.
- **`shared/notificacoes-consultas.ts`:**
  - `carregarAvisos(db, empresaId, userId, { soNaoLidas })` filtra por empresa **e** usuário, com limite de 50 e paginação.
  - `marcarLidas(db, ids)` usa `.select('id')` e confere as linhas.
  - `carregarDadosAlertas(db, empresaId, permissoes)`.
- **Telas iguais nas duas plataformas:**
  - seções "Alertas" e "Avisos";
  - filtro Todas/Não lidas;
  - marcar uma ou todas como lidas;
  - tocar abre a rota do aviso (`rotaDoAviso` em shared).
- **Sino:** mostra `contagemSino` nas duas plataformas. A profissional do app ganha o sino e a tela. O badge de comandas não fechadas vai para o app, no menu Comanda/Mais.

### Push

**Migration 097:**
- Tabela `push_dispositivos` com `id`, `user_id`, `empresa_id`, `plataforma` (`'expo'|'web'`), `token` (unique), `criado_em`, `visto_em`.
- RLS: a pessoa vê, insere e apaga só os próprios registros. Inserir exige vínculo ativo com a empresa; ver e apagar não (quem perdeu o vínculo precisa tirar o próprio aparelho, e o DELETE com `where`/`returning` passa pela policy de SELECT).
- Backfill de `users.push_token` para `push_dispositivos` (empresa = a mais antiga do usuário).
- As linhas de `web_push_subscriptions` continuam como estão.

**Crons (lembretes e resumo-diario):**
- Além do web push, enviam por **Expo Push API** (`https://exp.host/--/api/v2/push/send`, em lotes de até 100) para os dispositivos `expo` dos destinatários **daquela empresa**.
- Tokens inválidos (`DeviceNotRegistered`) são apagados.
- Sem dependência nova: `fetch`. A Expo não exige access token. Se `EXPO_ACCESS_TOKEN` existir no ambiente, ele é enviado no header.

**Resumo diário:** a parte de despesas e estoque só vai para quem tem `financeiro.ver` / `estoque.acessar` (via `tem_permissao`). Hoje a gestora recebe sem checagem.

**App:**
- Sai o pedido automático no login.
- Configurações (empresa e profissional) ganham o card "Notificações no celular", com status e o botão "Ativar notificações".
- Ao ativar, o token é registrado em `push_dispositivos` com a empresa ativa.
- Ao trocar de empresa ou sair, o registro é atualizado ou apagado.
- Os lembretes locais deixam de existir quando o push do servidor está ativo, para não chegar dobrado.

**Preferências:** `notif_lembrete_atendimento` e `notif_resumo_diario` são salvas na hora nas duas plataformas (o app perde o botão Salvar nesses dois).

**`notificacoes`:** a 097 versiona a policy de UPDATE "marcar como lida" (`user_id = auth.uid()`, só a coluna `lida`, via trigger que recusa mudar as outras colunas). Ela existe só em produção.

### Configurações

- **App, aba Empresa** (só a dona; quem tem `config.taxas` vê só as taxas):
  - logo: upload no bucket `logos`, mesmo caminho do web;
  - CNPJ com `maskCNPJ` + `validaCNPJ` + busca na BrasilAPI, igual ao web;
  - telefone com máscara;
  - endereço em campos (CEP com busca no ViaCEP, rua, número, complemento, bairro, cidade/UF);
  - segmento;
  - meta mensal.
- **Endereço da empresa:** `shared/endereco.ts`, com `serializarEnderecoEmpresa` e `lerEnderecoEmpresa`, usado pelas duas plataformas. O formato é JSON numa string em `empresas.endereco`, com leitura tolerante do formato antigo separado por vírgula. Sem coluna nova.
- **Perfil (todos):**
  - nome e telefone;
  - trocar e-mail (`updateUser({ email })`, com o aviso "Enviamos um link de confirmação para o novo e-mail.");
  - trocar senha, que o web ganha (senha atual não é exigida pelo Supabase; pede nova e confirmação, mínimo 8);
  - preferências de notificação;
  - "Minha agenda abre em" (já existe);
  - **modo escuro** (app: Claro/Escuro/Sistema, salvo em AsyncStorage; o web já tem).
- **Taxas no web:** `parseValorBR`, igual ao app.

### Papéis e guardas

- **App:**
  - `(empresa)/_layout` passa a proteger as rotas por permissão, com o mesmo mapa do `exigirAcesso` do web (`shared/permissoes.ts`: `permissaoDaRota`);
  - sem a permissão, a tela "Sem acesso" com Voltar;
  - os fallbacks `?? 'gestor'` / `?? 'profissional'` saem: o papel indefinido espera carregar.
- **Dona:** as duas plataformas a reconhecem pela mesma regra, `role = 'owner'` do vínculo, com `empresas.owner_id` como conferência.
- **`carregarMinhasPermissoes` com a RPC falhando:** devolve `null` e a tela mostra erro e "Tentar de novo". Nunca libera os padrões do papel por cima de exceções gravadas.

### Login, convite e cadastro (web e app)

- `PUBLIC_PREFIXES` ganha `/convite/aceitar` e `/redefinir-senha`. A página de convite mostra "Convite inválido ou expirado" para quem não está logado.
- O login respeita `?next=`, aceitando só caminhos internos que começam com `/` e não com `//`.
- **`/auth/callback`:**
  - sem `next`, vai para `/dashboard` se a pessoa já tem empresa, e para `/criar-empresa` se não tem;
  - cadastro e verificar-email passam `next` explícito.
- **`/criar-empresa`:** se a pessoa já tem um vínculo ativo, redireciona para `/dashboard`. O app faz a mesma checagem na tela de criar empresa. Criar uma 2ª empresa de propósito fica fora da fase (não existe fluxo para isso hoje).
- **App:** papel desconhecido logado vai para a tela "Sem acesso", não para o login.

## Erros

- Toda carga confere erro e mostra "—" com aviso.
- Gravações com `.select('id')`.
- Mensagens em português (`mensagemErroBanco`).

## Testes

- Unitários:
  - `escolherEmpresaAtiva`;
  - `alertasCalculados` por permissão;
  - `contagemSino`;
  - endereço (ida e volta, e formato antigo);
  - `permissaoDaRota`;
  - validação de `next`.
- 097 em PGlite:
  - RLS de `push_dispositivos`;
  - backfill;
  - UPDATE de `notificacoes` que mexe só em `lida`.
- Crons:
  - teste do envio Expo com `fetch` falso (lote, token inválido apagado, empresa certa, preferências respeitadas);
  - resumo sem despesas para quem não tem `financeiro.ver`.
- Varredura cruzada:
  - nenhum `.limit(1)` de empresa em `web/app`;
  - telas de Notificações e Configurações usando as funções de shared;
  - textos iguais.
- Verificação: vitest 100%, tsc web 0, tsc mobile 8 e `next build`.

## Deploy

- Ordem livre. Sem a 097, o app cai no caminho atual (`users.push_token`) e não registra dispositivos.
- Recomendado: rodar a 097 antes do deploy.
- Build nativo novo do app: já obrigatório desde a Fase 2C.

## Fora do escopo

- SMTP próprio (decisão de 24/09: adiado).
- Criar uma 2ª empresa de propósito.
- Push de outros eventos além de lembrete, resumo e os avisos que já existem.
