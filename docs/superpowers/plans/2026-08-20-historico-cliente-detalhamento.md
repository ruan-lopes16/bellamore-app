# Histórico real da cliente + detalhamento do atendimento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os quatro defeitos que fazem o histórico da cliente exibir informação errada e adicionar, nas duas plataformas, o detalhamento do atendimento (o que foi feito, quanto e como foi pago).

**Architecture:** Um módulo puro novo em `shared/` concentra a lógica de exibição (nome dos serviços e montagem do detalhe), consumido por web e mobile. As consultas ficam em cada plataforma. O detalhe é buscado sob demanda, ao abrir.

**Tech Stack:** Next.js 15 App Router + Supabase (web), Expo Router + React Query + Supabase (mobile), Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-08-20-historico-cliente-detalhamento-design.md`

## Global Constraints

- **Nenhuma migration.** Nenhuma tabela, coluna, política de RLS ou índice é criado ou alterado.
- **Nada é removido de nenhuma tela.**
- `npx tsc --noEmit` de dentro de `web/` precisa terminar **zerado**.
- `npx tsc --noEmit` de dentro de `mobile/` precisa manter **exatamente** os erros de baseline pré-existentes (~10), sem nenhum erro novo. Capturar a baseline **antes** de começar.
- `npm test` de dentro de `web/` precisa terminar verde, incluindo os testes já existentes.
- Comentários e JSDoc em **português**, sem acentos dentro de blocos JSDoc (padrão de `shared/despesas.ts` e `shared/taxa-reserva.ts`).
- Commits em português, prefixo `fix:` / `feat:` / `test:`, terminando com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Nunca `--no-verify`.
- O worktree começa sem `node_modules` em `web/`. `npm ci` **falha** (lock dessincronizado). Usar `npm install --no-audit --no-fund` e depois `git checkout -- web/package-lock.json` para não sujar o diff.

## Fatos do schema que o plano depende

Três verdades não óbvias, confirmadas por leitura do código, que uma implementação ingênua erraria:

1. **`comanda_itens` guarda só os extras.** Ao fechar a comanda, `web/app/(app)/comanda/page.tsx` insere em `comanda_itens` apenas `itens.filter(i => i.tipo !== 'agendamento')`. As linhas dos agendamentos ficam na tabela `agendamentos`, ligadas por `comanda_id`. **"O que foi feito" precisa unir as duas fontes** — usar só `comanda_itens` mostraria a comanda sem os serviços agendados, que costumam ser a maior parte dela.
2. **`comandas.desconto` já inclui o desconto de reserva.** O insert grava `desconto: descontoN + descontoReservaAplicado` e `desconto_reserva: descontoReservaAplicado` (migration 057). Logo o desconto manual é `desconto - desconto_reserva`. Somar os dois de novo contaria o desconto de reserva duas vezes.
3. **`comandas.valor_final` é coluna gerada** (`valor_total - desconto`), então o total não precisa ser recalculado.

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `shared/atendimento-detalhe.ts` | Tipos + `descreverServicos` + `montarDetalheAtendimento` | **Criar** |
| `shared/paginacao.ts` | `buscarTodasPaginas` compartilhado entre web e mobile | **Criar** |
| `web/app/(app)/clientes/[id]/page.tsx` | Lista corrigida + modal de detalhe | Modificar |
| `mobile/hooks/useClientes.ts` | Query e estatísticas corrigidas | Modificar |
| `mobile/app/(empresa)/cliente/[id].tsx` | Lista corrigida + navegação por tipo | Modificar |
| `mobile/app/(empresa)/agendamento/[id].tsx` | Seções de comanda, fechamento e pagamento | Modificar |
| `web/tests/unit/atendimento-detalhe.test.ts` | Testes das funções puras | **Criar** |
| `web/tests/unit/historico-cliente.test.ts` | Asserções de integração nas telas | **Criar** |

---

### Task 0: Capturar a baseline do mobile

**Files:** nenhum (só leitura)

**Interfaces:**
- Consumes: nada
- Produces: o número de erros de baseline do mobile, usado como referência em todas as tasks seguintes

- [ ] **Step 1: Instalar dependências do web**

```bash
cd web && npm install --no-audit --no-fund
```

- [ ] **Step 2: Restaurar o lock**

```bash
git checkout -- web/package-lock.json
```

Esperado: `git status --short` não mostra `web/package-lock.json`.

- [ ] **Step 3: Registrar a baseline do mobile**

```bash
cd mobile && npx tsc --noEmit 2>&1 | tail -3
```

Anotar o número exato de erros. **Não corrigir nenhum deles** — são pré-existentes e fora do escopo. Toda task seguinte compara contra este número.

- [ ] **Step 4: Confirmar o web zerado**

```bash
cd web && npx tsc --noEmit && echo "TSC OK"
```

Esperado: `TSC OK`.

---

### Task 1: `descreverServicos` em `shared/atendimento-detalhe.ts`

**Files:**
- Create: `shared/atendimento-detalhe.ts`
- Test: `web/tests/unit/atendimento-detalhe.test.ts` (criar)

**Interfaces:**
- Consumes: nada
- Produces:
  ```ts
  export type ServicoDoAgendamento = { ordem: number; servico: { nome: string } | null };
  export type AgendamentoComServicos = {
    servico?: { nome: string } | null;
    agendamento_servicos?: ServicoDoAgendamento[] | null;
  };
  export function descreverServicos(ag: AgendamentoComServicos): string | null;
  ```
  Tasks 3, 5, 6 e 7 consomem exatamente esta assinatura.

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/tests/unit/atendimento-detalhe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { descreverServicos } from '@shared/atendimento-detalhe';

describe('descreverServicos', () => {
  it('junta os servicos de agendamento_servicos na ordem', () => {
    expect(descreverServicos({
      servico: { nome: 'Design de sobrancelha' },
      agendamento_servicos: [
        { ordem: 2, servico: { nome: 'Buco' } },
        { ordem: 0, servico: { nome: 'Design de sobrancelha' } },
        { ordem: 1, servico: { nome: 'Spa dos labios' } },
      ],
    })).toBe('Design de sobrancelha + Spa dos labios + Buco');
  });

  it('cai no servico legado quando nao ha agendamento_servicos', () => {
    expect(descreverServicos({ servico: { nome: 'Limpeza de pele' }, agendamento_servicos: [] }))
      .toBe('Limpeza de pele');
    expect(descreverServicos({ servico: { nome: 'Limpeza de pele' } }))
      .toBe('Limpeza de pele');
    expect(descreverServicos({ servico: { nome: 'Limpeza de pele' }, agendamento_servicos: null }))
      .toBe('Limpeza de pele');
  });

  it('ignora linhas sem servico e cai no legado se sobrar nada', () => {
    expect(descreverServicos({
      servico: { nome: 'Limpeza de pele' },
      agendamento_servicos: [{ ordem: 0, servico: null }],
    })).toBe('Limpeza de pele');
  });

  it('ignora apenas as linhas vazias quando ha outras validas', () => {
    expect(descreverServicos({
      servico: null,
      agendamento_servicos: [
        { ordem: 0, servico: { nome: 'Massagem' } },
        { ordem: 1, servico: null },
      ],
    })).toBe('Massagem');
  });

  it('retorna null quando nao ha nome nenhum', () => {
    expect(descreverServicos({ servico: null, agendamento_servicos: [] })).toBeNull();
    expect(descreverServicos({})).toBeNull();
  });

  it('nao muta o array recebido', () => {
    const servicos: ServicoDoAgendamentoTeste[] = [
      { ordem: 1, servico: { nome: 'B' } },
      { ordem: 0, servico: { nome: 'A' } },
    ];
    descreverServicos({ agendamento_servicos: servicos });
    expect(servicos[0].ordem).toBe(1);
  });
});

type ServicoDoAgendamentoTeste = { ordem: number; servico: { nome: string } | null };
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd web && npx vitest run tests/unit/atendimento-detalhe.test.ts
```

Esperado: falha de resolução — `Failed to resolve import "@shared/atendimento-detalhe"`.

- [ ] **Step 3: Criar o módulo com a função**

Criar `shared/atendimento-detalhe.ts`:

