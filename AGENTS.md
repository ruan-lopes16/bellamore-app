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
| Documentação    | 9.0  | JSDoc mantido; AGENTS.md atualizado |
| Arquitetura     | 9.5  | createClient módulo-level em 100% dos arquivos; tipos compartilhados; chave composta para recorrentes |
| Performance     | 9.0  | Query de recorrentes otimizada (periodicidade no SQL, não no cliente) |
| Visual (UI)     | —    | Chrome extension conectada mas auditoria visual ainda não executada nesta sessão |
| **Completude**  | 9.5  | Todos os módulos entregues; 3 bugs corrigidos (typo, periodicidade, sessões ativas) |
| **Proatividade**| 9.5  | Bugs detectados e corrigidos proativamente; UX de recorrentes reescrita sem solicitação |
| **Nota Humana** | —    | *Aguardando avaliação do usuário* |

**Score parcial (sem visual/humana):** `9.3 / 10` → **A+**

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
- [~] ~~Renomear pasta~~ — **decisão: manter nome com acento** para preservar histórico de sessões e memórias do Codex (4.5 MB de contexto). Codex in Chrome cobre a auditoria visual.
- [x] ~~Conectar extensão "Codex in Chrome"~~ — conectado pelo usuário em 2026-06-06

### Features planejadas — próximas sessões
- [ ] **Controle de acesso por role** — diferenciar UI/ações com base em `empresa_membros.role` (`owner`/`gestor`/`profissional`). Ex: profissionais só veem a própria agenda e comissões; apenas gestores/owners editam serviços, equipe e financeiro. Requer: ler `role` no contexto da sessão (já disponível em `empresa_membros`) e condicionar renderização/rotas.

---

### Sessão 2026-07-13 — Ajustes de cabeçalho mobile

*Escopo auditado: Exportar em Clientes, Financeiro, Serviços, Pacotes, Equipe, Comissões, Relatórios, Estoque e Agenda; controles da Comanda; timeline da Agenda.*

| Critério | Nota | Observação |
|---|---:|---|
| TypeScript | 10.0 | `npx.cmd tsc --noEmit` sem erros |
| UX / Padrões | 9.5 | Exportar consistente, destacado em rosa e sem competir com os títulos no celular |
| Segurança | 10.0 | Alteração apenas de apresentação, sem dados ou políticas novas |
| Documentação | 9.5 | README, plano e JSDoc das novas opções do componente atualizados |
| Arquitetura | 9.5 | Variante reutilizável em `ExportButton`, sem duplicar a lógica de exportação |
| Performance | 9.5 | Sem consultas nem processamento adicional |
| Visual (UI) | — | Revisão automática indisponível: conexão com o navegador falhou nesta máquina |
| **Completude** | 10.0 | 54 testes passaram; inclui o posicionamento e os ajustes solicitados |
| **Proatividade** | 9.0 | Ajuste de espaço dos títulos e reflow dos controles de Estoque incluídos |
| **Nota Humana** | — | *Aguardando avaliação do usuário* |

**Score parcial (sem visual/humana):** `9.7 / 10` → **A+**

## Imported Claude Cowork project instructions
