# Permissões configuráveis em Configurações

**Data:** 2026-10-02
**Status:** Aguardando revisão do dono

## Contexto

Pedido do dono: "minhas profissionais não estão conseguindo criar novas clientes; em
Configurações me dê uma parte para eu gerenciar todas as permissões de forma detalhada".

O bug imediato foi corrigido à parte, no PR #142 (migration 081 + `shared/erros.ts`):
`clientes` só aceitava INSERT/UPDATE de dona/gestora (migration 006), embora web e app
mostrassem "Novo cliente" para todos. Esta spec trata da segunda parte, a tela de permissões.

### Estado real de produção (pg_policies lido em 2026-10-02)

- `agendamentos`: não havia INSERT/UPDATE para profissional nem gestora, só a policy manual
  "gestor pode gerenciar agendamentos" (FOR ALL, apenas a dona). Criar agendamento era
  recusado e concluir/fechar comanda afetava 0 linhas em silêncio. **Corrigido no PR #142
  (migration 082).**
- `vendas`/`venda_itens`: "membro gerencia" (FOR ALL), porque a 046 nunca foi aplicada.
- `anamnese_fichas`: só a policy antiga de SELECT, porque a 080 ainda não foi aplicada.
- `comissoes`: além das versionadas, existe "gestor pode gerenciar comissoes" (FOR ALL, só a
  dona), manual.
- As demais tabelas do catálogo batem com os arquivos.
- `empresa_membros` ativos: 1 owner + 1 profissional. A dona tem linha `role = 'owner'` em
  todas as empresas.

### Estado atual (levantado no código)

- As permissões são **fixas em código**, em dois arquivos espelhados: `web/lib/permissions.ts`
  e `mobile/lib/permissions.ts` (`temPermissao(role, chave)`, 17–18 chaves). Elas decidem
  menus, rotas (`exigirPermissao` nos `layout.tsx`) e botões.
- O banco aplica as regras **por papel**, em ~80 policies espalhadas por 23 migrations, quase
  todas via `is_gestor_ou_owner(empresa_id)` (migration 003).
- Os arquivos de migration **não têm** policy de INSERT/UPDATE para `agendamentos`, mas
  profissionais criam agendamentos em produção. Existem policies criadas à mão que nunca
  voltaram para uma migration (o mesmo aconteceu com `servicos`, ver a spec de 2026-09-24).
- Configurações (web) inteira exige `configurar_empresa` (só a dona). A decisão de 29/09
  ("Meu perfil" para todos) ainda não foi aplicada no web.
- No app, a profissional usa uma área própria, `(profissional)`, com 7 telas e sem Clientes,
  Estoque ou Financeiro. Dona e gestora usam `(empresa)`.

## Decisões do dono (2026-10-02)

1. Permissões **por papel + exceção por pessoa**.
2. Detalhe **por ação** (~26 chaves agrupadas por módulo, lista abaixo).
3. **Dona e gestora** editam. A gestora só mexe no papel Profissional e nas exceções de
   profissionais, nunca no papel Gestora, em outra gestora ou em si mesma.
4. Armazenamento em **tabelas próprias** (não JSON), com **histórico visível** das últimas 50
   alterações.
5. Os padrões reproduzem **exatamente o comportamento de hoje**. Nada muda no dia do deploy.
6. Vale para **web, PWA e app**. A regra mora no banco, que é o mesmo para os três.
7. **A área da profissional no app não ganha telas novas.** Gerir permissões é tarefa da
   dona/gestora. No app, as permissões controlam os botões das telas que já existem, e a
   aba Permissões existe só em `(empresa)/configuracoes`.

## Catálogo de permissões

`shared/permissoes.ts` é a fonte única: chave, grupo, rótulo, descrição curta e padrão por
papel. "Banco" quer dizer aplicada pelas policies via `tem_permissao`. "Tela" quer dizer que
só esconde ou mostra, porque é um campo dentro de uma operação que todos precisam fazer e
travá-la no banco quebraria essa operação.

