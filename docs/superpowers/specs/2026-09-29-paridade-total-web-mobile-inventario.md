# Paridade total web × mobile — inventário de divergências

**Data:** 2026-09-29
**Origem:** pedido do dono — "deve corrigir e igualar TUDO sem exceção; não existe ter diferença mobile x desktop/web".
**Método:** 6 auditorias de leitura completa (Agenda; Comanda/Vendas; Clientes/Anamnese; Financeiro/Relatórios/Dashboard; Serviços/Pacotes/Estoque/Equipe/Comissões/Configurações/Notificações; Auth/Onboarding/Papéis), mais verificação direta no banco de produção.
**Regra geral:** o **web é a referência**, salvo onde marcado "→ mobile" (o mobile está mais correto e o web deve ser ajustado) ou "DECISÃO" (regra de produto a definir pelo dono).
**Mecanismo de paridade:** toda regra de negócio duplicada vai para `shared/` e passa a ser importada pelos dois lados, para as duas plataformas não voltarem a divergir.

Legenda de arquivos: W = `web/app/(app)/…`; M = `mobile/app/(empresa)/…`; MP = `mobile/app/(profissional)/…`.

## Decisões do dono (2026-09-29)
- **Contexto:** a equipe usa web desktop + PWA; o app Expo ainda não foi publicado, mas deve ser tratado como em produção. Não há dados gravados pelo app nativo, então as mudanças de modelo de dados no mobile não precisam de backfill.
- **Área da cliente final: REMOVER por completo.** Cliente não terá login nem acesso. Isso inclui:
  - o grupo `mobile/app/(cliente)`;
  - `useCliente.ts`;
  - o papel `cliente` em permissões e em `rotaInicial` (web e mobile);
  - o cadastro aberto de conta.
- **Configurações:** o perfil próprio (dados, senha, notificações, push) fica liberado para todos os papéis. Os dados da empresa só a dona edita. A gestora também edita as taxas.
- **Segmentação de clientes:** juntar as duas regras (segmentos do web + tags do mobile) numa função única em `shared/`.
- Demais itens marcados "DECISÃO" seguem a recomendação da auditoria e serão confirmados no plano da fase correspondente.

---

## P0 — Quebras estruturais (o app nativo não funciona sem isto)

> **Status (2026-09-30): entregue** pela Fase 1 (`docs/superpowers/plans/2026-09-29-paridade-fase1-fundacao.md`). Itens 1, 2, 3, 5 e 6 estão concluídos. Do item 4, ficam pendentes `/(profissional)/novo-agendamento` (fase Agenda) e `/(empresa)/editar-profissional/[id]` (fase Equipe). As rotas de notificação foram corrigidas. Aceitar convite e redefinir senha seguem pelo link do web nas duas plataformas até o app ser publicado.

1. **Entidade "cliente" errada no mobile.** O mobile trata cliente como `users` + `empresa_membros(role='cliente')`, mas desde a migration 031 todas as FKs (`agendamentos`, `anamnese_fichas`, `taxas_reserva`, `pacote_clientes`, `comandas.clientes_id`) apontam para `public.clientes`. Situação em produção:
   - **Verificado em produção (2026-09-29):** o embed `cliente:users!agendamentos_cliente_id_fkey` **dá erro**; com `clientes!` funciona.
   - Há **0** membros com `role='cliente'`.
   - Consequências:
     - A agenda, o dashboard e a área da profissional do app nativo não carregam.
     - A lista de clientes do mobile vem vazia (as 217 clientes reais não aparecem).
     - Não é possível cadastrar cliente pelo mobile: o insert em `users` com id aleatório viola a FK com `auth.users`.
   - Arquivos afetados:
     - Hooks: `mobile/hooks/useClientes.ts`, `useAgenda.ts:108`, `useDashboard.ts:31`, `useProfissional.ts:52,145,365`.
     - Telas: `M/novo-cliente.tsx`, `M/cliente/[id]/editar.tsx`, `M/novo-agendamento.tsx:259-279`, `M/agendamento/[id].tsx:96`, `MP/agendamento/[id].tsx:87`.
