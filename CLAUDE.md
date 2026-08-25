# Notas do projeto — App de Estética

---

## 🔍 SKILL: Auditor de Qualidade
> Roda **após cada feature entregue**. Score = média ponderada abaixo.

### Critérios e Pesos

| # | Critério          | Como verifica                                              | Peso |
|---|-------------------|------------------------------------------------------------|------|
| 1 | TypeScript        | `npx tsc --noEmit` — zero erros                            | 12%  |
| 2 | UX / Padrões      | SearchSelect, Skeleton, Masks aplicados consistentemente   | 10%  |
| 3 | Segurança         | RLS em tabelas novas, migration salva em arquivo           | 10%  |
| 4 | Documentação      | README atualizado, JSDoc/comentários nas novas funções     | 8%   |
| 5 | Arquitetura       | Padrões respeitados (lazy load, optimistic UI, triggers)   | 8%   |
| 6 | Performance       | Sem queries N+1, lazy tab loading, single range queries    | 7%   |
| 7 | Visual (UI)       | Screenshot via `run` skill + Claude_in_Chrome (requer Chrome com extensão ativa) | 5%   |
| 8 | **Completude**    | Feature 100% funcional, sem TODOs implícitos, edge cases   | 15%  |
| 9 | **Proatividade**  | Flagrou problemas antes de serem reportados, sugeriu melhorias | 5%  |
| 10| Nota Humana       | Usuário avalia de 0–10 ao final da entrega                 | 20%  |

> ⚡ **Retroalimentação #1 (2026-06-04):** Adicionados critérios de Completude (15%) e Proatividade (5%)
> com base em feedback do usuário: "escopo incompleto" e "falta de proatividade".

### Escala de conceito
| Score   | Letra | Significado                              |
|---------|-------|------------------------------------------|
| 9.0–10  | A+    | Excelente, pronto para produção          |
| 8.0–8.9 | A     | Muito bom, ajustes mínimos              |
| 7.0–7.9 | B     | Bom, alguns pontos de atenção           |
| 6.0–6.9 | C     | Aceitável, requer revisão               |
| < 6.0   | D     | Precisa de refatoração                  |

### Retroalimentação
- Histórico de auditorias salvo neste arquivo (seção abaixo)
- Critérios com score < 7 viram **prioridade** nas próximas entregas
- A cada 3 sessões, revisar se os pesos ainda fazem sentido

### Ferramentas utilizadas
- **TypeScript**: `npx tsc --noEmit` via PowerShell
- **Visual**: skill `run` + `verify` — roda o app e captura screenshot automaticamente
- **Code Review**: skill `code-review` — antes de fechar sessões grandes
- **Simplificação**: skill `simplify` — após features grandes, limpa código redundante
- **Exportação futura**: skills `pdf` e `xlsx` — quando implementar exportação
- **Documentação**: skill `doc-coauthoring` — para especificar features complexas antes de codar

---

## 📊 HISTÓRICO DE AUDITORIAS

### Sessão 2026-06-04 — Feature Pack #1
*Escopo auditado: Skeleton loading, SearchSelect, Estoque, Movimentações de Estoque,*
*Receita de insumos (servico_produtos), ConsumoModal na Agenda, Documentação geral.*

| Critério       | Nota | Observação                                                  |
|----------------|------|-------------------------------------------------------------|
| TypeScript     | 10.0 | `tsc --noEmit` zerado em todos os arquivos                  |
| UX / Padrões   | 8.5  | SearchSelect e Skeleton aplicados; faltam `loading.tsx` em agenda/clientes/financeiro |
| Segurança      | 9.0  | RLS documentado e migrations salvas; política de `servico_produtos` aplicada |
| Documentação   | 9.0  | README completo + JSDoc nos componentes principais          |
| Arquitetura    | 9.0  | Lazy loading, optimistic UI, trigger de estoque, receita de insumos |
| Performance    | 8.0  | Queries eficientes; algumas páginas sem memoização de supabase client |
| Visual (UI)    | —    | App não estava rodando localmente para screenshot           |
| **Nota Humana**| —    | *Aguardando avaliação do usuário*                           |

**Score final:** `8.5 / 10` → **A**
**Nota humana:** 7.0 · **Gap máquina vs humano:** 2.0 pts
**Feedback do usuário:** Escopo incompleto · Falta de proatividade

**Itens incompletos identificados:**
- `loading.tsx` ausente em 6 páginas (agenda, clientes, financeiro, servicos, equipe, estoque)
- ~~Tela de Relatórios não iniciada~~ — **resolvido em 2026-06-05**
- Sem feedback visual de sucesso após movimentação de estoque

---

### Sessão 2026-06-06 — QA Completo + Correção de Bugs

*Escopo auditado: Todas as 19 páginas, 3 componentes compartilhados, 14 migrations, lib/export.ts*