| Chave | Rótulo | Gestora | Profissional | Onde |
|---|---|---|---|---|
| `agenda.ver_equipe` | Ver agenda de toda a equipe | ✔ | ✘ | Banco (SELECT `agendamentos`) |
| `agenda.gerenciar_outras` | Criar/editar agendamento de outra profissional | ✔ | ✘ | Banco (082) |
| `agenda.excluir` | Excluir agendamento | ✔ | ✘ | Banco (DELETE `agendamentos`, 066) |
| `agenda.aprovar_bloqueios` | Aprovar/recusar bloqueios e bloquear agenda geral | ✔ | ✘ | Banco (068) |
| `clientes.ver_todas` | Ver todas as clientes (desligado: só as que atendeu) | ✔ | ✔ | Banco (SELECT `clientes`) |
| `clientes.cadastrar` | Cadastrar cliente | ✔ | ✔ | Banco (081) |
| `clientes.editar` | Editar cliente | ✔ | ✔ | Banco (081) |
| `clientes.arquivar` | Arquivar/reativar cliente | ✔ | ✘ | Banco (trigger 081) |
| `clientes.excluir` | Excluir cliente para sempre | ✘ | ✘ | Banco (DELETE `clientes`) |
| `anamnese.ver` | Ver anamnese | ✔ | ✔ | Banco (080) |
| `anamnese.editar` | Editar anamnese | ✔ | ✔ | Banco (080) |
| `comanda.fechar` | Fechar comanda (profissional: só as próprias) | ✔ | ✔ | Banco (073/075) |
| `comanda.desconto` | Dar desconto / cortesia | ✔ | ✔ | Tela |
| `comanda.editar_fechada` | Editar comanda já fechada | ✔ | ✘ | Tela* |
| `vendas.acessar` | Tela Vendas (registrar e ver vendas avulsas) | ✔ | ✘ | Tela*** |
| `servicos.gerenciar` | Gerenciar serviços e categorias | ✔ | ✘ | Banco (078, 063) |
| `pacotes.gerenciar` | Gerenciar catálogo de pacotes | ✔ | ✘ | Banco (078) |
| `pacotes.vender` | Vender pacote para cliente | ✔ | ✔ | Banco (`pacote_clientes`) |
| `estoque.acessar` | Ver e movimentar estoque | ✔ | ✘ | Tela** |
| `financeiro.ver` | Ver Financeiro, Relatórios e números do Dashboard | ✔ | ✘ | Banco (SELECT despesas e taxas) + Tela |
| `despesas.gerenciar` | Lançar, editar e pagar despesas | ✔ | ✘ | Banco (003) |
| `taxas.marcar_pagas` | Marcar taxas de reserva/cancelamento como pagas | ✔ | ✘ | Banco (047/054) |
| `financeiro.fechamentos` | Importar fechamentos mensais | ✔ | ✘ | Banco (040) |
| `equipe.gerenciar` | Gerenciar equipe (convidar, editar, desativar) | ✔ | ✘ | Banco (043) |
| `comissoes.ver_todas` | Ver comissões de todas | ✔ | ✘ | Banco (042) |
| `comissoes.pagar` | Pagar comissões | ✔ | ✘ | Banco (042) |
| `config.taxas` | Editar taxas de reserva e cancelamento | ✔ | ✘ | Tela (UPDATE `empresas` já é gestor/owner, 049) |

\* Editar e fechar usam as mesmas policies de `comandas` (073/075), sem coluna que distinga
as duas operações no banco.
\*\* A comanda de qualquer profissional baixa estoque (`estoque_movimentos`/`produtos`), então
travar no banco quebraria o fechamento.
\*\*\* A comanda da profissional grava `vendas` e lê de volta (`insert(...).select()`); travar o
SELECT quebraria o fechamento. A 046, que restringia isso, nunca foi aplicada em produção.

**Fixo, só com a dona, fora da tabela:** dados da empresa (nome, CNPJ, endereço, horário, logo,
segmento, meta), retiradas da sócia, valores sensíveis (`ver_financeiro_sensivel`), promover
alguém a gestora.
**Sempre liberado, fora da tabela:** a própria agenda, a própria comissão, Meu perfil.

## Design

### 1. Banco (migration 083)

```
permissoes_papel     (empresa_id, papel 'gestor'|'profissional', chave, permitido bool,
                      alterado_por uuid, alterado_em timestamptz)   PK (empresa_id, papel, chave)
permissoes_membro    (empresa_id, user_id, chave, permitido bool,
                      alterado_por, alterado_em)                    PK (empresa_id, user_id, chave)
permissoes_historico (id, empresa_id, alterado_por, alvo_tipo 'papel'|'membro',
                      alvo text (papel ou user_id), chave, de bool null, para bool null,
                      criado_em)                                    só INSERT (via função)
```