2. **Anamnese com duas fontes e o mobile sem conseguir gravar.**
   - O web grava JSON em `clientes.observacoes` (9 fichas em produção).
   - O mobile usa `anamnese_fichas` (0 linhas), que só tem policy de SELECT. INSERT e UPDATE são bloqueados pelo RLS.
   - Os campos também diferem:
     - Só no web: `problemas_saude`, `declaracao_aceita` (obrigatória, LGPD) e `salvo_em`, além do formato sim/não com detalhe.
     - Só no mobile: `tipo_pele`, `sensibilidade`, `autoimune` e `procedimento_anterior`.
   - → Unificar em `anamnese_fichas`, com a união dos campos em `shared/anamnese.ts`, RLS de escrita, migrar as 9 fichas e liberar `clientes.observacoes` para observações internas.
3. **Navegação do app nativo.**
   - `(empresa)/_layout.tsx` e `(profissional)/_layout.tsx` usam `<Tabs>` sem `href:null`. Toda rota solta vira aba.
   - Não existe `mobile/app/index.tsx`.
   - `onAuthStateChange` em `TOKEN_REFRESHED`/`USER_UPDATED` faz `router.replace(rotaInicial)` e volta para a primeira empresa, desfazendo a troca de empresa.
4. **Rotas inexistentes:** `/(profissional)/novo-agendamento` (MP/agenda.tsx:158), `/(empresa)/editar-profissional/[id]` (M/equipe.tsx:255), `/(profissional)/financeiro` e `/(profissional)/notificacoes` (notifications.ts:92-104).
5. **Cadastro mobile sempre dá erro:** `register.tsx:126` insere em `users` a linha que o trigger `handle_new_user` (016) já criou, gerando chave duplicada. O nome e o telefone se perdem.
6. **Onboarding ausente no mobile:** criar empresa, verificar e-mail, aceitar convite e redefinir senha. Um dono novo fica preso.

## P1 — Dinheiro (números e cobranças divergentes)

### Comanda / Vendas
- ✅ **Já corrigido (commit 7754720):** o atendimento recém-fechado continuava aparecendo aberto e gerava cobrança em dobro (web + mobile).
- Mobile fecha comanda com total > 0 **sem nenhum pagamento**, ou com pagamento parcial (web trava em W/comanda:1709).
- Mobile não grava bandeira, parcelas, `taxa_perc` nem `valor_liquido`, e não tem `taxas-cartao`.
- Mobile não grava o valor cobrado em `agendamentos.valor` / `agendamento_servicos.valor`. Com pacote, a comissão é gerada sobre o valor **cheio** no mobile e sobre **0** no web.
- Desconto em **%** no web e em **R$** no mobile: o mesmo "10" dá valores diferentes.
- Mobile não checa erro em `comanda_itens`, `estoque_movimentos`, `pagamentos`, `vendas` e `venda_itens`, e mostra "Comanda fechada!" mesmo quando algo falhou.
- Mobile: comanda só do dia de hoje, sem backlog, sem edição de comanda fechada, sem multi-serviço, sem remover item de agendamento, sem profissional em serviço extra (a comissão se perde), sem recibo por WhatsApp, sem editar valor e quantidade.
- **Mobile não tem a tela de Vendas avulsas (PDV)** nem a permissão `gerenciar_vendas`.
- Bugs no web:
  - `abrirComandaFechada` perde o desconto manual ao editar.
  - `editarComanda` não é atômico e não mexe em estoque nem em vendas.
  - `editarComanda` não aplica a Cortesia R$0.
  - A edição mistura comandas diferentes da mesma cliente no mesmo dia.
- → mobile:
  - Checar o erro do insert de `vendas` na venda de pacote.
  - Usar `.eq('empresa_id')` nos UPDATEs.
  - Escolher a empresa ativa (o web usa `limit(1)`).
- DECISÃO:
  - Métodos de pagamento repetidos: a comanda permite, o PDV não.
  - Produto sem estoque: o PDV bloqueia, a comanda não.
  - Validar desconto acima do subtotal (hoje nenhum dos dois valida) → validar nos dois.

### Financeiro / Relatórios / Dashboard
- **Fonte de receita diferente:**
  - Web: agendamentos concluídos sem pacote + `vendas` + taxas pagas.
  - Mobile: soma de `pagamentos`.
  - Nenhum KPI bate entre as plataformas.
- **Lucro:**
  - Web: bruto − taxa de cartão − comissões − gastos.
  - Mobile: bruto − gastos.