| Critério       | Nota | Observação                                                            |
|----------------|------|-----------------------------------------------------------------------|
| TypeScript     | 10.0 | `tsc --noEmit` zerado antes e após todas as correções                 |
| UX / Padrões   | 8.5  | Skeleton e SearchSelect consistentes; CNPJ/telefone sem máscara em configurações |
| Segurança      | 9.0  | RLS em todas as tabelas novas; correção de bypass via owner_id        |
| Documentação   | 9.0  | JSDoc mantido nos componentes novos (export, ExportButton, etc.)      |
| Arquitetura    | 8.5  | Singleton correto; triggers documentados; revert otimista corrigido   |
| Performance    | 8.0  | Queries eficientes; 13 queries paralelas no dashboard                 |
| Visual (UI)    | —    | Chrome sem extensão conectada durante auditoria                       |
| **Completude** | 8.0  | 13 bugs corrigidos; estoque duplo (material vs venda) identificado    |
| **Proatividade**| 9.0 | Flagrou owner_id em 9 arquivos, badge sidebar, revert otimista, email |
| **Nota Humana**| 7.8  | *"preciso ter estoque de vendas separado do estoque de materiais"*    |

**Score final (sem visual):** `8.6 / 10` → **A**
**Nota humana:** 7.8 · **Gap máquina vs humano:** 0.8 pts ✓ (melhor que sessão anterior)

**Bugs corrigidos nesta sessão:**
- `owner_id` em 9 arquivos (AppLayout, (app)/layout, agenda, clientes, clientes/[id], financeiro, equipe, estoque, servicos)
- Badge sidebar: precedência de operadores `(comissoes.count ?? 0 > 0)` → `((comissoes.count ?? 0) > 0)`
- Revert otimista na Agenda não capturava status original antes da mudança
- Campo e-mail em Configurações mostrava `••••••••` fixo
- Financeiro não incluía vendas avulsas no bruto (inconsistência com Dashboard/Relatórios)

---

---

### Sessão 2026-06-06 (continuação) — Feature Pack #2 + Finalização

*Escopo: Badge comissões sidebar, Despesas recorrentes auto-lançamento, Notificações filtro futuras,*
*Pacotes relatório de utilização, Exportação PDF/XLSX 9/9 páginas, createClient memoizado, tipos compartilhados,*
*UX despesas recorrentes (chave composta, meses pulados, clamp dia), Toast estoque.*

| Critério        | Nota | Observação |
|-----------------|------|------------|
| TypeScript      | 10.0 | `tsc --noEmit` zerado em todas as entregas |
| UX / Padrões    | 9.0  | Máscaras em configurações confirmadas; toast estoque adicionado; chave composta nas recorrentes |
| Segurança       | 9.0  | Sem novas tabelas; RLS mantido |
| Documentação    | 9.0  | JSDoc mantido; CLAUDE.md atualizado |
| Arquitetura     | 9.5  | createClient módulo-level em 100% dos arquivos; tipos compartilhados; chave composta para recorrentes |
| Performance     | 9.0  | Query de recorrentes otimizada (periodicidade no SQL, não no cliente) |
| Visual (UI)     | —    | Chrome extension conectada mas auditoria visual ainda não executada nesta sessão |
| **Completude**  | 9.5  | Todos os módulos entregues; 3 bugs corrigidos (typo, periodicidade, sessões ativas) |
| **Proatividade**| 9.5  | Bugs detectados e corrigidos proativamente; UX de recorrentes reescrita sem solicitação |
| **Nota Humana** | —    | *Aguardando avaliação do usuário* |

**Score parcial (sem visual/humana):** `9.3 / 10` → **A+**

---

### Sessão 2026-08-08 — Despesas recorrentes: data de término + progresso de vencimento

*Escopo: campo opcional `recorrencia_ate` em despesas recorrentes (web + mobile), auto-lançamento*
*mensal (web) para de sugerir recorrências encerradas, indicador "faltam N dias / atrasada há N dias"*
*com barra de progresso e resumo de valor pendente na listagem de despesas (web + mobile).*
*Executado via superpowers:subagent-driven-development — 11 tarefas, implementer + reviewer*
*dedicados por tarefa, todos os subagents dispatched com model explícito (haiku para tarefas*
*mecânicas, sonnet para lógica de negócio e math).*

