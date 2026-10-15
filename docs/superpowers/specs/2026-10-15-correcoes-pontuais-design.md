# Pendências — Entrega 4: correções pontuais

**Data:** 2026-10-15 · Branch `feat/pendencias-registradas` (depois das Entregas 1–3).
Fonte: seções "Registrados, não corrigidos" do CLAUDE.md (Comanda A/B, Cartões, Vendas, Estoque, Equipe) e as
pendências menores da Fase 2B.

| # | Pendência | Correção |
|---|---|---|
| 4 | Mês com fechamento importado: linha "Serviços extras" ao vivo enquanto o bruto é o importado | Com mês importado inteiro no período, extras/vendas/taxas avulsas não aparecem como linha própria — ficam "incluídos no fechamento importado" (mesma nota já usada nos gráficos), web e app, Financeiro/Relatórios/exportações |
| 7 | Taxa de cartão 0% gravada como `null` (reabre "não cadastrada") | `montarPagamentos` grava `taxa_perc = 0` quando a configuração tem 0%; `null` só quando não há taxa cadastrada; `valor_liquido = valor` com 0% |
| 8 | "0.250" em campo de dinheiro lido como 250 | `parseValorBR`: `^-?0\.\d+$` é decimal (mesma regra de `parseQuantidadeBR`); testes |
| 9 | Quem fechou a comanda mantém acesso após perder a chave (F10) | `comanda_pertence_ao_profissional`: ramo `profissional_id = auth.uid()` exige vínculo ativo na empresa (migration 093) |
| 10 | Funções não conferem cliente/maquininha/profissional da mesma empresa | `fechar_comanda`, `editar_comanda`, `registrar_venda_avulsa_v2`: conferem `cliente_id`, `maquininha_id` e `profissional_id` dos extras contra `empresa_id` (093, recriando as funções a partir do corpo da 090) |
| 11 | **Confirmado em produção (2026-10-15):** `vendas` e `venda_itens` só têm "membro gerencia" (ALL) + as da 086 (`vendas.acessar` ve/deleta); a 046 nunca rodou — qualquer membro vê, altera e apaga vendas pela API | 093: drop "membro gerencia" nas duas; cria INSERT para membro da empresa (a comanda da profissional grava a venda dos produtos); SELECT para `vendas.acessar` (já existe) **ou** `financeiro.ver` **ou** `is_gestor_ou_owner`; UPDATE e DELETE só `is_gestor_ou_owner` (mantém o "vendas.acessar deleta" da 086 para desfazer venda recém-criada sem itens). Conferir que Financeiro/Dashboard/Relatórios (`financeiro.ver`) e as funções 087/090 continuam lendo/gravando |
| 12 | Id da venda/comanda no app com `Math.random` | `expo-crypto` (`randomUUID`) no app; `shared/uuid.ts` aceita um gerador injetado; o app registra o do expo-crypto na inicialização |
| 13 | Profissional com Financeiro/Relatórios vê só os extras das próprias comandas, sem aviso | Aviso discreto nessas telas quando quem vê não tem `agenda.gerenciar_outras`/não é gestora: "Os serviços extras mostrados são só das suas comandas." |
| 14 | Erro de permissão de desconto com mensagem genérica | `mensagemErroBanco` reconhece as mensagens das funções (P0001/42501 com texto próprio) e mostra o texto da função; fallback atual |
| 15 | Ajustes de tela | Spinner do histórico de Vendas só na 1ª carga do dia; `carregar` do app de Vendas com contador de requisição; badges da Sidebar e do app conferem `.error` (sem número falso); alerta "0 lançadas" do lançamento de recorrentes com mensagem própria ("Todas as recorrentes deste mês já estavam lançadas.") |
| 16 | **Policies amplas em produção (consulta de 2026-10-15):** `pacote_uso: membro gerencia` (ALL — qualquer membro cria/apaga uso de sessão), `pagamentos: membro insere` e `comanda_itens: membro insere` (qualquer membro lança em qualquer comanda da empresa) | 093: `pacote_uso` — SELECT membro; INSERT/UPDATE/DELETE só com `pacotes.vender` ou ligado a atendimento da própria agenda/`agenda.gerenciar_outras` (conferir os callers: trigger `fn_registrar_uso_pacote` é definer; tela Pacotes "vincular"); `pagamentos` INSERT — `comanda_id` de comanda que pertence a ela ou `agenda.gerenciar_outras`/gestora, ou `venda_id` com `vendas.acessar`, ou membro na venda via comanda (conferir callers do caminho antigo); `comanda_itens` INSERT — comanda que pertence a ela ou `agenda.gerenciar_outras`/gestora. `empresa_all_avaliacoes` fica para a fase Agenda |
| — | Testes de fuso dependem de `process.env.TZ` | Fixar `TZ` no setup do vitest (`process.env.TZ = 'America/Sao_Paulo'`) e um teste rodando com UTC |

## Testes
Um teste por linha da tabela (regra pura, SQL por texto ou varredura de tela, conforme o caso).

## Produção
Rodar a 093 (ordem livre).
