# Taxa de reserva: cobrada no agendamento e descontada na comanda

## Contexto

A taxa de reserva já existe como feature completa (`docs/superpowers/specs/2026-08-05-taxa-reserva-design.md`):
tabela `taxas_reserva` (`status`: `pendente`/`pago`/`retida`), campo no
formulário de "Novo agendamento" (web: `web/app/(app)/agenda/page.tsx` e
`web/app/(app)/clientes/[id]/page.tsx`; mobile:
`mobile/app/(empresa)/novo-agendamento.tsx`) que insere a linha sempre como
`pendente`, e uma ação "marcar como paga" isolada no Financeiro
(`web/app/(app)/financeiro/page.tsx`, `mobile/app/(empresa)/financeiro.tsx`).

A comanda (`web/app/(app)/comanda/page.tsx`, `mobile/app/(empresa)/nova-comanda.tsx`)
é uma tela separada que fecha o atendimento e registra pagamento — hoje ela
não consulta `taxas_reserva` em nenhum momento. Não existe nenhuma ligação
entre as duas telas.

## Decisão aprovada

1. Ao criar um agendamento, se a taxa de reserva tiver valor maior que zero,
   um toggle "Já foi cobrada?" pergunta se o valor já foi recebido ali. Se
   sim, a linha em `taxas_reserva` nasce direto com `status = 'pago'` e
   `paga_em = agora` — sem precisar passar pelo Financeiro depois. Se não
   (padrão), continua nascendo `pendente`, comportamento atual inalterado.
2. Ao abrir uma comanda, soma-se o valor de todas as `taxas_reserva` com
   `status = 'pago'` ligadas aos `agendamento_id` presentes naquela comanda.
   Essa soma vira uma linha automática e sempre aplicada no resumo da
   comanda — "Taxa de reserva paga: −R$ X" — subtraída do total a cobrar,
   junto do desconto manual já existente. O total nunca fica negativo (trava
   em R$ 0, mesma regra já usada pelo desconto manual).
3. Taxas de reserva ainda `pendente` continuam fora do fluxo da comanda —
   cobrança delas continua manual, via Financeiro. Nada muda aí.

## 1. Agendamento — toggle "Já foi cobrada?"

Nos três formulários de criação de agendamento (web ×2, mobile ×1), ao lado
do campo de valor da taxa de reserva (só visível quando
`taxa_reserva_ativa` da empresa está ligado e o formulário é de criação, não
edição — comportamento já existente, inalterado), um checkbox/toggle "Já foi
cobrada?" aparece quando o valor digitado é maior que zero. Desmarcado por
padrão (preserva o comportamento atual: taxa nasce pendente a menos que
explicitamente marcada como já paga).

Lógica de payload extraída para função pura testável em novo arquivo
`shared/taxa-reserva.ts`:

```ts
export type TaxaReservaInsertPayload = {
  empresa_id: string;
  agendamento_id: string;
  cliente_id: string | null;
  valor: number;
  status: 'pendente' | 'pago';
  paga_em: string | null;
};

export function buildTaxaReservaInsert(
  params: {
    empresaId: string;
    agendamentoId: string;
    clienteId: string | null;
    valor: number;
    jaCobrada: boolean;
  },
  agoraIso: string,
): TaxaReservaInsertPayload | null {
  if (params.valor <= 0) return null;
  return {
    empresa_id: params.empresaId,
    agendamento_id: params.agendamentoId,
    cliente_id: params.clienteId,
    valor: params.valor,
    status: params.jaCobrada ? 'pago' : 'pendente',
    paga_em: params.jaCobrada ? agoraIso : null,
  };
}
```

Os três formulários passam a chamar essa função em vez de montar o payload
inline (hoje cada um duplica a mesma lógica sem helper compartilhado — esta
extração corrige isso de passagem, sem mudar nenhum outro comportamento dos
três formulários).

## 2. Comanda — desconto automático

Ao carregar a comanda (`abrirComanda()` web, equivalente mobile), além da
query de agendamentos do dia, uma nova query busca `taxas_reserva` com
`status = 'pago'` cujo `agendamento_id` está entre os agendamentos que
entraram como itens da comanda.