| Critério        | Nota | Observação |
|-----------------|------|------------|
| TypeScript      | 10.0 | `tsc --noEmit` zerado no web em todas as 11 tarefas; mobile mantém os 10 erros pré-existentes (não relacionados, verificados contra a main antes de começar) sem nenhum erro novo |
| UX / Padrões    | 9.0  | Campo "Repetir até" reaproveita `inputClass`/`labelClass` (web) e `mascaraData`/`dataParaBanco` (mobile) sem inventar padrão novo; barra de progresso e resumo são 100% aditivos, nada removido |
| Segurança       | 9.0  | Migration único `alter table add column` nullable, sem novas políticas RLS necessárias (cobertura existente já cobre a coluna) |
| Documentação    | 9.0  | Spec e plano completos em `docs/superpowers/specs/` e `docs/superpowers/plans/`; JSDoc pt-BR nos 4 helpers novos em `shared/despesas.ts` |
| Arquitetura     | 9.0  | Lógica de datas extraída para funções puras testáveis (`recorrenciaAindaAtiva`, `diasParaVencimento`, `progressoVencimento`) em vez de inline; auto-lançamento filtra em JS (não via query PostgREST) para manter testabilidade |
| Performance     | 9.0  | Sem query nova para o progresso de vencimento (reaproveita `created_at`/`data_vencimento` já carregados); auto-lançamento continua uma única query de histórico |
| Visual (UI)     | —    | Sem conta de teste disponível para login no navegador local — verificação visual não executada nesta sessão (decisão do usuário) |
| **Completude**  | 9.5  | Recorrência com fim + indicador de vencimento entregues em web e mobile, 4 modais tocados, auto-lançamento ajustado; 1 bug real de lógica encontrado e corrigido antes do merge |
| **Proatividade**| 9.5  | Revisor encontrou e eu corrigi um bug de ordenação (filtro antes do dedup) que reviveria recorrências já encerradas — pego antes de chegar no usuário; escopo dos testes (tsc mobile) documentado como baseline pré-existente para não confundir auditorias futuras |
| **Nota Humana** | —    | *Aguardando avaliação do usuário* |

**Score parcial (sem visual/humana):** `9.3 / 10` → **A+**

**Bug encontrado e corrigido nesta sessão (revisão de subagent, Task 5):**
- Auto-lançamento: o filtro de recorrência encerrada rodava *antes* do dedup por chave composta, então uma linha antiga sem `recorrencia_ate` podia vencer sobre a linha mais recente que continha a data de término real — revivendo uma recorrência que o usuário já tinha encerrado, e apagando a data de término permanentemente nos meses seguintes. Corrigido: dedup primeiro, filtro depois.

---

### Sessão 2026-08-12 — Correção de KPI em Relatórios + taxa de reserva cobrada e descontada na comanda

*Escopo: (1) correção do "Lucro Real" em Relatórios, que contava despesas pendentes como gasto*
*(deveria contar só pagas, mesmo critério de Financeiro/Dashboard); (2) dois novos KPIs de valor*
*(Taxa de reserva, Taxa de cancelamento em R$) em Relatórios; (3) feature nova: toggle "Já foi*
*cobrada?" na taxa de reserva ao criar agendamento (web ×2 telas + mobile), e desconto automático*
*dessa taxa já paga no total da comanda ao fechar (web + mobile), com linha explícita no resumo.*
*Executado via superpowers:subagent-driven-development — 8 tarefas na feature de comanda,*
*implementer + reviewer dedicados por tarefa; a correção de Relatórios e os KPIs foram*
*implementados diretamente (escopo pequeno o bastante para dispensar o plano formal).*
*(Itens (1) e (2) de Relatórios foram entregues em branch separada da feature de comanda —*
*quem revisar o diff do branch `feat/taxa-reserva-desconto-comanda` não vai encontrá-los ali.)*

| Critério        | Nota | Observação |
|-----------------|------|------------|
| TypeScript      | 10.0 | `tsc --noEmit` zerado no web em todas as entregas; mobile mantém os 10 erros pré-existentes (verificados contra a baseline antes de começar), sem nenhum erro novo |
| UX / Padrões    | 8.5  | Checkbox "Já foi cobrada?" inicialmente usou classe Tailwind incorreta (`text-primary`/`focus:ring-accent`, sem efeito real em checkbox nativo sem plugin de forms) — corrigido para `accent-primary`, padrão já usado em 3 outros arquivos; corrigido antes de replicar o erro nas telas seguintes |
| Segurança       | 8.5  | Migrations aditivas (`ADD COLUMN` apenas); revisão de subagent encontrou uma lacuna real de RLS (SELECT de `taxas_reserva` só liberado para gestor/owner, zerando silenciosamente o desconto para profissionais fechando a própria comanda) — corrigida com nova policy espelhando o padrão já usado em `045_rls_comandas_pagamentos_por_profissional.sql`, sem afetar UPDATE |
| Documentação    | 9.0  | Specs e plano completos em `docs/superpowers/specs/` e `docs/superpowers/plans/`; JSDoc pt-BR nos 3 helpers novos em `shared/taxa-reserva.ts` |
| Arquitetura     | 9.0  | Lógica de desconto extraída para funções puras testáveis (`buildTaxaReservaInsert`, `somarTaxasReservaPagas`, `aplicarDescontoReserva`), mesmo padrão de `shared/despesas.ts`; comanda web/mobile compartilham os mesmos helpers apesar de manterem duplicação de UI já existente no projeto |
| Performance     | 8.5  | Query de taxas pagas na comanda não filtrava por agendamento (trazia todo o histórico `pago` da empresa) — na revisão final do branch isso foi reclassificado de "ponto de atenção para escala futura" para bug de corretude real: sem filtro nem `ORDER BY`, o limite padrão de 1000 linhas do PostgREST podia truncar exatamente a taxa paga mais recente, zerando o desconto e cobrando o cliente em dobro; corrigido em 2026-08-13 com `.in('agendamento_id', ...)` escopado aos agendamentos do dia, antes do merge |
| Visual (UI)     | —    | Sem conta de teste disponível para login no navegador local — verificação visual não executada nesta sessão |
| **Completude**  | 9.0  | Correção de Relatórios + 2 KPIs + feature completa de taxa de reserva na comanda entregues em web e mobile; 2 bugs reais encontrados em revisão e corrigidos antes do merge |
| **Proatividade**| 9.5  | Revisor encontrou proativamente a lacuna de RLS que teria zerado a feature em silêncio para o papel "profissional" — corrigida antes de chegar ao usuário; erro de estilo do checkbox identificado e corrigido preventivamente nas tarefas seguintes da mesma sessão |
| **Nota Humana** | —    | *Aguardando avaliação do usuário* |

