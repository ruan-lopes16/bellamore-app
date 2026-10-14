# Matriz de permissões: tela × banco (2026-10-14)

Revisão das 27 chaves de `shared/permissoes.ts` nas duas plataformas (web/PWA e app Expo) e no banco.
O banco considera a **última definição** de cada policy (migrations 083–089 sobre o estado de produção
de `2026-10-02-pg-policies-producao.csv`). A trava está no teste `web/tests/unit/permissoes-matriz.test.ts`.

Padrão: G = gestora, P = profissional (✔ ligado, ✘ desligado). A dona pode tudo.

Motivo da revisão: um bug de produção (commit 4088486). A profissional Thalia, com `comanda.fechar`, via
"Você não tem permissão para fechar a comanda". O INSERT em `comandas` pedia RETURNING, e a policy de
SELECT ainda não mostrava a comanda recém-criada para ela.

## Matriz

| # | Chave | Web/PWA | App | Banco (policy/função) | Padrão G/P | Veredito |
|---|-------|---------|-----|------------------------|-----------|----------|
| 1 | `agenda.ver_equipe` | Agenda: equipe toda e filtro por profissional | `(empresa)/agenda` | `agendamentos: ver` (SELECT) | ✔/✘ | OK |
| 2 | `agenda.gerenciar_outras` | Agenda (form, status, `podeMexerNoAgendamento`), Comanda (atendimento de outra), perfil da cliente (novo agendamento) | `novo-agendamento`, `agendamento/[id]`, `nova-comanda` | `agendamentos` INSERT/UPDATE, `taxas_reserva` SELECT, `pagamentos` SELECT (083/086); 089: `comandas` SELECT/UPDATE, `comanda_itens` SELECT/UPDATE/DELETE, `pagamentos` DELETE, `estoque_movimentos` INSERT, `agendamento_servicos` escrita | ✔/✘ | **Corrigido** (D1, D2, D3, D4) |
| 3 | `agenda.excluir` | Agenda: excluir | `agendamento/[id]` | `agendamentos: gestor ou owner exclui` (DELETE) | ✔/✘ | OK |
| 4 | `agenda.aprovar_bloqueios` | Agenda: bloqueio geral, aprovar/recusar | `agenda`, `useAgenda` | `agenda_bloqueios` ver/criar/aprovar/excluir | ✔/✘ | OK |
| 5 | `clientes.ver_todas` | — (a lista já vem filtrada pela RLS) | — (idem) | `clientes: membro ve` (SELECT) | ✔/✔ | OK (só banco, de propósito) |
| 6 | `clientes.cadastrar` | Clientes, cadastro rápido na Agenda | `novo-cliente`, `novo-agendamento` | `clientes: membro pode inserir`; RETURNING passa por `criado_por = auth.uid()` | ✔/✔ | OK |
| 7 | `clientes.editar` | perfil da cliente | `cliente/[id]`, `cliente/[id]/editar` | `clientes: membro pode atualizar` | ✔/✔ | OK |
| 8 | `clientes.arquivar` | perfil da cliente | `cliente/[id]` | trigger `fn_clientes_ativo_so_gestor` + UPDATE exige `clientes.editar` | ✔/✘ | **Corrigido** (D7) |
| 9 | `clientes.excluir` | perfil da cliente | `cliente/[id]` | `clientes: excluir` (DELETE) | ✘/✘ | OK (mensagem corrigida, D12) |
| 10 | `anamnese.ver` | perfil da cliente (aba Anamnese) | `cliente/[id]` | `anamnese: ver` (SELECT) | ✔/✔ | OK |
| 11 | `anamnese.editar` | perfil da cliente | `cliente/[id]`, `cliente/[id]/anamnese`, `novo-cliente` | `anamnese: inserir`/`atualizar` (+ SELECT no upsert/RETURNING) | ✔/✔ | **Corrigido** (D6) |
| 12 | `comanda.fechar` | Comanda, Dashboard (card), Sidebar (badge) | `nova-comanda`, `dashboard` | `comandas: membro insere` (INSERT) | ✔/✔ | **Corrigido** (4088486, D1, D10) |
| 13 | `comanda.desconto` | Comanda (desconto e Cortesia), Vendas | `nova-comanda`, `vendas` | `registrar_venda_avulsa` (087) | ✔/✔ | OK na venda avulsa; na comanda é só tela (F2) |
| 14 | `comanda.editar_fechada` | Comanda | `nova-comanda` | — | ✔/✔ | **Só tela** (F1) |
| 15 | `vendas.acessar` | `vendas/layout` (`exigirAcesso`), Sidebar | `mais`, `vendas` | `vendas`/`venda_itens` SELECT, `vendas` DELETE, `pagamentos` SELECT, `estoque_movimentos` INSERT, `registrar_venda_avulsa` | ✔/✘ | OK |
| 16 | `servicos.gerenciar` | Serviços (+ categorias e insumos) | `servicos`, `editar-servico` | `servicos` ALL, `categorias_servico`; 089: `servico_produtos` | ✔/✘ | **Corrigido** (D5, D11) |
| 17 | `pacotes.gerenciar` | Pacotes (catálogo) | `pacotes`, `editar-pacote` | `pacotes` ALL, `pacote_servicos` ALL (078 derrubou as escritas de membro) | ✔/✘ | OK (D11: `.select` nas escritas) |
| 18 | `pacotes.vender` | Pacotes, Agenda, Comanda | `novo-agendamento`, `nova-comanda` | `pacote_clientes: vender` (INSERT) | ✔/✔ | OK |
| 19 | `estoque.acessar` | `estoque/layout`, Estoque, Notificações, Sidebar | `estoque`, `dashboard`, `mais` | `produtos` INSERT/UPDATE, `estoque_movimentos`, `estoque_unidades_empresa`, `movimentar_estoque` | ✔/✘ | OK |
| 20 | `financeiro.ver` | Dashboard, `financeiro/layout`, `relatorios/layout`, Sidebar | `_layout`, `dashboard`, `mais` | `despesas`/`taxas_cancelamento`/`taxas_reserva`/`pagamentos` SELECT | ✔/✘ | OK |
| 21 | `despesas.gerenciar` | Financeiro | `financeiro` | `despesas` INSERT/UPDATE (DELETE só da dona) | ✔/✘ | **Corrigido** (D9) |
| 22 | `taxas.marcar_pagas` | Financeiro | `financeiro` | `taxas_reserva`/`taxas_cancelamento` UPDATE | ✔/✘ | OK |
| 23 | `financeiro.fechamentos` | — (sem tela; importação pelo suporte) | — | `financeiro_ajustes_mensais` INSERT/UPDATE | ✔/✘ | OK (só banco) |
| 24 | `equipe.gerenciar` | `equipe/layout`, Equipe, Sidebar, API `convites`/`profissionais` (`resolverPermissao`) | `equipe`, `editar-profissional`, `mais` | `membros: gestor ou owner atualiza`/`convida` | ✔/✘ | OK |
| 25 | `comissoes.ver_todas` | Comissões (escolhe a visão de gestão ou a própria) | `comissoes`, `mais` | `comissoes: ver` (SELECT) | ✔/✘ | OK no banco; diferença de tela registrada (F4) |
| 26 | `comissoes.pagar` | Comissões, Equipe, Relatórios | `comissoes`, `equipe`, `relatorios`, `useRelatorios` | `comissoes: gestor ou owner atualiza` | ✔/✘ | OK |
| 27 | `config.taxas` | Configurações, `CartoesConfig` | `configuracoes`, `CartoesConfig` | `empresas: gestor pode atualizar` + trigger só `taxa_*`, `cartao_*` ALL | ✔/✘ | OK |

