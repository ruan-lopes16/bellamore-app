# Contrato — convites com aceite e histórico da Equipe (migration 092)

Escrito na Task 1 da Entrega 3 (`docs/superpowers/plans/2026-10-15-convite-aceite-historico.md`).
As Tasks 2 (API), 3 (web) e 4 (app) consomem o que está aqui. Spec:
`docs/superpowers/specs/2026-10-15-convite-aceite-historico-design.md`.

## Tabelas

### `public.convites_equipe`
| coluna | tipo | observação |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `empresa_id` | uuid not null | FK `empresas`, cascade |
| `user_id` | uuid not null | conta existente convidada (FK `users`, cascade) |
| `email` | text not null | e-mail do convite (minúsculo). O aceite exige que seja o e-mail do login (`auth.users`) |
| `nome` | text | nome digitado no formulário (a convidada ainda não é colega: `users` não é legível pela RLS) |
| `role` | text not null | `'gestor'` \| `'profissional'` |
| `percentual_comissao` | numeric(5,2) not null default 0 | 0–100. **Valor final** a gravar no vínculo |
| `tipo_contrato` | text | `'pj'` \| `'clt'` \| null. **Valor final** a gravar no vínculo |
| `status` | text not null default `'pendente'` | `pendente` \| `aceito` \| `recusado` \| `cancelado` |
| `convidado_por` | uuid | quem convidou (vai para `feito_por` do `convite_enviado`) |
| `criado_em` | timestamptz default now() | |
| `respondido_em` | timestamptz | preenchido ao aceitar/recusar/cancelar |

- Índice único parcial `convites_equipe_um_pendente (empresa_id, user_id) where status = 'pendente'`:
  inserir um segundo pendente dá `23505`. **Task 2:** se já existe pendente para (empresa, conta),
  atualize essa linha (service role) em vez de inserir — a atualização de papel/comissão não gera
  histórico (só mudança de `status` gera).
- RLS: SELECT para `user_id = auth.uid()` ou `tem_permissao(empresa_id, 'equipe.gerenciar')`.
  `anon` sem nenhum acesso; `authenticated` sem INSERT/UPDATE/DELETE/TRUNCATE. Criar convite = rota
  com service role; mudar status = funções abaixo (ou service role).
- **Sem expiração** (a spec não define prazo).

### `public.equipe_historico`
| coluna | tipo | observação |
|---|---|---|
| `id` | uuid PK | |
| `empresa_id` | uuid not null | FK `empresas`, cascade |
| `alvo_user_id` | uuid | pessoa afetada |
| `acao` | text not null | `convite_enviado`, `convite_aceito`, `convite_recusado`, `convite_cancelado`, `login_trocado`, `desativado`, `reativado`, `papel_trocado`, `comissao_trocada`, `contrato_trocado` |
| `detalhe` | jsonb not null default `{}` | ver abaixo |
| `feito_por` | uuid | `auth.uid()`; **nulo** quando a mudança veio da rota com service role |
| `criado_em` | timestamptz default now() | |

- RLS: SELECT direto **só da dona** (`eh_dona_da_empresa`), porque ela vê e-mails sem máscara. Quem
  tem `equipe.gerenciar` lê por `listar_historico_equipe` (e-mails mascarados no banco). Sem escrita
  para anon/authenticated.
- Quem grava:
  - trigger em `convites_equipe` (INSERT → `convite_enviado`, `feito_por = convidado_por`; mudança de
    `status` → `convite_aceito`/`convite_recusado`/`convite_cancelado`, `feito_por = auth.uid()`);
    `detalhe = { email, nome, role, percentual_comissao, tipo_contrato, convite_id }`;
  - trigger em `empresa_membros` (AFTER UPDATE): `desativado`/`reativado` (`{}`), `papel_trocado`,
    `comissao_trocada` (números), `contrato_trocado` (`'pj'|'clt'|null`), todos com `{ de, para }`.
    O aceite não duplica (`reativado`/comissão) — só `convite_aceito`;
  - **Task 2 (`login_trocado`)**: a rota PATCH insere direto com o service role, depois de trocar o
    login com sucesso:
    ```ts
    await adminClient.from('equipe_historico').insert({
      empresa_id: empresaId, alvo_user_id: userId, acao: 'login_trocado',
      detalhe: { de: emailAntigoAuth, para: emailNovo }, feito_por: requesterId,
    });
    ```
    (As mudanças de comissão/contrato feitas pela mesma rota caem no trigger com `feito_por` nulo.)

## Funções (todas `security definer`, `set search_path = public`, execute só para `authenticated`)

| função | retorno | quem |
|---|---|---|
| `aceitar_convite(p_convite uuid)` | `uuid` (empresa em que entrou) | só a convidada |
| `recusar_convite(p_convite uuid)` | `void` | só a convidada |
| `cancelar_convite(p_empresa uuid, p_convite uuid)` | `void` | `equipe.gerenciar`; convite de gestora só a dona |
| `meus_convites()` | `table(id, empresa_id, empresa_nome, role, percentual_comissao, tipo_contrato, criado_em, convidado_por_nome)` | conta logada; só pendentes cujo e-mail é o do login |
| `listar_historico_equipe(p_empresa uuid, p_limite integer, p_offset integer)` | `table(id, empresa_id, alvo_user_id, acao, detalhe, feito_por, criado_em, alvo_nome, feito_por_nome)` | `equipe.gerenciar`; mais recentes primeiro; limite 1–200; e-mails (`de`, `para`, `email`) mascarados para quem não é a dona (`th***@gmail.com`) |
| `mascarar_email(text)` | `text` | auxiliar (immutable) |

