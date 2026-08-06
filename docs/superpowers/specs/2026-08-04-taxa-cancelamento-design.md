# Taxa de Cancelamento — Design

**Data:** 2026-08-04
**Status:** Aprovado

## Objetivo

Permitir que a empresa configure uma taxa cobrada do cliente quando um agendamento é
cancelado e/ou o cliente falta ("faltou"), com lançamento financeiro gerado
automaticamente. Adicionar também uma métrica de % de agendamentos perdidos
(cancelados + faltas) no Dashboard/Relatórios.

Escopo: web e mobile juntos, mesma entrega.

## 1. Configuração por empresa

Novas colunas em `public.empresas`:

| Coluna | Tipo | Default | Descrição |
|---|---|---|---|
| `taxa_cancelamento_ativa` | boolean | `false` | Liga/desliga a cobrança automática |
| `taxa_cancelamento_modo` | text | `'percentual'` | `'percentual'` ou `'fixo'` |
| `taxa_cancelamento_valor` | numeric(10,2) | `0` | % (0–100) ou valor em R$, conforme o modo |
| `taxa_cancelamento_aplica_cancelado` | boolean | `true` | Se dispara ao status virar `cancelado` |
| `taxa_cancelamento_aplica_faltou` | boolean | `true` | Se dispara ao status virar `faltou` |

UI: nova seção "Taxa de cancelamento" na página de Configurações (web:
`web/app/(app)/configuracoes`, mobile: `mobile/app/(empresa)/configuracoes.tsx`).
Editável apenas por `owner`/`gestor` (mesmo padrão de controle de acesso já usado em
outras configurações restritas). Campos: toggle ativa, select de modo, input de valor
(com máscara de % ou R$ conforme modo), dois checkboxes (aplica em cancelado / aplica
em falta).

## 2. Geração automática da cobrança

Nova tabela `public.taxas_cancelamento`:

```sql
create table public.taxas_cancelamento (
  id             uuid primary key default uuid_generate_v4(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  agendamento_id uuid not null references public.agendamentos(id) on delete cascade,
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  valor          numeric(10,2) not null,
  status         text not null default 'pendente', -- 'pendente' | 'paga' | 'cancelada'
  created_at     timestamptz default now(),
  paga_em        timestamptz,
  unique (agendamento_id)
);
```

RLS: `empresa_id = ANY(minha_empresas())` para select; update (marcar como paga)
restrito a `owner`/`gestor`, seguindo o padrão de `042_rls_reforco_leitura_por_role.sql`.

Trigger `aplicar_taxa_cancelamento()` em `agendamentos`, disparado em `AFTER UPDATE OF
status`, mesmo padrão do trigger `gerar_comissao()` existente:

- Se o novo `status` é `cancelado` e `taxa_cancelamento_aplica_cancelado` está ativo
  (ou `faltou` e `taxa_cancelamento_aplica_faltou` está ativo) e
  `taxa_cancelamento_ativa` é `true`:
  - calcula `valor` = `agendamentos.valor * taxa_cancelamento_valor / 100` (modo
    percentual) ou `taxa_cancelamento_valor` (modo fixo)
  - insere uma linha em `taxas_cancelamento` com `status = 'pendente'`, usando
    `ON CONFLICT (agendamento_id) DO NOTHING` (evita duplicar se o trigger rodar mais
    de uma vez para o mesmo agendamento)
- Se o `status` anterior era `cancelado`/`faltou` e o novo status é outro (ex.:
  reagendado de volta para `agendado`), e existe uma taxa `pendente` para esse
  `agendamento_id`, ela é marcada como `cancelada`.

Rodar no banco garante o mesmo comportamento em web e mobile sem duplicar lógica de
cliente.

## 3. Financeiro — nova seção

Em `web/app/(app)/financeiro` e `mobile/app/(empresa)/financeiro.tsx`: seção "Taxas de
cancelamento" listando cliente, data, valor, status. Ação "marcar como paga" para
linhas `pendente` (define `status = 'paga'`, `paga_em = now()`), visível para
`owner`/`gestor`. Taxas com `status = 'paga'` dentro do período somam ao faturamento
bruto do financeiro (mesmo tratamento dado a vendas avulsas hoje).

## 4. Perfil do cliente

Em `clientes/[id]` (web) e na tela de detalhe do cliente (mobile), nova seção com o
histórico de taxas de cancelamento daquele cliente (data, valor, status).

## 5. Métrica de % de cancelamento

Dashboard e Relatórios: novo indicador `% = (cancelados + faltou) / total de
agendamentos do período`. Calculado a partir de `agendamentos.status`, sem depender da
tabela `taxas_cancelamento` (a métrica existe mesmo com a cobrança desativada).

## Edge cases

- Empresa com `taxa_cancelamento_ativa = false`: nenhuma linha é criada; a métrica de %
  continua funcionando normalmente.
- Agendamento cancelado antes da feature existir: não gera taxa retroativa (trigger só
  age em updates futuros).
- Reversão de status (cancelado → agendado): taxa pendente vinculada é marcada
  `cancelada`, não é excluída (mantém histórico).
- Agendamento sem `valor` definido (null/0) no modo percentual: taxa calculada como 0;
  ainda assim gera a linha `pendente` com valor 0 (mantém rastreabilidade, mas não
  aparece como algo a cobrar de fato — decisão consciente de simplicidade, sem tela de
  edição manual do valor nesta entrega).
- Apenas `owner`/`gestor` podem editar a configuração e marcar taxas como pagas;
  `profissional` só visualiza (se tiver acesso à tela).
