# Taxa de Reserva — Design

**Data:** 2026-08-05
**Status:** Aprovado

## Objetivo

Permitir que a empresa cobre uma taxa de reserva (um "sinal") do cliente no
momento em que o agendamento é criado, independente de cancelamento. O valor
tem um padrão configurável (% do serviço ou fixo), mas é editável em cada
agendamento individualmente. Se o agendamento for cancelado ou o cliente
faltar, a taxa já cobrada fica retida (não devolvida), sem se confundir com a
taxa de cancelamento — as duas cobranças são independentes e podem coexistir.

Escopo: web e mobile juntos, mesma entrega (mesmo padrão do projeto).

## 1. Configuração por empresa

Novas colunas em `public.empresas`, independentes das colunas de
`taxa_cancelamento_*` já existentes:

| Coluna | Tipo | Default | Descrição |
|---|---|---|---|
| `taxa_reserva_ativa` | boolean | `false` | Liga/desliga o campo de taxa de reserva no formulário de agendamento |
| `taxa_reserva_modo` | text | `'percentual'` | `'percentual'` ou `'fixo'` |
| `taxa_reserva_valor` | numeric(10,2) | `0` | % (0–100) ou valor em R$, conforme o modo — usado apenas para pré-preencher o campo |

UI: nova seção "Taxa de reserva" na página de Configurações (web e mobile),
espelhando visualmente a seção "Taxa de cancelamento" já existente (mesmo
componente/padrão: toggle, seletor de modo, input de valor). Editável apenas
por `owner`/`gestor`, mesma regra já usada para a taxa de cancelamento.

## 2. Registro no momento do agendamento

Nova tabela `public.taxas_reserva`:

```sql
create table public.taxas_reserva (
  id             uuid primary key default uuid_generate_v4(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  agendamento_id uuid not null references public.agendamentos(id) on delete cascade,
  cliente_id     uuid references public.clientes(id) on delete cascade,
  valor          numeric(10,2) not null,
  status         text not null default 'pendente', -- 'pendente' | 'pago' | 'retida'
  created_at     timestamptz default now(),
  paga_em        timestamptz,
  unique (agendamento_id)
);
```

`cliente_id` é nullable (assim como em `taxas_cancelamento`, para não quebrar
em agendamentos sem cliente vinculado).

No formulário de "Novo agendamento" (web: `web/app/(app)/agenda`, mobile:
`mobile/app/(empresa)/novo-agendamento.tsx`): quando `taxa_reserva_ativa` está
ligado, aparece um campo "Taxa de reserva" pré-preenchido a partir do serviço
selecionado (recalculado se o serviço mudar, mas não sobrescreve um valor que
a pessoa já editou manualmente) e editável livremente antes de salvar. Ao
salvar o agendamento, se o valor for maior que zero, insere a linha
correspondente em `taxas_reserva` com `status = 'pendente'`.

Diferença importante em relação à taxa de cancelamento: aquela é gerada
automaticamente por um trigger no banco (reage à mudança de status). Esta
nasce de uma ação explícita na tela de agendamento — não há trigger de
criação. Isso é intencional: o valor da taxa de reserva pode ser negociado
por agendamento, então precisa de confirmação humana no momento da marcação.

## 3. Retenção ao cancelar

Trigger em `agendamentos` (roda junto com o já existente
`gerar_taxa_cancelamento()`, mas como função separada para manter
responsabilidades isoladas): quando o status muda para `cancelado` ou
`faltou`, se existir uma linha em `taxas_reserva` para aquele
`agendamento_id` com `status in ('pendente', 'pago')`, ela é marcada como
`retida`. Não há reversão automática se o agendamento voltar a `agendado`
(diferente da taxa de cancelamento) — a retenção reflete uma decisão de
negócio já tomada, não é revertida por engano de reagendamento; se a empresa
quiser reverter manualmente, isso fica fora do escopo desta entrega (sem tela
de edição de status).

## 4. Financeiro

Nova seção "Taxa de Reserva" no Financeiro (web + mobile), mesmo padrão visual
da seção de taxa de cancelamento: lista com cliente, data, valor, status
(Pendente/Paga/Retida), ação "marcar como paga" para linhas `pendente`.
Taxas `pago` dentro do período somam ao faturamento bruto (mesmo tratamento
já dado às taxas de cancelamento pagas — aplicado de forma consistente nas
mesmas quatro telas: Financeiro web, Relatórios web, Dashboard web e
Financeiro mobile, para não repetir a inconsistência já corrigida na feature
anterior). Taxas `retida` NÃO somam ao bruto automaticamente — retenção não é
necessariamente "recebido" a menos que já estivesse `pago` antes de reter
(nesse caso já contou no bruto quando foi marcada como paga).

## 5. Perfil do cliente

Nova seção "Taxas de reserva" no histórico do cliente (`clientes/[id]` web,
tela de detalhe do cliente no mobile), listando valor, data e status.

## Edge cases

- Empresa com `taxa_reserva_ativa = false`: o campo não aparece no formulário
  de agendamento; nenhuma linha é criada.
- Valor do campo de taxa de reserva deixado em zero ao salvar: nenhuma linha é
  criada em `taxas_reserva` (mesma regra de "sem rastro para valor zero" já
  usada na taxa de cancelamento).
- Agendamento sem `cliente_id`: taxa de reserva ainda pode ser registrada
  (campo `cliente_id` nullable), mas não aparecerá no perfil de cliente
  nenhum (não há cliente para exibir).
- Cancelamento de um agendamento que nunca teve taxa de reserva registrada:
  trigger não encontra linha para reter, não faz nada.
- Apenas `owner`/`gestor` podem editar a configuração e marcar taxas como
  pagas; a criação da linha `taxas_reserva` acontece via ação normal de
  criar/editar agendamento (mesma permissão de quem já pode agendar).
