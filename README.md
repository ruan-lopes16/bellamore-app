# App de Estética — Documentação do Projeto

> Sistema de gestão para salões e estúdios de estética.  
> Stack: **Next.js 14 (App Router)** + **Supabase** + **Tailwind CSS**

---

## Índice

1. [Visão Geral](#visão-geral)
2. [Estrutura do Repositório](#estrutura-do-repositório)
3. [Stack Tecnológica](#stack-tecnológica)
4. [Banco de Dados](#banco-de-dados)
5. [Arquitetura da Web App](#arquitetura-da-web-app)
6. [Componentes Reutilizáveis](#componentes-reutilizáveis)
7. [Utilitários](#utilitários)
8. [Padrões de Código](#padrões-de-código)
9. [Configuração do Ambiente](#configuração-do-ambiente)
10. [Migrations](#migrations)
11. [Funcionalidades Implementadas](#funcionalidades-implementadas)
12. [Pendências e Roadmap](#pendências-e-roadmap)

---

## Visão Geral

O sistema é uma plataforma multi-tenant para gestão de estúdios de estética. Cada empresa
(salão/estúdio) tem seus próprios dados isolados por RLS (Row-Level Security) no Supabase.

### Módulos principais
| Módulo       | Status     | Descrição                                         |
|--------------|------------|---------------------------------------------------|
| Dashboard    | ✅ Pronto  | KPIs financeiros + agenda do dia + alertas        |
| Agenda       | ✅ Pronto  | Calendário semanal/mensal + criação de agendamentos |
| Clientes     | ✅ Pronto  | Cadastro + perfil + histórico + anamnese          |
| Financeiro   | ✅ Pronto  | Faturamento, comissões, despesas, evolução        |
| Serviços     | ✅ Pronto  | Catálogo com categorias + receita de insumos      |
| Equipe       | ✅ Pronto  | Profissionais + comissão + ativar/desativar       |
| Estoque      | ✅ Pronto  | Produtos + alertas + movimentações                |
| Pacotes      | 🔜 Pendente | Pacotes de serviços para clientes                |
| Relatórios   | ✅ Completo | KPIs, rankings, gráfico de evolução, 5 abas      |
| Vendas       | 🔜 Pendente | Venda de produtos/bebidas avulsos                |
| Configurações| 🔜 Pendente | Dados da empresa, CNPJ, horários                 |

---

## Estrutura do Repositório

```
app-estetica/
├── web/                        # Aplicação Next.js (principal)
│   ├── app/                    # App Router (pages + layouts)
│   │   ├── (app)/layout.tsx    # Layout base com autenticação
│   │   ├── dashboard/          # Página do dashboard (Server Component)
│   │   ├── agenda/             # Agenda interativa
│   │   ├── clientes/           # Lista + perfil de clientes
│   │   │   └── [id]/           # Perfil individual do cliente
│   │   ├── financeiro/         # Módulo financeiro
│   │   ├── servicos/           # Catálogo de serviços
│   │   ├── equipe/             # Gestão de profissionais
│   │   ├── estoque/            # Gestão de estoque
│   │   ├── criar-empresa/      # Onboarding (cadastro da empresa)
│   │   ├── login/              # Autenticação
│   │   └── cadastro/           # Cadastro de conta
│   ├── components/             # Componentes reutilizáveis
│   │   ├── Sidebar.tsx         # Navegação lateral
│   │   ├── Skeleton.tsx        # Loading states (shimmer)
│   │   ├── SearchSelect.tsx    # Dropdown com busca
│   │   └── AppLayout.tsx       # Layout wrapper com auth check
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts       # Cliente Supabase (browser)
│   │   │   └── server.ts       # Cliente Supabase (server/RSC)
│   │   └── masks.ts            # Máscaras de input (phone, CNPJ, CPF, CEP)
│   └── api/
│       └── profissionais/      # API Route para update de usuários (admin SDK)
│
├── mobile/                     # Aplicação React Native (Expo) — em desenvolvimento
│   ├── app/
│   │   ├── (empresa)/          # Telas para gestores/owners
│   │   ├── (profissional)/     # Telas para profissionais
│   │   └── (cliente)/          # Telas para clientes
│   ├── hooks/                  # Hooks de dados (useAgenda, useClientes, etc.)
│   └── lib/                    # Supabase client + utils
│
└── supabase/
    └── migrations/             # SQL de criação e evolução do schema
```

---

## Stack Tecnológica

### Web (`/web`)
| Tecnologia        | Versão  | Uso                                      |
|-------------------|---------|------------------------------------------|
| Next.js           | 14      | Framework React com App Router           |
| TypeScript        | 5.x     | Tipagem estática em todo o código        |
| Tailwind CSS      | 3.x     | Estilização utilitária                   |
| Supabase JS       | 2.x     | Client para autenticação e banco         |
| date-fns          | 2.x     | Manipulação de datas                     |
| lucide-react      | latest  | Ícones SVG                               |

### Banco de Dados
| Tecnologia      | Uso                                               |
|-----------------|---------------------------------------------------|
| Supabase        | PostgreSQL gerenciado + Auth + Storage + RLS      |
| PostgreSQL       | Triggers, funções, enums, constraints             |

---

## Banco de Dados

### Diagrama de Tabelas

```
empresas
  └── empresa_membros (profissionais/gestores vinculados)
  └── clientes (base de clientes da empresa)
  └── servicos
        └── servico_produtos (receita de insumos por serviço)
  └── pacotes
        └── pacote_servicos
  └── agendamentos
        ├── → clientes
        ├── → servicos
        ├── → users (profissional)
        └── → comandas
  └── comissoes (geradas via trigger ao concluir agendamento)
  └── despesas
  └── produtos
        └── estoque_movimentos (entradas/saídas; trigger atualiza estoque_atual)
  └── notificacoes
  └── anamnese_fichas

users (espelho de auth.users)
```

### Principais Tabelas

#### `empresas`
Representa cada salão/estúdio cadastrado. Ponto de partida do multi-tenant.
| Coluna      | Tipo    | Descrição                          |
|-------------|---------|-------------------------------------|
| id          | uuid    | PK                                  |
| owner_id    | uuid    | FK → users (dono da empresa)        |
| nome        | text    | Nome do estúdio                     |
| cnpj        | text    | CNPJ (opcional)                     |
| telefone    | text    | Telefone de contato                 |
| endereco    | text    | Endereço                            |
| ativo       | boolean | Soft delete                         |

#### `agendamentos`
Central do sistema. Conecta cliente + profissional + serviço + horário.
| Coluna            | Tipo              | Descrição                          |
|-------------------|-------------------|------------------------------------|
| status            | agendamento_status| agendado/confirmado/concluido/cancelado/faltou |
| valor             | numeric           | Valor cobrado (pode diferir do preço do serviço) |
| data_hora_inicio  | timestamptz       | Início do atendimento              |
| data_hora_fim     | timestamptz       | Fim calculado pela duração         |

**Trigger:** `trg_check_conflito_horario` — impede dois agendamentos no mesmo horário para o mesmo profissional.  
**Trigger:** `trg_gerar_comissao` — ao marcar `concluido`, gera registro em `comissoes` automaticamente.

#### `produtos` + `estoque_movimentos`
Controle de estoque com movimentações rastreadas.
- Campo `qtd_por_unidade`: usado quando `unidade = 'pct'` ou `'cx'` para saber quantas unidades há dentro do pacote/caixa.
- **Trigger:** `trg_atualizar_estoque` — atualiza `estoque_atual` automaticamente ao inserir uma movimentação.

#### `servico_produtos`
Receita de insumos de cada serviço. Usada para pré-preencher o consumo ao concluir um agendamento.
| Coluna     | Tipo    | Descrição                             |
|------------|---------|---------------------------------------|
| servico_id | uuid    | FK → servicos                         |
| produto_id | uuid    | FK → produtos                         |
| quantidade | numeric | Quantidade padrão consumida           |

### RLS (Row-Level Security)

Toda tabela tem RLS habilitado. As funções auxiliares principais são:

```sql
-- Retorna os empresa_ids acessíveis pelo usuário logado
minha_empresas() → setof uuid

-- Verifica se o usuário é gestor ou owner de uma empresa
is_gestor_ou_owner(p_empresa_id uuid) → boolean
```

**Regra geral:**
- `SELECT`: qualquer membro da empresa vê os dados
- `INSERT/UPDATE`: apenas owners e gestores
- `DELETE`: apenas owner

---

## Arquitetura da Web App

### Autenticação e Multi-tenant

O fluxo de autenticação segue este caminho:
```
Usuário acessa qualquer rota protegida
  → (app)/layout.tsx verifica sessão via Supabase server client
  → Se não autenticado: redirect('/login')
  → Se autenticado mas sem empresa: redirect('/criar-empresa')
  → Caso contrário: renderiza a página com Sidebar
```

### Server vs Client Components

| Tipo             | Onde usar                                             |
|------------------|-------------------------------------------------------|
| Server Component | Dashboard (dados estáticos, SEO, loading.tsx)         |
| Client Component | Todas as outras páginas (estado, interatividade)      |

A página de Dashboard é um **Server Component** (`async`) pois não tem estado interativo — busca todos os dados no servidor e renderiza. O `loading.tsx` ao lado fornece o skeleton enquanto aguarda.

As demais páginas são `'use client'` e buscam dados no `useEffect` após a montagem.

### Comunicação com Supabase

**Client-side (pages):**
```typescript
import { createClient } from '@/lib/supabase/client';
const supabase = createClient(); // cria uma instância singleton
```

**Server-side (dashboard, layouts):**
```typescript
import { createClient } from '@/lib/supabase/server';
const supabase = await createClient(); // async, usa cookies do request
```

**Admin SDK (API Routes):**
```typescript
// Usado em /api/profissionais/route.ts para atualizar auth.users
// Requer SUPABASE_SERVICE_ROLE_KEY (nunca expor no client)
```

---

## Componentes Reutilizáveis

### `SearchSelect` (`components/SearchSelect.tsx`)
Dropdown com busca em tempo real. Substitui o `<select>` nativo em todos os formulários.

```tsx
<SearchSelect
  options={[{ value: 'id', label: 'Nome', sub: 'Subtítulo opcional' }]}
  value={selectedId}
  onChange={(id) => setSelectedId(id)}
  placeholder="Buscar..."
  required // injeta <input hidden> para validação de form
/>
```

**Comportamento:**
- Clique no campo → abre em modo busca (input ativo)
- Filtra por `label` e `sub` simultaneamente
- `onMouseDown + preventDefault` nas opções evita que o `onBlur` feche antes do clique registrar
- Suporte a teclado (fechar com Escape via blur)

### `Skeleton` (`components/Skeleton.tsx`)
Sistema de loading states com animação shimmer.

```tsx
// Bloco genérico
<Sk className="h-4 w-32" />

// Layouts prontos para páginas completas
<SkStatGrid cols={3} />
<SkTableRows count={5} />
<SkCardList count={3} />
<SkKPIs />
<SkChart />
<SkPerfil />
<SkTabs />
<SkProfCard />
```

O CSS do shimmer está em `globals.css`:
```css
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
.sk {
  background: linear-gradient(90deg, #EDE8E3 25%, #F5F2EF 50%, #EDE8E3 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
  border-radius: 0.5rem;
}
```

### `Sidebar` (`components/Sidebar.tsx`)
Navegação lateral fixa. Define os links de navegação em um array `NAV` — para adicionar uma nova página, basta adicionar um item ao array.

---

## Utilitários

### `lib/masks.ts`
Funções puras de máscara de input (sem biblioteca externa).

| Função       | Formato resultado           | Uso                          |
|--------------|-----------------------------|------------------------------|
| `maskPhone`  | `(11) 99999-9999`           | Fixo (10d) e celular (11d)   |
| `maskCNPJ`   | `00.000.000/0001-00`        | Configurações da empresa     |
| `maskCPF`    | `000.000.000-00`            | Futuro: cadastro de clientes |
| `maskCEP`    | `00000-000`                 | Futuro: endereço             |

**Padrão de uso em inputs:**
```tsx
<input
  value={telefone}
  onChange={e => setTelefone(maskPhone(e.target.value))}
  maxLength={15}
  type="tel"
/>
```

---

## Padrões de Código

### Cálculo de Comissões
Comissões **não** são calculadas a partir da tabela `comissoes` — são calculadas em tempo real multiplicando o valor do agendamento pelo percentual do profissional:

```typescript
// Monta mapa { user_id → percentual_comissao }
const comMap: Record<string, number> = {};
membros.forEach(m => { comMap[m.user_id] = m.percentual_comissao ?? 0; });

// Calcula comissão de cada agendamento
const comissoes = agendamentos.reduce(
  (soma, ag) => soma + ag.valor * (comMap[ag.profissional_id] ?? 0) / 100,
  0
);
```

### Otimistic UI (Agenda)
Mudanças de status são aplicadas localmente antes da confirmação do banco:
```typescript
// Aplica imediatamente
setAgs(prev => prev.map(a => a.id === id ? { ...a, status } : a));
// Reverte se falhou
if (error) setAgs(prev => prev.map(a => a.id === id ? { ...a, status: statusAntigo } : a));
```

### Lazy Loading (Histórico do Cliente)
O histórico de agendamentos do cliente só é carregado quando a aba "Histórico" é aberta pela primeira vez:
```typescript
const [histCarregado, setHistCarregado] = useState(false);

function abrirHistorico() {
  setAbaAtiva('historico');
  if (!histCarregado) { carregarHistorico(); setHistCarregado(true); }
}
```

### Fluxo de Saída de Estoque
Ao marcar um agendamento como "Concluído", abre-se um modal com os insumos pré-definidos na receita do serviço (`servico_produtos`). O usuário ajusta as quantidades reais e confirma — o sistema insere em `estoque_movimentos` e o trigger `trg_atualizar_estoque` debita automaticamente de `produtos.estoque_atual`.

---

## Configuração do Ambiente

### Variáveis de Ambiente (`web/.env.local`)
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...   # Apenas server-side (API Routes)
```

> ⚠️ **Nunca expor `SUPABASE_SERVICE_ROLE_KEY` no client.** Ele é usado apenas em `/api/profissionais/route.ts` para atualizar `auth.users`.

### Rodando localmente
```bash
cd web
npm install
npm run dev   # http://localhost:3000
```

### Verificação de tipos
```bash
cd web
npx tsc --noEmit   # deve retornar zero erros
```

---

## Migrations

As migrations ficam em `supabase/migrations/` e devem ser rodadas em ordem no **Supabase SQL Editor**.

| Arquivo                            | Descrição                                              |
|------------------------------------|--------------------------------------------------------|
| `001_initial_schema.sql`           | Schema completo: todas as tabelas, triggers, RLS base  |
| `002_users_perfil.sql`             | Campos extras em `public.users` (email, etc.)          |
| `003_despesas_policies.sql`        | Políticas de escrita para despesas + `is_gestor_ou_owner()` |
| `004_estoque_policies.sql`         | Políticas de escrita para produtos e estoque_movimentos |
| `005_pacote_servicos_rls.sql`      | RLS para pacotes                                       |
| `005_push_token.sql`               | Tabela de push tokens para notificações mobile         |
| `006_clientes.sql`                 | Tabela `clientes` (separada de `auth.users`)           |
| `007_produtos_qtd_por_unidade.sql` | Coluna `qtd_por_unidade` em produtos (para pct e cx)   |
| `008_servico_produtos.sql`         | Tabela de receita de insumos por serviço               |

---

## Funcionalidades Implementadas

### UX Global
- ✅ Skeleton loading em todas as telas (shimmer animado)
- ✅ `SearchSelect` em todos os campos de seleção (busca em tempo real)
- ✅ Máscaras de input: telefone, CNPJ, CPF, CEP
- ✅ Feedbacks visuais (erros inline, estados de loading nos botões)

### Agenda
- ✅ Visão semanal e mensal
- ✅ Criação de agendamentos com busca de cliente/serviço/profissional
- ✅ Mudança de status com dropdown clicável
- ✅ Validação de conflito de horário (trigger no banco)
- ✅ Ao concluir: modal de consumo de insumos com ajuste de quantidades

### Clientes
- ✅ Lista com busca por nome/telefone/email
- ✅ Perfil completo com abas: Info | Histórico | Anamnese
- ✅ Histórico de agendamentos com lazy loading
- ✅ Novo agendamento diretamente do perfil do cliente

### Financeiro
- ✅ KPIs: Faturamento Bruto, Comissões, Faturamento Líquido, Gastos, Lucro Real
- ✅ Comparativo mês anterior com delta %
- ✅ Gráfico de evolução de 6 meses (Bruto / Comissões / Gastos)
- ✅ Gestão de despesas com suporte a recorrentes
- ✅ Despesas recorrentes permitem ajustar o valor apenas no mês vigente ao confirmar pagamento
- ✅ Marcar despesa como paga com data e forma de pagamento

### Estoque
- ✅ Catálogo de produtos com categorias e alertas de reposição
- ✅ Suporte a pct/cx com campo "unidades por pacote/caixa"
- ✅ Movimentações de entrada e saída
- ✅ Receita de insumos por serviço (para débito automático via agenda)
- ✅ Banner de alerta para produtos abaixo do mínimo

---

## Pendências e Roadmap

### Próximas telas
- [x] **Relatórios** — KPIs, gráfico evolução, 5 abas (Financeiro, Serviços, Equipe, Clientes, Estoque)
- [ ] **Pacotes** — pacotes de serviços para venda
- [ ] **Configurações** — dados da empresa (CNPJ, logo, horários)
- [ ] **Notificações** — central de notificações

### Features planejadas
- [ ] **Módulo de Vendas** — venda de produtos/bebidas avulsos (fora de agendamentos). Registrado em 2026-06-04.
- [ ] **Controle de acesso por role** — owner vs profissional (views diferentes). Explicitamente adiado pelo usuário.
- [x] **Exportação PDF/XLSX** — disponível nas listagens, com o botão Exportar destacado e posicionado no canto superior direito em telas móveis.
- [x] **Cabeçalhos móveis** — ações preservam espaço para o título; Agenda exibe o nome completo do profissional no timeline e a Comanda mantém Semana/Mês alinhado à direita.

### Dívida técnica
- [ ] Adicionar `loading.tsx` nas páginas que ainda não têm (agenda, clientes, financeiro, etc.)
- [ ] Extrair tipos compartilhados para `types/index.ts`
- [ ] Testes automatizados (Playwright para E2E, Vitest para utils)