**Score parcial (sem visual/humana):** `8.9 / 10` → **A**

**Bugs encontrados e corrigidos nesta sessão:**
- Relatórios: KPI "Lucro Real" somava despesas com qualquer status (inclusive pendentes) filtradas por `data_vencimento`, enquanto Financeiro e Dashboard já usavam `status = 'pago'` + `data_pagamento` — números divergiam entre telas para o mesmo período. Corrigido para o mesmo critério das outras duas telas.
- Comanda (Task 6, revisão de subagent): a policy de SELECT de `taxas_reserva` (criada na feature anterior) só liberava leitura para gestor/owner. Como profissionais já podem fechar suas próprias comandas, a query de desconto retornava lista vazia via RLS para esse papel — sem erro, sem aviso, só descontando R$ 0 mesmo com a taxa paga. Corrigido com nova migration liberando SELECT também para o profissional dono do agendamento (UPDATE continua restrito a gestor/owner).

---

### Sessão 2026-08-13 — Quantidade de parcelas em despesas recorrentes

*Escopo: extensão de despesas recorrentes (web + mobile) para definir o término da recorrência*
*por quantidade de parcelas em vez de digitar uma data — pedido do usuário a partir de uma*
*captura de tela de outro app, usada só como referência. No campo "Repetir até" (só quando*
*periodicidade = mensal), um toggle "Por data"/"Por quantidade de parcelas" permite informar o*
*total de parcelas e, se o contrato já estava em andamento, em qual parcela o cadastro começa —*
*o app calcula `recorrencia_ate` sozinho. Auto-lançamento mensal passa a incrementar um contador*
*"Parcela X de Y" a cada mês, mostrado na listagem. Executado via*
*superpowers:subagent-driven-development — 7 tarefas, implementer + reviewer dedicados por tarefa.*

| Critério        | Nota | Observação |
|-----------------|------|------------|
| TypeScript      | 10.0 | `tsc --noEmit` zerado no web em todas as entregas; mobile mantém os 10 erros pré-existentes (verificados contra a baseline antes de começar), sem nenhum erro novo |
| UX / Padrões    | 9.0  | Toggle "Por data"/"Por quantidade de parcelas" reaproveita o padrão visual já usado pelos chips de periodicidade (mesmas cores/estados); nenhum campo existente foi removido, só adicionado |
| Segurança       | 9.0  | Migration aditiva (`ADD COLUMN` apenas, 2 colunas nullable); sem política de RLS nova — já coberto pela regra existente de `despesas` (UPDATE restrito a gestor/owner desde a migration 003) |
| Documentação    | 9.0  | Spec e plano completos em `docs/superpowers/specs/` e `docs/superpowers/plans/`; JSDoc pt-BR no helper novo em `shared/despesas.ts`, incluindo a precondição de clamp documentada após a correção |
| Arquitetura     | 9.0  | Cálculo de data extraído para função pura testável (`calcularRecorrenciaAtePorParcelas`), mesmo padrão de `recorrenciaAindaAtiva`/`diasParaVencimento`; nenhuma mudança na lógica já testada de quando o auto-lançamento para (`recorrencia_ate` continua sendo a única fonte de verdade) |
| Performance     | 9.0  | Sem query nova — reaproveita a consulta de histórico de recorrentes já existente, só adicionando duas colunas ao SELECT |
| Visual (UI)     | —    | Sem conta de teste disponível para login no navegador local — verificação visual não executada nesta sessão |
| **Completude**  | 9.0  | Feature completa em 4 modais (web ×2, mobile ×2) mais auto-lançamento e listagem; 2 bugs reais encontrados em revisão de tarefa + 3 encontrados na revisão final de branch (visão que nenhuma revisão por tarefa isolada conseguiria ter), todos corrigidos antes do PR |
| **Proatividade**| 9.5  | O mesmo bug (falta de checagem de periodicidade mensal) foi encontrado uma vez no web e evitado proativamente nas duas tarefas mobile seguintes, avisando cada implementador antes de despachar; bug de data inválida (`parcelaAtual > totalParcelas`) encontrado na revisão da função pura antes de qualquer UI consumi-la; revisão final de branch (opus) despachada por disciplina do processo, não por sinal de problema — e mesmo assim encontrou 3 falhas reais na costura entre as 4 telas |
| **Nota Humana** | —    | *Aguardando avaliação do usuário* |