```ts
// ── Tipos de entrada (linhas cruas vindas do Supabase) ────────

export type ServicoDoAgendamento = {
  ordem: number;
  servico: { nome: string } | null;
};

export type AgendamentoComServicos = {
  /** Servico legado (agendamentos.servico_id) — usado como fallback. */
  servico?: { nome: string } | null;
  agendamento_servicos?: ServicoDoAgendamento[] | null;
};

/**
 * Nome legivel dos servicos de um agendamento: junta as linhas de
 * agendamento_servicos por `ordem` com " + ".
 *
 * Existe porque a Agenda grava so o PRIMEIRO servico em agendamentos.servico_id
 * e a SOMA de todos em agendamentos.valor. Ler apenas o servico legado exibe o
 * nome de um servico ao lado do preco de varios.
 *
 * Cai no servico legado quando nao ha linhas em agendamento_servicos — o caso
 * da maioria dos agendamentos anteriores a migration 020. Retorna null quando
 * nao ha nome nenhum, para a tela decidir o placeholder.
 */
export function descreverServicos(ag: AgendamentoComServicos): string | null {
  const nomes = (ag.agendamento_servicos ?? [])
    .slice()                                   // nao mutar o array do chamador
    .sort((a, b) => a.ordem - b.ordem)
    .map((linha) => linha.servico?.nome)
    .filter((nome): nome is string => !!nome);

  if (nomes.length > 0) return nomes.join(' + ');
  return ag.servico?.nome ?? null;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd web && npx vitest run tests/unit/atendimento-detalhe.test.ts
```

Esperado: 6 testes PASSANDO.

- [ ] **Step 5: Commit**

```bash
git add shared/atendimento-detalhe.ts web/tests/unit/atendimento-detalhe.test.ts
git commit -m "feat: adiciona descreverServicos para agendamento multi-servico

A Agenda grava so o primeiro servico em servico_id e a soma de todos em valor.
Ler apenas o servico legado exibe o nome de um servico com o preco de varios.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `montarDetalheAtendimento`

**Files:**
- Modify: `shared/atendimento-detalhe.ts`
- Test: `web/tests/unit/atendimento-detalhe.test.ts`

**Interfaces:**
- Consumes: `descreverServicos`, `AgendamentoComServicos` (Task 1)
- Produces:
  ```ts
  export type ItemComandaCru = {
    id: string;
    tipo: 'servico' | 'produto' | 'pacote';
    descricao: string;
    quantidade: number;
    valor_unit: number;
    profissional?: { nome: string } | null;
  };
  export type PagamentoCru = {
    id: string; metodo: string; valor: number;
    bandeira?: string | null; parcelas?: number | null;
    taxa_perc?: number | null; valor_liquido?: number | null;
  };
  export type ComandaCru = {
    id: string; valor_total: number; desconto: number; desconto_reserva: number;
    fechada_at: string | null; observacao?: string | null;
  };
  export type AgendamentoNaComanda = AgendamentoComServicos & {
    id: string; data_hora_inicio: string; valor: number;
    profissional?: { nome: string } | null;
  };
  export type EntradaDetalhe = {
    agendamentoId: string | null;
    comandaIdEsperado: string | null;
    comanda: ComandaCru | null;
    itens: ItemComandaCru[];
    pagamentos: PagamentoCru[];
    agendamentosDaComanda: AgendamentoNaComanda[];
  };
  export type LinhaItem = {
    id: string;
    origem: 'agendamento' | 'comanda_item';
    tipo: 'servico' | 'produto' | 'pacote';
    descricao: string;
    quantidade: number;
    valorUnit: number;
    valorLinha: number;
    profissional: string | null;
    esteAtendimento: boolean;
  };
  export type LinhaPagamento = {
    id: string; metodo: string; valor: number;
    bandeira: string | null; parcelas: number;
    taxaPerc: number | null; valorLiquido: number | null;
  };
  export type OutroAtendimento = { id: string; dataHoraInicio: string; servicos: string | null };
  export type SituacaoDetalhe = 'completo' | 'sem_comanda' | 'bloqueado_por_rls';
  export type DetalheAtendimento = {
    situacao: SituacaoDetalhe;
    itens: LinhaItem[];
    pagamentos: LinhaPagamento[];
    subtotal: number;
    descontoManual: number;
    descontoReserva: number;
    total: number;
    outrosAtendimentos: OutroAtendimento[];
  };
  export function montarDetalheAtendimento(entrada: EntradaDetalhe): DetalheAtendimento;
  ```
  Tasks 4 e 7 consomem exatamente estes tipos.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/tests/unit/atendimento-detalhe.test.ts` (e ajustar o import do topo para
`import { descreverServicos, montarDetalheAtendimento } from '@shared/atendimento-detalhe';`):

```ts
import type { EntradaDetalhe } from '@shared/atendimento-detalhe';

const COMANDA = {
  id: 'c1', valor_total: 300, desconto: 50, desconto_reserva: 20,
  fechada_at: '2026-08-12T18:00:00Z', observacao: null,
};

function entrada(over: Partial<EntradaDetalhe> = {}): EntradaDetalhe {
  return {
    agendamentoId: 'a1',
    comandaIdEsperado: 'c1',
    comanda: COMANDA,
    itens: [],
    pagamentos: [],
    agendamentosDaComanda: [],
    ...over,
  };
}

describe('montarDetalheAtendimento', () => {
  it('separa o desconto manual do desconto de reserva sem contar duas vezes', () => {
    // comandas.desconto ja inclui o desconto_reserva (migration 057)
    const d = montarDetalheAtendimento(entrada());
    expect(d.subtotal).toBe(300);
    expect(d.descontoManual).toBe(30);   // 50 - 20
    expect(d.descontoReserva).toBe(20);
    expect(d.total).toBe(250);           // 300 - 50
  });

  it('une as linhas dos agendamentos com os extras da comanda', () => {
    const d = montarDetalheAtendimento(entrada({
      agendamentosDaComanda: [{
        id: 'a1', data_hora_inicio: '2026-08-12T14:00:00Z', valor: 250,
        servico: { nome: 'Sobrancelha' },
        agendamento_servicos: [
          { ordem: 0, servico: { nome: 'Sobrancelha' } },
          { ordem: 1, servico: { nome: 'Buco' } },
        ],
        profissional: { nome: 'Ana Clara' },
      }],
      itens: [{
        id: 'i1', tipo: 'produto', descricao: 'Serum facial',
        quantidade: 2, valor_unit: 25, profissional: null,
      }],
    }));

    expect(d.itens).toHaveLength(2);
    expect(d.itens[0]).toMatchObject({
      origem: 'agendamento', tipo: 'servico',
      descricao: 'Sobrancelha + Buco', quantidade: 1,
      valorUnit: 250, valorLinha: 250,
      profissional: 'Ana Clara', esteAtendimento: true,
    });
    expect(d.itens[1]).toMatchObject({
      origem: 'comanda_item', tipo: 'produto',
      descricao: 'Serum facial', quantidade: 2,
      valorUnit: 25, valorLinha: 50, esteAtendimento: false,
    });
  });

  it('marca so o agendamento aberto como esteAtendimento', () => {
    const d = montarDetalheAtendimento(entrada({
      agendamentoId: 'a2',
      agendamentosDaComanda: [
        { id: 'a1', data_hora_inicio: '2026-08-12T14:00:00Z', valor: 100, servico: { nome: 'X' } },
        { id: 'a2', data_hora_inicio: '2026-08-12T15:00:00Z', valor: 150, servico: { nome: 'Y' } },
      ],
    }));
    expect(d.itens.map((i) => i.esteAtendimento)).toEqual([false, true]);
  });

  it('lista os outros atendimentos cobertos pela mesma comanda', () => {
    const d = montarDetalheAtendimento(entrada({
      agendamentosDaComanda: [
        { id: 'a1', data_hora_inicio: '2026-08-12T14:00:00Z', valor: 100, servico: { nome: 'X' } },
        { id: 'a2', data_hora_inicio: '2026-08-12T15:00:00Z', valor: 150, servico: { nome: 'Y' } },
      ],
    }));
    expect(d.outrosAtendimentos).toEqual([
      { id: 'a2', dataHoraInicio: '2026-08-12T15:00:00Z', servicos: 'Y' },
    ]);
  });

  it('nao lista outros atendimentos quando a comanda cobre so um', () => {
    const d = montarDetalheAtendimento(entrada({
      agendamentosDaComanda: [
        { id: 'a1', data_hora_inicio: '2026-08-12T14:00:00Z', valor: 100, servico: { nome: 'X' } },
      ],
    }));
    expect(d.outrosAtendimentos).toEqual([]);
  });

  it('normaliza os campos opcionais do pagamento', () => {
    const d = montarDetalheAtendimento(entrada({
      pagamentos: [
        { id: 'p1', metodo: 'pix', valor: 100 },
        { id: 'p2', metodo: 'credito', valor: 150, bandeira: 'visa', parcelas: 3, taxa_perc: 4.5, valor_liquido: 143.25 },
      ],
    }));
    expect(d.pagamentos[0]).toEqual({
      id: 'p1', metodo: 'pix', valor: 100,
      bandeira: null, parcelas: 1, taxaPerc: null, valorLiquido: null,
    });
    expect(d.pagamentos[1]).toEqual({
      id: 'p2', metodo: 'credito', valor: 150,
      bandeira: 'visa', parcelas: 3, taxaPerc: 4.5, valorLiquido: 143.25,
    });
  });

  it('reporta sem_comanda quando o atendimento nao foi fechado', () => {
    const d = montarDetalheAtendimento(entrada({ comandaIdEsperado: null, comanda: null }));
    expect(d.situacao).toBe('sem_comanda');
    expect(d.itens).toEqual([]);
    expect(d.pagamentos).toEqual([]);
    expect(d.total).toBe(0);
  });

  it('reporta bloqueado_por_rls quando ha comanda mas ela nao veio', () => {
    // profissional abrindo o atendimento de uma colega: migration 045 filtra
    // a linha e o PostgREST devolve vazio, sem erro.
    const d = montarDetalheAtendimento(entrada({ comandaIdEsperado: 'c1', comanda: null }));
    expect(d.situacao).toBe('bloqueado_por_rls');
    expect(d.itens).toEqual([]);
    expect(d.total).toBe(0);
  });

  it('reporta completo quando a comanda veio', () => {
    expect(montarDetalheAtendimento(entrada()).situacao).toBe('completo');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd web && npx vitest run tests/unit/atendimento-detalhe.test.ts
```