Soma e aplicação do desconto extraídos para função pura testável, mesmo
arquivo `shared/taxa-reserva.ts`:

```ts
export function somarTaxasReservaPagas(
  agendamentoIds: string[],
  taxasPagas: { agendamento_id: string; valor: number }[],
): number {
  const idsNaComanda = new Set(agendamentoIds);
  return taxasPagas
    .filter(t => idsNaComanda.has(t.agendamento_id))
    .reduce((soma, t) => soma + t.valor, 0);
}

export function aplicarDescontoReserva(
  subtotal: number,
  descontoManual: number,
  descontoReserva: number,
): { total: number; descontoReservaAplicado: number } {
  const descontoReservaAplicado = Math.min(
    descontoReserva,
    Math.max(subtotal - descontoManual, 0),
  );
  const total = Math.max(subtotal - descontoManual - descontoReservaAplicado, 0);
  return { total, descontoReservaAplicado };
}
```

`aplicarDescontoReserva` limita o desconto de reserva ao que sobra depois do
desconto manual (evita passar de zero mesmo em conjunto com um desconto
manual grande) e nunca deixa `total` negativo — mesma regra do desconto
manual hoje.

### UI

No resumo da comanda (web e mobile), nova linha condicional entre o
subtotal e o desconto manual, só aparece quando `descontoReservaAplicado > 0`:

```
Subtotal:                R$ 100,00
Taxa de reserva paga:    − R$ 30,00
Desconto:                − R$ 0,00
Total a cobrar:          R$ 70,00
```

Sem toggle de confirmação — aplicada automaticamente sempre que existir taxa
paga vinculada a algum agendamento daquela comanda, conforme decisão
aprovada.

## 3. Dados

Nova coluna em `comandas`:

```sql
alter table public.comandas
  add column desconto_reserva numeric(10,2) not null default 0;
```

Guarda quanto do desconto total aplicado veio de taxa de reserva paga —
apenas para auditoria/rastreio, sem efeito na coluna gerada `valor_final`
(que continua `valor_total - desconto`). Ao fechar a comanda,
`descontoReservaAplicado` é somado dentro do valor gravado em `desconto`
(mantendo `valor_final` correto automaticamente) **e** gravado separadamente
em `desconto_reserva` (para distinguir depois quanto foi desconto manual vs.
taxa já paga).

## Fora de escopo

- Cobrar taxa de reserva `pendente` no momento de fechar a comanda — isso
  continua exclusivamente manual, via Financeiro (ação "marcar como paga").
- Editar o campo "Já foi cobrada?" depois de o agendamento já ter sido
  salvo — mesma limitação que já existe hoje para o campo de valor da taxa
  de reserva (só aparece na criação, não na edição).
- Desconto por item individual (o desconto de reserva é sempre sobre o total
  da comanda, não por agendamento/item específico) — decisão já aprovada.
- Reverter ou desfazer o desconto de reserva depois que a comanda foi
  fechada (o valor gravado em `desconto`/`desconto_reserva` é fixo; reabrir e
  editar a comanda recalcula a partir do estado atual de `taxas_reserva`,
  mesmo comportamento do fluxo de edição de comanda já existente).

## Verificação

- Testes unitários para `buildTaxaReservaInsert` (valor zero → `null`;
  `jaCobrada = true` → `status: 'pago'` com `paga_em` preenchido;
  `jaCobrada = false` → `status: 'pendente'` com `paga_em: null`).
- Testes unitários para `somarTaxasReservaPagas` (soma correta filtrando só
  os `agendamento_id` presentes na comanda; ignora taxas de outros
  agendamentos).
- Testes unitários para `aplicarDescontoReserva` (desconto normal; desconto
  de reserva maior que o subtotal restante → trava em zero; combinação com
  desconto manual não passa de zero).
- `npx tsc --noEmit` no web e no mobile.
- Verificação visual não é possível nesta sessão (sem conta de teste) — como
  já registrado nas sessões anteriores.