Gates por papel que ficaram, de propósito: o painel de Permissões e o selo de exceções (`papel === 'gestor'`)
espelham `salvar_permissoes`; e `podeAtribuirRole(..., 'gestor')` equivale a `pode('dona')`. Mudar o papel
de alguém é só da dona (trigger 083).

## Divergências achadas e corrigidas

| Id | Classe | Onde | Problema | Correção |
|----|--------|------|----------|----------|
| D1 | (a) | Banco: `comanda_pertence_ao_profissional` | Na comanda só com extras fechada pela profissional, ela via a comanda, mas não os itens nem os pagamentos. Ao editar, a tela abria vazia, o DELETE dos pagamentos acertava 0 linhas, a conferência por contagem também dava 0 (invisível) e os pagamentos eram **reinseridos em dobro**. | 089: a função também vale para `comandas.profissional_id = auth.uid()` (quem fechou). |
| D2 | (a)/(c) | Banco: `comandas`, `comanda_itens`, `pagamentos` DELETE | A tela libera a comanda de outra profissional com `agenda.gerenciar_outras`, mas essas policies só tinham `is_gestor_ou_owner`. Uma profissional com essa exceção não lia os itens e não salvava a edição. Pagamentos SELECT e taxas_reserva SELECT já tinham o ramo. | 089: ramo `tem_permissao(empresa_id, 'agenda.gerenciar_outras')`. |
| D3 | (a) | Web Agenda, web perfil da cliente, app `novo-agendamento` | O INSERT em `agendamentos` pedia RETURNING (`.select()`). Com `agenda.gerenciar_outras` e sem `agenda.ver_equipe`, a linha da colega não passa no SELECT e o INSERT inteiro falhava com 42501. | Id gerado no cliente (`novoUuid`) e INSERT sem RETURNING, nas 3 telas. |
| D4 | (a) | Banco: `estoque_movimentos` INSERT | Produto extra na comanda de outra profissional (com `agenda.gerenciar_outras`): a baixa era recusada e a tela só avisava. | 089: ramo de saída ligada a atendimento da empresa para quem tem a chave. |
| D5 | (a) | Banco `servico_produtos` + web Serviços | A escrita era só da dona (008), mas a tela oferece os insumos a quem tem `servicos.gerenciar`. A gestora via "salvo" e a receita não mudava, porque os erros eram ignorados. | 089: policy por `servicos.gerenciar`. `sincronizarInsumos` passou a conferir os erros e avisa. |
| D6 | (a) | Anamnese (web e app) | Salvar é um upsert com RETURNING, então exige também `anamnese.ver`. Com editar e sem ver, a tela abria a ficha em branco, e salvar sobrescreveria a real (o banco recusava). | `podeEditarAnamnese(pode)` em `shared/permissoes.ts` = ver **e** editar, em todos os pontos. Descrição da chave atualizada. |
| D7 | (a) | Arquivar cliente (web e app) | O UPDATE de `ativo` exige `clientes.editar` (policy) **e** `clientes.arquivar` (trigger). A tela olhava só arquivar. | `podeArquivarCliente(pode)` = as duas. Descrição da chave atualizada. |
| D8 | (a) | Pacotes → vincular atendimento (web e app) | A sessão era lançada e depois um UPDATE sem `.select` vinculava o atendimento. Num atendimento de colega sem `agenda.gerenciar_outras`, o UPDATE acertava 0 linhas: a sessão era gasta e o atendimento seguia contando como receita. | O vínculo vem primeiro, com `.select('id')` e conferência. Se a sessão falhar, o vínculo é desfeito. |
| D9 | (a) | Financeiro (web e app) | O botão "Excluir despesa" aparecia para quem tem `despesas.gerenciar`, mas o DELETE é só da dona. No web, sem `.select`, era sucesso falso. No app, a mensagem dizia "Só gestores". Pagar e editar despesa não conferiam as linhas afetadas. | O botão aparece só para `pode('dona')`, o DELETE tem `.select('id')`, e as mensagens foram corrigidas. Pagar e editar ganharam `.select('id')`. |
| D10 | (d) | Sidebar web (badge de comandas) | O Dashboard (web e app) só conta comandas não fechadas com `comanda.fechar`. A Sidebar contava sempre. | O badge também exige `comanda.fechar`. |
| D11 | (a) sucesso falso | Serviços (web: excluir, ativar; app: ativar, editar, desativar) e Pacotes (web: salvar, ativar, excluir; app: ativar, editar, desativar) | UPDATE/DELETE sem `.select` | `.select('id')` com conferência das linhas e mensagem de permissão. |
| D12 | texto | Excluir cliente (web e app) | A mensagem dizia "apenas a dona", mas a regra agora é a chave `clientes.excluir`. | Texto neutro. |
| D13 | (a) sucesso falso | App `(profissional)/agendamento/[id]` (status) | UPDATE sem `.select` | `.select('id')` com conferência. |
| D14 | (b) | Banco `agendamento_servicos` | `membro gerencia` FOR ALL: qualquer membro alterava os serviços de qualquer atendimento, mais do que a policy de `agendamentos` deixa. | 089: a escrita segue `agendamentos` (atendimento próprio ou `agenda.gerenciar_outras`). A leitura continua para membro. |
| D15 | erro não conferido | Venda do pacote na Agenda (web e app) e serviços do agendamento (web) | Os INSERTs de `vendas` e `agendamento_servicos` não conferiam o erro. | O erro é conferido: em `vendas` a tela avisa sem abortar (o pacote já foi vendido); em `agendamento_servicos` mostra o erro. |