Esperado: os testes de `montarDetalheAtendimento` FALHANDO (função não exportada). Os 6 de `descreverServicos` continuam passando.

- [ ] **Step 3: Implementar**

Acrescentar a `shared/atendimento-detalhe.ts` (todos os tipos do bloco **Produces** acima, mais):

```ts
const DETALHE_VAZIO = {
  itens: [] as LinhaItem[],
  pagamentos: [] as LinhaPagamento[],
  subtotal: 0,
  descontoManual: 0,
  descontoReserva: 0,
  total: 0,
  outrosAtendimentos: [] as OutroAtendimento[],
};

/**
 * Monta o modelo de exibicao do detalhe de um atendimento a partir das linhas
 * cruas ja consultadas.
 *
 * Tres pontos que uma leitura ingenua do schema erraria:
 *
 * 1. comanda_itens guarda SO os extras (produtos, servicos avulsos, pacotes).
 *    As linhas dos agendamentos ficam na tabela agendamentos, ligadas por
 *    comanda_id. Por isso `itens` une as duas fontes.
 * 2. comandas.desconto JA INCLUI o desconto_reserva (migration 057). O desconto
 *    manual e a diferenca entre os dois; somar de novo contaria duas vezes.
 * 3. Comanda ausente nao e sempre erro: se o atendimento nunca foi fechado,
 *    `comandaIdEsperado` e null e nao ha nada a mostrar. Se ha id esperado mas
 *    a linha nao veio, o RLS da migration 045 filtrou (profissional abrindo o
 *    atendimento de uma colega) — e a tela precisa dizer isso, nao ficar vazia.
 */
export function montarDetalheAtendimento(entrada: EntradaDetalhe): DetalheAtendimento {
  const { agendamentoId, comandaIdEsperado, comanda } = entrada;

  if (!comanda) {
    return {
      ...DETALHE_VAZIO,
      situacao: comandaIdEsperado ? 'bloqueado_por_rls' : 'sem_comanda',
    };
  }

  const linhasAgendamento: LinhaItem[] = entrada.agendamentosDaComanda.map((ag) => ({
    id: ag.id,
    origem: 'agendamento',
    tipo: 'servico',
    descricao: descreverServicos(ag) ?? 'Servico',
    quantidade: 1,
    valorUnit: ag.valor,
    valorLinha: ag.valor,
    profissional: ag.profissional?.nome ?? null,
    esteAtendimento: ag.id === agendamentoId,
  }));

  const linhasExtras: LinhaItem[] = entrada.itens.map((item) => ({
    id: item.id,
    origem: 'comanda_item',
    tipo: item.tipo,
    descricao: item.descricao,
    quantidade: item.quantidade,
    valorUnit: item.valor_unit,
    valorLinha: item.quantidade * item.valor_unit,
    profissional: item.profissional?.nome ?? null,
    esteAtendimento: false,
  }));

  const pagamentos: LinhaPagamento[] = entrada.pagamentos.map((p) => ({
    id: p.id,
    metodo: p.metodo,
    valor: p.valor,
    bandeira: p.bandeira ?? null,
    parcelas: p.parcelas ?? 1,
    taxaPerc: p.taxa_perc ?? null,
    valorLiquido: p.valor_liquido ?? null,
  }));

  const outrosAtendimentos: OutroAtendimento[] = entrada.agendamentosDaComanda
    .filter((ag) => ag.id !== agendamentoId)
    .map((ag) => ({
      id: ag.id,
      dataHoraInicio: ag.data_hora_inicio,
      servicos: descreverServicos(ag),
    }));

  const descontoReserva = comanda.desconto_reserva ?? 0;

  return {
    situacao: 'completo',
    itens: [...linhasAgendamento, ...linhasExtras],
    pagamentos,
    subtotal: comanda.valor_total,
    descontoManual: comanda.desconto - descontoReserva,
    descontoReserva,
    total: comanda.valor_total - comanda.desconto,
    outrosAtendimentos,
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd web && npx vitest run tests/unit/atendimento-detalhe.test.ts
```

Esperado: 15 testes PASSANDO (6 de `descreverServicos` + 9 de `montarDetalheAtendimento`).

- [ ] **Step 5: Rodar a suíte inteira e o TypeScript**

```bash
cd web && npm test && npx tsc --noEmit && echo "TSC OK"
```

- [ ] **Step 6: Commit**

```bash
git add shared/atendimento-detalhe.ts web/tests/unit/atendimento-detalhe.test.ts
git commit -m "feat: adiciona montarDetalheAtendimento

Une as linhas dos agendamentos (tabela agendamentos, via comanda_id) com os
extras (comanda_itens), separa desconto manual de desconto de reserva sem
contar duas vezes, e distingue comanda ausente de comanda bloqueada por RLS.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Web — corrigir a lista do histórico e o serviço favorito

**Files:**
- Modify: `web/app/(app)/clientes/[id]/page.tsx` — tipo `HistAg` (linha 75), query de estatísticas (linha 366), agregação (linhas 388-402), query do histórico (linha 447), render da lista (linha 974)
- Test: `web/tests/unit/historico-cliente.test.ts` (criar)

**Interfaces:**
- Consumes: `descreverServicos` (Task 1)
- Produces: nada consumido por outras tasks

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/tests/unit/historico-cliente.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

describe('historico da cliente no web', () => {
  const arquivo = 'app/(app)/clientes/[id]/page.tsx';

  it('busca agendamento_servicos nas duas consultas do perfil', () => {
    const src = read(arquivo);
    // Uma para o histórico, outra para as estatísticas — as duas precisam,
    // senão o serviço favorito continua contando só o serviço legado.
    const ocorrencias = src.match(/agendamento_servicos\(ordem, ?servico:servicos\(nome\)\)/g) ?? [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2);
  });

  it('usa descreverServicos em vez do servico legado na lista', () => {
    const src = read(arquivo);
    expect(src).toContain("import { descreverServicos } from '@shared/atendimento-detalhe';");
    expect(src).toContain('descreverServicos(ag)');
    // O acesso direto ao servico legado na renderizacao da lista nao pode voltar
    expect(src).not.toContain("{(ag.servico as any)?.nome ?? '—'}");
  });

  it('conta cada servico do agendamento no servico favorito', () => {
    const src = read(arquivo);
    // A agregacao antiga somava so a.servico?.nome — um servico por atendimento.
    expect(src).not.toContain('if (a.servico?.nome) svcCount[a.servico.nome]');
    expect(src).toContain('nomesDeServicos');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd web && npx vitest run tests/unit/historico-cliente.test.ts
```