- `chave` tem CHECK contra a lista do catálogo, para que uma chave errada não seja gravada
  em silêncio.
- **`tem_permissao(p_empresa uuid, p_chave text) returns boolean`**, `stable security definer`:
  1. dona da empresa → `true`;
  2. não é membro ativo → `false`;
  3. linha em `permissoes_membro` → vale ela;
  4. linha em `permissoes_papel` para o papel do membro → vale ela;
  5. senão → padrão do catálogo (literal na função).
- **`minhas_permissoes(p_empresa) returns table(chave text, permitido bool)`**: a lista efetiva
  da pessoa logada, numa chamada só.
- **`salvar_permissoes(p_empresa, p_mudancas jsonb)`**, `security definer`. Valida quem salva
  (dona: tudo; gestora: só papel `profissional` e membros de papel `profissional` que não sejam
  ela mesma; demais: recusa com `errcode 42501`), faz upsert/delete nas tabelas e grava
  `permissoes_historico`, tudo numa transação. Uma "exceção" que volta para "padrão do papel"
  apaga a linha de `permissoes_membro`.
- As tabelas não têm policy de escrita direta. SELECT é liberado para membros da empresa
  (a tela da gestora precisa ler).
- **Reescrita das policies** da coluna "Banco": `is_gestor_ou_owner(empresa_id)` passa a
  `tem_permissao(empresa_id, '<chave>')`, preservando as demais condições de cada policy
  (ex.: comanda da própria profissional em 073/075). Cada policy tocada é recriada a partir do
  estado **real** de produção (Tarefa 1), não só dos arquivos.
- `clientes.ver_todas` desligado: o SELECT de `clientes` passa a liberar só as clientes com
  algum agendamento da própria profissional, mais as que ela cadastrou. Para isso, entra a
  coluna nova `clientes.criado_por uuid default auth.uid()`; as linhas antigas ficam `null`.
- Rollback completo no cabeçalho da migration.

### 2. Código compartilhado (`shared/permissoes.ts`)

- `CATALOGO_PERMISSOES` (chave, grupo, rótulo, descrição, padrão por papel) e tipo `ChavePermissao`.
- `resolverPermissao({ isOwner, papel, linhasPapel, linhasMembro }, chave)`: a mesma ordem da
  função SQL, como função pura testada.
- `permissoesPadrao(papel)`: usado como **fallback** quando `minhas_permissoes` não existe
  (migration ainda não aplicada) ou falha. Garante que o deploy seja seguro em qualquer ordem.
- `podeEditarPermissao(quemSalva, alvo)`: espelha a regra da gestora em `salvar_permissoes`,
  para a tela travar antes do banco recusar.
- Teste que lê a migration 083 e confere que a lista do CHECK e os padrões literais de
  `tem_permissao` batem com o catálogo.
- `web/lib/permissions.ts` e `mobile/lib/permissions.ts` passam a ser finos: as chaves antigas
  (`ver_resumo_financeiro` etc.) são mapeadas para as novas, ou trocadas nos pontos de uso.
  Fica um só vocabulário.

### 3. Web e PWA

- `getAppContext()` passa a trazer `permissoes: Set<ChavePermissao>` (via `minhas_permissoes`,
  com fallback). `exigirPermissao`, Sidebar e páginas consultam a chave, não o papel.
- **Configurações**: o layout deixa de exigir `configurar_empresa`. Três abas:
  - **Empresa**: só a dona. A gestora com `config.taxas` vê só o bloco de taxas.
  - **Permissões**: dona e gestora.
  - **Meu perfil**: todos.
- **Aba Permissões**, com três sub-abas:
  1. *Por papel*: grupos do catálogo, um switch por papel (Gestora | Profissional); a coluna
     Gestora fica só leitura para a gestora.
  2. *Por pessoa*: `SearchSelect` de membro (sem a dona; para a gestora, só profissionais).
     Cada chave tem 3 estados: *Padrão do papel (✔/✘)* / *Permitir* / *Bloquear*. Membros com
     exceções mostram o selo "N exceções".
  3. *Histórico*: as últimas 50 linhas de `permissoes_historico`, no formato
     "02/10 14:30 · Carla (gestora) · Profissional · Excluir agendamento: ✘ → ✔".
- Mudanças ficam pendentes numa barra "N alterações não salvas · Descartar · Salvar". Salvar
  chama `salvar_permissoes` e mostra um toast. Erro de permissão usa `mensagemErroBanco`.