### Varredura da profissional com os padrões (sobre as coisas dela)

Cada passo foi conferido por leitura do SQL: INSERT, RETURNING, UPDATE/DELETE com `.select` e as leituras
seguintes da mesma tela.

- **Fechar comanda.** Todos os passos passam: INSERT `comandas` sem RETURNING (`comanda.fechar`), UPDATE `agendamentos` próprio com `.select`, `agendamento_servicos` próprio, `comanda_itens` INSERT (membro), `pacote_clientes` INSERT (`pacotes.vender`), `vendas` e `venda_itens` INSERT sem RETURNING (membro), `estoque_movimentos` ligado ao próprio atendimento e `pagamentos` INSERT (membro).
- **Editar a comanda fechada, recibo e perfil da cliente.** Passam depois do D1: `comandas` por `profissional_id` (quem fechou) e por atendimento, e `comanda_itens` e `pagamentos` via `comanda_pertence_ao_profissional`. Isso inclui a comanda só com extras.
- **Desconto e cortesia.** Passam: são só tela na comanda (F2).
- **Agenda.** Passam: criar, editar, concluir, status e cancelar (própria agenda), e o bloqueio pendente com RETURNING via `criado_por`. Cancelar cria a taxa pelo trigger definer (052).
- **Clientes.** Passam: cadastrar (RETURNING via `criado_por`), editar e anamnese (ver e editar padrão ✔).
- **Venda de pacote.** Passa: `pacote_clientes` com RETURNING via "membro ve".
- **Vendas avulsas.** Fora do padrão da profissional (`vendas.acessar` ✘). Com a exceção, a 087 e as policies da 086 cobrem.