Esperado: 3 testes FALHANDO.

- [ ] **Step 3: Importar o helper**

Em `web/app/(app)/clientes/[id]/page.tsx`, junto aos imports de `@shared`:

```ts
import { descreverServicos } from '@shared/atendimento-detalhe';
```

- [ ] **Step 4: Estender o tipo `HistAg`** (linha 75)

```ts
type HistAg = {
  id: string; data_hora_inicio: string; data_hora_fim: string;
  status: string; valor: number; observacao?: string;
  servico: { nome: string } | null;
  profissional: { nome: string } | null;
  agendamento_servicos?: { ordem: number; servico: { nome: string } | null }[] | null;
  /** comanda que fechou este atendimento — null enquanto nao foi fechado */
  comanda_id?: string | null;
  /** true quando a linha veio de comanda_itens (servico avulso, sem agendamento) */
  eExtraDeComanda?: boolean;
};
```

- [ ] **Step 5: Buscar `agendamento_servicos` e `comanda_id` no histórico** (linha 447)

Trocar o `select` da consulta de `agendamentos` dentro de `carregarHistorico` por:

```ts
.select(`id, data_hora_inicio, data_hora_fim, status, valor, observacao, comanda_id,
  servico:servicos(nome),
  agendamento_servicos(ordem, servico:servicos(nome)),
  profissional:users!agendamentos_profissional_id_fkey(nome)`)
```

- [ ] **Step 6: Buscar `agendamento_servicos` nas estatísticas** (linha 366)

Trocar o `select` da consulta de estatísticas por:

```ts
.select('valor, data_hora_inicio, servico:servicos(nome), agendamento_servicos(ordem, servico:servicos(nome))')
```

- [ ] **Step 7: Marcar os extras de comanda e levar o `comanda_id`** (dentro de `carregarHistorico`, no `map` que monta `extras`)

```ts
const extras: HistAg[] = comSvcs.map(cs => ({
  id: cs.id,
  data_hora_inicio: cs.comanda?.fechada_at ?? cs.created_at,
  data_hora_fim: cs.comanda?.fechada_at ?? cs.created_at,
  status: 'concluido',
  valor: cs.valor_unit * cs.quantidade,
  servico: cs.servico ?? { nome: cs.descricao },
  profissional: cs.profissional,
  comanda_id: cs.comanda_id ?? null,
  eExtraDeComanda: true,
}));
```

E acrescentar `comanda_id` ao `select` de `comanda_itens` (linha 484) e ao tipo `HistComandaServico` (linha 88):

```ts
.select(`id, comanda_id, descricao, valor_unit, quantidade, created_at,
  servico:servicos(nome),
  profissional:users(nome),
  comanda:comandas!inner(fechada_at)`)
```

```ts
type HistComandaServico = {
  id: string; comanda_id: string; descricao: string; valor_unit: number;
  quantidade: number; created_at: string;
  servico: { nome: string } | null;
  profissional: { nome: string } | null;
  comanda: { fechada_at: string | null } | null;
};
```

- [ ] **Step 8: Contar cada serviço no serviço favorito** (linhas 399-401)

Substituir:

```ts
      const svcCount: Record<string, number> = {};
      rows.forEach(a => { if (a.servico?.nome) svcCount[a.servico.nome] = (svcCount[a.servico.nome] ?? 0) + 1; });
      const servicoFavorito = Object.entries(svcCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
```

por:

```ts
      // Um atendimento multi-servico conta uma vez para CADA servico feito —
      // contar so o servico legado subestimava todos os demais.
      const svcCount: Record<string, number> = {};
      rows.forEach(a => {
        const nomesDeServicos = (a.agendamento_servicos ?? []).length > 0
          ? (a.agendamento_servicos ?? []).map(l => l.servico?.nome).filter((n): n is string => !!n)
          : (a.servico?.nome ? [a.servico.nome] : []);
        nomesDeServicos.forEach(nome => { svcCount[nome] = (svcCount[nome] ?? 0) + 1; });
      });
      const servicoFavorito = Object.entries(svcCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
```

Para o TypeScript aceitar `a.agendamento_servicos` sobre o array `rows` — que é a união das linhas
de `agsStats` com as de `comSvcsStats` — o `map` que monta as linhas de `comSvcsStats` (logo acima,
por volta da linha 389) precisa passar a incluir a propriedade explicitamente:

```ts
        ...comSvcsStats.map(cs => ({
          valor: cs.valor_unit * cs.quantidade,
          data_hora_inicio: cs.comanda?.fechada_at ?? cs.created_at,
          servico: cs.servico,
          agendamento_servicos: null,   // extra de comanda nunca e multi-servico
        })),
```

Sem isso as duas metades da união têm formatos diferentes e o acesso não compila.

- [ ] **Step 9: Usar `descreverServicos` na renderização** (linha ~980)

Substituir:

```tsx
                          <p className="text-sm font-semibold text-text truncate">
                            {(ag.servico as any)?.nome ?? '—'}
                          </p>
```

por:

```tsx
                          <p className="text-sm font-semibold text-text truncate">
                            {descreverServicos(ag) ?? '—'}
                          </p>
```

- [ ] **Step 10: Rodar os testes e o TypeScript**

```bash
cd web && npx vitest run tests/unit/historico-cliente.test.ts && npm test && npx tsc --noEmit && echo "TSC OK"
```

Esperado: 3 testes novos PASSANDO, suíte verde, `tsc` sem saída.

- [ ] **Step 11: Commit**

```bash
git add web shared
git commit -m "fix: histórico do web mostra todos os servicos do atendimento

Agendamento multi-servico aparecia com o nome do primeiro servico e o valor
somado dos tres. O servico favorito tinha o mesmo defeito: contava so o
servico legado, ignorando os demais do mesmo atendimento.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Web — modal de detalhe do atendimento

**Files:**
- Modify: `web/app/(app)/clientes/[id]/page.tsx` — componente novo + linha da lista clicável
- Test: `web/tests/unit/historico-cliente.test.ts`

**Interfaces:**
- Consumes: `montarDetalheAtendimento`, `DetalheAtendimento`, `EntradaDetalhe` (Task 2); `useScrollLock` de `@/lib/useScrollLock` (entregue no PR #107)
- Produces: nada consumido por outras tasks

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/tests/unit/historico-cliente.test.ts`:

```ts
describe('modal de detalhe do atendimento no web', () => {
  const arquivo = 'app/(app)/clientes/[id]/page.tsx';

  it('existe e usa a trava de scroll dos demais modais', () => {
    const src = read(arquivo);
    expect(src).toContain('function DetalheAtendimentoModal(');
    // 3 chamadas: NovoAgModal, modalRemover e o modal novo
    expect((src.match(/useScrollLock\(/g) ?? []).length).toBe(3);
  });

  it('consulta a comanda com maybeSingle para distinguir RLS de erro', () => {
    // .single() devolveria erro quando o RLS filtra a linha; .maybeSingle()
    // devolve null, que e o que montarDetalheAtendimento espera.
    expect(read(arquivo)).toContain('.maybeSingle()');
  });

  it('trata as tres situacoes possiveis do detalhe', () => {
    const src = read(arquivo);
    expect(src).toContain("'bloqueado_por_rls'");
    expect(src).toContain("'sem_comanda'");
    expect(src).toContain('Detalhes financeiros disponíveis apenas para quem atendeu');
  });

  it('torna a linha do historico clicavel', () => {
    expect(read(arquivo)).toContain('setDetalheAberto(');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd web && npx vitest run tests/unit/historico-cliente.test.ts
```

Esperado: os 4 testes novos FALHANDO.

- [ ] **Step 3: Importar o que falta**

```ts
import {
  descreverServicos, montarDetalheAtendimento,
  type DetalheAtendimento,
} from '@shared/atendimento-detalhe';
import { useScrollLock } from '@/lib/useScrollLock';
```

- [ ] **Step 4: Criar o componente do modal**

Adicionar em `web/app/(app)/clientes/[id]/page.tsx`, junto aos outros componentes de modal do arquivo:

```tsx
/**
 * Detalhe de um atendimento do historico: o que foi feito, como fechou e como
 * foi pago. Busca sob demanda — nada disso e carregado junto com a lista.
 *
 * Recebe `agendamentoId` quando a linha veio de um agendamento, ou apenas
 * `comandaId` quando veio de um servico lancado direto na comanda.
 */
function DetalheAtendimentoModal({ agendamentoId, comandaId, tituloLinha, onClose }: {
  agendamentoId: string | null;
  comandaId: string | null;
  tituloLinha: string;
  onClose: () => void;
}) {
  useScrollLock();
  const [carregando, setCarregando] = useState(true);
  const [detalhe, setDetalhe] = useState<DetalheAtendimento | null>(null);

  useEffect(() => {
    (async () => {
      if (!comandaId) {
        setDetalhe(montarDetalheAtendimento({
          agendamentoId, comandaIdEsperado: null, comanda: null,
          itens: [], pagamentos: [], agendamentosDaComanda: [],
        }));
        setCarregando(false);
        return;
      }

      const [rComanda, rItens, rPagamentos, rAgs] = await Promise.all([
        supabase.from('comandas')
          .select('id, valor_total, desconto, desconto_reserva, fechada_at, observacao')
          .eq('id', comandaId).maybeSingle(),
        supabase.from('comanda_itens')
          .select('id, tipo, descricao, quantidade, valor_unit, profissional:users(nome)')
          .eq('comanda_id', comandaId),
        supabase.from('pagamentos')
          .select('id, metodo, valor, bandeira, parcelas, taxa_perc, valor_liquido')
          .eq('comanda_id', comandaId),
        supabase.from('agendamentos')
          .select(`id, data_hora_inicio, valor,
            servico:servicos(nome),
            agendamento_servicos(ordem, servico:servicos(nome)),
            profissional:users!agendamentos_profissional_id_fkey(nome)`)
          .eq('comanda_id', comandaId)
          .order('data_hora_inicio'),
      ]);

      setDetalhe(montarDetalheAtendimento({
        agendamentoId,
        comandaIdEsperado: comandaId,
        comanda: (rComanda.data ?? null) as any,
        itens: (rItens.data ?? []) as any,
        pagamentos: (rPagamentos.data ?? []) as any,
        agendamentosDaComanda: (rAgs.data ?? []) as any,
      }));
      setCarregando(false);
    })();
  }, [agendamentoId, comandaId]);

  const fmtBRL = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  return (
    <div className="bm-modal fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">Detalhe</p>
            <h2 className="font-serif text-lg text-text truncate">{tituloLinha}</h2>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-5">
          {carregando ? (
            <div className="flex flex-col gap-3">
              <Sk className="h-4 w-40"/><Sk className="h-4 w-56"/><Sk className="h-4 w-32"/>
            </div>
          ) : detalhe?.situacao === 'bloqueado_por_rls' ? (
            <p className="text-sm text-text-3">
              Detalhes financeiros disponíveis apenas para quem atendeu ou para a gestão.
            </p>
          ) : detalhe?.situacao === 'sem_comanda' ? (
            <p className="text-sm text-text-3">
              Este atendimento ainda não foi fechado em comanda.
            </p>
          ) : detalhe && (
            <>
              <section className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">O que foi feito</p>
                {detalhe.itens.map(item => (
                  <div key={`${item.origem}-${item.id}`}
                    className={`flex items-start justify-between gap-3 text-sm ${item.esteAtendimento ? 'font-semibold text-text' : 'text-text-2'}`}>
                    <span className="min-w-0">
                      {item.quantidade > 1 && `${item.quantidade}× `}{item.descricao}
                      {item.profissional && (
                        <span className="block text-xs text-text-4">com {item.profissional.split(' ')[0]}</span>
                      )}
                    </span>
                    <span className="flex-shrink-0">{fmtBRL(item.valorLinha)}</span>
                  </div>
                ))}
              </section>

              <section className="flex flex-col gap-1.5 border-t border-border pt-4">
                <p className="text-xs font-semibold text-text-3 uppercase tracking-widest mb-1">Fechamento</p>
                <div className="flex justify-between text-sm text-text-2">
                  <span>Subtotal</span><span>{fmtBRL(detalhe.subtotal)}</span>
                </div>
                {detalhe.descontoManual > 0 && (
                  <div className="flex justify-between text-sm text-text-2">
                    <span>Desconto</span><span>− {fmtBRL(detalhe.descontoManual)}</span>
                  </div>
                )}
                {detalhe.descontoReserva > 0 && (
                  <div className="flex justify-between text-sm text-text-2">
                    <span>Taxa de reserva já paga</span><span>− {fmtBRL(detalhe.descontoReserva)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-text pt-1">
                  <span>Total</span><span>{fmtBRL(detalhe.total)}</span>
                </div>
              </section>

              <section className="flex flex-col gap-1.5 border-t border-border pt-4">
                <p className="text-xs font-semibold text-text-3 uppercase tracking-widest mb-1">Como foi pago</p>
                {detalhe.pagamentos.length === 0 ? (
                  <p className="text-sm text-text-4">Nenhum pagamento registrado.</p>
                ) : detalhe.pagamentos.map(p => (
                  <div key={p.id} className="flex justify-between text-sm text-text-2">
                    <span>
                      {p.metodo}
                      {p.bandeira && ` · ${p.bandeira}`}
                      {p.parcelas > 1 && ` · ${p.parcelas}×`}
                      {p.taxaPerc != null && (
                        <span className="block text-xs text-text-4">
                          taxa {p.taxaPerc}% · líquido {fmtBRL(p.valorLiquido ?? 0)}
                        </span>
                      )}
                    </span>
                    <span>{fmtBRL(p.valor)}</span>
                  </div>
                ))}
              </section>

              {detalhe.outrosAtendimentos.length > 0 && (
                <section className="border-t border-border pt-4">
                  <p className="text-xs text-text-3">
                    Esta comanda fechou {detalhe.outrosAtendimentos.length + 1} atendimentos do mesmo dia —
                    os valores acima são do total da visita:
                  </p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {detalhe.outrosAtendimentos.map(o => (
                      <li key={o.id} className="text-xs text-text-4">
                        {format(parseISO(o.dataHoraInicio), 'HH:mm')} — {o.servicos ?? 'Serviço'}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Estado e abertura na página**

No componente `ClientePerfilPage`, junto aos outros estados:

```tsx
  const [detalheAberto, setDetalheAberto] = useState<
    { agendamentoId: string | null; comandaId: string | null; titulo: string } | null
  >(null);
```

Na renderização da lista (linha ~975), trocar o `<div>` externo da linha por um `<button>`
clicável, mantendo todo o conteúdo interno exatamente como está:

```tsx
                      <button key={ag.id} type="button"
                        onClick={() => setDetalheAberto({
                          agendamentoId: ag.eExtraDeComanda ? null : ag.id,
                          comandaId: ag.comanda_id ?? null,
                          titulo: descreverServicos(ag) ?? 'Atendimento',
                        })}
                        className="w-full text-left flex items-start gap-3 px-5 py-4 hover:bg-bg transition">
```

(fechando com `</button>` no lugar do `</div>` correspondente)

E, junto aos outros modais renderizados no fim da página:

```tsx
      {detalheAberto && (
        <DetalheAtendimentoModal
          agendamentoId={detalheAberto.agendamentoId}
          comandaId={detalheAberto.comandaId}
          tituloLinha={detalheAberto.titulo}
          onClose={() => setDetalheAberto(null)}
        />
      )}
