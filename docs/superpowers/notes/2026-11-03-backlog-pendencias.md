# Backlog consolidado — pendências registradas (2026-11-03)

Fonte: seções "Registrados, não corrigidos" de todas as fases no CLAUDE.md (29/09 → 02/11).
Saíram desta lista os itens que uma fase posterior já resolveu (ex.: empresa ativa no web → 097;
taxa 0% e `expo-crypto` → 093; comanda não atômica → 090; deep links sem guarda → 097).
Cada item ainda precisa ser confirmado no código antes de virar task.

## A — Dinheiro ou número errado
| # | Item | Onde |
|---|---|---|
| A1 | Taxa de reserva `retida` (cancelado/faltou) nunca volta quando o agendamento é reagendado e atendido | 055/061 |
| A2 | Excluir 1 unidade de um pacote "Cobrar agora" vendido com várias deixa os pagamentos (devolução manual) | 096 |
| A3 | "Fat. hoje" da profissional sem o desconto rateado da comanda | agenda/área da profissional |
| A4 | Item adicionado ao editar comanda fechada de outro mês: comissão pelo `created_at`, receita pelo `fechada_at` (meses diferentes) | 085/090 |
| A5 | Validade do pacote em UTC no trigger 036/037 (último dia pode falhar nas últimas 3h) | 036/037 |
| A6 | Pacote com validade hoje some ao agendar | agenda |
| A7 | Elegibilidade de pacote em atendimento com vários serviços olha só a 1ª linha (web) | comanda web |
| A8 | Relatório de Pacotes conta pacotes antigos vendidos pelo catálogo sem venda (só histórico) | relatório pacotes |
| A9 | Cards por profissional e componentes da receita arredondados separado do total (1 centavo) | relatórios |

## B — Falha silenciosa, permissão ou segurança
| # | Item |
|---|---|
| B1 | Tirar `comanda_id` pela API contorna a trava de "Concluído" (nenhuma tela faz) |
| B2 | Telas novo/editar serviço do app abrem sem `servicos.gerenciar` (o banco recusa ao salvar) |
| B3 | "Reativar" na Equipe reativa sem novo aceite |
| B4 | Sessão expirada no app continua recebendo push até alguém entrar |
| B5 | Erro ao ler os vínculos leva a `/login`; convite troca a empresa ativa ao carregar |
| B6 | Exportar com erro de carga (Clientes) gera arquivo vazio |
| B7 | `novo-agendamento` do app carrega a base inteira de clientes e falha sem aviso |
| B8 | Badge com erro mostra 0 no app (web mantém o número); badge de comandas não respeita `comanda.fechar` |
| B9 | Gestora sem `agenda.ver_equipe` recebe a contagem da empresa inteira no resumo diário |
| B10 | Profissional com Financeiro/Relatórios vê só os extras das próprias comandas, sem aviso; segmentos de clientes idem |
| B11 | Gestora sem `pacotes.vender` não vê "Excluir" pacote |
| B12 | Troca de login sem aviso ao e-mail antigo |
| B13 | Conferências incompletas no banco: `pacote_uso` UPDATE; `pagamentos` com `comanda_id` + `venda_id`; FKs entre empresas nas tabelas de cartão |
| B14 | Push: token compartilhado por 2 contas recebe só o 1º resumo; recibos assíncronos da Expo não são lidos |

## C — Funcionalidade e aparência
| # | Item |
|---|---|
| C1 | Modo escuro nas telas secundárias do app + contraste de `primary`/`green` no escuro |
| C2 | Atendimento longo aparece só na 1ª hora da grade do app |
| C3 | Avaliação não editável no web |
| C4 | Cancelado não aparece nas agendas (reabrir fica difícil) |
| C5 | Seletor de dia do web usa o calendário local (não Brasília) |
| C6 | Contagem do mês da agenda do app não atualiza depois de mexer no detalhe/comanda |
| C7 | Filtro "Retornos" aceita data futura |
| C8 | Vincular pacote ao editar uma comanda já fechada |
| C9 | Pacote misto exibido como ilimitado |
| C10 | Exceção de bandeira copiada da padrão não acompanha mudanças; seletor de maquininha oculto com 1 ativa / pagamento reaberto em maquininha inativa |
| C11 | Painel de permissões: rascunho perdido ao trocar de aba sem aviso; dica "Escolha uma pessoa" no app |
| C12 | Paginação: clientes na agenda web, produtos nos insumos, histórico da equipe por offset |
| C13 | Gráficos do app: sparkline e rótulos que se sobrepõem em tela estreita; mensagens de erro duplicadas; alerta "0 lançadas"; spinner do histórico de Vendas pisca |
| C14 | Aviso de bloqueio pendente só no sino (sem push) |

## D — Decisões do dono (não mexer sem pedido)
- Valor do item da comanda editável sem `comanda.desconto` (27/10).
- Total gasto da cliente sem taxas (22/10).
- Comanda não bloqueia sem estoque (29/09).
- Área da profissional no app sem "Toda a agenda" nem aprovação de bloqueio (02/10).
- `financeiro.fechamentos` sem tela (importação por suporte).