Regras do aceite:
- conta convidada = `convites_equipe.user_id = auth.uid()` **e** e-mail do login (`auth.users.email`,
  sem diferenciar maiúsculas) = `convites_equipe.email`;
- convite `pendente`;
- convite de `gestor` só vale se `convidado_por` é a dona (mesma regra de `podeAtribuirRole`);
- sem vínculo → cria `empresa_membros` ativo com `role`, `percentual_comissao`, `tipo_contrato` do convite;
- vínculo inativo → reativa com comissão e contrato do convite; o papel **não** muda (só a dona muda
  papel — triggers 043/083). Papel do vínculo ≠ papel do convite → erro "desatualizado".
  **Task 2:** ao convidar quem tem vínculo inativo, grave `role = vinculo.role` e calcule
  comissão/contrato com `vinculoParaGravar(vinculoInativo, corpo)` (nunca zera);
- vínculo já ativo (entrou por outro caminho depois do convite) → só marca `aceito`, sem mudar o vínculo.

## Erros (mensagens exatas)

| mensagem | código | onde |
|---|---|---|
| `Sessão expirada. Entre de novo.` | P0001 | todas, sem `auth.uid()` |
| `Convite não encontrado.` | P0001 | aceitar/recusar (outra conta, e-mail diferente, id inexistente); cancelar (id inexistente ou de outra empresa) |
| `Este convite já foi respondido ou cancelado.` | P0001 | aceitar, recusar, cancelar |
| `Convite inválido: só a dona pode convidar uma gestora.` | P0001 | aceitar |
| `Este convite está desatualizado: o papel desta pessoa na equipe mudou. Peça um novo convite.` | P0001 | aceitar |
| `Só a dona pode cancelar o convite de uma gestora.` | P0001 | cancelar |
| `Sem permissão para gerenciar a equipe.` | 42501 | cancelar (a tela mostra "Você não tem permissão para cancelar o convite. Fale com a dona ou a gestora.") |
| `Sem permissão para ver o histórico da equipe.` | 42501 | listar (a tela mostra "Você não tem permissão para carregar o histórico da equipe. …") |
| `duplicate key … convites_equipe_um_pendente` | 23505 | INSERT de segundo pendente (só a rota) |

P0001 chega à tela como veio (`mensagemErroBanco`); 42501 vira o aviso de permissão em português.
Para a Task 2, sem a 092 o PostgREST devolve `PGRST205` (tabela) / `PGRST202` (função): use
`semMigration092(erro)` e responda 503 "Atualização do banco pendente: peça para rodar a migration 092."

## Exports de `shared/`

`shared/convites-consultas.ts` (client com `from` e `rpc`: `ClienteDbConvites`):
- `type ConviteRecebido = { id, empresa_id, empresa_nome, role: 'gestor'|'profissional', percentual_comissao: number, tipo_contrato: TipoContrato|null, criado_em, convidado_por_nome: string|null }`
- `type ConvitePendente = { id, user_id, email, nome: string|null, role, percentual_comissao: number, tipo_contrato, convidado_por: string|null, criado_em }`
- `TAMANHO_PAGINA_HISTORICO_EQUIPE = 30`
- `semMigration092(erro): boolean` — `PGRST202`/`PGRST205`/`42P01`/"could not find the function|table" (nunca 42883)
- `carregarMeusConvites(db): Promise<ConviteRecebido[]>` — sem a 092: `[]`
- `aceitarConvite(db, conviteId): Promise<string>` — devolve `empresa_id` (trocar a empresa ativa); lança com a mensagem do banco
- `recusarConvite(db, conviteId): Promise<void>`
- `carregarConvitesPendentes(db, empresaId): Promise<ConvitePendente[]>` — sem a 092: `[]`
- `cancelarConvite(db, empresaId, conviteId): Promise<void>` — chama `cancelar_convite`
- `carregarHistoricoEquipe(db, empresaId, pagina): Promise<{ linhas: LinhaHistoricoEquipe[]; temMais: boolean; disponivel: boolean }>` — página 0 = mais recente; `disponivel: false` = sem a 092 (esconder a aba)

`shared/equipe.ts`:
- `ACOES_HISTORICO_EQUIPE`, `type AcaoHistoricoEquipe`, `type LinhaHistoricoEquipe`
- `rotuloPapelEquipe(papel)` — Dona / Gestora / Profissional
- `descreverHistoricoEquipe(linha, nomes = {})` — frase em português (ex.: "Carla mudou a comissão de Thalia de 40% para 45,5%."); nomes: mapa da tela → nome do banco → nome/e-mail do convite; autor nulo = "Alguém"
- `quandoHistoricoEquipe(iso)` — "16/10/2026 14:30" em Brasília, sem Intl

## Produção
Rodar a 092 no SQL Editor **antes** do deploy da Task 2. Ela depende de `tem_permissao` e
`eh_dona_da_empresa` (083) e do enum `perfil_role`.
