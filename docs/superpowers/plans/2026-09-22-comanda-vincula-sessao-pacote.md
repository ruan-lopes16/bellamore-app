# Comanda — vincular atendimento a sessão de pacote — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a Comanda (web + mobile) zerar automaticamente o valor cobrado de um
atendimento vinculado a uma sessão de pacote, resolvendo os três sintomas
reportados (alerta de "não fechada" com falso positivo aparente, botão de salvar
travado sem erro, e a ausência de um jeito de vincular atendimento a sessão).

**Architecture:** A Comanda passa a ser a única fonte de verdade sobre cobrar ou
não — ela lê `agendamentos.pacote_cliente_id` (já existe no banco desde a
migration 036) para decidir, em vez de confiar no `valor` gravado. Nenhuma
migration nova. A Agenda não muda.

**Tech Stack:** Next.js 15 (web) + Expo/React Native (mobile) + Supabase +
Vitest. Segue os padrões já usados por `shared/taxa-reserva.ts` (desconto
já pago aplicado na comanda) e `shared/comanda.ts` (persistência de valor
editado).

**Spec:** `docs/superpowers/specs/2026-09-22-comanda-vincula-sessao-pacote-design.md`

## Global Constraints

- Vínculo com pacote é por **atendimento inteiro** (`agendamentos.pacote_cliente_id`), nunca por serviço individual dentro de um atendimento multi-serviço.
- Sessão coberta por pacote sempre grava valor **R$ 0**, nunca desconto separado.
- Quando não houver nenhum split de pagamento lançado e o total já for R$ 0, grava um pagamento `cortesia` de **valor 0** — nunca o valor cheio (evita contar receita da venda do pacote duas vezes).
- **Fora de escopo:** vincular pacote ao editar uma comanda já fechada (`editarComanda` no web). Não mexer nesse fluxo.
- **Fora de escopo:** mudar o cálculo de valor na tela de Agenda (web ou mobile).
- Sem migration nova.
- `cd web && npx tsc --noEmit` deve ficar em zero erros após cada task web.
- `cd mobile && npx tsc --noEmit` não pode introduzir nenhum erro novo além dos pré-existentes (rodar a baseline na Task 6 antes de mexer em mobile, para comparar).
- **Números de linha são aproximados**, válidos no estado do arquivo no momento em que este plano foi escrito (antes da Task 1). Cada task de `comanda/page.tsx` (3, 4, 5) e de `nova-comanda.tsx` (6, 7, 8) roda depois da anterior ter inserido código no mesmo arquivo, então a linha real pode ter deslocado. Use o texto citado (`old_string`) pra localizar o trecho por busca — ele é único no arquivo — e trate o número de linha só como uma pista de vizinhança, não como verdade absoluta.

---

## Task 1: `shared/pacotes.ts` — elegibilidade de pacotes do cliente

**Files:**
- Create: `shared/pacotes.ts`
- Test: `web/tests/unit/pacotes-ativos-cliente.test.ts`

**Interfaces:**
- Produces: `calcularPacotesAtivosCliente(rows: PacoteClienteRaw[], hojeIso: string): PacoteClienteOpt[]` — usado pelas Tasks 3 e 6.
- Produces: tipos `PacoteClienteRaw`, `PacoteClienteOpt`, `PacoteSessaoFeita`.

Essa função replica, como função pura testável, a lógica que já existe hoje
*inline* em `web/app/(app)/agenda/page.tsx:459-486` (e o equivalente em
`mobile/app/(empresa)/novo-agendamento.tsx:205-232`) — mesma regra de
elegibilidade que o trigger `fn_registrar_uso_pacote` (migration 036) usa no
banco. Extraída aqui porque a Comanda (Tasks 3 e 6) precisa da mesma
computação e não deve duplicá-la pela terceira vez.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// web/tests/unit/pacotes-ativos-cliente.test.ts
import { describe, expect, it } from 'vitest';
import { calcularPacotesAtivosCliente, type PacoteClienteRaw } from '@shared/pacotes';

function raw(over: Partial<PacoteClienteRaw>): PacoteClienteRaw {
  return {
    id: 'pc1',
    data_validade: null,
    pacote: { nome: 'Pacote X', controla_sessoes: true, servicos: [{ servico_id: 's1', quantidade: 10 }] },
    uso: [],
    ...over,
  };
}