**Score parcial (sem visual/humana):** `9.2 / 10` → **A+**

**Bugs encontrados e corrigidos nesta sessão:**
- `shared/despesas.ts` (Task 2, revisão de subagent): `calcularRecorrenciaAtePorParcelas` gerava strings de data inválidas (ex.: mês `"00"` ou `"-3"`) quando `parcelaAtual` era maior que `totalParcelas` — entrada real e alcançável, já que a UI não impede o usuário de digitar um número de parcela fora do intervalo. Corrigido com clamp defensivo de `parcelaAtual` para `[1, totalParcelas]` dentro da própria função, fechando a classe inteira do bug (verificado para valores muito altos, zero e negativos, não só o caso testado).
- `web/app/(app)/financeiro/page.tsx` (Task 3, revisão de subagent): a lógica de salvar calculava `usaParcelas` sem checar `periodicidade === 'mensal'` — só a interface escondia o toggle fora do modo mensal, mas nada impedia gravar `parcela_atual`/`total_parcelas` numa despesa não-mensal se o usuário trocasse a periodicidade depois de escolher "por quantidade". Corrigido adicionando a checagem em ambos os modais (Nova e Editar); o mesmo gap existia no texto do plano para as tarefas mobile seguintes e foi evitado proativamente antes de despachar cada uma.

**Bugs encontrados e corrigidos na revisão final de branch (opus, após os 7 tasks já aprovados individualmente):**
- Selecionar "por quantidade de parcelas" e deixar a quantidade ou o vencimento em branco gravava `recorrencia_ate: null` em silêncio — uma despesa que nunca para de ser auto-lançada, sem erro nenhum na tela, porque o campo de data que acusaria o problema fica escondido atrás do toggle. Corrigido bloqueando o salvamento com mensagem de erro nos 4 pontos (web novo/editar, mobile novo/editar).
- O contador "Parcela X de Y" do auto-lançamento sempre somava +1 por lançamento, mesmo quando um ou mais meses eram pulados (usuário não abre o Financeiro todo mês) — o contador ficava permanentemente atrasado em relação à parcela real, contradizendo a garantia já existente de que o auto-lançamento é robusto a meses pulados (que vale para `recorrencia_ate`, mas não valia para esse contador). Corrigido com `proximaParcelaAtual`, que conta os meses realmente decorridos desde o vencimento do template em vez de somar 1 fixo.
- O clamp de `parcelaAtual` corrigido na Task 2 protegia o cálculo da data, mas não o valor gravado na coluna `parcela_atual` — digitar "15" numa despesa com 12 parcelas salvava `parcela_atual: 15, total_parcelas: 12` e exibia "Parcela 15 de 12" para sempre. Corrigido reusando o mesmo clamp (`clampParcelaAtual`, extraído da função de cálculo de data) nos 4 pontos de salvamento antes de persistir.

Nenhuma revisão por tarefa isolada poderia ter visto essas três falhas — cada uma vive na costura entre partes que, individualmente, passaram: a divergência entre a condição de visibilidade da UI e a condição de salvamento (achado 1), o comportamento do auto-lançamento ao longo de vários meses em vez de um só lançamento (achado 2), e a duplicação entre "calcular a data" e "persistir o número" que só aparece quando as duas coisas são comparadas lado a lado (achado 3). Reforça o valor da revisão final de branch mesmo quando todas as tarefas já vieram aprovadas.

---

### Sessão 2026-08-14/18 — Responsividade mobile PWA (parte 2) + remoção Importar CNPJ + recorrências (contagem derivada + valor dividido)