- **Comissão calculada de 2 formas dentro do próprio web** (percentual × tabela `comissoes`): Financeiro, Dashboard e Relatórios dão lucros diferentes para o mesmo mês. → Usar a tabela `comissoes` como fonte única, numa função `shared/kpis-financeiros.ts` consumida pelas duas plataformas em todas as telas.
- Mobile: `endOfMonth(...).toISOString()` em UTC−3 inclui o dia 1 do mês seguinte em gastos, despesas e retiradas.
- Mobile: o fechamento importado substitui só a receita (o web substitui receita e comissão e zera a taxa de cartão).
- Mobile: o gráfico de evolução quebra (`locale: {code:'pt-BR'}` inválido), e o dashboard mostra "+12% vs mês anterior" fixo no código.
- Mobile não tem:
  - lançamento automático de recorrentes (as parcelas não avançam);
  - KPIs de taxa de cartão, líquido, comissões e taxas;
  - exportação (os botões de Download estão mortos);
  - quase todas as abas de Relatórios;
  - navegação de mês no dashboard;
  - meta mensal;
  - reconquista, aniversariantes e despesas vencendo.
- Bugs no web:
  - Limite do mês no fuso do servidor.
  - Ticket médio mistura bases com e sem pacote.
  - A evolução não soma as taxas.
  - `pctLucro` sem comissões.
  - Código morto em `web/lib/financeiro/ajustes-mensais.ts`.
- → web:
  - Alerta de "comandas não fechadas" no Dashboard.
  - Linha "Após retiradas" no Financeiro.
  - Deltas vs período anterior nos Relatórios.
- DECISÃO: definição de "clientes que retornaram".

### Estoque
- Mobile não cadastra produto de **venda** (o tipo fica sempre `material`) nem `qtd_por_unidade`.
- As categorias de produto são gravadas em formatos incompatíveis:
  - Web: chaves minúsculas.
  - Mobile: rótulos.
- As unidades de medida também divergem.
- Mobile: "baixo" é `<` e o web usa `<=`. O mobile deixa a saída ficar negativa. A movimentação **mostra sucesso mesmo quando falha**. `parseBRLFloat` transforma "0.5" em 5.
- Mobile não tem a aba Movimentações, os filtros, o valor total e a exportação.

### Equipe / Comissões
- Reenviar convite pelo mobile **zera o `percentual_comissao`** (a API usa `?? 0`).
- Mobile não permite:
  - editar a profissional (tela inexistente; e o PATCH só aceita cookie);
  - desativar uma profissional ativa;
  - informar a comissão ao cadastrar;
  - definir `tipo_contrato`;
  - pagar comissões pela Equipe.
- Mobile: "Pagar comissão" não aguarda o resultado nem trata erro. As comissões aparecem só por mês e não há Comissões no menu.
- A área da profissional (MP) mostra a comissão errada: o valor inteiro, ou somando faltas e sessões de pacote.
- DECISÃO: qual o escopo de "Pagar": todas as pendentes, ou só as do período.

## P2 — Funcionalidade e regra

### Agenda
- Mobile não permite:
  - editar ou reagendar;
  - vários serviços por agendamento (e não grava `agendamento_servicos`);
  - duração editável;
  - aviso de conflito (e o ramo "Conflito" é código morto);
  - pré-check de bloqueio;
  - visão Mês;
  - timeline por profissional;
  - **trocar de semana** (as setas só mudam o rótulo);
  - mudar o status livremente, avaliação, exportação, aviso de taxa paga ao excluir.
- Mobile esconde atendimentos antes das 7h ou a partir das 20h. Owner e gestor que atendem não aparecem como profissionais. O valor 0 (cortesia) vira o preço cheio. Horários só de 30 em 30 minutos. A semana começa na segunda (no web, no domingo).
- Mobile não filtra bloqueios por profissional. A área da profissional não filtra `empresa_id`. Há violação das regras de hooks em `novo-agendamento.tsx`.
- Bugs no web:
  - Editar um agendamento legado começa sem serviços.
  - A taxa de reserva percentual é calculada sobre a última linha, não sobre o total.
  - O status é gravado sem `.select()`.
  - Atendimentos fora da janela de 7h a 22h somem da timeline.
  - Erros ignorados em `avaliacoes`, `vendas` e `agendamento_servicos`.
