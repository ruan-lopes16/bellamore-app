# Pendências — Entrega 3: convite com aceite + histórico da Equipe

**Data:** 2026-10-15 · Branch `feat/pendencias-registradas` (depois das Entregas 1 e 2).

## Decisões do dono (2026-10-15)
- **B:** quem **já tem conta** só entra na equipe depois de **aceitar o convite** (web e app).
- **C:** troca do e-mail de login fica registrada num **histórico da Equipe** (não há e-mail próprio para avisar).

## Situação hoje
- `POST /api/profissionais` e `POST /api/convites`: se o e-mail já tem conta, a pessoa é vinculada à empresa na hora
  (`empresa_membros` ativo), sem consentimento — inclusive a dona de outra empresa.
- Nenhum registro de quem mudou o quê na equipe (só `permissoes_historico` para permissões).

## Solução

### Banco — migration 092 (`092_convites_e_historico_equipe.sql`)
- **`convites_equipe`**: `id`, `empresa_id`, `user_id` (conta existente), `email`, `role` (`gestor`|`profissional`),
  `percentual_comissao`, `tipo_contrato`, `status` (`pendente`|`aceito`|`recusado`|`cancelado`), `convidado_por`,
  `criado_em`, `respondido_em`. Único parcial: um `pendente` por (empresa, user).
  RLS: SELECT para o próprio convidado (`user_id = auth.uid()`) e para quem tem `equipe.gerenciar` na empresa;
  sem INSERT/UPDATE direto (só pelas rotas com service role e pelas funções abaixo).
- **`aceitar_convite(p_convite uuid)`** e **`recusar_convite(p_convite uuid)`** (`security definer`, `search_path`,
  conferem `user_id = auth.uid()` e `status = 'pendente'`): aceitar cria/reativa o vínculo em `empresa_membros` com
  papel/comissão/contrato do convite (vínculo existente: mesma regra de `vinculoParaGravar` — não zera) e marca
  `aceito`; recusar marca `recusado`. Ambas registram no histórico.
- **`equipe_historico`**: `id`, `empresa_id`, `alvo_user_id`, `acao` (`convite_enviado`, `convite_aceito`,
  `convite_recusado`, `convite_cancelado`, `login_trocado`, `desativado`, `reativado`, `papel_trocado`,
  `comissao_trocada`, `contrato_trocado`), `detalhe jsonb` (de/para; e-mail com máscara para quem não é a dona),
  `feito_por`, `criado_em`. RLS: SELECT com `equipe.gerenciar`; INSERT só por funções/rotas (service role) e por um
  trigger em `empresa_membros` para ativo/papel/comissão/contrato (`security definer`).

### API
- POST (profissionais e convites): conta **nova** → como hoje (vínculo na hora; a pessoa criou a conta por esse
  convite). Conta **existente** sem vínculo nesta empresa (ou com vínculo inativo) → cria `convites_equipe` pendente e
  responde `{ status: 'convite_pendente' }` (a tela diz "Convite enviado. Ela precisa aceitar no app ou no site.").
  Vínculo ativo já existente → mesma regra de hoje (atualiza só o que veio, com `podeGerenciarMembro`).
- PATCH com troca de login → insere `login_trocado` no histórico (de/para, quem fez).
- Nova rota/consulta: cancelar convite pendente (`equipe.gerenciar`).

### Telas
- **Convidada** (web e app): banner "Você foi convidada para entrar na equipe de {empresa} como {papel}" com
  **Aceitar** / **Recusar** — no topo do app logado e na tela de criar empresa (quem ainda não tem empresa). Aceitar
  troca a empresa ativa para a nova (web: recarrega o contexto; app: `empresaAtiva`).
- **Equipe** (web e app): seção "Convites pendentes" (nome, e-mail, papel, data, **Cancelar**) e aba/seção
  **Histórico** (lista paginada, mais recentes primeiro, frases em português via `descreverHistoricoEquipe` em
  `shared/equipe.ts`).

## Testes
- SQL 092 por texto (tabelas, RLS, funções definer com conferência de `auth.uid()`, unique parcial, trigger de
  histórico) + PGlite para aceitar/recusar.
- `shared/equipe.ts` (`descreverHistoricoEquipe`), API por varredura (conta existente → convite pendente; nunca
  vincula direto), telas por varredura.

## Produção
Rodar a 092 **antes** do deploy (as rotas passam a gravar em `convites_equipe`; sem a tabela, o POST de conta
existente falha com mensagem clara em vez de vincular sem aceite).