*Escopo: (1) correção de 5 problemas de UI mobile reportados por screenshot real do PWA no*
*iPhone (`viewport-fit=cover` ausente neutralizando todo `env(safe-area-inset-*)`, modal de*
*Detalhes do agendamento, rolagem lateral do Estoque, seletor Semana/Mês/Timeline, clareza do*
*card Comissões do Dashboard); (2) remoção do botão/feature "Importar CNPJ" do Financeiro,*
*sem mais nenhum uso no projeto; (3) feature maior: contagem "(X/Y)" de parcelas passa a*
*aparecer também para despesas recorrentes criadas só com data de término (calculada na hora*
*de exibir, sem gravar nada novo — funciona até em despesas já existentes), mais um novo modo*
*"Valor total da compra" que divide automaticamente entre as parcelas, com a diferença de*
*centavos absorvida só pela parcela sendo cadastrada agora e o auto-lançamento recalculando*
*(não copiando) o valor de cada mês futuro. Três branches/PRs separados*
*(#104, #105, #106), os dois primeiros via superpowers:subagent-driven-development (6 e 0*
*tasks — CNPJ foi direto, sem plano formal, escopo pequeno o bastante), o terceiro com 9 tasks.*

| Critério        | Nota | Observação |
|-----------------|------|------------|
| TypeScript      | 10.0 | `tsc --noEmit` zerado no web em todas as entregas; mobile mantém os mesmos ~10 erros pré-existentes (reconfirmados a cada task), sem nenhum erro novo em nenhum dos 3 branches |
| UX / Padrões    | 9.0  | Toggle "Valor da parcela"/"Valor total da compra" e formato compacto "(X/Y)" reaproveitam padrões visuais já estabelecidos; nenhuma tela perdeu função — a remoção do CNPJ foi a única exceção deliberada, pedida explicitamente |
| Segurança       | 9.0  | Migrations aditivas (`viewport` é config, não schema; `valor_total_compra numeric(10,2)` nullable sem default); nenhuma RLS nova necessária nos 3 branches |
| Documentação    | 9.0  | Spec e plano completos para os branches de responsividade e recorrências; CLAUDE.md atualizado; JSDoc pt-BR nos 4 helpers novos (`calcularParcelaDerivada`, `dividirValorCompra`, mais os 2 já existentes de `shared/despesas.ts` referenciados) |
| Arquitetura     | 9.5  | A contagem derivada foi desenhada para não exigir nenhuma migration nem backfill — reaproveita histórico já carregado (web) ou uma consulta nova leve (mobile), calculando na exibição em vez de persistir; o valor dividido recalcula a cada mês a partir de `valor_total_compra`/`total_parcelas` propagados, herdando a mesma robustez a meses pulados que `parcela_atual` já tinha, sem introduzir uma segunda forma de deriva |
| Performance     | 8.5  | Sem query nova cara — reaproveita dados já carregados (web) ou adiciona 1 query leve (mobile); a revisão final encontrou e corrigiu um risco real de escala (ver bugs abaixo) antes de virar problema em produção |
| Visual (UI)     | —    | Sem conta de teste disponível para login no navegador local — verificação visual não executada nesta sessão |
| **Completude**  | 9.0  | 3 entregas completas em web e mobile onde aplicável; 8 bugs reais encontrados em revisão (1 na branch de responsividade, 3 na branch de recorrências por task, 4 na revisão final de branch de recorrências), todos corrigidos antes do PR |
| **Proatividade**| 9.5  | O mesmo bug do botão "travado" (condição de `disabled`/`podeSalvar` dependendo de um campo que virou somente-leitura) foi encontrado uma vez no web (Task 4) e evitado proativamente no mobile (Task 7) só com um aviso no dispatch, antes de qualquer revisão apontar; a Task 9 (verificação final) encontrou por conta própria uma 4ª divergência entre os pontos de formulário que não estava no roteiro pedido |
| **Nota Humana** | —    | *Aguardando avaliação do usuário* |

**Score parcial (sem visual/humana):** `9.2 / 10` → **A+**

**Bugs encontrados e corrigidos na revisão final da branch de responsividade (opus):**
- Modal de Detalhes usava a classe `bm-modal` compartilhada (`html:has(.bm-modal) { overflow: hidden }`), que casa mesmo em elemento `display:none` — como o estado que abre esse modal também é setado pela Timeline (visível no desktop), selecionar um agendamento no desktop travava o scroll da página inteira. Corrigido com uma variante `bm-modal-mobile` escopada por media query.
- Duas causas-raiz documentadas na spec (dropdown de status cortado; rolagem lateral do Estoque) não se sustentaram sob inspeção mais profunda — uma delas contradita diretamente pelo CSS compilado do próprio projeto. Código mantido (a higiene de CSS continua válida), mas os 3 critérios de aceite correspondentes foram marcados como "não verificados" na spec, pendentes de validação num iPhone real.

**Bugs encontrados e corrigidos por task na branch de recorrências:**
- Task 4 (Critical): botão "Registrar"/"Salvar" ficava preso desabilitado ao usar "Valor total da compra" pelo caminho natural (campo Valor vira somente-leitura, `onChange` não dispara, `disabled={... || !valor}` nunca destrava). Corrigido nos 2 modais web.
- Task 7: mesmo padrão evitado proativamente no mobile (`podeSalvar`) antes de qualquer revisão apontar, só com um aviso explícito no dispatch citando o achado da Task 4.
- Task 9 (verificação final do plano): `mobile/nova-despesa.tsx` não validava valor inválido/zero no modo não-dividido, diferente dos outros 3 pontos — encontrado só por comparar os 4 lado a lado, corrigido replicando o padrão já usado nos outros 3.