- → web:
  - Detalhe do atendimento com comanda e pagamentos.
  - Ligar, WhatsApp e Perfil a partir do agendamento.
  - Resumo do dia.
  - Confirmação antes de cancelar.
- DECISÃO:
  - Filtro "Todas as profissionais" (o mobile tem; o web proíbe de propósito).
  - Agendar em data passada.
  - Filtro inicial da agenda.

### Clientes
- Mobile não tem:
  - Segmentos com KPIs clicáveis;
  - Novas no mês, Aniversariantes do mês;
  - exportação, busca por e-mail;
  - histórico de vendas avulsas;
  - método de pagamento nas taxas;
  - serviço favorito;
  - endereço estruturado, data 1900-MM-DD e máscara de telefone;
  - redirecionamento para a anamnese depois de cadastrar.
- Mobile: a idade sai com ~126 anos para as datas do web, e o aniversário aparece um dia antes (UTC). O alerta de gestante nunca dispara. O WhatsApp duplica o 55. O campo "Observação" do cadastro é descartado. A invalidação do cache está errada depois de editar.
- → web:
  - Tags, filtros Retornos/Sumidas, total gasto e última visita na lista.
  - Alerta de restrições da anamnese.
  - Empresa ativa.
- DECISÃO: regras de segmentação. Web (VIP ≥8 atendimentos; Em risco >45d) × mobile (VIP ≥R$2000 ou ≥20 visitas; Sumida >60d).
- Schema drift: `clientes.endereco` não existe em nenhuma migration.

### Serviços / Pacotes
- Mobile não tem:
  - insumos (`servico_produtos`);
  - duração livre;
  - excluir de verdade;
  - pacote Combo (`controla_sessoes`), sessões ilimitadas, validade livre ou sem validade;
  - vender pelo catálogo;
  - aba Relatório de utilização;
  - exportação.
- Mobile: editar um pacote "sem validade" grava 90 dias. O pacote sincroniza serviços com delete+insert sem checar erro.
- → mobile: confirmação antes de excluir uma sessão de pacote.

### Configurações / Notificações / Papéis
- Mobile não tem:
  - segmento, meta mensal e upload de logo (o botão está morto);
  - máscaras e busca de CNPJ/CEP;
  - endereço estruturado;
  - trocar e-mail;
  - ativar push;
  - modo escuro;
  - alertas calculados;
  - badges;
  - Notificações para a profissional.
- **O servidor nunca envia push para o app nativo**: o cron só lê `web_push_subscriptions` e ignora `users.push_token`.
- O papel padrão é `gestor` no mobile (fail-open) e `profissional` no web. O mobile não protege rotas por papel.
- No mobile, o gestor edita dados da empresa, o que o web só permite ao dono.
- → web:
  - Trocar senha logada.
  - Trocar de empresa (o web usa `.limit(1)`).
  - "Meus ajustes" para a profissional e o gestor: hoje o web os bloqueia inteiro em `/configuracoes`, inclusive as preferências de notificação e o **único** lugar onde se ativa o push.
  - Parse monetário das taxas.
  - Filtro "Não lidas" em Notificações.
- Bugs no web:
  - `/convite/aceitar` fora de `PUBLIC_PREFIXES`.
  - O login ignora `next`.
  - `/auth/callback` sem `next` cai em "criar empresa", que permite criar uma 2ª empresa.
  - O badge da profissional conta despesas.
  - O cliente cai em 404 (`/inicio`).
- DECISÃO:
  - **Área da cliente final** (existe só no mobile e está quebrada pelo P0.1).
  - O gestor acessa Configurações?
  - Pedido de permissão de notificação (automático × no clique).

## Ordem de execução proposta
1. **P0** — fundação: entidade cliente, anamnese, navegação, onboarding. Sem isso, nenhuma paridade de tela importa.
2. **P1** — dinheiro: `shared/kpis-financeiros.ts`; comanda e PDV idênticos; estoque; equipe e comissões.
3. **P2** — módulo a módulo (Agenda → Clientes → Serviços/Pacotes → Configurações/Notificações), sempre extraindo a regra para `shared/`.
4. Limpeza de dados duplicados em produção (comandas de 25/06, 25/09 e 28/09) — SQL entregue ao dono.

Cada fase segue o fluxo spec → plano → execução por tarefa com revisão, e fecha com `tsc` web zerado, `tsc` mobile sem novos erros (baseline: 9) e suíte web verde.