describe('calcularPacotesAtivosCliente', () => {
  it('pacote sem sessão usada — restantes = total', () => {
    const r = calcularPacotesAtivosCliente([raw({})], '2026-09-22');
    expect(r).toEqual([{
      id: 'pc1', nome: 'Pacote X', total: 10, usadas: 0, restantes: 10,
      servicos: [{ servico_id: 's1' }], sessoes: [],
    }]);
  });

  it('soma quantidade de múltiplos serviços do pacote', () => {
    const r = calcularPacotesAtivosCliente([raw({
      pacote: { nome: 'Combo', controla_sessoes: true, servicos: [{ servico_id: 's1', quantidade: 4 }, { servico_id: 's2', quantidade: 6 }] },
    })], '2026-09-22');
    expect(r[0].total).toBe(10);
  });

  it('sessão com quantidade null em qualquer serviço torna o pacote ilimitado (total/restantes null)', () => {
    const r = calcularPacotesAtivosCliente([raw({
      pacote: { nome: 'Ilimitado', controla_sessoes: true, servicos: [{ servico_id: 's1', quantidade: null }] },
    })], '2026-09-22');
    expect(r[0].total).toBeNull();
    expect(r[0].restantes).toBeNull();
  });

  it('desconta sessões já usadas de "restantes"', () => {
    const r = calcularPacotesAtivosCliente([raw({
      uso: [{ id: 'u1', created_at: '2026-09-01T10:00:00Z', agendamento_id: 'ag1', servico: { nome: 'Massagem' } }],
    })], '2026-09-22');
    expect(r[0].usadas).toBe(1);
    expect(r[0].restantes).toBe(9);
    expect(r[0].sessoes).toEqual([{ id: 'u1', data: '2026-09-01T10:00:00Z', servico: 'Massagem', viaAg: true }]);
  });

  it('pacote sem sessões restantes (restantes = 0) fica de fora do resultado', () => {
    const usoCheio = Array.from({ length: 10 }, (_, i) => ({ id: `u${i}`, created_at: '2026-09-01T10:00:00Z', agendamento_id: null, servico: null }));
    const r = calcularPacotesAtivosCliente([raw({ uso: usoCheio })], '2026-09-22');
    expect(r).toEqual([]);
  });

  it('pacote vencido (data_validade no passado) fica de fora', () => {
    const r = calcularPacotesAtivosCliente([raw({ data_validade: '2026-01-01' })], '2026-09-22');
    expect(r).toEqual([]);
  });

  it('data_validade igual a hoje ainda conta como válido', () => {
    const r = calcularPacotesAtivosCliente([raw({ data_validade: '2026-09-22' })], '2026-09-22');
    expect(r).toHaveLength(1);
  });

  it('pacote combo (controla_sessoes = false) fica de fora — não tem conceito de sessão', () => {
    const r = calcularPacotesAtivosCliente([raw({
      pacote: { nome: 'Combo fixo', controla_sessoes: false, servicos: [{ servico_id: 's1', quantidade: 1 }] },
    })], '2026-09-22');
    expect(r).toEqual([]);
  });

  it('pacote sem data_validade (null) nunca vence', () => {
    const r = calcularPacotesAtivosCliente([raw({ data_validade: null })], '2026-09-22');
    expect(r).toHaveLength(1);
  });

  it('sessoes ordenadas da mais recente para a mais antiga', () => {
    const r = calcularPacotesAtivosCliente([raw({
      uso: [
        { id: 'u1', created_at: '2026-09-01T10:00:00Z', agendamento_id: null, servico: null },
        { id: 'u2', created_at: '2026-09-10T10:00:00Z', agendamento_id: null, servico: null },
      ],
    })], '2026-09-22');
    expect(r[0].sessoes.map(s => s.id)).toEqual(['u2', 'u1']);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run tests/unit/pacotes-ativos-cliente.test.ts`
Expected: FAIL — `Cannot find module '@shared/pacotes'`

- [ ] **Step 3: Implementar**

```typescript
// shared/pacotes.ts

/** Uma sessao registrada em pacote_uso, ja resolvida para exibicao. */
export type PacoteSessaoFeita = {
  id: string;
  data: string;             // pacote_uso.created_at (ISO)
  servico: string | null;
  viaAg: boolean;           // true = veio de um agendamento; false = lancamento avulso
};

/** Formato bruto vindo do supabase (join pacote_clientes -> pacotes -> pacote_servicos / pacote_uso). */
export type PacoteClienteRaw = {
  id: string;
  data_validade: string | null; // yyyy-MM-dd
  pacote: {
    nome: string | null;
    controla_sessoes: boolean | null;
    servicos: { servico_id: string; quantidade: number | null }[];
  } | null;
  uso: {
    id: string;
    created_at: string;
    agendamento_id: string | null;
    servico: { nome: string } | null;
  }[];
};

/** Pacote do cliente ja elegivel para uso (ativo, dentro da validade, com sessao sobrando). */
export type PacoteClienteOpt = {
  id: string;
  nome: string;
  total: number | null;      // null = ilimitado
  usadas: number;
  restantes: number | null;  // null = ilimitado
  servicos: { servico_id: string }[];
  sessoes: PacoteSessaoFeita[];
};

/**
 * Filtra e calcula, a partir dos pacote_clientes ATIVOS de um cliente (o
 * caller ja filtrou status='ativo' na query), quais ainda tem sessao
 * disponivel. Mesma regra usada pelo trigger fn_registrar_uso_pacote
 * (migration 036): combo (controla_sessoes=false) nao entra, pacote vencido
 * nao entra, "restantes" soma a quantidade de todos os servicos do pacote e
 * subtrai o total ja usado (qualquer servico), null em qualquer linha de
 * servico torna o pacote inteiro ilimitado.
 *
 * hojeIso deve ser uma data yyyy-MM-dd (comparacao lexicografica, sem parse
 * de fuso horario).
 */
export function calcularPacotesAtivosCliente(
  rows: PacoteClienteRaw[],
  hojeIso: string,
): PacoteClienteOpt[] {
  return rows
    .filter(pc => (pc.pacote?.controla_sessoes ?? true) && (!pc.data_validade || pc.data_validade >= hojeIso))
    .map(pc => {
      const servicosPac = pc.pacote?.servicos ?? [];
      const ilimitado = servicosPac.some(s => s.quantidade == null);
      const total = ilimitado ? null : servicosPac.reduce((s, x) => s + (x.quantidade ?? 0), 0);
      const usadas = pc.uso.length;
      const restantes = total != null ? total - usadas : null;
      const sessoes: PacoteSessaoFeita[] = [...pc.uso]
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        .map(u => ({ id: u.id, data: u.created_at, servico: u.servico?.nome ?? null, viaAg: !!u.agendamento_id }));
      return {
        id: pc.id,
        nome: pc.pacote?.nome ?? 'Pacote',
        total,
        usadas,
        restantes,
        servicos: servicosPac.map(s => ({ servico_id: s.servico_id })),
        sessoes,
      };
    })
    .filter(p => p.restantes === null || p.restantes > 0);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run tests/unit/pacotes-ativos-cliente.test.ts`
Expected: PASS — 10/10

- [ ] **Step 5: Commit**

```bash
git add shared/pacotes.ts web/tests/unit/pacotes-ativos-cliente.test.ts
git commit -m "feat(pacotes): funcao pura de elegibilidade de pacotes ativos do cliente"
```

---

## Task 2: `shared/comanda.ts` — vínculo de pacote no agrupamento por agendamento

**Files:**
- Modify: `shared/comanda.ts`
- Test: `web/tests/unit/comanda-valor-persistencia.test.ts`

**Interfaces:**
- Consumes: nada de fora.
- Produces: `agruparValoresPorAgendamento(itens, pacoteLinksPorAgendamento?)` — o parâmetro novo é opcional (não quebra a chamada existente em `editarComanda`, que não vincula pacote). `PersistenciaValorAgendamento` ganha `pacoteClienteId?: string`. Usado pelas Tasks 5 e 8 (via `persistirValoresAgendamento`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final do `describe('agruparValoresPorAgendamento', ...)` já
existente em `web/tests/unit/comanda-valor-persistencia.test.ts` (não
remover nenhum teste existente):

```typescript
  it('inclui pacoteClienteId no grupo quando ha vinculo pendente pro agendamento', () => {
    const r = agruparValoresPorAgendamento(
      [item({ agendamento_id: 'ag1', ag_servico_id: 'as1', valor: 0 })],
      { ag1: 'pc-123' },
    );
    expect(r[0].pacoteClienteId).toBe('pc-123');
  });

  it('nao inclui pacoteClienteId quando o agendamento nao esta no mapa de vinculos', () => {
    const r = agruparValoresPorAgendamento(
      [item({ agendamento_id: 'ag1', ag_servico_id: 'as1', valor: 100 })],
      { outroAgendamento: 'pc-999' },
    );
    expect(r[0].pacoteClienteId).toBeUndefined();
  });

  it('sem segundo argumento, comportamento identico ao anterior (compatibilidade com editarComanda)', () => {
    const r = agruparValoresPorAgendamento([item({ agendamento_id: 'ag1', ag_servico_id: 'as1', valor: 100 })]);
    expect(r[0].pacoteClienteId).toBeUndefined();
    expect(r[0].novoValorTotal).toBe(100);
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run tests/unit/comanda-valor-persistencia.test.ts`
Expected: FAIL nos 2 primeiros testes novos (`pacoteClienteId` undefined em vez de `'pc-123'`)

- [ ] **Step 3: Implementar**

Em `shared/comanda.ts`, editar o tipo e a função:

```typescript
/** O que gravar de volta em um agendamento apos editar valores na comanda. */
export type PersistenciaValorAgendamento = {
  agendamentoId: string;
  /** Novo `agendamentos.valor` = soma das linhas daquele agendamento na comanda. */
  novoValorTotal: number;
  /** Linhas de `agendamento_servicos` cujo `valor` deve ser regravado. */
  linhasServico: { agServicoId: string; valor: number }[];
  /** pacote_clientes.id a gravar em agendamentos.pacote_cliente_id, quando a comanda vinculou uma sessao de pacote a este agendamento. Ausente = nao mexer no vinculo existente. */
  pacoteClienteId?: string;
};

export function agruparValoresPorAgendamento(
  itens: ItemComandaValor[],
  pacoteLinksPorAgendamento: Record<string, string> = {},
): PersistenciaValorAgendamento[] {
  const porAgendamento = new Map<string, PersistenciaValorAgendamento>();

  for (const item of itens) {
    if (item.tipo !== 'agendamento') continue;
    if (!item.agendamento_id) continue;

    const quantidade = item.quantidade > 0 ? item.quantidade : 1;

    let grupo = porAgendamento.get(item.agendamento_id);
    if (!grupo) {
      grupo = {
        agendamentoId: item.agendamento_id,
        novoValorTotal: 0,
        linhasServico: [],
      };
      porAgendamento.set(item.agendamento_id, grupo);
    }

    grupo.novoValorTotal += item.valor * quantidade;
    if (item.ag_servico_id) {
      grupo.linhasServico.push({ agServicoId: item.ag_servico_id, valor: item.valor });
    }
  }

  for (const grupo of porAgendamento.values()) {
    grupo.novoValorTotal = Math.round(grupo.novoValorTotal * 100) / 100;
    const pacoteClienteId = pacoteLinksPorAgendamento[grupo.agendamentoId];
    if (pacoteClienteId) grupo.pacoteClienteId = pacoteClienteId;
  }

  return [...porAgendamento.values()];
}
```

Só isso muda — o resto do arquivo (`ItemComandaValor`, o JSDoc do topo) fica igual.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run tests/unit/comanda-valor-persistencia.test.ts`
Expected: PASS — todos os testes (os antigos + os 3 novos)

- [ ] **Step 5: Rodar o tsc pra garantir que nada mais quebrou**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros (o novo parâmetro é opcional, não quebra `editarComanda` que chama `agruparValoresPorAgendamento(itens)` sem ele — via `persistirValoresAgendamento()` sem segundo argumento, que ainda não existe até a Task 5, então neste ponto `persistirValoresAgendamento` continua com a assinatura antiga; a Task 5 é quem muda essa assinatura)

- [ ] **Step 6: Commit**

```bash
git add shared/comanda.ts web/tests/unit/comanda-valor-persistencia.test.ts
git commit -m "feat(comanda): agruparValoresPorAgendamento aceita vinculo de pacote por agendamento"
```

---

## Task 3: Web — query de pacotes elegíveis + estado + pré-preenchimento zerado

**Files:**
- Modify: `web/app/(app)/comanda/page.tsx`

**Interfaces:**
- Consumes: `calcularPacotesAtivosCliente`, `PacoteClienteOpt` (Task 1).
- Produces: estados `pacotesClienteAtivos`, `pacoteLinks`, `pacoteVenderPorAgendamento` — consumidos pela Task 4 (handlers/UI) e Task 5 (`fecharComanda`).

- [ ] **Step 1: Adicionar `pacote_cliente_id` ao tipo `AgDia` e à query do dia**

Editar (linha 64-75):

```typescript
type AgDia = {
  id: string;
  data_hora_inicio: string;
  data_hora_fim: string;
  status: string;
  valor: number;
  comanda_id: string | null;
  pacote_cliente_id: string | null;
  cliente:      { id: string; nome: string; telefone?: string } | null;
  profissional: { id: string; nome: string } | null;
  servico:      { id: string; nome: string; preco: number }    | null;
  agendamento_servicos: AgServicoDia[];
};
```

Editar a query (linha 255-260), acrescentando `pacote_cliente_id,` logo depois de `comanda_id,`:

```typescript
      supabase.from('agendamentos')
        .select(`id, data_hora_inicio, data_hora_fim, status, valor, comanda_id, pacote_cliente_id,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, preco),
          agendamento_servicos(id,servico_id,valor,duracao_minutos,ordem,servico:servicos(id,nome))`)
```

- [ ] **Step 2: Novos imports e estados**

No topo do arquivo, acrescentar ao import já existente da linha 55:

```typescript
import { agruparValoresPorAgendamento } from '@shared/comanda';
import { calcularPacotesAtivosCliente, type PacoteClienteOpt } from '@shared/pacotes';
```

Logo depois da declaração de `comandaExistenteId` (linha 205), acrescentar:

```typescript
  const [comandaExistenteId, setComandaExistenteId] = useState<string | null>(null);
  // Pacotes ativos do cliente selecionado, elegíveis pra vincular a um atendimento
  const [pacotesClienteAtivos, setPacotesClienteAtivos] = useState<PacoteClienteOpt[]>([]);
  // Vínculos feitos NESTA sessão de comanda (agendamento_id -> pacote_clientes.id), ainda não persistidos
  const [pacoteLinks, setPacoteLinks] = useState<Record<string, string>>({});
  // Pacotes NOVOS a vender do catálogo (agendamento_id -> pacotes.id), pra quando o cliente não tem nenhum elegível
  const [pacoteVenderPorAgendamento, setPacoteVenderPorAgendamento] = useState<Record<string, string>>({});
```

- [ ] **Step 3: Efeito que busca os pacotes ativos do cliente selecionado**

Logo depois do `useEffect` que carrega `empresaId` (linha 246, após o `}, []);` de fechamento), acrescentar:

```typescript
  // Pacotes ativos do cliente selecionado — pra oferecer vínculo com sessão
  useEffect(() => {
    if (!clienteSel || clienteSel.id === '__sem__' || !empresaId) { setPacotesClienteAtivos([]); return; }
    supabase.from('pacote_clientes')
      .select('id, data_validade, pacote:pacotes(nome, controla_sessoes, servicos:pacote_servicos(servico_id, quantidade)), uso:pacote_uso(id, created_at, agendamento_id, servico:servicos(nome))')
      .eq('empresa_id', empresaId)
      .eq('cliente_id', clienteSel.id)
      .eq('status', 'ativo')
      .then(({ data }: { data: any[] | null }) => {
        setPacotesClienteAtivos(calcularPacotesAtivosCliente((data ?? []) as any[], format(new Date(), 'yyyy-MM-dd')));
      });
  }, [clienteSel?.id, empresaId]);
```

(`clienteSel` já existe como estado; `format` já está importado de `date-fns` no topo do arquivo.)

- [ ] **Step 4: `abrirComanda` — inicializa vínculos já existentes e zera o valor deles**

Substituir a função inteira (linhas 385-425):

```typescript
  // ── Abrir comanda para um cliente (nova)
  function abrirComanda(cliente: ClienteComanda) {
    setClienteSel(cliente);
    setComandaExistenteId(null);
    setErro('');
    setDescontoPct('');
    setSplits([]);
    setPacoteVenderPorAgendamento({});

    // Atendimentos já vinculados a um pacote na Agenda (ou numa comanda
    // anterior desta sessão) entram já cobertos — é o que resolve, sem
    // backfill, os atendimentos que hoje ficam travados sem cobrança
    // possível.
    const linksIniciais: Record<string, string> = {};
    for (const ag of cliente.agendamentos) {
      if (ag.pacote_cliente_id) linksIniciais[ag.id] = ag.pacote_cliente_id;
    }
    setPacoteLinks(linksIniciais);

    // Pré-preenche itens — cada serviço do agendamento vira um item separado
    setItens(
      cliente.agendamentos
        .filter(ag => ag.status !== 'concluido')
        .flatMap(ag => {
          const coberto = !!ag.pacote_cliente_id;
          const servicos = [...(ag.agendamento_servicos ?? [])].sort((a, b) => a.ordem - b.ordem);
          if (servicos.length > 0) {
            return servicos.map(s => ({
              uid:             uid(),
              tipo:            'agendamento' as const,
              descricao:       s.servico?.nome ?? 'Serviço',
              profissional:    ag.profissional?.nome,
              valor:           coberto ? 0 : s.valor,
              quantidade:      1,
              agendamento_id:  ag.id,
              ag_servico_id:   s.id,
              servico_id:      s.servico?.id,
              profissional_id: ag.profissional?.id,
            }));
          }
          return [{
            uid:             uid(),
            tipo:            'agendamento' as const,
            descricao:       ag.servico?.nome ?? 'Serviço',
            profissional:    ag.profissional?.nome,
            valor:           coberto ? 0 : ag.valor,
            quantidade:      1,
            agendamento_id:  ag.id,
            servico_id:      ag.servico?.id,
            profissional_id: ag.profissional?.id,
          }];
        })
    );
  }
```

- [ ] **Step 5: `abrirComandaFechada` — só limpa os estados novos (sem vincular pacote, fora de escopo)**

Essa função (a partir da linha 428) fica **funcionalmente igual** — só precisa
zerar os 2 estados novos pra não vazar vínculo de uma comanda pra outra ao
trocar de cliente. Logo após a linha `setErro(''); setDescontoPct(''); setSplits([]);`
dentro de `abrirComandaFechada`, acrescentar:

```typescript
    setPacoteLinks({});
    setPacoteVenderPorAgendamento({});
```

- [ ] **Step 6: Verificar tsc**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros

- [ ] **Step 7: Commit**

```bash
git add web/app/\(app\)/comanda/page.tsx
git commit -m "feat(comanda): carrega pacotes ativos do cliente e zera atendimentos ja vinculados"
```

---

## Task 4: Web — vincular/desvincular pacote + UI

**Files:**
- Modify: `web/app/(app)/comanda/page.tsx`

**Interfaces:**
- Consumes: `pacotesClienteAtivos`, `pacoteLinks`, `pacoteVenderPorAgendamento`, `pacotesCat` (Task 3 + já existente).
- Produces: handlers `vincularPacote`, `desvincularPacote`, `venderEVincularPacote` — a UI da Task 4 os usa; `fecharComanda` (Task 5) lê `pacoteLinks`/`pacoteVenderPorAgendamento`.

- [ ] **Step 1: Handlers, logo após `removerItem` (linha ~651, função existente `function removerItem(u: string) { ... }`)**

```typescript
  /** Vincula um atendimento a uma sessão de um pacote já ativo do cliente — zera o(s) item(ns) daquele atendimento. */
  function vincularPacote(agendamentoId: string, pacoteClienteId: string) {
    setPacoteLinks(prev => ({ ...prev, [agendamentoId]: pacoteClienteId }));
    setPacoteVenderPorAgendamento(prev => {
      if (!(agendamentoId in prev)) return prev;
      const { [agendamentoId]: _omit, ...resto } = prev;
      return resto;
    });
    setItens(prev => prev.map(i => i.agendamento_id === agendamentoId ? { ...i, valor: 0 } : i));
  }

  /** Desfaz o vínculo (existente ou "vender pacote novo") — restaura o valor de tabela do atendimento. */
  function desvincularPacote(agendamentoId: string) {
    setPacoteLinks(prev => {
      if (!(agendamentoId in prev)) return prev;
      const { [agendamentoId]: _omit, ...resto } = prev;
      return resto;
    });
    setPacoteVenderPorAgendamento(prev => {
      if (!(agendamentoId in prev)) return prev;
      const { [agendamentoId]: _omit, ...resto } = prev;
      return resto;
    });
    const ag = agDia.find(a => a.id === agendamentoId);
    setItens(prev => prev.map(i => {
      if (i.agendamento_id !== agendamentoId || !ag) return i;
      if (i.ag_servico_id) {
        const s = (ag.agendamento_servicos ?? []).find(x => x.id === i.ag_servico_id);
        return s ? { ...i, valor: s.valor } : i;
      }
      return { ...i, valor: ag.valor };
    }));
  }

  /** Cliente sem pacote elegível pro serviço — marca pra vender um pacote novo do catálogo ao fechar, e já zera o item (a venda de fato acontece em fecharComanda). */
  function venderEVincularPacote(agendamentoId: string, pacoteCatalogoId: string) {
    setPacoteVenderPorAgendamento(prev => ({ ...prev, [agendamentoId]: pacoteCatalogoId }));
    setPacoteLinks(prev => {
      if (!(agendamentoId in prev)) return prev;
      const { [agendamentoId]: _omit, ...resto } = prev;
      return resto;
    });
    setItens(prev => prev.map(i => i.agendamento_id === agendamentoId ? { ...i, valor: 0 } : i));
  }
```

- [ ] **Step 2: UI — seção "Vincular a pacote" dentro do loop de itens**

No JSX (dentro de `{itens.map(item => (...))}`, por volta da linha 1215-1281),
acrescentar a seção logo **depois** do `</div>` que fecha o bloco
`{item.tipo === 'servico' && (...)}` (linha 1279) e **antes** do `</div>`
que fecha o `<div key={item.uid} ...>` (linha 1280). O bloco só renderiza
uma vez por atendimento (guarda `item === itens.find(...)`, já que um
atendimento multi-serviço gera vários itens com o mesmo `agendamento_id`):

```typescript
                        {/* Vínculo com sessão de pacote — uma vez por atendimento, não por linha de serviço */}
                        {item.tipo === 'agendamento' && item.agendamento_id &&
                         item === itens.find(i => i.agendamento_id === item.agendamento_id) && (() => {
                          const agendamentoId = item.agendamento_id!;
                          const pacoteVinculado = pacotesClienteAtivos.find(p => p.id === pacoteLinks[agendamentoId]);
                          const pacoteParaVender = pacotesCat.find(p => p.id === pacoteVenderPorAgendamento[agendamentoId]);
                          if (pacoteVinculado || pacoteParaVender) {
                            return (
                              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-green-soft border border-green/20 px-3 py-2">
                                <span className="text-xs font-semibold text-green truncate">
                                  {pacoteVinculado ? `Sessão de pacote — ${pacoteVinculado.nome}` : `Novo pacote — ${pacoteParaVender!.nome}`}
                                </span>
                                <button onClick={() => desvincularPacote(agendamentoId)}
                                  className="text-xs font-semibold text-text-4 hover:text-red flex-shrink-0">
                                  Desvincular
                                </button>
                              </div>
                            );
                          }
                          const servicoId = item.servico_id;
                          const elegiveis = servicoId
                            ? pacotesClienteAtivos.filter(p => p.servicos.some(s => s.servico_id === servicoId))
                            : [];
                          if (elegiveis.length === 0 && pacotesCat.length === 0) return null;
                          return (
                            <div className="mt-2">
                              {elegiveis.length > 0 ? (
                                <SearchSelect
                                  options={elegiveis.map(p => ({ value: p.id, label: p.nome, sub: p.restantes == null ? 'ilimitado' : `${p.restantes} restante${p.restantes !== 1 ? 's' : ''}` }))}
                                  value=""
                                  onChange={id => vincularPacote(agendamentoId, id)}
                                  placeholder="Vincular a sessão de pacote..."
                                />
                              ) : (
                                <SearchSelect
                                  options={pacotesCat.map(p => ({ value: p.id, label: p.nome, sub: fmtBRL(p.preco) }))}
                                  value=""
                                  onChange={id => venderEVincularPacote(agendamentoId, id)}
                                  placeholder="Cliente não tem pacote — vender pacote novo..."
                                />
                              )}
                            </div>
                          );
                        })()}
```

- [ ] **Step 3: Verificar tsc**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros

- [ ] **Step 4: Commit**

```bash
git add web/app/\(app\)/comanda/page.tsx
git commit -m "feat(comanda): vincular atendimento a sessao de pacote direto na comanda"
```

---

## Task 5: Web — fechar comanda: gravar vínculo, cortesia automática, destravar botão

**Files:**
- Modify: `web/app/(app)/comanda/page.tsx`

**Interfaces:**
- Consumes: `pacoteLinks`, `pacoteVenderPorAgendamento`, `pacotesCat`, `agruparValoresPorAgendamento` (Task 2), `PersistenciaValorAgendamento.pacoteClienteId`.

- [ ] **Step 1: `persistirValoresAgendamento` — aceita e grava o vínculo por grupo**

Localizar a função (por volta da linha 499-528) e substituir a assinatura e
o corpo do laço de `UPDATE agendamentos`:

```typescript
  async function persistirValoresAgendamento(
    extraUpdate: Record<string, unknown> = {},
    pacoteLinksPorAgendamento: Record<string, string> = {},
  ): Promise<string | null> {
    const grupos = agruparValoresPorAgendamento(itens, pacoteLinksPorAgendamento);
    for (const g of grupos) {
      for (const linha of g.linhasServico) {
        const { data, error } = await supabase.from('agendamento_servicos')
          .update({ valor: linha.valor }).eq('id', linha.agServicoId).select('id');
        if (error) return error.message;
        if (!data || data.length === 0) return 'Não foi possível salvar o valor de um serviço do atendimento.';
      }
      const { data, error } = await supabase.from('agendamentos')
        .update({
          valor: g.novoValorTotal,
          ...extraUpdate,
          ...(g.pacoteClienteId ? { pacote_cliente_id: g.pacoteClienteId } : {}),
        })
        .eq('id', g.agendamentoId).select('id');
      if (error) return error.message;
      if (!data || data.length === 0) return 'Não foi possível salvar o valor do atendimento.';
    }
    setAgDia(prev => prev.map(ag => {
      const g = grupos.find(x => x.agendamentoId === ag.id);
      if (!g) return ag;
      return {
        ...ag,
        valor: g.novoValorTotal,
        pacote_cliente_id: g.pacoteClienteId ?? ag.pacote_cliente_id,
        agendamento_servicos: (ag.agendamento_servicos ?? []).map(s => {
          const linha = g.linhasServico.find(x => x.agServicoId === s.id);
          return linha ? { ...s, valor: linha.valor } : s;
        }),
      };
    }));
    return null;
  }
```

(Isso é o corpo inteiro da função — o resto do arquivo que a chama continua
igual; `editarComanda`, na Task "fora de escopo", já chama
`persistirValoresAgendamento()` sem nenhum argumento, o que continua
funcionando: os dois parâmetros novos têm default.)

- [ ] **Step 2: `fecharComanda` — resolve "vender pacote novo" antes de persistir valores**

Localizar, dentro de `fecharComanda` (por volta da linha 699-730), o trecho:

```typescript
    const comandaId = comanda.id;

    // 2. Marcar agendamentos como concluídos + gravar o valor cobrado no
    //    mesmo UPDATE do status, para o trigger trg_gerar_comissao já nascer
    //    com o valor certo (inclusive quando o usuário editou algum preço).
    const agIds = itens.filter(i => i.agendamento_id).map(i => i.agendamento_id!);
    if (agIds.length > 0) {
      const errValor = await persistirValoresAgendamento({ status: 'concluido', comanda_id: comandaId });
      if (errValor) { setErro(errValor); setFechando(false); return; }
    }
```

E substituir por:

```typescript
    const comandaId = comanda.id;

    // 1b. Resolve pacotes NOVOS escolhidos no vínculo da comanda (cliente
    //     sem pacote elegível) — mesmo padrão que a Agenda já usa em
    //     executarSalvar: vende o pacote, registra a receita da venda, e usa
    //     o id resultante como o vínculo final da sessão.
    const pacoteLinksFinal: Record<string, string> = { ...pacoteLinks };
    for (const [agendamentoId, pacoteCatalogoId] of Object.entries(pacoteVenderPorAgendamento)) {
      if (clienteSel.id === '__sem__') continue;
      const pacote = pacotesCat.find(p => p.id === pacoteCatalogoId);
      if (!pacote) continue;
      const { data: novaVenda, error: errVenda } = await supabase.from('pacote_clientes').insert({
        empresa_id:    empresaId,
        pacote_id:     pacote.id,
        cliente_id:    clienteSel.id,
        data_inicio:   format(new Date(), 'yyyy-MM-dd'),
        data_validade: pacote.validade_dias != null
          ? format(addDays(new Date(), pacote.validade_dias), 'yyyy-MM-dd')
          : null,
        valor_pago:    pacote.preco,
        status:        'ativo',
      }).select('id').single();
      if (errVenda || !novaVenda) { setErro(errVenda?.message ?? 'Erro ao vender pacote'); setFechando(false); return; }
      pacoteLinksFinal[agendamentoId] = novaVenda.id;
      await supabase.from('vendas').insert({
        empresa_id:  empresaId,
        cliente_id:  clienteSel.id,
        valor_total: pacote.preco,
        desconto:    0,
        observacao:  `Venda de pacote: ${pacote.nome}`,
      });
    }

    // 2. Marcar agendamentos como concluídos + gravar o valor cobrado (e o
    //    vínculo de pacote, se houver) no mesmo UPDATE do status — pra o
    //    trigger trg_gerar_comissao (e o trg_uso_pacote, que também só
    //    dispara nessa transição) já nascerem com o valor e o vínculo
    //    certos. Gravar o vínculo NUM SEGUNDO UPDATE, depois do status já
    //    ter virado 'concluido', faria o trigger de uso de pacote rodar sem
    //    enxergar o vínculo (ele só dispara na transição, não de novo).
    const agIds = itens.filter(i => i.agendamento_id).map(i => i.agendamento_id!);
    if (agIds.length > 0) {
      const errValor = await persistirValoresAgendamento({ status: 'concluido', comanda_id: comandaId }, pacoteLinksFinal);
      if (errValor) { setErro(errValor); setFechando(false); return; }
    }
```

- [ ] **Step 3: Cortesia automática — antes do INSERT em `pagamentos`**

Localizar, mais abaixo em `fecharComanda` (por volta da linha 832-853):

```typescript
    // 4. Inserir pagamentos
    const splitsValidos = splits.filter(s => parseFloat(s.valor.replace(',', '.')) > 0);
    if (splitsValidos.length > 0) {
```

Substituir por:

```typescript
    // 4. Inserir pagamentos — se nenhum split foi lançado e o total já
    //    fechou em R$ 0 (sessão de pacote ou desconto manual de 100%),
    //    grava um "Cortesia" de R$ 0 em vez de deixar sem nenhum registro:
    //    fica claro no relatório de formas de pagamento que esse
    //    fechamento não gerou cobrança nova, sem somar nada na receita.
    const splitsValidos = splits.filter(s => parseFloat(s.valor.replace(',', '.')) > 0);
    const splitsParaGravar = splitsValidos.length === 0 && total <= 0.01
      ? [{ metodo: 'cortesia', valor: '0' }]
      : splitsValidos;
    if (splitsParaGravar.length > 0) {
```

E, logo abaixo, trocar a ÚNICA ocorrência de `splitsValidos.map(s => {`
dentro deste mesmo bloco (o `.map` que monta o insert de `pagamentos`, ainda
dentro do `if (splitsParaGravar.length > 0) {`) por
`splitsParaGravar.map(s => {`. Atenção: existe uma SEGUNDA ocorrência de
`const splitsValidos = splits.filter(...)` no arquivo, na linha 592, dentro
de `editarComanda` — **não mexer nela**, é fora de escopo (ver "Fora de
escopo" na spec). A variável `reciboSplits = [...splits]` mais abaixo em
`fecharComanda`, usada no recibo de sucesso, também **não muda** — o recibo
deve continuar mostrando exatamente o que o usuário lançou, sem a cortesia
sintética.

- [ ] **Step 4: Destravar o botão de fechar quando o total já é zero**

Localizar (linha ~1498, dentro do JSX do botão "Fechar comanda"):

```typescript
                  disabled={fechando || itens.length === 0 || splits.length === 0 || !empresaId || (splits.length > 0 && restante > 0.01)}
```

Substituir por:

```typescript
                  disabled={fechando || itens.length === 0 || !empresaId || (total > 0.01 && (splits.length === 0 || restante > 0.01))}
```

- [ ] **Step 5: Verificar tsc**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros

- [ ] **Step 6: Rodar a suíte inteira**

Run: `cd web && npx vitest run`
Expected: todos os testes passando (incluindo os novos das Tasks 1 e 2)

- [ ] **Step 7: Commit**

```bash
git add web/app/\(app\)/comanda/page.tsx
git commit -m "feat(comanda): fecha comanda coberta por pacote sem exigir split manual"
```

---

## Task 6: Mobile — query de pacotes elegíveis + estado + pré-preenchimento zerado

**Files:**
- Modify: `mobile/app/(empresa)/nova-comanda.tsx`

**Interfaces:**
- Consumes: `calcularPacotesAtivosCliente`, `PacoteClienteOpt` (Task 1).
- Produces: estados `pacotesClienteAtivos`, `pacoteLinks`, `pacoteVenderPorAgendamento`, `pacotesCat` — consumidos pelas Tasks 7 e 8.

- [ ] **Step 0: Capturar a baseline de erros pré-existentes do tsc mobile**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep "error TS" | sort > /tmp/mobile-tsc-baseline.txt` (ou salve num arquivo local do seu ambiente) — usado nas verificações das Tasks 6-8, pra confirmar que nenhum erro NOVO foi introduzido (o projeto já tem ~9 erros pré-existentes, não relacionados, documentados em `CLAUDE.md`).

- [ ] **Step 1: Adicionar `pacote_cliente_id` ao tipo `AgDia` e à query do dia**

Editar o tipo `AgDia` (por volta da linha 59-80, procure `type AgDia = {`):

```typescript
type AgDia = {
  id: string;
  data_hora_inicio: string;
  status: string;
  valor: number;
  pacote_cliente_id: string | null;
  cliente:      { id: string; nome: string; telefone?: string } | null;
  profissional: { id: string; nome: string } | null;
  servico:      { id: string; nome: string; preco: number }    | null;
};
```

Editar a query (linha ~147-151):

```typescript
      supabase.from('agendamentos')
        .select(`id, data_hora_inicio, status, valor, pacote_cliente_id,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, preco)`)
```

- [ ] **Step 2: Novos imports e estados**

No topo do arquivo, junto aos imports de `@shared/taxa-reserva`:

```typescript
import { aplicarDescontoReserva, somarTaxasReservaPagas } from '@shared/taxa-reserva';
import { calcularPacotesAtivosCliente, type PacoteClienteOpt } from '@shared/pacotes';
```

Logo depois de `const [produtos, setProdutos] = useState<...>([]);` (linha 117):

```typescript
  const [produtos, setProdutos] = useState<{ id: string; nome: string; preco_venda: number }[]>([]);
  const [pacotesCat, setPacotesCat] = useState<{ id: string; nome: string; preco: number; validade_dias: number | null }[]>([]);
  const [pacotesClienteAtivos, setPacotesClienteAtivos] = useState<PacoteClienteOpt[]>([]);
  const [pacoteLinks, setPacoteLinks] = useState<Record<string, string>>({});
  const [pacoteVenderPorAgendamento, setPacoteVenderPorAgendamento] = useState<Record<string, string>>({});
```

- [ ] **Step 3: Carregar catálogo de pacotes junto com o carregamento do dia**

Editar o `Promise.all` do carregamento inicial (linha 146-158), acrescentando
a query de catálogo:

```typescript
    Promise.all([
      supabase.from('agendamentos')
        .select(`id, data_hora_inicio, status, valor, pacote_cliente_id,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, preco)`)
        .eq('empresa_id', empresaId)
        .gte('data_hora_inicio', startOfDay(hoje).toISOString())
        .lte('data_hora_inicio', endOfDay(hoje).toISOString())
        .neq('status', 'cancelado')
        .order('data_hora_inicio'),
      supabase.from('servicos').select('id, nome, preco').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.from('produtos').select('id, nome, preco_venda').eq('empresa_id', empresaId).eq('ativo', true).eq('tipo', 'venda').order('nome'),
      supabase.from('pacotes').select('id, nome, preco, validade_dias').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    ]).then(async ([rAgs, rServs, rProds, rPacotes]) => {
```

E, dentro do `.then(...)`, logo após `setProdutos((rProds.data ?? []) as any[]);`:

```typescript
      setProdutos((rProds.data ?? []) as any[]);
      setPacotesCat((rPacotes.data ?? []) as { id: string; nome: string; preco: number; validade_dias: number | null }[]);
```

- [ ] **Step 4: Efeito que busca os pacotes ativos do cliente selecionado**

Logo após o `useMemo` de `clientesDia` (linha 187-195), acrescentar:

```typescript
  useEffect(() => {
    if (!clienteSel || clienteSel.id === '__sem__' || !empresaId) { setPacotesClienteAtivos([]); return; }
    supabase.from('pacote_clientes')
      .select('id, data_validade, pacote:pacotes(nome, controla_sessoes, servicos:pacote_servicos(servico_id, quantidade)), uso:pacote_uso(id, created_at, agendamento_id, servico:servicos(nome))')
      .eq('empresa_id', empresaId)
      .eq('cliente_id', clienteSel.id)
      .eq('status', 'ativo')
      .then(({ data }: { data: any[] | null }) => {
        setPacotesClienteAtivos(calcularPacotesAtivosCliente((data ?? []) as any[], format(new Date(), 'yyyy-MM-dd')));
      });
  }, [clienteSel?.id, empresaId]);
```

(`format` já está importado de `date-fns` no topo do arquivo.)

- [ ] **Step 5: `abrirComanda` — inicializa vínculos existentes e zera o valor deles**

Substituir a função inteira (linhas 224-238):

```typescript
  function abrirComanda(cliente: ClienteComanda) {
    setClienteSel(cliente);
    setDesconto('');
    setSplits([]);
    setPacoteVenderPorAgendamento({});

    const linksIniciais: Record<string, string> = {};
    for (const ag of cliente.agendamentos) {
      if (ag.pacote_cliente_id) linksIniciais[ag.id] = ag.pacote_cliente_id;
    }
    setPacoteLinks(linksIniciais);

    setItens(
      cliente.agendamentos
        .filter(ag => ag.status !== 'concluido')
        .map(ag => ({
          uid: uid(), tipo: 'agendamento', descricao: ag.servico?.nome ?? 'Serviço',
          profissional: ag.profissional?.nome, valor: ag.pacote_cliente_id ? 0 : ag.valor, quantidade: 1,
          agendamento_id: ag.id, servico_id: ag.servico?.id, profissional_id: ag.profissional?.id,
        })),
    );
    setEtapa('comanda');
  }
```

- [ ] **Step 6: Verificar tsc contra a baseline**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep "error TS" | sort`
Expected: mesma lista da baseline capturada no Step 0 — nenhuma linha nova, nenhuma envolvendo `nova-comanda.tsx`

- [ ] **Step 7: Commit**

```bash
git add mobile/app/\(empresa\)/nova-comanda.tsx
git commit -m "feat(comanda mobile): carrega pacotes ativos do cliente e zera atendimentos ja vinculados"
```

---

## Task 7: Mobile — vincular/desvincular pacote + UI

**Files:**
- Modify: `mobile/app/(empresa)/nova-comanda.tsx`

**Interfaces:**
- Consumes: `pacotesClienteAtivos`, `pacoteLinks`, `pacoteVenderPorAgendamento`, `pacotesCat` (Task 6).
- Produces: handlers `vincularPacote`, `desvincularPacote`, `venderEVincularPacote` — consumidos pela Task 8.

- [ ] **Step 1: Handlers, logo após `removerItem` (linha ~248)**

```typescript
  function vincularPacote(agendamentoId: string, pacoteClienteId: string) {
    setPacoteLinks(prev => ({ ...prev, [agendamentoId]: pacoteClienteId }));
    setPacoteVenderPorAgendamento(prev => {
      if (!(agendamentoId in prev)) return prev;
      const { [agendamentoId]: _omit, ...resto } = prev;
      return resto;
    });
    setItens(prev => prev.map(i => i.agendamento_id === agendamentoId ? { ...i, valor: 0 } : i));
  }

  function desvincularPacote(agendamentoId: string) {
    setPacoteLinks(prev => {
      if (!(agendamentoId in prev)) return prev;
      const { [agendamentoId]: _omit, ...resto } = prev;
      return resto;
    });
    setPacoteVenderPorAgendamento(prev => {
      if (!(agendamentoId in prev)) return prev;
      const { [agendamentoId]: _omit, ...resto } = prev;
      return resto;
    });
    const ag = agDia.find(a => a.id === agendamentoId);
    if (!ag) return;
    setItens(prev => prev.map(i => i.agendamento_id === agendamentoId ? { ...i, valor: ag.valor } : i));
  }

  function venderEVincularPacote(agendamentoId: string, pacoteCatalogoId: string) {
    setPacoteVenderPorAgendamento(prev => ({ ...prev, [agendamentoId]: pacoteCatalogoId }));
    setPacoteLinks(prev => {
      if (!(agendamentoId in prev)) return prev;
      const { [agendamentoId]: _omit, ...resto } = prev;
      return resto;
    });
    setItens(prev => prev.map(i => i.agendamento_id === agendamentoId ? { ...i, valor: 0 } : i));
  }
```

(No mobile não existe `ag_servico_id`/multi-serviço — `desvincularPacote` é
mais simples que a versão web: um agendamento = um item.)

- [ ] **Step 2: UI — seção de vínculo dentro do card de cada item**

Dentro do `{itens.map(item => ( <View key={item.uid} ...> ... </View> ))}`
(por volta das linhas 593-621), acrescentar logo **antes** do `</View>`
que fecha o `<View key={item.uid} ...>` (linha 620), só para itens de
`tipo === 'agendamento'`:

```tsx
                {item.tipo === 'agendamento' && item.agendamento_id && (() => {
                  const agendamentoId = item.agendamento_id!;
                  const pacoteVinculado = pacotesClienteAtivos.find(p => p.id === pacoteLinks[agendamentoId]);
                  const pacoteParaVender = pacotesCat.find(p => p.id === pacoteVenderPorAgendamento[agendamentoId]);
                  if (pacoteVinculado || pacoteParaVender) {
                    return (
                      <TouchableOpacity onPress={() => desvincularPacote(agendamentoId)}
                        style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.greenSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.green, flex: 1 }} numberOfLines={1}>
                          {pacoteVinculado ? `Sessão de pacote — ${pacoteVinculado.nome}` : `Novo pacote — ${pacoteParaVender!.nome}`}
                        </Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text4 }}>Desvincular</Text>
                      </TouchableOpacity>
                    );
                  }
                  const servicoId = item.servico_id;
                  const elegiveis = servicoId ? pacotesClienteAtivos.filter(p => p.servicos.some(s => s.servico_id === servicoId)) : [];
                  if (elegiveis.length === 0 && pacotesCat.length === 0) return null;
                  return (
                    <View style={{ marginTop: 8, gap: 4 }}>
                      {(elegiveis.length > 0 ? elegiveis : pacotesCat).map((p: any) => (
                        <TouchableOpacity key={p.id}
                          onPress={() => elegiveis.length > 0 ? vincularPacote(agendamentoId, p.id) : venderEVincularPacote(agendamentoId, p.id)}
                          style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text }} numberOfLines={1}>
                            {elegiveis.length > 0 ? `Vincular: ${p.nome}` : `Vender pacote: ${p.nome}`}
                          </Text>
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3 }}>
                            {elegiveis.length > 0 ? (p.restantes == null ? 'ilimitado' : `${p.restantes} rest.`) : fmtBRL(p.preco)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  );
                })()}
```

- [ ] **Step 3: Verificar tsc contra a baseline**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep "error TS" | sort`
Expected: idêntico à baseline (Task 6, Step 0) — nenhum erro novo

- [ ] **Step 4: Commit**

```bash
git add mobile/app/\(empresa\)/nova-comanda.tsx
git commit -m "feat(comanda mobile): vincular atendimento a sessao de pacote"
```

---

## Task 8: Mobile — fechar comanda: gravar vínculo por atendimento + cortesia automática

**Files:**
- Modify: `mobile/app/(empresa)/nova-comanda.tsx`

**Interfaces:**
- Consumes: `pacoteLinks`, `pacoteVenderPorAgendamento`, `pacotesCat` (Tasks 6-7).

Diferente do web, o `fecharComanda` mobile faz **um único UPDATE em lote**
(`.in('id', agIds)`) pra marcar todos os agendamentos como concluídos. Como
o vínculo de pacote pode ser diferente por agendamento, é preciso separar em
dois grupos: quem tem vínculo novo (update individual, incluindo
`pacote_cliente_id` no MESMO update que muda o status) e quem não tem
(continua o update em lote). Fazer o vínculo num update SEPARADO, depois do
status já ter virado `concluido`, faria o trigger `trg_uso_pacote` — que só
dispara na transição de status — rodar sem enxergar o vínculo.

- [ ] **Step 1: Localizar o trecho a substituir**

Em `fecharComanda` (por volta da linha 282-289):

```typescript
    const comandaId = comanda.id;
    const agIds = itens.filter(i => i.agendamento_id).map(i => i.agendamento_id!);

    if (agIds.length > 0) {
      const { error } = await supabase.from('agendamentos')
        .update({ status: 'concluido', comanda_id: comandaId }).in('id', agIds).eq('empresa_id', empresaId);
      if (error) { Alert.alert('Erro', error.message); setFechando(false); return; }
    }
```

- [ ] **Step 2: Substituir por**

```typescript
    const comandaId = comanda.id;
    const agIds = itens.filter(i => i.agendamento_id).map(i => i.agendamento_id!);

    if (agIds.length > 0) {
      // Resolve pacotes NOVOS escolhidos no vínculo da comanda (mesmo
      // padrão do web) antes de marcar os agendamentos como concluídos.
      const pacoteLinksFinal: Record<string, string> = { ...pacoteLinks };
      for (const [agendamentoId, pacoteCatalogoId] of Object.entries(pacoteVenderPorAgendamento)) {
        if (clienteSel.id === '__sem__') continue;
        const pacote = pacotesCat.find(p => p.id === pacoteCatalogoId);
        if (!pacote) continue;
        const { data: novaVenda, error: errVenda } = await supabase.from('pacote_clientes').insert({
          empresa_id:    empresaId,
          pacote_id:     pacote.id,
          cliente_id:    clienteSel.id,
          data_inicio:   format(new Date(), 'yyyy-MM-dd'),
          data_validade: pacote.validade_dias != null
            ? format(addDays(new Date(), pacote.validade_dias), 'yyyy-MM-dd')
            : null,
          valor_pago:    pacote.preco,
          status:        'ativo',
        }).select('id').single();
        if (errVenda || !novaVenda) { Alert.alert('Erro', errVenda?.message ?? 'Erro ao vender pacote'); setFechando(false); return; }
        pacoteLinksFinal[agendamentoId] = novaVenda.id;
        await supabase.from('vendas').insert({
          empresa_id: empresaId, cliente_id: clienteSel.id,
          valor_total: pacote.preco, desconto: 0,
          observacao: `Venda de pacote: ${pacote.nome}`,
        });
      }

      const agIdsSemPacote = agIds.filter(id => !pacoteLinksFinal[id]);
      const agIdsComPacote = agIds.filter(id => pacoteLinksFinal[id]);

      if (agIdsSemPacote.length > 0) {
        const { error } = await supabase.from('agendamentos')
          .update({ status: 'concluido', comanda_id: comandaId }).in('id', agIdsSemPacote).eq('empresa_id', empresaId);
        if (error) { Alert.alert('Erro', error.message); setFechando(false); return; }
      }
      for (const agendamentoId of agIdsComPacote) {
        const { error } = await supabase.from('agendamentos')
          .update({ status: 'concluido', comanda_id: comandaId, pacote_cliente_id: pacoteLinksFinal[agendamentoId] })
          .eq('id', agendamentoId).eq('empresa_id', empresaId);
        if (error) { Alert.alert('Erro', error.message); setFechando(false); return; }
      }
    }
```

- [ ] **Step 3: Cortesia automática antes do INSERT em `pagamentos`**

Localizar (linha ~329-338):

```typescript
    const splitsValidos = splits.filter(s => parseFloat(s.valor.replace(',', '.')) > 0);
    if (splitsValidos.length > 0) {
      await supabase.from('pagamentos').insert(
        splitsValidos.map(s => ({
          empresa_id: empresaId, comanda_id: comandaId,
          valor: parseFloat(s.valor.replace(',', '.')),
          metodo: s.metodo, status: 'pago',
        })),
      );
    }
```

Substituir por:

```typescript
    const splitsValidos = splits.filter(s => parseFloat(s.valor.replace(',', '.')) > 0);
    const splitsParaGravar = splitsValidos.length === 0 && total <= 0.01
      ? [{ metodo: 'cortesia', valor: '0' }]
      : splitsValidos;
    if (splitsParaGravar.length > 0) {
      await supabase.from('pagamentos').insert(
        splitsParaGravar.map(s => ({
          empresa_id: empresaId, comanda_id: comandaId,
          valor: parseFloat(s.valor.replace(',', '.')),
          metodo: s.metodo, status: 'pago',
        })),
      );
    }
```

(`total` já está em escopo — computado logo acima na função, na linha 254.
`splits: splitsValidos` no `setSucessoData` mais abaixo continua usando
`splitsValidos`, não `splitsParaGravar` — o resumo de sucesso mostra o que
o usuário realmente lançou.)

- [ ] **Step 4: Verificar tsc contra a baseline**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep "error TS" | sort`
Expected: idêntico à baseline — nenhum erro novo

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(empresa\)/nova-comanda.tsx
git commit -m "feat(comanda mobile): fecha comanda coberta por pacote com vinculo por atendimento"
```

---

## Task 9: Verificação final

**Files:** nenhum arquivo novo — só checagem.

- [ ] **Step 1: tsc web limpo**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros

- [ ] **Step 2: tsc mobile sem erro novo**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep "error TS" | sort`
Expected: idêntico à baseline capturada na Task 6

- [ ] **Step 3: suíte de testes completa**

Run: `cd web && npx vitest run`
Expected: todos passando, incluindo os `pacotes-ativos-cliente.test.ts` (Task 1) e as adições em `comanda-valor-persistencia.test.ts` (Task 2)

- [ ] **Step 4: checklist manual de fluxo (sem banco de teste local — revisão de código linha a linha contra este checklist)**

- [ ] Atendimento sem pacote, cliente com pacote elegível pro serviço → aparece no seletor → vincular → item zera na hora, badge "Sessão de pacote" aparece.
- [ ] Atendimento sem pacote, cliente SEM pacote elegível, mas com pacote no catálogo → aparece "vender pacote novo" → item zera, badge "Novo pacote" aparece.
- [ ] Clicar "Desvincular" em qualquer um dos dois casos acima → item volta ao preço de tabela, botão de vincular reaparece.
- [ ] Fechar com total R$ 0 (via pacote) e nenhum split lançado → botão habilita (web) → após fechar, 1 linha em `pagamentos` com `metodo='cortesia', valor=0`.
- [ ] Fechar com total R$ 0 e usuário lançou um split manualmente mesmo assim → grava o que o usuário lançou, NÃO injeta cortesia em cima (`splitsValidos.length > 0`, a condição não entra no ramo automático).
- [ ] Atendimento multi-serviço (web): vincular a pacote zera as DUAS linhas de serviço daquele atendimento, não só uma.
- [ ] Atendimento já vinculado na Agenda (campo `pacote_cliente_id` preenchido antes de abrir a comanda) → ao abrir a comanda pela primeira vez, item já nasce zerado, badge já aparece — sem precisar clicar em nada.
- [ ] Editar uma comanda JÁ FECHADA (web, `abrirComandaFechada`/`editarComanda`) → nenhuma seção de vínculo de pacote aparece (fora de escopo, confirmado).

- [ ] **Step 5: Commit final (se sobrou algo solto, tipicamente não deveria)**

```bash
git status
```

Expected: working tree limpo (tudo já commitado task a task).

---

## Observação fora de escopo (não corrigir aqui)

`web/app/(app)/agenda/page.tsx:459-486` e
`mobile/app/(empresa)/novo-agendamento.tsx:205-232` têm, cada um, sua PRÓPRIA
cópia inline da mesma lógica de elegibilidade que a Task 1 extraiu para
`shared/pacotes.ts`. Não foram tocados aqui (spec aprovada cobre só
`comanda/page.tsx` + `nova-comanda.tsx`), mas agora existem 3 implementações
da mesma regra em vez de 1. Vale uma sessão futura pra migrar os dois pontos
da Agenda a chamar `calcularPacotesAtivosCliente` também.