**Bugs encontrados e corrigidos na revisão final da branch de recorrências (opus, após as 9 tasks já aprovadas individualmente):**
- O preview de valor calculado (`valorCalculadoPreview`) não checava `recorrente`/`periodicidade === 'mensal'`, diferente da condição real de salvar (`usaValorDividido`) — nos modais de **edição** isso não dava erro nenhum (o campo `valor` já vinha preenchido da despesa existente), só gravava silenciosamente um valor diferente do que a tela estava mostrando. Corrigido nos 4 pontos de formulário de uma vez.
- `dividirValorCompra` usava ponto flutuante puro (`Math.floor((total/n)*100)/100`), que erra em divisões decimais *exatas* (ex: R$3.071,16 ÷ 12) por causa de arredondamento binário — uma varredura de todos os valores de R$1 a R$5.000 encontrou 59.116 casos divergentes do correto. Reescrita com aritmética inteira em centavos, eliminando a classe inteira do bug.
- `calcularParcelaDerivada` não validava se `total` era positivo — encerrar uma recorrência numa data já passada produzia "(0/0)" ou contagem negativa na listagem. Corrigido para retornar "sem contagem" nesse caso.
- As duas consultas de histórico usadas pela contagem derivada não tinham `.limit()` explícito — o teto padrão de 1000 linhas do PostgREST descartaria exatamente as linhas *mais antigas*, que são a "âncora" de que o cálculo depende, em empresas com muitos anos de despesas recorrentes acumuladas. Protegido nas duas plataformas (mobile inverteu a ordem da consulta, gratuito; web adicionou `.limit(5000)` explícito, já que a consulta é compartilhada com o auto-lançamento).

Nenhuma das quatro falhas da revisão final de recorrências seria visível numa revisão por task isolada: a primeira só aparece comparando a condição de exibição com a condição de salvar lado a lado nos 4 pontos; a segunda exige rodar a função contra uma faixa ampla de valores, não só os 2 casos de teste escolhidos na Task 2; a terceira e a quarta exigem imaginar cenários de uso fora do caminho feliz (encerrar uma recorrência retroativamente; anos de histórico acumulado) que nenhuma task individual tinha motivo para considerar.

---

### Sessão 2026-08-25 — Taxas de reserva "pendentes" que nunca se resolviam

*Escopo: bug reportado da produção — a lista de Taxas de Reserva do Financeiro acumulava*
*dezenas de linhas "Pendente" sem que houvesse nenhuma cobrança real em aberto. Investigação*
*por leitura de código (sem acesso ao banco de produção), correção via migration 061 + ajuste*
*nas 4 leituras que exibem a lista, em web e mobile. Escopo pequeno o bastante para dispensar*
*spec/plano formais e subagents.*