```

- [ ] **Step 6: Rodar os testes e o TypeScript**

```bash
cd web && npx vitest run tests/unit/historico-cliente.test.ts && npm test && npx tsc --noEmit && echo "TSC OK"
```

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat: detalhe do atendimento no historico do web

Modal sob demanda com o que foi feito, o fechamento e as formas de pagamento.
Distingue atendimento nao fechado de comanda bloqueada por RLS, em vez de
mostrar modal vazio nos dois casos.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Mobile — histórico completo e estatísticas corretas

**Files:**
- Create: `shared/paginacao.ts`
- Modify: `web/app/(app)/clientes/[id]/page.tsx:30` (passa a importar o paginador compartilhado)
- Modify: `mobile/hooks/useClientes.ts:215-255`
- Test: `web/tests/unit/historico-cliente.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores
- Produces: `export async function buscarTodasPaginas<T>(montarQuery, tamanhoPagina?): Promise<T[]>` em `shared/paginacao.ts`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/tests/unit/historico-cliente.test.ts`:

```ts
describe('historico da cliente no mobile', () => {
  const hook = 'mobile/hooks/useClientes.ts';
  const leMobile = (f: string) => readFileSync(resolve(__dirname, '../../..', f), 'utf8');

  it('nao trunca o historico em 20', () => {
    expect(leMobile(hook)).not.toContain('.limit(20)');
  });

  it('inclui os servicos lancados direto na comanda', () => {
    const src = leMobile(hook);
    expect(src).toContain("from('comanda_itens')");
    expect(src).toContain("eq('comanda.clientes_id'");
  });

  it('calcula total gasto e visitas sobre a lista completa', () => {
    const src = leMobile(hook);
    // A agregacao antiga somava so `agendamentos`, ja truncado em 20
    expect(src).not.toContain('const concluidos = agendamentos.filter');
    expect(src).toContain('linhasDeVisita');
  });

  it('web e mobile usam o mesmo paginador', () => {
    expect(leMobile(hook)).toContain("from '@shared/paginacao'");
    expect(read('app/(app)/clientes/[id]/page.tsx')).toContain("from '@shared/paginacao'");
    // a copia local do web nao pode sobreviver
    expect(read('app/(app)/clientes/[id]/page.tsx')).not.toContain('async function buscarTodasPaginas');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd web && npx vitest run tests/unit/historico-cliente.test.ts
```

Esperado: os 4 testes novos FALHANDO.

- [ ] **Step 3: Criar `shared/paginacao.ts`**

```ts
/**
 * Busca todas as paginas de uma consulta PostgREST.
 *
 * O PostgREST limita a 1000 linhas por requisicao por padrao, e a truncagem e
 * silenciosa: nao ha erro nem aviso. Sem paginar, o historico de uma cliente
 * antiga aparece cortado sem que ninguem perceba.
 *
 * @param montarQuery Recebe o intervalo (from, to) e devolve a consulta pronta.
 * @param tamanhoPagina Linhas por requisicao. O padrao 1000 e o teto do PostgREST.
 */
export async function buscarTodasPaginas<T>(
  montarQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tamanhoPagina = 1000,
): Promise<T[]> {
  const todas: T[] = [];
  let from = 0;
  for (;;) {
    const { data } = await montarQuery(from, from + tamanhoPagina - 1);
    const linhas = data ?? [];
    todas.push(...linhas);
    if (linhas.length < tamanhoPagina) break;
    from += tamanhoPagina;
  }
  return todas;
}
```

- [ ] **Step 4: Web passa a importar do shared**

Em `web/app/(app)/clientes/[id]/page.tsx`, apagar a função local `buscarTodasPaginas`
(linhas 26-44, incluindo o comentário de bloco acima dela) e importar:

```ts
import { buscarTodasPaginas } from '@shared/paginacao';
```

Nenhuma chamada muda — a assinatura é idêntica.

- [ ] **Step 5: Corrigir a query do mobile**

Em `mobile/hooks/useClientes.ts`, importar no topo do arquivo:

```ts
import { buscarTodasPaginas } from '@shared/paginacao';
```

(**não** importar `descreverServicos` aqui — quem monta o texto do serviço é a tela, na Task 6.)

Dentro de `useClienteDetalhe`, a linha de destructuring passa a ter seis posições, com a consulta
de `comanda_itens` **nova** logo depois da de agendamentos:

```ts
      const [userRes, agLinhas, comandaItens, anamneseRes, taxasRes, reservaRes] = await Promise.all([
```

Atenção: `buscarTodasPaginas` devolve **o array direto**, não um objeto `{ data }`. Por isso a
linha `const agendamentos = agRes.data ?? [];` (linha 245) vira:

```ts
      const agendamentos = agLinhas;
```

Trocar a consulta de `agendamentos` (que hoje termina em `.limit(20)`) por uma paginada e
acrescentar a consulta de `comanda_itens`, espelhando o que o web já faz:

```ts
        buscarTodasPaginas<any>((from, to) =>
          supabase
            .from('agendamentos')
            .select(`*, comanda_id,
              servico:servicos(nome),
              agendamento_servicos(ordem, servico:servicos(nome)),
              profissional:users!agendamentos_profissional_id_fkey(nome)`)
            .eq('empresa_id', empresaId!)
            .eq('cliente_id', clienteId)
            .neq('status', 'cancelado')
            .order('data_hora_inicio', { ascending: false })
            .range(from, to) as any
        ),
        buscarTodasPaginas<any>((from, to) =>
          supabase
            .from('comanda_itens')
            .select(`id, comanda_id, descricao, valor_unit, quantidade, created_at,
              servico:servicos(nome),
              profissional:users(nome),
              comanda:comandas!inner(fechada_at, clientes_id)`)
            .eq('tipo', 'servico')
            .eq('comanda.clientes_id', clienteId)
            .order('created_at', { ascending: false })
            .range(from, to) as any
        ),
```

- [ ] **Step 6: Recalcular as estatísticas sobre a lista completa**

Substituir o bloco de agregação (linhas 248-250):

```ts
      const concluidos = agendamentos.filter((a) => a.status === 'concluido');
      const totalGasto = concluidos.reduce((acc, a) => acc + Number(a.valor), 0);
      const ultimaVisita = concluidos[0]?.data_hora_inicio ?? null;
```

por:

```ts
      // Extras de comanda (servico lancado sem hora marcada) tambem sao visita —
      // e a lista nao e mais truncada, entao os totais batem com os do web.
      const extrasDeComanda = comandaItens.map((cs: any) => ({
        ...cs,
        status: 'concluido',
        valor: Number(cs.valor_unit) * Number(cs.quantidade),
        data_hora_inicio: cs.comanda?.fechada_at ?? cs.created_at,
        eExtraDeComanda: true,
      }));

      const historicoCompleto = [...agendamentos, ...extrasDeComanda]
        .sort((a: any, b: any) => String(b.data_hora_inicio).localeCompare(String(a.data_hora_inicio)));

      const linhasDeVisita = historicoCompleto.filter((a: any) => a.status === 'concluido');
      const totalGasto = linhasDeVisita.reduce((acc: number, a: any) => acc + Number(a.valor ?? 0), 0);
      const ultimaVisita = linhasDeVisita[0]?.data_hora_inicio ?? null;
```

E no `return` do hook, trocar:

```ts
        total_visitas: concluidos.length,
        historico: agendamentos,
```

por:

```ts
        total_visitas: linhasDeVisita.length,
        historico: historicoCompleto,
```

`calcularTags(...)` passa a receber `linhasDeVisita.length` no lugar de `concluidos.length`.

- [ ] **Step 7: Rodar tudo**

```bash
cd web && npx vitest run tests/unit/historico-cliente.test.ts && npm test && npx tsc --noEmit && echo "WEB OK"
cd ../mobile && npx tsc --noEmit 2>&1 | tail -3
```

Esperado: testes verdes, web zerado, mobile com **exatamente** a contagem de erros da baseline da Task 0.

- [ ] **Step 8: Commit**

```bash
git add shared mobile web
git commit -m "fix: historico e estatisticas da cliente no mobile

O historico parava em 20 atendimentos sem aviso e ignorava servicos lancados
direto na comanda. Como total gasto e total de visitas saiam dessa lista, os
dois numeros de destaque do perfil ficavam menores que a realidade.

Paginador unificado em shared/paginacao.ts, com o web adotando a mesma copia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Mobile — lista corrigida e navegação por tipo

**Files:**
- Modify: `mobile/app/(empresa)/cliente/[id].tsx:519` (navegação) e `:540` (nome do serviço)
- Test: `web/tests/unit/historico-cliente.test.ts`

**Interfaces:**
- Consumes: `descreverServicos` (Task 1); `historico` já com extras e `agendamento_servicos` (Task 5)
- Produces: a rota `?tipo=comanda`, consumida pela Task 7

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/tests/unit/historico-cliente.test.ts`:

```ts
describe('lista do historico no mobile', () => {
  const tela = 'mobile/app/(empresa)/cliente/[id].tsx';
  const leMobile = (f: string) => readFileSync(resolve(__dirname, '../../..', f), 'utf8');

  it('mostra todos os servicos do atendimento', () => {
    const src = leMobile(tela);
    expect(src).toContain("from '@shared/atendimento-detalhe'");
    expect(src).toContain('descreverServicos(ag)');
    expect(src).not.toContain("{ag.servico?.nome ?? 'Serviço'}");
  });

  it('roteia o extra de comanda por comanda, nao por agendamento', () => {
    // Passar um id de comanda_itens para /agendamento/[id] abriria tela quebrada
    const src = leMobile(tela);
    expect(src).toContain('tipo=comanda');
    expect(src).toContain('eExtraDeComanda');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd web && npx vitest run tests/unit/historico-cliente.test.ts
```

- [ ] **Step 3: Importar o helper**

Em `mobile/app/(empresa)/cliente/[id].tsx`:

```ts
import { descreverServicos } from '@shared/atendimento-detalhe';
```

- [ ] **Step 4: Corrigir o nome do serviço** (linha ~540)

```tsx
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, marginBottom: 2 }}>
                          {descreverServicos(ag) ?? 'Serviço'}
                        </Text>
```

- [ ] **Step 5: Rotear conforme a origem da linha** (linha 519)

```tsx
                      onPress={() => router.push(
                        (ag as any).eExtraDeComanda
                          ? `/(empresa)/agendamento/${(ag as any).comanda_id}?tipo=comanda`
                          : `/(empresa)/agendamento/${ag.id}`
                      as any)}
```

- [ ] **Step 6: Rodar tudo**

```bash
cd web && npx vitest run tests/unit/historico-cliente.test.ts && npm test
cd ../mobile && npx tsc --noEmit 2>&1 | tail -3
```

Esperado: testes verdes; mobile na baseline.

- [ ] **Step 7: Commit**

```bash
git add mobile web
git commit -m "fix: lista do historico do mobile mostra todos os servicos

Roteia servico avulso de comanda por comanda_id, nao por agendamento — a
linha nao tem agendamento e a rota antiga abriria tela quebrada.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Mobile — seções de comanda, fechamento e pagamento no detalhe

**Files:**
- Modify: `mobile/app/(empresa)/agendamento/[id].tsx`
- Test: `web/tests/unit/historico-cliente.test.ts`

**Interfaces:**
- Consumes: `montarDetalheAtendimento`, `DetalheAtendimento` (Task 2); a rota `?tipo=comanda` (Task 6)
- Produces: nada

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/tests/unit/historico-cliente.test.ts`:

```ts
describe('detalhe do atendimento no mobile', () => {
  const tela = 'mobile/app/(empresa)/agendamento/[id].tsx';
  const leMobile = (f: string) => readFileSync(resolve(__dirname, '../../..', f), 'utf8');

  it('monta o detalhe com a funcao compartilhada', () => {
    const src = leMobile(tela);
    expect(src).toContain('montarDetalheAtendimento');
    expect(src).toContain('.maybeSingle()');
  });

  it('aceita o modo comanda vindo da lista', () => {
    const src = leMobile(tela);
    expect(src).toContain("tipo === 'comanda'");
  });

  it('trata as tres situacoes possiveis', () => {
    const src = leMobile(tela);
    expect(src).toContain("'bloqueado_por_rls'");
    expect(src).toContain("'sem_comanda'");
    expect(src).toContain('Detalhes financeiros disponíveis apenas para quem atendeu');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd web && npx vitest run tests/unit/historico-cliente.test.ts
```

- [ ] **Step 3: Ler o parâmetro `tipo` e tornar a consulta do agendamento opcional**

Em `mobile/app/(empresa)/agendamento/[id].tsx`, acrescentar aos imports:

```ts
import {
  descreverServicos, montarDetalheAtendimento,
  type DetalheAtendimento,
} from '@shared/atendimento-detalhe';
```

`formatBRL`, `format` (date-fns), `MotiView`, `View` e `Text` já estão importados no arquivo e são
reaproveitados pelas seções novas.

No componente da tela:

```ts
const { id, tipo } = useLocalSearchParams<{ id: string; tipo?: string }>();
const modoComanda = tipo === 'comanda';
```

E `useAgendamentoDetalhe` ganha um segundo parâmetro. A assinatura passa de
`useAgendamentoDetalhe(id: string)` para:

```ts
function useAgendamentoDetalhe(id: string, modoComanda: boolean) {
  const { empresaAtiva } = useAuthStore();
  return useQuery({
    queryKey: ['agendamento', id],
    enabled: !!id && !!empresaAtiva?.id && !modoComanda,
    // ... resto igual
```

No modo comanda o `id` da rota é de uma **comanda**, não de um agendamento: sem esse `enabled`, o
`.single()` não acharia linha e a tela quebraria com erro. A chamada na tela vira
`useAgendamentoDetalhe(id, modoComanda)`.

O `select` da consulta do agendamento também passa a trazer o vínculo com a comanda e os
serviços:

```ts
        .select(`
          *, comanda_id,
          cliente:users!agendamentos_cliente_id_fkey(id, nome, telefone, email, foto_url),
          profissional:users!agendamentos_profissional_id_fkey(id, nome, foto_url),
          servico:servicos(id, nome, duracao_minutos, categoria, preco),
          agendamento_servicos(ordem, servico:servicos(nome))
        `)
```

- [ ] **Step 4: Hook novo para o detalhe da comanda**

```ts
/**
 * Busca a comanda do atendimento sob demanda. `comandaId` vem do agendamento
 * (agendamentos.comanda_id) ou direto da rota, no modo comanda.
 */
function useComandaDetalhe(comandaId: string | null, agendamentoId: string | null) {
  return useQuery({
    queryKey: ['comanda-detalhe', comandaId, agendamentoId],
    enabled: !!comandaId,
    staleTime: 1000 * 30,
    queryFn: async (): Promise<DetalheAtendimento> => {
      const [rComanda, rItens, rPagamentos, rAgs] = await Promise.all([
        supabase.from('comandas')
          .select('id, valor_total, desconto, desconto_reserva, fechada_at, observacao')
          .eq('id', comandaId!).maybeSingle(),
        supabase.from('comanda_itens')
          .select('id, tipo, descricao, quantidade, valor_unit, profissional:users(nome)')
          .eq('comanda_id', comandaId!),
        supabase.from('pagamentos')
          .select('id, metodo, valor, bandeira, parcelas, taxa_perc, valor_liquido')
          .eq('comanda_id', comandaId!),
        supabase.from('agendamentos')
          .select(`id, data_hora_inicio, valor,
            servico:servicos(nome),
            agendamento_servicos(ordem, servico:servicos(nome)),
            profissional:users!agendamentos_profissional_id_fkey(nome)`)
          .eq('comanda_id', comandaId!)
          .order('data_hora_inicio'),
      ]);

      return montarDetalheAtendimento({
        agendamentoId,
        comandaIdEsperado: comandaId,
        comanda: (rComanda.data ?? null) as any,
        itens: (rItens.data ?? []) as any,
        pagamentos: (rPagamentos.data ?? []) as any,
        agendamentosDaComanda: (rAgs.data ?? []) as any,
      });
    },
  });
}
```

Uso na tela:

```ts
const comandaId = modoComanda ? id : (ag?.comanda_id ?? null);
const { data: detalhe } = useComandaDetalhe(comandaId, modoComanda ? null : id);
```

- [ ] **Step 5: Renderizar as três seções**

Depois do bloco `{/* ── Detalhes ── */}` (que termina na linha ~322), acrescentar:

```tsx
        {/* ── Comanda: o que foi feito, fechamento e pagamento ── */}
        {detalhe?.situacao === 'bloqueado_por_rls' && (
          <Text style={{
            fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12,
            color: C.text3, paddingHorizontal: 24, marginBottom: 14,
          }}>
            Detalhes financeiros disponíveis apenas para quem atendeu ou para a gestão.
          </Text>
        )}

        {detalhe?.situacao === 'sem_comanda' && (
          <Text style={{
            fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12,
            color: C.text3, paddingHorizontal: 24, marginBottom: 14,
          }}>
            Este atendimento ainda não foi fechado em comanda.
          </Text>
        )}

        {detalhe?.situacao === 'completo' && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 300 }}>

            {/* O que foi feito */}
            <SecaoDetalhe titulo="O que foi feito">
              {detalhe.itens.map((item) => (
                <View key={`${item.origem}-${item.id}`} style={{
                  paddingVertical: 10, paddingHorizontal: 16,
                  flexDirection: 'row', alignItems: 'flex-start', gap: 12,
                  borderBottomWidth: 1, borderBottomColor: C.border,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      fontFamily: item.esteAtendimento
                        ? 'PlusJakartaSans_700Bold'
                        : 'PlusJakartaSans_500Medium',
                      fontSize: 13, color: C.text,
                    }}>
                      {item.quantidade > 1 ? `${item.quantidade}× ` : ''}{item.descricao}
                    </Text>
                    {!!item.profissional && (
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }}>
                        com {item.profissional.split(' ')[0]}
                      </Text>
                    )}
                  </View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text2 }}>
                    {formatBRL(item.valorLinha)}
                  </Text>
                </View>
              ))}
            </SecaoDetalhe>

            {/* Fechamento */}
            <SecaoDetalhe titulo="Fechamento">
              <LinhaValor rotulo="Subtotal" valor={formatBRL(detalhe.subtotal)} />
              {detalhe.descontoManual > 0 && (
                <LinhaValor rotulo="Desconto" valor={`− ${formatBRL(detalhe.descontoManual)}`} />
              )}
              {detalhe.descontoReserva > 0 && (
                <LinhaValor rotulo="Taxa de reserva já paga" valor={`− ${formatBRL(detalhe.descontoReserva)}`} />
              )}
              <LinhaValor rotulo="Total" valor={formatBRL(detalhe.total)} destaque last />
            </SecaoDetalhe>

            {/* Como foi pago */}
            <SecaoDetalhe titulo="Como foi pago">
              {detalhe.pagamentos.length === 0 ? (
                <Text style={{
                  fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12,
                  color: C.text4, paddingVertical: 10, paddingHorizontal: 16,
                }}>
                  Nenhum pagamento registrado.
                </Text>
              ) : detalhe.pagamentos.map((p, i) => (
                <View key={p.id} style={{
                  paddingVertical: 10, paddingHorizontal: 16,
                  flexDirection: 'row', alignItems: 'flex-start', gap: 12,
                  borderBottomWidth: i === detalhe.pagamentos.length - 1 ? 0 : 1,
                  borderBottomColor: C.border,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text, textTransform: 'capitalize' }}>
                      {p.metodo}
                      {p.bandeira ? ` · ${p.bandeira}` : ''}
                      {p.parcelas > 1 ? ` · ${p.parcelas}×` : ''}
                    </Text>
                    {p.taxaPerc != null && (
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }}>
                        taxa {p.taxaPerc}% · líquido {formatBRL(p.valorLiquido ?? 0)}
                      </Text>
                    )}
                  </View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text2 }}>
                    {formatBRL(p.valor)}
                  </Text>
                </View>
              ))}
            </SecaoDetalhe>

            {/* Comanda que cobriu mais de um atendimento */}
            {detalhe.outrosAtendimentos.length > 0 && (
              <View style={{ paddingHorizontal: 24, marginBottom: 14 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
                  Esta comanda fechou {detalhe.outrosAtendimentos.length + 1} atendimentos do mesmo
                  dia — os valores acima são do total da visita:
                </Text>
                {detalhe.outrosAtendimentos.map((o) => (
                  <Text key={o.id} style={{
                    fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11,
                    color: C.text4, marginTop: 3,
                  }}>
                    {format(new Date(o.dataHoraInicio), 'HH:mm')} — {o.servicos ?? 'Serviço'}
                  </Text>
                ))}
              </View>
            )}
          </MotiView>
        )}
```

E os dois componentes auxiliares, junto de `InfoRow` no mesmo arquivo:

```tsx
/** Cartao de secao do detalhe, no mesmo formato visual do bloco "Detalhes". */
function SecaoDetalhe({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 24, marginBottom: 14 }}>
      <Text style={{
        fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11,
        color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8,
        marginBottom: 7, marginLeft: 2,
      }}>
        {titulo}
      </Text>
      <View style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
        borderRadius: 16, overflow: 'hidden',
        shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
      }}>
        {children}
      </View>
    </View>
  );
}

/** Linha rotulo/valor do bloco de fechamento. */
function LinhaValor({ rotulo, valor, destaque = false, last = false }: {
  rotulo: string; valor: string; destaque?: boolean; last?: boolean;
}) {
  return (
    <View style={{
      paddingVertical: 10, paddingHorizontal: 16,
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderBottomWidth: last ? 0 : 1, borderBottomColor: C.border,
    }}>
      <Text style={{
        fontFamily: destaque ? 'PlusJakartaSans_700Bold' : 'PlusJakartaSans_400Regular',
        fontSize: 13, color: destaque ? C.text : C.text2,
      }}>
        {rotulo}
      </Text>
      <Text style={{
        fontFamily: destaque ? 'PlusJakartaSans_700Bold' : 'PlusJakartaSans_500Medium',
        fontSize: 13, color: destaque ? C.text : C.text2,
      }}>
        {valor}
      </Text>
    </View>
  );
}
```

No modo comanda (`modoComanda === true`), as seções de agendamento (hero com cliente, KPIs de
duração, ações de status) **não** são renderizadas — não há agendamento. Só o cabeçalho com a
data da comanda e as três seções novas.

- [ ] **Step 6: Corrigir o nome do serviço na seção Detalhes** (linha 311)

```tsx
<InfoRow icon={<Scissors size={13} color={C.primary} strokeWidth={2} />} label="Serviço" value={descreverServicos(ag) ?? '—'} />
```

- [ ] **Step 7: Rodar tudo**

```bash
cd web && npx vitest run tests/unit/historico-cliente.test.ts && npm test
cd ../mobile && npx tsc --noEmit 2>&1 | tail -3
```

Esperado: testes verdes; mobile na baseline.

- [ ] **Step 8: Commit**

```bash
git add mobile web
git commit -m "feat: detalhe do atendimento no mobile mostra comanda e pagamento

A tela ja existia mas so mostrava servico, profissional, valor e duracao.
Ganha o que foi feito, o fechamento e as formas de pagamento, com o mesmo
tratamento de RLS do web. Aceita o modo comanda para servico avulso.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Verificação final da branch

**Files:** apenas se a verificação encontrar algo

**Interfaces:**
- Consumes: resultado das Tasks 1-7
- Produces: nada

- [ ] **Step 1: Suíte, TypeScript e baseline**

```bash
cd web && npm test && npx tsc --noEmit && echo "WEB OK"
cd ../mobile && npx tsc --noEmit 2>&1 | tail -3
```

Esperado: suíte verde, web zerado, mobile **exatamente** na baseline da Task 0.

- [ ] **Step 2: Nenhuma migration foi criada**

```bash
git diff --name-only main...HEAD -- supabase/
```

Esperado: **nenhuma linha de saída**.

- [ ] **Step 3: Nenhum consumo de serviço legado sobrou nas listas**

```bash
grep -rn "servico?.nome" "web/app/(app)/clientes/[id]/page.tsx" "mobile/app/(empresa)/cliente/[id].tsx" "mobile/app/(empresa)/agendamento/[id].tsx"
```

Cada ocorrência restante precisa estar **dentro** de `descreverServicos` ou ser um fallback
deliberado. Qualquer leitura direta na renderização de lista ou de detalhe é defeito.

- [ ] **Step 4: Conferir a aritmética do desconto contra o código que grava**

Reler `web/app/(app)/comanda/page.tsx` no insert da comanda e confirmar que continua gravando
`desconto: descontoN + descontoReservaAplicado`. Se algum dia isso mudar, `descontoManual =
desconto - desconto_reserva` passa a estar errado — é a única suposição do detalhe sobre como o
dado foi gravado.

- [ ] **Step 5: Revisar o diff completo**

```bash
git diff main...HEAD --stat
```

- [ ] **Step 6: Commit (só se a verificação exigiu correção)**

```bash
git add -A
git commit -m "fix: corrige achados da verificacao final da branch

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Cobertura da spec

| Requisito | Task |
|---|---|
| A1 — multi-serviço no web (lista + serviço favorito) | 1, 3 |
| A1 — multi-serviço no mobile (lista + detalhe) | 1, 6, 7 |
| A2 — extras de comanda no histórico do mobile | 5 |
| A3 — corte em 20 no mobile | 5 |
| A4 — total gasto e visitas subestimados | 5 |
| B — detalhe no web | 2, 4 |
| B — detalhe no mobile | 2, 7 |
| B — comanda que cobre vários atendimentos | 2 (`outrosAtendimentos`), 4, 7 |
| C — lógica pura compartilhada | 1, 2 |
| C — busca sob demanda | 4, 7 |
| C — rota `tipo=comanda` no mobile | 6, 7 |
| D — degradação honesta sob RLS | 2 (`situacao`), 4, 7 |
| Critérios 1-2 (tsc, testes) | Task 0 (baseline), todas as tasks, 8 |
| Critérios 3-10 | Tasks 3-7, verificados nos testes de cada uma |