## Fora do escopo (com motivo)

| Id | O quê | Motivo |
|----|-------|--------|
| F1 | `comanda.editar_fechada` não tem trava no banco | A comanda nasce `fechada`, e o próprio fechamento grava itens e pagamentos nela. O banco não distingue "fechar" de "editar" sem um estado novo. Travar só o UPDATE de `comandas` deixaria a edição pela metade (os itens são gravados antes). Fica só na tela, nas duas plataformas. |
| F2 | `comanda.desconto` na comanda não tem trava no banco | O desconto é gravado junto com o desconto de reserva e reaberto na edição. Travar exigiria um trigger comparando OLD e NEW. O total coberto continua conferido. Na venda avulsa, a 087 confere. |
| F3 | Comanda só com extras fechada por profissional sem `estoque.acessar`/`vendas.acessar`: a baixa de estoque é recusada | `estoque_movimentos` não tem `comanda_id`. Abrir a saída sem atendimento para quem tem `comanda.fechar` deixaria baixar qualquer produto. Já estava registrado em 2026-10-02. |
| F4 | App: a gestora sem `comissoes.ver_todas` não tem "Comissões" no menu; no web ela vê a própria visão | Exige uma tela nova na área `(empresa)` do app, e a decisão é não criar telas nesta fase (fase Equipe/Comissões). |
| F5 | App: a área `(profissional)` não tem comanda, não tem a lista de clientes e tem a rota `novo-agendamento` inexistente | Já registrado (decisões de 29/09 e 03/10). No app, a profissional só muda status e pede bloqueio. |
| F6 | App `pacotes`: não tem o botão "Vender" | É paridade de tela, não de permissão: a venda pelo app acontece no agendamento e na comanda. |
| F7 | `pacote_clientes` UPDATE/DELETE e `pacote_uso` liberados para qualquer membro ("Excluir venda", sessões) | Tela e banco concordam (os dois liberam). É uma decisão da 083 e não há chave no catálogo. |
| F8 | Gestora sem `agenda.gerenciar_outras`: o banco ainda deixa mexer na comanda da colega (`is_gestor_ou_owner`), e a tela esconde | Mantido para não mudar o comportamento da gestora. A tela é a mais restrita. |
| F9 | UPDATEs sem `.select` em linhas da própria pessoa (`users`, `notificacoes`), em rotas de API com service role, `pacote_uso`, `pacote_clientes` e `pagamentos` DELETE da comanda web (conferido por contagem) | A RLS é a da própria linha ou a escrita é por service role. A lista exata, com o motivo de cada uma, está no teste. |

## Para produção

- Aplicar `089_permissoes_alinhamento.sql` no SQL Editor. A ordem é livre em relação ao deploy: o código novo funciona antes e depois da 089. Antes dela, D1, D2, D4 e D5 continuam como estavam.
- Conferências somente leitura:
  ```sql
  select pg_get_functiondef('public.comanda_pertence_ao_profissional(uuid)'::regprocedure); -- contém comandas c
  select policyname, cmd from pg_policies where tablename in ('agendamento_servicos','servico_produtos') order by 1; -- 4 + 2
  select count(*) from pg_policies where qual like '%agenda.gerenciar_outras%' and tablename in ('comandas','comanda_itens','pagamentos'); -- 7
  ```