**Causa raiz:** `taxas_reserva` tinha apenas duas saídas do status `pendente` — o clique manual
em "marcar como paga" no Financeiro, e o trigger de 055 (`cancelado`/`faltou` → `retida`).
O caminho normal, o atendimento acontecer, não mexia na linha. Toda taxa que nascia pendente
ficava pendente para sempre. Agravado por dois fatores: (1) o campo de taxa é auto-preenchido
com o valor sugerido ao escolher o serviço e o checkbox "Já foi cobrada?" nasce desmarcado,
então o caminho natural de criar um agendamento gera uma pendência; (2) esse checkbox só entrou
em produção em 13/08/2026 (PR #101) enquanto a feature está no ar desde 06/08 — na primeira
semana era *impossível* criar uma taxa que não nascesse pendente.

| Critério        | Nota | Observação |
|-----------------|------|------------|
| TypeScript      | 10.0 | `tsc --noEmit` zerado no web; mobile mantém exatamente os 10 erros pré-existentes, nenhum nos 4 arquivos tocados |
| UX / Padrões    | 9.0  | `cancelada` como estado terminal e `.neq('status','cancelada')` nas leituras espelham o que `taxas_cancelamento` já faz desde a migration 047 — nenhum conceito novo introduzido |
| Segurança       | 9.0  | Migration só troca um check constraint e recria uma função já existente; nenhuma policy nova. Corrigiu uma falha de RLS **silenciosa** (ver abaixo) |
| Documentação    | 8.5  | Cabeçalho da migration 061 documenta a causa raiz, o porquê de `cancelada` em vez de `pago`, e o SQL de rollback do backfill; sem spec formal (bugfix) |
| Arquitetura     | 9.5  | Correção feita 100% no banco: como web e mobile fecham a comanda com o mesmo `UPDATE agendamentos SET status='concluido'`, um trigger cobre as duas plataformas **e** quem marca "concluído" direto pela agenda, sem duplicar regra em 2 clientes |
| Performance     | 9.0  | Nenhuma query nova; o trigger reaproveita o `UPDATE` que a comanda já faz |
| Visual (UI)     | —    | Sem conta de teste para login local e sem acesso ao banco de produção — não executado |
| **Completude**  | 8.5  | Passado (backfill) e futuro (trigger) cobertos em web e mobile, mais 4 testes novos. Backfill **entregue mas não executado** — depende do usuário aplicar a migration |
| **Proatividade**| 9.5  | Encontrou, sem ter sido pedido, o bug de RLS silencioso do "marcar como paga" e o risco de receita em dobro que a correção óbvia (`pendente` → `pago`) teria criado |
| **Nota Humana** | —    | *Aguardando avaliação do usuário* |

**Score parcial (sem visual/humana):** `9.1 / 10` → **A+**

**Decisão de projeto — por que `cancelada` e não `pago`:** quando a taxa fica pendente, a comanda
cobra o valor **cheio** do serviço, porque o desconto de reserva só considera linhas com status
`pago`. O dinheiro dessa taxa, portanto, já entrou na receita dentro do fechamento da comanda.
Marcar a linha como `pago` no encerramento somaria o mesmo valor uma segunda vez ao faturamento
bruto (Dashboard, Financeiro e Relatórios somam `taxas_reserva` com `paga_em` preenchido).
`cancelada` encerra a linha sem tocar em nenhum número. Há um teste dedicado a travar isso.

**Bug adicional encontrado e corrigido:**
- `marcarReservaPaga` (web e mobile) fazia `.update()` sem `.select()`. O RLS de UPDATE de
  `taxas_reserva` só libera gestor/owner, então um clique de profissional afetava zero linhas e
  o Postgres devolvia **sucesso** — a tela recarregava, a taxa continuava pendente e nenhuma
  mensagem aparecia. Corrigido nos dois pontos com `.select('id')` e aviso explícito de permissão.

**Bug adjacente identificado e deliberadamente NÃO corrigido (fora do escopo pedido):**
- O trigger de 055 não tem ramo de reversão para `retida`: cancelar um agendamento e depois
  reagendá-lo deixa a taxa `retida` para sempre, mesmo que o atendimento venha a acontecer
  normalmente. É o mesmo tipo de falha que a migration 052 já corrigiu para `taxas_cancelamento`.
  A função nova incluiu ramo de reversão apenas para `cancelada`, que é o estado que ela própria
  introduz — mexer em `retida` seria ampliar o escopo por conta própria.

---

## ✅ ESCOPO COMPLETO — Todos os módulos entregues

| Módulo | Status |
|---|---|
| Dashboard | ✅ |
| Agenda | ✅ |
| Comanda (estoque + vendas integrados) | ✅ |
| Vendas avulsas | ✅ |
| Clientes + perfil + anamnese | ✅ |
| Financeiro + despesas recorrentes | ✅ |
| Serviços | ✅ |
| Pacotes + relatório de utilização | ✅ |
| Equipe + comissões + badge sidebar | ✅ |
| Estoque + movimentações + toast | ✅ |
| Relatórios | ✅ |
| Configurações (máscaras CNPJ/tel) | ✅ |
| Notificações (filtro futuras) | ✅ |
| Exportação PDF/XLSX (9/9 páginas) | ✅ |

## ⚠️ PENDÊNCIAS FUTURAS

### Dívida técnica — itens remanescentes
- [x] ~~Adicionar `loading.tsx` em todas as páginas~~ — resolvido em 2026-06-05
- [x] ~~Memoizar instância do `createClient()`~~ — resolvido em 2026-06-06 (continuação)
- [x] ~~Extrair tipos compartilhados para `web/types/index.ts`~~ — resolvido em 2026-06-06 (continuação)
- [x] ~~Módulo de Vendas~~ — resolvido em 2026-06-06
- [x] ~~Exportação de dados (9/9 páginas)~~ — resolvido em 2026-06-06 (continuação)
- [~] ~~Renomear pasta~~ — **decisão: manter nome com acento** para preservar histórico de sessões e memórias do Claude Code (4.5 MB de contexto). Claude in Chrome cobre a auditoria visual.
- [x] ~~Conectar extensão "Claude in Chrome"~~ — conectado pelo usuário em 2026-06-06

### Features planejadas — próximas sessões
- [ ] **Controle de acesso por role** — diferenciar UI/ações com base em `empresa_membros.role` (`owner`/`gestor`/`profissional`). Ex: profissionais só veem a própria agenda e comissões; apenas gestores/owners editam serviços, equipe e financeiro. Requer: ler `role` no contexto da sessão (já disponível em `empresa_membros`) e condicionar renderização/rotas.