- **Equipe**: selo "N exceções" por pessoa, com atalho para *Por pessoa* já filtrado nela.
- **Wiring**: cada botão e rota ligado a uma chave do catálogo passa a consultar a permissão
  efetiva (ex.: "Remover cliente" ↔ `clientes.arquivar`; "Excluir agendamento" ↔
  `agenda.excluir`; menu Estoque ↔ `estoque.acessar`; desconto na comanda ↔ `comanda.desconto`).
- A pessoa afetada recebe a mudança na próxima navegação, porque o contexto é lido a cada
  request do servidor.

### 4. App (Expo)

- `useAuthStore` passa a carregar as permissões efetivas (`minhas_permissoes` + fallback) na
  sessão e recarregar ao voltar ao app (foco).
- `(empresa)/configuracoes` ganha a aba Permissões (mesmas 3 sub-abas e mesma regra da gestora).
- As telas de `(empresa)` e `(profissional)` consultam a chave em vez do papel nos pontos do
  catálogo.
- **A área `(profissional)` não ganha telas nem menus novos** (decisão 7). Uma permissão
  liberada para profissional só aparece no app onde já existe tela para ela; no web/PWA,
  aparece em todo lugar.

### 5. Erros e casos de borda

- Quem perde uma permissão com a tela aberta: o próximo salvamento é recusado pelo banco e
  mostra o aviso em português (`mensagemErroBanco`).
- Membro desativado: `tem_permissao` retorna `false` (passo 2), mesmo com exceção gravada.
- Membro que muda de papel (profissional → gestora): as exceções são mantidas e passam a valer
  sobre o padrão do novo papel. A aba *Por pessoa* mostra isso.
- Gestora tentando burlar pela API: `salvar_permissoes` recusa (testado por leitura da função).
- Chave nova no futuro: entra no catálogo + CHECK + literal de padrão numa migration nova. O
  teste de paridade falha se algum dos três ficar faltando.

## Entrega

Plano via superpowers:writing-plans, execução por subagent-driven-development:

1. ~~Sondar produção~~: feito em 2026-10-02 (seção "Estado real de produção").
2. `shared/permissoes.ts` + testes (TDD).
3. Migration 083 (tabelas, funções, reescrita de policies, `clientes.criado_por`) + teste de
   paridade com o catálogo.
4. Web: contexto + `exigirPermissao`/Sidebar com chaves novas.
5. Web: Configurações em 3 abas + aba Permissões + selo na Equipe.
6. Web: wiring dos botões por chave.
7. App: store + aba Permissões em `(empresa)/configuracoes`.
8. App: wiring dos botões por chave.
9. Revisão final de branch.

**Dependência:** a 083 reescreve as policies de `clientes` (081) e de `agendamentos` (082),
ambas do PR #142, e as de `anamnese_fichas` (080). Esta branch só vira PR depois do #142
mergeado. Ordem obrigatória no SQL Editor: 080 → 081 → 082 → 083.

**Padrões ✔/✘ da tabela:** conferidos contra o banco real em 2026-10-02. Se algum ainda divergir do comportamento
real de hoje durante a implementação, vale o de hoje (decisão 5) e a tabela é corrigida.

**Deploy em qualquer ordem:** código novo sem a 083 usa o fallback (comportamento de hoje);
código antigo com a 083 se comporta igual, porque os padrões são idênticos. A 083 é aplicada à
mão no SQL Editor (nunca `supabase db push`), como todas as anteriores.

## Fora de escopo

- Telas novas na área `(profissional)` do app (decisão 7).
- Rota `(profissional)/novo-agendamento` do app, que ainda não existe (pendência da Fase 1 da
  paridade; a equipe usa web/PWA).
- Unificar as áreas `(empresa)` e `(profissional)` do app.
- Permissões por pessoa para a dona (ela sempre tem tudo).
- Exportar o histórico.

## Verificação

- `tsc` web zerado; mobile sem erro novo (baseline: 6 erros pré-existentes em 2026-10-02).
- Testes unitários do catálogo/resolvedor, da regra da gestora e da paridade SQL ↔ catálogo.
- Conferência em produção, somente leitura, depois de aplicada a 083: `minhas_permissoes`
  para cada papel bate com `permissoesPadrao`.
- Visual: depende de uma conta de teste de profissional, que hoje não existe. Se o dono criar
  uma, verificar no navegador.
