# Recorrências: Contagem Derivada e Valor Dividido Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar a contagem "(X/Y)" de parcelas também para despesas recorrentes mensais criadas só com data de término (sem quantidade explícita), calculada na hora de exibir sem gravar nada novo no banco; e permitir informar o valor total de uma compra parcelada, dividindo automaticamente entre as parcelas.

**Architecture:** Duas melhorias independentes. A contagem derivada é uma função pura nova que, dado o histórico de despesas já carregado pela tela (web já carrega; mobile ganha uma consulta nova leve), acha a ocorrência mais antiga da mesma série e calcula a posição atual — sem tocar em nenhum formulário de salvar. O valor dividido é uma coluna nova (`valor_total_compra`) mais uma função pura de divisão, usada nos 4 pontos que já editam despesas recorrentes e no auto-lançamento (web), que passa a recalcular o valor de cada mês futuro em vez de só copiar o anterior.

**Tech Stack:** Next.js (App Router), Expo/React Native, Supabase (Postgres), TypeScript, Vitest.

## Global Constraints

- Nenhuma despesa existente muda de valor, contagem ou comportamento sem o usuário optar
  ativamente pelo novo toggle "Valor total da compra" — a contagem derivada é automática mas
  não grava nada.
- A coluna nova é aditiva (`nullable`, sem valor padrão) — nenhuma migration de dados, nenhum
  backfill.
- Nenhuma política de RLS muda — `valor_total_compra` é uma coluna simples de `despesas`, já
  coberta pela política existente (UPDATE restrito a gestor/owner desde a migration 003).
- `npx tsc --noEmit` sem erros novos no web e no mobile ao final de cada task.
- Toda comunicação de commit em português.

---

### Task 1: Migration `valor_total_compra` + tipos

**Files:**
- Create: `supabase/migrations/060_despesas_valor_total_compra.sql`
- Test: `web/tests/unit/despesas-valor-total-compra-migration.test.ts`
- Modify: `web/types/index.ts`
- Modify: `mobile/types/index.ts`
- Modify: `mobile/hooks/useFinanceiro.ts:34-48` (interface `DespesaItem`)
- Modify: `web/app/(app)/financeiro/page.tsx:64-74` (tipos locais `Despesa` e `RecorrenteTemplate`)

**Interfaces:**
- Produz: campo `valor_total_compra?: number` em todo tipo que representa uma linha de
  `despesas`, para as próximas tasks usarem sem erro de TypeScript.

- [ ] **Passo 1: Escrever o teste da migration**

Criar `web/tests/unit/despesas-valor-total-compra-migration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('migration 060_despesas_valor_total_compra', () => {
  it('adiciona valor_total_compra como coluna numerica nullable, sem default', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../../supabase/migrations/060_despesas_valor_total_compra.sql'),
      'utf8',
    );

    expect(sql).toMatch(/alter table public\.despesas/);
    expect(sql).toMatch(/add column valor_total_compra numeric\(10,\s*2\)/);
    expect(sql).not.toMatch(/not null/i);
    expect(sql).not.toMatch(/default/i);
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar falha**

Run: `cd web && npx vitest run tests/unit/despesas-valor-total-compra-migration.test.ts`
Expected: FAIL — o arquivo de migration ainda não existe.

- [ ] **Passo 3: Criar a migration**

Criar `supabase/migrations/060_despesas_valor_total_compra.sql`:

```sql
alter table public.despesas
  add column valor_total_compra numeric(10,2);
```

- [ ] **Passo 4: Rodar o teste de novo e confirmar sucesso**

Run: `cd web && npx vitest run tests/unit/despesas-valor-total-compra-migration.test.ts`
Expected: PASS.

- [ ] **Passo 5: Atualizar `web/types/index.ts`**

Localizar a `interface Despesa` (contém `recorrencia_ate?: string; parcela_atual?: number;
total_parcelas?: number;`) e adicionar logo depois de `total_parcelas?: number;`:

```ts
  valor_total_compra?: number;
```

- [ ] **Passo 6: Atualizar `mobile/types/index.ts`**

Mesma alteração, na `interface Despesa` desse arquivo — adicionar `valor_total_compra?:
number;` logo depois de `total_parcelas?: number;`.

- [ ] **Passo 7: Atualizar `mobile/hooks/useFinanceiro.ts`**

Na `interface DespesaItem` (linhas 34-48), adicionar `valor_total_compra?: number;` logo
depois de `total_parcelas?: number;`.

- [ ] **Passo 8: Atualizar os tipos locais em `web/app/(app)/financeiro/page.tsx`**

Trocar (linhas 64-74):

```ts
type Despesa = {
  id: string; descricao: string; categoria?: string;
  valor: number; recorrente: boolean; periodicidade?: string;
  data_vencimento?: string; data_pagamento?: string; recorrencia_ate?: string;
  parcela_atual?: number; total_parcelas?: number;
  created_at?: string;
  status: 'pendente' | 'pago';
};
type TopServico = { nome: string; quantidade: number; receita: number; percentual: number };
type MetodoPag  = { metodo: string; valor: number; quantidade: number; percentual: number };
type RecorrenteTemplate = { descricao: string; categoria?: string; valor: number; periodicidade?: string; data_vencimento?: string; recorrencia_ate?: string; parcela_atual?: number; total_parcelas?: number };
```

por:

```ts
type Despesa = {
  id: string; descricao: string; categoria?: string;
  valor: number; recorrente: boolean; periodicidade?: string;
  data_vencimento?: string; data_pagamento?: string; recorrencia_ate?: string;
  parcela_atual?: number; total_parcelas?: number; valor_total_compra?: number;
  created_at?: string;
  status: 'pendente' | 'pago';
};
type TopServico = { nome: string; quantidade: number; receita: number; percentual: number };
type MetodoPag  = { metodo: string; valor: number; quantidade: number; percentual: number };
type RecorrenteTemplate = { descricao: string; categoria?: string; valor: number; periodicidade?: string; data_vencimento?: string; recorrencia_ate?: string; parcela_atual?: number; total_parcelas?: number; valor_total_compra?: number };
```

- [ ] **Passo 9: Rodar TypeScript**

Run: `cd web && npx tsc --noEmit` e `cd mobile && npx tsc --noEmit`
Expected: mesma quantidade de erros de antes desta task (nenhum erro novo — os tipos só
ganharam um campo opcional, nada consome esse campo ainda).

- [ ] **Passo 10: Commit**

```bash
git add supabase/migrations/060_despesas_valor_total_compra.sql web/tests/unit/despesas-valor-total-compra-migration.test.ts web/types/index.ts mobile/types/index.ts mobile/hooks/useFinanceiro.ts "web/app/(app)/financeiro/page.tsx"
git commit -m "feat: adiciona coluna valor_total_compra em despesas"
```

---

### Task 2: Funções puras — contagem derivada e divisão de valor

**Files:**
- Modify: `shared/despesas.ts`
- Test: `web/tests/unit/despesas.test.ts`

**Interfaces:**
- Produz:
  - `export type OcorrenciaHistorico = { descricao: string; categoria?: string; data_vencimento?: string; recorrencia_ate?: string; }`
  - `export function calcularParcelaDerivada(descricao: string, categoria: string | undefined, dataVencimento: string, recorrenciaAte: string | null | undefined, historico: OcorrenciaHistorico[]): { atual: number; total: number } | null`
  - `export function dividirValorCompra(valorTotal: number, totalParcelas: number): { valorBase: number; valorParcelaAtual: number }`

- [ ] **Passo 1: Escrever os testes que falham**

Adicionar ao final de `web/tests/unit/despesas.test.ts` (mesmo padrão `describe`/`it` já usado
no arquivo, incluir `calcularParcelaDerivada, dividirValorCompra, type OcorrenciaHistorico` no
import de `@shared/despesas` no topo do arquivo):

```ts
  describe('calcularParcelaDerivada', () => {
    it('primeira ocorrencia sem historico vira a propria ancora', () => {
      const resultado = calcularParcelaDerivada(
        'Financiamento notebook', 'Equipamentos', '2026-08-13', '2027-03-13', [],
      );
      expect(resultado).toEqual({ atual: 1, total: 8 });
    });

    it('ocorrencia no meio de uma serie usa a data mais antiga do historico como ancora', () => {
      const historico: OcorrenciaHistorico[] = [
        { descricao: 'Financiamento notebook', categoria: 'Equipamentos', data_vencimento: '2026-08-13', recorrencia_ate: '2027-03-13' },
        { descricao: 'Financiamento notebook', categoria: 'Equipamentos', data_vencimento: '2026-09-13', recorrencia_ate: '2027-03-13' },
        { descricao: 'Financiamento notebook', categoria: 'Equipamentos', data_vencimento: '2026-10-13', recorrencia_ate: '2027-03-13' },
        { descricao: 'Financiamento notebook', categoria: 'Equipamentos', data_vencimento: '2026-11-13', recorrencia_ate: '2027-03-13' },
      ];
      const resultado = calcularParcelaDerivada(
        'Financiamento notebook', 'Equipamentos', '2026-12-13', '2027-03-13', historico,
      );
      expect(resultado).toEqual({ atual: 5, total: 8 });
    });

    it('sem recorrencia_ate retorna null (recorrencia sem termino nao tem contagem)', () => {
      const resultado = calcularParcelaDerivada(
        'Aluguel', 'Aluguel', '2026-08-13', null, [],
      );
      expect(resultado).toBeNull();
    });

    it('duas series diferentes com a mesma descricao nao se confundem (recorrencia_ate diferente)', () => {
      const historico: OcorrenciaHistorico[] = [
        { descricao: 'Máquina de cartão', categoria: 'Equipamentos', data_vencimento: '2024-01-10', recorrencia_ate: '2024-06-10' },
      ];
      const resultado = calcularParcelaDerivada(
        'Máquina de cartão', 'Equipamentos', '2026-08-13', '2027-01-13', historico,
      );
      expect(resultado).toEqual({ atual: 1, total: 6 });
    });
  });

  describe('dividirValorCompra', () => {
    it('divisao exata: valor base e a parcela atual sao iguais', () => {
      expect(dividirValorCompra(1200, 12)).toEqual({ valorBase: 100, valorParcelaAtual: 100 });
    });

    it('divisao com resto: a parcela atual absorve a diferenca de centavos', () => {
      const resultado = dividirValorCompra(100, 3);
      expect(resultado.valorBase).toBe(33.33);
      expect(resultado.valorParcelaAtual).toBe(33.34);
      expect(Math.round((resultado.valorBase * 2 + resultado.valorParcelaAtual) * 100) / 100).toBe(100);
    });
  });
```

- [ ] **Passo 2: Rodar os testes e confirmar falha**

Run: `cd web && npx vitest run tests/unit/despesas.test.ts`
Expected: FAIL — `calcularParcelaDerivada` e `dividirValorCompra` ainda não existem.

- [ ] **Passo 3: Implementar as duas funções**

Adicionar ao final de `shared/despesas.ts`:

```ts
export type OcorrenciaHistorico = {
  descricao: string;
  categoria?: string;
  data_vencimento?: string;
  recorrencia_ate?: string;
};

/**
 * Deriva a posicao (atual/total) de uma despesa recorrente mensal dentro da sua
 * serie, a partir da data de vencimento mais antiga entre as ocorrencias
 * anteriores com a mesma descricao+categoria+recorrencia_ate (a "ancora" da
 * serie). Se nao houver ocorrencia anterior, a propria despesa e a ancora
 * (mostra "1 de Y"). Retorna null se nao houver recorrenciaAte (recorrencia sem
 * termino nao tem contagem). Usada como alternativa a `total_parcelas`/
 * `parcela_atual` para despesas criadas so com data (modo "Por data"), sem
 * gravar nada novo — o calculo e refeito a cada exibicao.
 */
export function calcularParcelaDerivada(
  descricao: string,
  categoria: string | undefined,
  dataVencimento: string,
  recorrenciaAte: string | null | undefined,
  historico: OcorrenciaHistorico[],
): { atual: number; total: number } | null {
  if (!recorrenciaAte) return null;

  const mesmaSerie = historico.filter(h =>
    h.descricao === descricao &&
    (h.categoria ?? '') === (categoria ?? '') &&
    h.recorrencia_ate === recorrenciaAte &&
    !!h.data_vencimento,
  );

  const ancora = mesmaSerie.reduce(
    (menor, h) => (h.data_vencimento! < menor ? h.data_vencimento! : menor),
    dataVencimento,
  );

  const mesesEntre = (deIso: string, ateIso: string): number => {
    const [anoDe, mesDe] = deIso.split('-').map(Number);
    const [anoAte, mesAte] = ateIso.split('-').map(Number);
    return (anoAte - anoDe) * 12 + (mesAte - mesDe);
  };

  const total = mesesEntre(ancora, recorrenciaAte) + 1;
  const atual = mesesEntre(ancora, dataVencimento) + 1;

  return { atual: Math.min(Math.max(atual, 1), total), total };
}

/**
 * Divide o valor total de uma compra parcelada pela quantidade de parcelas.
 * A parcela sendo cadastrada agora absorve toda a diferenca de arredondamento
 * (ex: R$100 / 3 = R$33,33 + R$33,33 + R$33,34), para a soma da serie bater
 * exatamente com o valor total informado. As demais parcelas (lancadas
 * automaticamente depois) recebem sempre o valor-base, sem a diferenca.
 */
export function dividirValorCompra(
  valorTotal: number,
  totalParcelas: number,
): { valorBase: number; valorParcelaAtual: number } {
  const totalParcelasClamped = Math.max(totalParcelas, 1);
  const valorBase = Math.floor((valorTotal / totalParcelasClamped) * 100) / 100;
  const valorParcelaAtual = Math.round((valorTotal - valorBase * (totalParcelasClamped - 1)) * 100) / 100;
  return { valorBase, valorParcelaAtual };
}
```

- [ ] **Passo 4: Rodar os testes de novo e confirmar sucesso**

Run: `cd web && npx vitest run tests/unit/despesas.test.ts`
Expected: PASS em todos os testes do arquivo, incluindo os novos.

- [ ] **Passo 5: Rodar TypeScript**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Passo 6: Commit**

```bash
git add shared/despesas.ts web/tests/unit/despesas.test.ts
git commit -m "feat: adiciona calcularParcelaDerivada e dividirValorCompra"
```

---

### Task 3: Web — listagem usa contagem derivada

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consome: `calcularParcelaDerivada` (Task 2).

- [ ] **Passo 1: Adicionar `calcularParcelaDerivada` ao import de `@shared/despesas`**

Localizar a linha de import (contém `buildDespesaPagamentoUpdate, formatValorMonetarioInput,
diasParaVencimento, progressoVencimento, templatesRecorrentesParaLancar,
calcularRecorrenciaAtePorParcelas, clampParcelaAtual, proximaParcelaAtual`) e adicionar
`calcularParcelaDerivada` ao final da lista.

- [ ] **Passo 2: Guardar o histórico em estado, para a listagem poder usar**

Localizar a declaração de estado `recorrentesParaLancar` (perto de `setRecorrentesParaLancar`)
e adicionar um estado novo logo depois:

```ts
  const [historicoMensal, setHistoricoMensal] = useState<RecorrenteTemplate[]>([]);
```

Depois, na função `carregar()`, localizar:

```ts
    const todasMensais = (recMesAnt.data ?? []) as RecorrenteTemplate[];
    const despAtual = (despLista.data ?? []) as { descricao: string; categoria?: string }[];
    const chavesMesAtual = new Set(despAtual.map(d => `${d.descricao}||${d.categoria ?? ''}`));
    setRecorrentesParaLancar(
      templatesRecorrentesParaLancar(todasMensais, chavesMesAtual, periodo.startDate)
    );
```

e adicionar logo abaixo (antes de `setLoading(false);`):

```ts
    setHistoricoMensal(todasMensais);
```

- [ ] **Passo 3: Trocar o rótulo da listagem para usar o valor explícito ou o derivado**

Localizar em `despesas.map((d, i) => { ... })`:

```tsx
                        {d.recorrente && ' · Recorrente'}
                        {d.total_parcelas ? ` · Parcela ${d.parcela_atual ?? 1} de ${d.total_parcelas}` : ''}
```

Trocar por:

```tsx
                        {d.recorrente && ' · Recorrente'}
                        {(() => {
                          if (d.total_parcelas) return ` · (${d.parcela_atual ?? 1}/${d.total_parcelas})`;
                          if (d.recorrente && d.periodicidade === 'mensal' && d.recorrencia_ate && d.data_vencimento) {
                            const derivada = calcularParcelaDerivada(d.descricao, d.categoria, d.data_vencimento, d.recorrencia_ate, historicoMensal);
                            return derivada ? ` · (${derivada.atual}/${derivada.total})` : '';
                          }
                          return '';
                        })()}
```

- [ ] **Passo 4: Rodar TypeScript**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Passo 5: Commit**

```bash
git add "web/app/(app)/financeiro/page.tsx"
git commit -m "feat: listagem web mostra (X/Y) tambem para recorrencias so com data"
```

---

### Task 4: Web — toggle "Valor total da compra" nos modais Nova/Editar despesa

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consome: `dividirValorCompra` (Task 2).

- [ ] **Passo 1: Adicionar `dividirValorCompra` ao import de `@shared/despesas`**

Mesma linha de import do Passo 1 da Task 3 — adicionar `dividirValorCompra` ao final da lista.

- [ ] **Passo 2: `NovaDespesaModal` — novo estado**

Logo depois de `const [parcelaAtualInput, setParcelaAtualInput] = useState('');` (dentro de
`NovaDespesaModal`), adicionar:

```ts
  const [modoValor, setModoValor] = useState<'parcela' | 'total'>('parcela');
  const [valorTotalCompra, setValorTotalCompra] = useState('');
```

- [ ] **Passo 3: `NovaDespesaModal` — valor calculado para pré-visualização**

Logo antes do `return (` do componente `NovaDespesaModal`, adicionar:

```ts
  const totalParcelasPreview = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
  const valorTotalCompraPreviewNum = parseFloat(valorTotalCompra.replace(',', '.'));
  const valorCalculadoPreview = modoValor === 'total' && totalParcelasPreview > 0 && !isNaN(valorTotalCompraPreviewNum) && valorTotalCompraPreviewNum > 0
    ? dividirValorCompra(valorTotalCompraPreviewNum, totalParcelasPreview).valorParcelaAtual
    : null;
```

- [ ] **Passo 4: `NovaDespesaModal` — campo Valor vira somente-leitura quando dividido**

Trocar:

```tsx
          <div>
            <label className={labelClass}>Valor *</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
              <input value={valor} onChange={e => setValor(e.target.value)}
                inputMode="decimal" placeholder="0,00" required className={`${inputClass} pl-9`}/>
            </div>
          </div>
```

(este é o bloco dentro de `NovaDespesaModal`, logo após o campo Descrição) por:

```tsx
          <div>
            <label className={labelClass}>Valor *</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
              <input value={valorCalculadoPreview !== null ? formatValorMonetarioInput(valorCalculadoPreview) : valor}
                onChange={e => setValor(e.target.value)}
                readOnly={valorCalculadoPreview !== null}
                inputMode="decimal" placeholder="0,00" required
                className={`${inputClass} pl-9 ${valorCalculadoPreview !== null ? 'bg-bg text-text-3' : ''}`}/>
            </div>
          </div>
```

- [ ] **Passo 5: `NovaDespesaModal` — novo toggle e campo dentro de "Por quantidade de parcelas"**

Localizar, dentro do bloco `{periodicidade === 'mensal' && modoRepeticao === 'parcelas' ? (
<div className="flex flex-col gap-2"> ... )`, o trecho:

```tsx
                      {contratoEmAndamento && (
                        <input value={parcelaAtualInput} onChange={e => setParcelaAtualInput(e.target.value)}
                          inputMode="numeric" placeholder="Parcela atual" className={inputClass}/>
                      )}
                    </div>
                  ) : (
```

(dentro de `NovaDespesaModal`) e trocar por:

```tsx
                      {contratoEmAndamento && (
                        <input value={parcelaAtualInput} onChange={e => setParcelaAtualInput(e.target.value)}
                          inputMode="numeric" placeholder="Parcela atual" className={inputClass}/>
                      )}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setModoValor('parcela')}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            modoValor === 'parcela' ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                          }`}>Valor da parcela</button>
                        <button type="button" onClick={() => setModoValor('total')}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            modoValor === 'total' ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                          }`}>Valor total da compra</button>
                      </div>
                      {modoValor === 'total' && (
                        <input value={valorTotalCompra} onChange={e => setValorTotalCompra(e.target.value)}
                          inputMode="decimal" placeholder="Valor total da compra" className={inputClass}/>
                      )}
                    </div>
                  ) : (
```

- [ ] **Passo 6: `NovaDespesaModal` — `salvar()` calcula e grava o valor dividido**

Trocar a função `salvar` inteira de `NovaDespesaModal` por:

```ts
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const totalParcelasNum = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
    const parcelaAtualNumRaw = contratoEmAndamento ? (parseInt(parcelaAtualInput, 10) || 1) : 1;
    const parcelaAtualNum = totalParcelasNum > 0 ? clampParcelaAtual(parcelaAtualNumRaw, totalParcelasNum) : parcelaAtualNumRaw;
    const usaValorDividido = recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas' && modoValor === 'total';
    let valorN: number;
    let valorTotalCompraNum: number | null = null;
    if (usaValorDividido) {
      valorTotalCompraNum = parseFloat(valorTotalCompra.replace(',', '.'));
      if (isNaN(valorTotalCompraNum) || valorTotalCompraNum <= 0) {
        setErro('Informe o valor total da compra.'); setSalvando(false); return;
      }
      valorN = dividirValorCompra(valorTotalCompraNum, totalParcelasNum || 1).valorParcelaAtual;
    } else {
      valorN = parseFloat(valor.replace(',', '.'));
      if (isNaN(valorN) || valorN <= 0) {
        setErro('Informe um valor maior que zero.'); setSalvando(false); return;
      }
    }
    if (recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas') {
      if (totalParcelasNum < 1) {
        setErro('Informe a quantidade de parcelas.'); setSalvando(false); return;
      }
      if (!vencimento) {
        setErro('Informe a data de vencimento para calcular o término das parcelas.'); setSalvando(false); return;
      }
    }
    const usaParcelas = periodicidade === 'mensal' && modoRepeticao === 'parcelas' && totalParcelasNum > 0 && !!vencimento;
    const recorrenciaAteFinal = usaParcelas
      ? calcularRecorrenciaAtePorParcelas(vencimento, totalParcelasNum, parcelaAtualNum)
      : recorrenciaAte;
    const { error } = await supabase.from('despesas').insert({
      empresa_id:      empresaId,
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimento || null,
      recorrencia_ate: recorrente ? (recorrenciaAteFinal || null) : null,
      parcela_atual:   recorrente && usaParcelas ? parcelaAtualNum : null,
      total_parcelas:  recorrente && usaParcelas ? totalParcelasNum : null,
      valor_total_compra: usaValorDividido ? valorTotalCompraNum : null,
      status:          'pendente',
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  }
```

- [ ] **Passo 7: `EditarDespesaModal` — mesmas mudanças**

Repetir os Passos 2 a 6 em `EditarDespesaModal`, com duas diferenças:

1. No Passo 2 (novo estado), inicializar a partir da despesa existente, logo depois de `const
   [parcelaAtualInput, setParcelaAtualInput] = useState(despesa.parcela_atual ? String(despesa.parcela_atual) : '');`:

```ts
  const [modoValor, setModoValor] = useState<'parcela' | 'total'>(despesa.valor_total_compra ? 'total' : 'parcela');
  const [valorTotalCompra, setValorTotalCompra] = useState(despesa.valor_total_compra ? formatValorMonetarioInput(Number(despesa.valor_total_compra)) : '');
```

2. No Passo 6 (`salvar()`), a função de `EditarDespesaModal` usa `.update({...}).eq('id',
   despesa.id)` em vez de `.insert({...})` — manter esse formato, só trocando o corpo do
   objeto da mesma forma que o Passo 6 troca (adicionar `valor: valorN` no lugar de `valor:
   valorN` já existente, e `valor_total_compra: usaValorDividido ? valorTotalCompraNum :
   null,` depois de `total_parcelas`). O `EditarDespesaModal.salvar()` completo fica:

```ts
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const totalParcelasNum = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
    const parcelaAtualNumRaw = contratoEmAndamento ? (parseInt(parcelaAtualInput, 10) || 1) : 1;
    const parcelaAtualNum = totalParcelasNum > 0 ? clampParcelaAtual(parcelaAtualNumRaw, totalParcelasNum) : parcelaAtualNumRaw;
    const usaValorDividido = recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas' && modoValor === 'total';
    let valorN: number;
    let valorTotalCompraNum: number | null = null;
    if (usaValorDividido) {
      valorTotalCompraNum = parseFloat(valorTotalCompra.replace(',', '.'));
      if (isNaN(valorTotalCompraNum) || valorTotalCompraNum <= 0) {
        setErro('Informe o valor total da compra.'); setSalvando(false); return;
      }
      valorN = dividirValorCompra(valorTotalCompraNum, totalParcelasNum || 1).valorParcelaAtual;
    } else {
      valorN = parseFloat(valor.replace(',', '.'));
      if (isNaN(valorN) || valorN <= 0) {
        setErro('Informe um valor maior que zero.'); setSalvando(false); return;
      }
    }
    if (recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas') {
      if (totalParcelasNum < 1) {
        setErro('Informe a quantidade de parcelas.'); setSalvando(false); return;
      }
      if (!vencimento) {
        setErro('Informe a data de vencimento para calcular o término das parcelas.'); setSalvando(false); return;
      }
    }
    const usaParcelas = periodicidade === 'mensal' && modoRepeticao === 'parcelas' && totalParcelasNum > 0 && !!vencimento;
    const recorrenciaAteFinal = usaParcelas
      ? calcularRecorrenciaAtePorParcelas(vencimento, totalParcelasNum, parcelaAtualNum)
      : recorrenciaAte;
    const { error } = await supabase.from('despesas').update({
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimento || null,
      recorrencia_ate: recorrente ? (recorrenciaAteFinal || null) : null,
      parcela_atual:   recorrente && usaParcelas ? parcelaAtualNum : null,
      total_parcelas:  recorrente && usaParcelas ? totalParcelasNum : null,
      valor_total_compra: usaValorDividido ? valorTotalCompraNum : null,
    }).eq('id', despesa.id);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  }
```

Os Passos 3, 4 e 5 (preview, campo Valor somente-leitura, novo toggle + campo) são idênticos
ao texto usado em `NovaDespesaModal` — aplicar o mesmo `replace_all` nos dois componentes
quando o trecho for byte a byte igual (o campo Valor e o bloco de "Parcela atual" já são
idênticos entre os dois modais hoje).

- [ ] **Passo 8: Rodar TypeScript**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Passo 9: Commit**

```bash
git add "web/app/(app)/financeiro/page.tsx"
git commit -m "feat: toggle valor total da compra nos modais de despesa (web)"
```

---

### Task 5: Web — auto-lançamento recalcula o valor dividido

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consome: `dividirValorCompra` (Task 2), já importado na Task 4.

- [ ] **Passo 1: Incluir `valor_total_compra` na consulta de histórico**

Localizar a consulta `recMesAnt` (dentro do `Promise.all` de `carregar()`):

```ts
      supabase.from('despesas')
        .select('descricao, categoria, valor, periodicidade, data_vencimento, recorrencia_ate, parcela_atual, total_parcelas')
        .eq('empresa_id', empId).eq('recorrente', true).eq('periodicidade', 'mensal')
        .lt('data_vencimento', periodo.startDate)   // somente meses passados
        .order('data_vencimento', { ascending: false }),
```

Trocar o `.select(...)` por:

```ts
      supabase.from('despesas')
        .select('descricao, categoria, valor, periodicidade, data_vencimento, recorrencia_ate, parcela_atual, total_parcelas, valor_total_compra')
        .eq('empresa_id', empId).eq('recorrente', true).eq('periodicidade', 'mensal')
        .lt('data_vencimento', periodo.startDate)   // somente meses passados
        .order('data_vencimento', { ascending: false }),
```

- [ ] **Passo 2: `lancarRecorrentes()` recalcula o valor quando há compra dividida**

Localizar, dentro de `lancarRecorrentes()`, o objeto inteiro passado para `.map(r => ({ ... }))`:

```ts
      recorrentesParaLancar.map(r => ({
        empresa_id:      empresaId,
        descricao:       r.descricao,
        categoria:       r.categoria ?? null,
        valor:           r.valor,
        recorrente:      true,
        periodicidade:   r.periodicidade ?? 'mensal',
        data_vencimento: (() => {
          // Preserva o dia do template, mas força o ano/mês atual visualizado
          const dia = r.data_vencimento ? parseInt(r.data_vencimento.slice(8, 10)) : 1;
          const ano  = mesRef.getFullYear();
          const mes  = mesRef.getMonth(); // 0-based
          // Clamp: dia 31 em fevereiro → último dia do mês
          const ultimo = new Date(ano, mes + 1, 0).getDate();
          return format(new Date(ano, mes, Math.min(dia, ultimo)), 'yyyy-MM-dd');
        })(),
        recorrencia_ate: r.recorrencia_ate ?? null,
        total_parcelas:  r.total_parcelas ?? null,
        parcela_atual:   r.total_parcelas != null && r.parcela_atual != null && r.data_vencimento
          ? proximaParcelaAtual(r.parcela_atual, r.total_parcelas, r.data_vencimento, mesRef.getFullYear(), mesRef.getMonth() + 1)
          : null,
        status:          'pendente',
      }))
```

Trocar por:

```ts
      recorrentesParaLancar.map(r => ({
        empresa_id:      empresaId,
        descricao:       r.descricao,
        categoria:       r.categoria ?? null,
        valor:           r.valor_total_compra != null && r.total_parcelas != null
          ? dividirValorCompra(r.valor_total_compra, r.total_parcelas).valorBase
          : r.valor,
        recorrente:      true,
        periodicidade:   r.periodicidade ?? 'mensal',
        data_vencimento: (() => {
          // Preserva o dia do template, mas força o ano/mês atual visualizado
          const dia = r.data_vencimento ? parseInt(r.data_vencimento.slice(8, 10)) : 1;
          const ano  = mesRef.getFullYear();
          const mes  = mesRef.getMonth(); // 0-based
          // Clamp: dia 31 em fevereiro → último dia do mês
          const ultimo = new Date(ano, mes + 1, 0).getDate();
          return format(new Date(ano, mes, Math.min(dia, ultimo)), 'yyyy-MM-dd');
        })(),
        recorrencia_ate: r.recorrencia_ate ?? null,
        total_parcelas:  r.total_parcelas ?? null,
        parcela_atual:   r.total_parcelas != null && r.parcela_atual != null && r.data_vencimento
          ? proximaParcelaAtual(r.parcela_atual, r.total_parcelas, r.data_vencimento, mesRef.getFullYear(), mesRef.getMonth() + 1)
          : null,
        valor_total_compra: r.valor_total_compra ?? null,
        status:          'pendente',
      }))
```

- [ ] **Passo 3: Rodar TypeScript**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Passo 4: Rodar a suite de testes**

Run: `cd web && npx vitest run tests/unit/despesas.test.ts`
Expected: PASS (nenhum teste existente depende do comportamento antigo de `lancarRecorrentes`,
que não tem teste unitário direto — a lógica testável já está coberta via `dividirValorCompra`
na Task 2).

- [ ] **Passo 5: Commit**

```bash
git add "web/app/(app)/financeiro/page.tsx"
git commit -m "feat: auto-lancamento recalcula valor de compras divididas"
```

---

### Task 6: Mobile — consulta de histórico + listagem usa contagem derivada

**Files:**
- Modify: `mobile/hooks/useFinanceiro.ts`
- Modify: `mobile/app/(empresa)/financeiro.tsx`

**Interfaces:**
- Produz (do hook): `despesasHistorico: OcorrenciaHistorico[]`.
- Consome: `calcularParcelaDerivada`, `OcorrenciaHistorico` (Task 2).

- [ ] **Passo 1: Adicionar a consulta de histórico em `useFinanceiro.ts`**

Localizar a query `despesas` (retorna `DespesaItem[]`, filtrada pelo mês atual) e adicionar
logo depois dela (antes de `// ── Taxas de cancelamento do mês`):

```ts
  // ── Histórico de despesas recorrentes mensais (para contagem derivada) ──
  const despesasHistorico = useQuery<OcorrenciaHistorico[]>({
    queryKey: ['fin-despesas-historico', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data } = await supabase
        .from('despesas')
        .select('descricao, categoria, data_vencimento, recorrencia_ate')
        .eq('empresa_id', empresaId!)
        .eq('recorrente', true)
        .eq('periodicidade', 'mensal')
        .lt('data_vencimento', inicio.slice(0, 10))
        .order('data_vencimento', { ascending: false });

      return (data ?? []) as OcorrenciaHistorico[];
    },
  });
```

- [ ] **Passo 2: Importar `OcorrenciaHistorico` no topo do arquivo**

Localizar o import de `@shared/despesas` (se não existir ainda em `useFinanceiro.ts`,
adicionar a linha; se já existir alguma importação desse módulo, adicionar `OcorrenciaHistorico`
à lista):

```ts
import type { OcorrenciaHistorico } from '@shared/despesas';
```

- [ ] **Passo 3: Expor `despesasHistorico` no retorno do hook**

Localizar o `return { ... }` do hook e adicionar `despesasHistorico: despesasHistorico.data ??
[],` logo depois de `despesas: despesas.data ?? [],`. Adicionar também
`despesasHistorico.refetch();` na função `refetch` do hook, logo depois de
`despesas.refetch();`.

- [ ] **Passo 4: Receber `despesasHistorico` em `financeiro.tsx`**

Localizar:

```ts
  const { resumo, metodos, topServicos, despesas, taxasCancelamento, taxasReserva, evolucao, isLoading, refetch } = useFinanceiro(mesRef);
```

Trocar por:

```ts
  const { resumo, metodos, topServicos, despesas, despesasHistorico, taxasCancelamento, taxasReserva, evolucao, isLoading, refetch } = useFinanceiro(mesRef);
```

- [ ] **Passo 5: Passar `despesasHistorico` para `DespesaRow`**

Localizar:

```tsx
              despesas.map((d, i) => (
                <DespesaRow
                  key={d.id}
                  item={d}
                  isLast={i === despesas.length - 1}
                  hojeIso={hojeIso}
                  onMarcarPago={setDespesaSelecionada}
                  onEditar={setDespesaParaEditar}
                />
              ))
```

Trocar por:

```tsx
              despesas.map((d, i) => (
                <DespesaRow
                  key={d.id}
                  item={d}
                  isLast={i === despesas.length - 1}
                  hojeIso={hojeIso}
                  historico={despesasHistorico}
                  onMarcarPago={setDespesaSelecionada}
                  onEditar={setDespesaParaEditar}
                />
              ))
```

- [ ] **Passo 6: `DespesaRow` recebe o histórico e calcula o rótulo**

Localizar a assinatura de `DespesaRow`:

```tsx
function DespesaRow({
  item, isLast, hojeIso, onMarcarPago, onEditar,
}: {
  item: DespesaItem;
  isLast: boolean;
  hojeIso: string;
  onMarcarPago: (item: DespesaItem) => void;
  onEditar: (item: DespesaItem) => void;
}) {
```

Trocar por:

```tsx
function DespesaRow({
  item, isLast, hojeIso, historico, onMarcarPago, onEditar,
}: {
  item: DespesaItem;
  isLast: boolean;
  hojeIso: string;
  historico: OcorrenciaHistorico[];
  onMarcarPago: (item: DespesaItem) => void;
  onEditar: (item: DespesaItem) => void;
}) {
```

No topo de `mobile/app/(empresa)/financeiro.tsx`, localizar:

```ts
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, diasParaVencimento, progressoVencimento, calcularRecorrenciaAtePorParcelas, clampParcelaAtual } from '@shared/despesas';
```

Trocar por (adiciona `calcularParcelaDerivada` à mesma linha e uma segunda linha só para o
tipo `OcorrenciaHistorico`, já que `import type` não pode ser misturado com valores na mesma
declaração sem a sintaxe `import { type X, valor }`, que este arquivo ainda não usa em
nenhum outro import):

```ts
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, diasParaVencimento, progressoVencimento, calcularRecorrenciaAtePorParcelas, clampParcelaAtual, calcularParcelaDerivada } from '@shared/despesas';
import type { OcorrenciaHistorico } from '@shared/despesas';
```

- [ ] **Passo 7: Trocar o rótulo em `DespesaRow`**

Localizar:

```tsx
            {item.recorrente ? ' · Recorrente' : ''}
            {item.total_parcelas ? ` · Parcela ${item.parcela_atual ?? 1} de ${item.total_parcelas}` : ''}
            {labelDias ? ` · ${labelDias}` : ''}
```

Trocar por:

```tsx
            {item.recorrente ? ' · Recorrente' : ''}
            {(() => {
              if (item.total_parcelas) return ` · (${item.parcela_atual ?? 1}/${item.total_parcelas})`;
              if (item.recorrente && item.periodicidade === 'mensal' && item.recorrencia_ate && item.data_vencimento) {
                const derivada = calcularParcelaDerivada(item.descricao, item.categoria, item.data_vencimento, item.recorrencia_ate, historico);
                return derivada ? ` · (${derivada.atual}/${derivada.total})` : '';
              }
              return '';
            })()}
            {labelDias ? ` · ${labelDias}` : ''}
```

- [ ] **Passo 8: Rodar TypeScript**

Run: `cd mobile && npx tsc --noEmit`
Expected: mesma quantidade de erros pré-existentes de antes desta task (os 10 erros já
documentados em arquivos não tocados por este plano), zero erros novos em
`useFinanceiro.ts` ou `financeiro.tsx`.

- [ ] **Passo 9: Commit**

```bash
git add mobile/hooks/useFinanceiro.ts "mobile/app/(empresa)/financeiro.tsx"
git commit -m "feat: listagem mobile mostra (X/Y) tambem para recorrencias so com data"
```

---

### Task 7: Mobile — toggle "Valor total da compra" em Nova despesa

**Files:**
- Modify: `mobile/app/(empresa)/nova-despesa.tsx`

**Interfaces:**
- Consome: `dividirValorCompra` (Task 2).

- [ ] **Passo 1: Adicionar `dividirValorCompra` ao import de `@shared/despesas`**

Trocar:

```ts
import { calcularRecorrenciaAtePorParcelas, clampParcelaAtual } from '@shared/despesas';
```

por:

```ts
import { calcularRecorrenciaAtePorParcelas, clampParcelaAtual, dividirValorCompra } from '@shared/despesas';
```

- [ ] **Passo 2: Novo estado**

Logo depois de `const [parcelaAtualInput, setParcelaAtualInput] = useState('');`, adicionar:

```ts
  const [modoValor, setModoValor] = useState<'parcela' | 'total'>('parcela');
  const [valorTotalCompra, setValorTotalCompra] = useState('');
```

- [ ] **Passo 3: Valor calculado para pré-visualização**

Logo antes de `if (!fontsLoaded) return null;`, adicionar:

```ts
  const totalParcelasPreview = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
  const valorTotalCompraPreviewNum = parseFloat(valorTotalCompra.replace(',', '.'));
  const valorCalculadoPreview = modoValor === 'total' && totalParcelasPreview > 0 && !isNaN(valorTotalCompraPreviewNum) && valorTotalCompraPreviewNum > 0
    ? dividirValorCompra(valorTotalCompraPreviewNum, totalParcelasPreview).valorParcelaAtual
    : null;
```

- [ ] **Passo 4: Campo Valor vira somente-leitura quando dividido**

Localizar:

```tsx
          {/* Valor */}
          <Campo label="Valor *">
            <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}>
              <DollarSign size={16} color={C.text4} strokeWidth={1.8} style={{ marginRight: 10 }} />
              <TextInput
                value={valor}
                onChangeText={setValor}
                placeholder="0,00"
                placeholderTextColor={C.text4}
                keyboardType="numeric"
                style={{ flex: 1, paddingVertical: 14, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 18, color: C.text, letterSpacing: -0.5 }}
              />
            </View>
          </Campo>
```

Trocar por:

```tsx
          {/* Valor */}
          <Campo label="Valor *">
            <View style={{ backgroundColor: valorCalculadoPreview !== null ? C.bg : C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}>
              <DollarSign size={16} color={C.text4} strokeWidth={1.8} style={{ marginRight: 10 }} />
              <TextInput
                value={valorCalculadoPreview !== null ? valorCalculadoPreview.toFixed(2).replace('.', ',') : valor}
                onChangeText={setValor}
                editable={valorCalculadoPreview === null}
                placeholder="0,00"
                placeholderTextColor={C.text4}
                keyboardType="numeric"
                style={{ flex: 1, paddingVertical: 14, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 18, color: valorCalculadoPreview !== null ? C.text3 : C.text, letterSpacing: -0.5 }}
              />
            </View>
          </Campo>
```

- [ ] **Passo 5: Novo toggle e campo dentro de "Por quantidade de parcelas"**

Localizar:

```tsx
                      {contratoEmAndamento && (
                        <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14 }}>
                          <TextInput
                            value={parcelaAtualInput}
                            onChangeText={setParcelaAtualInput}
                            placeholder="Parcela atual"
                            placeholderTextColor={C.text4}
                            keyboardType="numeric"
```

e o restante desse bloco (fecha com `</View>` e `)}` do `{contratoEmAndamento && (`). Depois
desse `)}` de fechamento (ainda dentro do `<View style={{ gap: 8 }}>` maior que envolve
quantidade/novo-ou-andamento/parcela-atual), adicionar:

```tsx
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => setModoValor('parcela')}
                          style={{
                            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                            backgroundColor: modoValor === 'parcela' ? C.amberSoft : C.surface,
                            borderWidth: 1, borderColor: modoValor === 'parcela' ? C.amber : C.border,
                          }}
                        >
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: modoValor === 'parcela' ? C.amber : C.text3 }}>
                            Valor da parcela
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setModoValor('total')}
                          style={{
                            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                            backgroundColor: modoValor === 'total' ? C.amberSoft : C.surface,
                            borderWidth: 1, borderColor: modoValor === 'total' ? C.amber : C.border,
                          }}
                        >
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: modoValor === 'total' ? C.amber : C.text3 }}>
                            Valor total da compra
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {modoValor === 'total' && (
                        <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14 }}>
                          <TextInput
                            value={valorTotalCompra}
                            onChangeText={setValorTotalCompra}
                            placeholder="Valor total da compra"
                            placeholderTextColor={C.text4}
                            keyboardType="numeric"
                            style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text }}
                          />
                        </View>
                      )}
```

- [ ] **Passo 6: `salvar()` calcula e grava o valor dividido**

Trocar a função `salvar` inteira por:

```ts
  async function salvar() {
    if (!podeSalvar || !empresaAtiva) return;
    setSalvando(true);

    const vencimentoBanco = dataParaBanco(vencimento);
    const totalParcelasNum = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
    const parcelaAtualNumRaw = contratoEmAndamento ? (parseInt(parcelaAtualInput, 10) || 1) : 1;
    const parcelaAtualNum = totalParcelasNum > 0 ? clampParcelaAtual(parcelaAtualNumRaw, totalParcelasNum) : parcelaAtualNumRaw;
    const usaValorDividido = recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas' && modoValor === 'total';
    if (recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas') {
      if (totalParcelasNum < 1) {
        setSalvando(false);
        Alert.alert('Quantidade inválida', 'Informe a quantidade de parcelas.');
        return;
      }
      if (!vencimentoBanco) {
        setSalvando(false);
        Alert.alert('Vencimento obrigatório', 'Informe a data de vencimento para calcular o término das parcelas.');
        return;
      }
    }
    let valorFinal: number;
    let valorTotalCompraNum: number | null = null;
    if (usaValorDividido) {
      valorTotalCompraNum = parseFloat(valorTotalCompra.replace(',', '.'));
      if (isNaN(valorTotalCompraNum) || valorTotalCompraNum <= 0) {
        setSalvando(false);
        Alert.alert('Valor inválido', 'Informe o valor total da compra.');
        return;
      }
      valorFinal = dividirValorCompra(valorTotalCompraNum, totalParcelasNum || 1).valorParcelaAtual;
    } else {
      valorFinal = parseFloat(valor.replace(',', '.'));
    }
    const usaParcelas = periodicidade === 'mensal' && modoRepeticao === 'parcelas' && totalParcelasNum > 0 && !!vencimentoBanco;
    const recorrenciaAteFinal = usaParcelas
      ? calcularRecorrenciaAtePorParcelas(vencimentoBanco!, totalParcelasNum, parcelaAtualNum)
      : dataParaBanco(recorrenciaAte);

    const { error } = await supabase.from('despesas').insert({
      empresa_id:      empresaAtiva.id,
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorFinal,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimentoBanco,
      recorrencia_ate: recorrente ? recorrenciaAteFinal : null,
      parcela_atual:   recorrente && usaParcelas ? parcelaAtualNum : null,
      total_parcelas:  recorrente && usaParcelas ? totalParcelasNum : null,
      valor_total_compra: usaValorDividido ? valorTotalCompraNum : null,
      status:          'pendente',
    });

    setSalvando(false);
    if (error) { Alert.alert('Erro', error.message); return; }

    qc.invalidateQueries({ queryKey: ['fin-resumo'] });
    qc.invalidateQueries({ queryKey: ['fin-despesas'] });
    qc.invalidateQueries({ queryKey: ['fin-evolucao'] });
    Alert.alert('Despesa registrada!', descricao, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }
```

- [ ] **Passo 7: Rodar TypeScript**

Run: `cd mobile && npx tsc --noEmit`
Expected: mesma quantidade de erros pré-existentes, zero erros novos em `nova-despesa.tsx`.

- [ ] **Passo 8: Commit**

```bash
git add "mobile/app/(empresa)/nova-despesa.tsx"
git commit -m "feat: toggle valor total da compra em Nova despesa (mobile)"
```

---

### Task 8: Mobile — toggle "Valor total da compra" em Editar despesa

**Files:**
- Modify: `mobile/app/(empresa)/financeiro.tsx`

**Interfaces:**
- Consome: `dividirValorCompra` (Task 2), já importado na Task 6.

- [ ] **Passo 1: Adicionar `dividirValorCompra` ao import de `@shared/despesas`**

A Task 6 já trocou a linha de import de valores de `@shared/despesas` em
`mobile/app/(empresa)/financeiro.tsx` para:

```ts
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, diasParaVencimento, progressoVencimento, calcularRecorrenciaAtePorParcelas, clampParcelaAtual, calcularParcelaDerivada } from '@shared/despesas';
```

Trocar por:

```ts
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, diasParaVencimento, progressoVencimento, calcularRecorrenciaAtePorParcelas, clampParcelaAtual, calcularParcelaDerivada, dividirValorCompra } from '@shared/despesas';
```

- [ ] **Passo 2: `ModalEditarDespesa` — novo estado**

Logo depois de `const [parcelaAtualInput, setParcelaAtualInput] = useState('');`, adicionar:

```ts
  const [modoValor, setModoValor] = useState<'parcela' | 'total'>('parcela');
  const [valorTotalCompra, setValorTotalCompra] = useState('');
```

- [ ] **Passo 3: `ModalEditarDespesa` — resetar o novo estado junto com os outros, no `useEffect`**

Localizar, dentro do `useEffect(() => { if (!item) return; ... }, [item]);`:

```ts
    setModoRepeticao(item.total_parcelas ? 'parcelas' : 'data');
    setQuantidadeParcelas(item.total_parcelas ? String(item.total_parcelas) : '');
    setContratoEmAndamento((item.parcela_atual ?? 1) > 1);
    setParcelaAtualInput(item.parcela_atual ? String(item.parcela_atual) : '');
    setConfirmDelete(false);
```

Trocar por:

```ts
    setModoRepeticao(item.total_parcelas ? 'parcelas' : 'data');
    setQuantidadeParcelas(item.total_parcelas ? String(item.total_parcelas) : '');
    setContratoEmAndamento((item.parcela_atual ?? 1) > 1);
    setParcelaAtualInput(item.parcela_atual ? String(item.parcela_atual) : '');
    setModoValor(item.valor_total_compra ? 'total' : 'parcela');
    setValorTotalCompra(item.valor_total_compra ? formatValorMonetarioInput(Number(item.valor_total_compra)) : '');
    setConfirmDelete(false);
```

- [ ] **Passo 4: Valor calculado para pré-visualização**

Logo antes de `function mascaraData(v: string) {` (dentro de `ModalEditarDespesa`), adicionar:

```ts
  const totalParcelasPreview = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
  const valorTotalCompraPreviewNum = parseFloat(valorTotalCompra.replace(',', '.'));
  const valorCalculadoPreview = modoValor === 'total' && totalParcelasPreview > 0 && !isNaN(valorTotalCompraPreviewNum) && valorTotalCompraPreviewNum > 0
    ? dividirValorCompra(valorTotalCompraPreviewNum, totalParcelasPreview).valorParcelaAtual
    : null;
```

- [ ] **Passo 5: Campo Valor vira somente-leitura quando dividido**

Localizar:

```tsx
            {/* Valor */}
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2, marginBottom: 8 }}>
              Valor *
            </Text>
            <View style={{
              backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
              borderRadius: 12, paddingHorizontal: 14, height: 48,
              flexDirection: 'row', alignItems: 'center', marginBottom: 16,
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text3, marginRight: 6 }}>R$</Text>
              <TextInput
                value={valor}
                onChangeText={setValor}
                placeholder="0,00"
                placeholderTextColor={C.text4}
                keyboardType="decimal-pad"
                style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}
              />
            </View>
```

Trocar por:

```tsx
            {/* Valor */}
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2, marginBottom: 8 }}>
              Valor *
            </Text>
            <View style={{
              backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
              borderRadius: 12, paddingHorizontal: 14, height: 48,
              flexDirection: 'row', alignItems: 'center', marginBottom: 16,
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text3, marginRight: 6 }}>R$</Text>
              <TextInput
                value={valorCalculadoPreview !== null ? valorCalculadoPreview.toFixed(2).replace('.', ',') : valor}
                onChangeText={setValor}
                editable={valorCalculadoPreview === null}
                placeholder="0,00"
                placeholderTextColor={C.text4}
                keyboardType="decimal-pad"
                style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: valorCalculadoPreview !== null ? C.text3 : C.text }}
              />
            </View>
```

(o container já usa `backgroundColor: C.bg` nos dois estados neste modal — diferente de
`nova-despesa.tsx`, aqui não há troca de fundo do container a fazer, só o `TextInput`.)

- [ ] **Passo 6: Novo toggle e campo dentro de "Por quantidade de parcelas"**

Localizar o fechamento do bloco `{contratoEmAndamento && ( ... )}`:

```tsx
                      {contratoEmAndamento && (
                        <View style={{
                          backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                          borderRadius: 12, paddingHorizontal: 14, height: 48, justifyContent: 'center',
                        }}>
                          <TextInput
                            value={parcelaAtualInput}
                            onChangeText={setParcelaAtualInput}
                            placeholder="Parcela atual"
                            placeholderTextColor={C.text4}
                            keyboardType="numeric"
                            style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
                          />
                        </View>
                      )}
                    </View>
                  ) : (
```

Trocar por:

```tsx
                      {contratoEmAndamento && (
                        <View style={{
                          backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                          borderRadius: 12, paddingHorizontal: 14, height: 48, justifyContent: 'center',
                        }}>
                          <TextInput
                            value={parcelaAtualInput}
                            onChangeText={setParcelaAtualInput}
                            placeholder="Parcela atual"
                            placeholderTextColor={C.text4}
                            keyboardType="numeric"
                            style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
                          />
                        </View>
                      )}
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => setModoValor('parcela')}
                          style={{
                            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                            backgroundColor: modoValor === 'parcela' ? C.amberSoft : C.bg,
                            borderWidth: 1, borderColor: modoValor === 'parcela' ? C.amber : C.border,
                          }}
                        >
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: modoValor === 'parcela' ? C.amber : C.text3 }}>
                            Valor da parcela
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setModoValor('total')}
                          style={{
                            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                            backgroundColor: modoValor === 'total' ? C.amberSoft : C.bg,
                            borderWidth: 1, borderColor: modoValor === 'total' ? C.amber : C.border,
                          }}
                        >
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: modoValor === 'total' ? C.amber : C.text3 }}>
                            Valor total da compra
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {modoValor === 'total' && (
                        <View style={{
                          backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                          borderRadius: 12, paddingHorizontal: 14, height: 48, justifyContent: 'center',
                        }}>
                          <TextInput
                            value={valorTotalCompra}
                            onChangeText={setValorTotalCompra}
                            placeholder="Valor total da compra"
                            placeholderTextColor={C.text4}
                            keyboardType="numeric"
                            style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
                          />
                        </View>
                      )}
                    </View>
                  ) : (
```

- [ ] **Passo 7: `salvar()` calcula e grava o valor dividido**

Trocar a função `salvar` inteira de `ModalEditarDespesa` por:

```ts
  async function salvar() {
    if (!item) return;
    setSalvando(true);
    const vencimentoBanco = dataParaBanco(vencimento);
    const totalParcelasNum = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
    const parcelaAtualNumRaw = contratoEmAndamento ? (parseInt(parcelaAtualInput, 10) || 1) : 1;
    const parcelaAtualNum = totalParcelasNum > 0 ? clampParcelaAtual(parcelaAtualNumRaw, totalParcelasNum) : parcelaAtualNumRaw;
    const usaValorDividido = recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas' && modoValor === 'total';
    if (recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas') {
      if (totalParcelasNum < 1) {
        setSalvando(false);
        Alert.alert('Quantidade inválida', 'Informe a quantidade de parcelas.');
        return;
      }
      if (!vencimentoBanco) {
        setSalvando(false);
        Alert.alert('Vencimento obrigatório', 'Informe a data de vencimento para calcular o término das parcelas.');
        return;
      }
    }
    let valorFinal: number;
    let valorTotalCompraNum: number | null = null;
    if (usaValorDividido) {
      valorTotalCompraNum = parseFloat(valorTotalCompra.replace(',', '.'));
      if (isNaN(valorTotalCompraNum) || valorTotalCompraNum <= 0) {
        setSalvando(false);
        Alert.alert('Valor inválido', 'Informe o valor total da compra.');
        return;
      }
      valorFinal = dividirValorCompra(valorTotalCompraNum, totalParcelasNum || 1).valorParcelaAtual;
    } else {
      valorFinal = parseFloat(valor.replace(',', '.'));
      if (isNaN(valorFinal) || valorFinal <= 0) {
        setSalvando(false);
        Alert.alert('Valor inválido', 'Informe um valor maior que zero.');
        return;
      }
    }
    const usaParcelas = periodicidade === 'mensal' && modoRepeticao === 'parcelas' && totalParcelasNum > 0 && !!vencimentoBanco;
    const recorrenciaAteFinal = usaParcelas
      ? calcularRecorrenciaAtePorParcelas(vencimentoBanco!, totalParcelasNum, parcelaAtualNum)
      : dataParaBanco(recorrenciaAte);
    const { error } = await supabase.from('despesas').update({
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorFinal,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimentoBanco,
      recorrencia_ate: recorrente ? recorrenciaAteFinal : null,
      parcela_atual:   recorrente && usaParcelas ? parcelaAtualNum : null,
      total_parcelas:  recorrente && usaParcelas ? totalParcelasNum : null,
      valor_total_compra: usaValorDividido ? valorTotalCompraNum : null,
    }).eq('id', item.id);
    setSalvando(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    onSalvo();
    onClose();
  }
```

Note que a validação de valor (`isNaN(valorN) || valorN <= 0`) que hoje roda **antes** de
`setSalvando(true)` foi movida para dentro do bloco `else` (só valida `valor` quando o modo NÃO
é dividido — quando é dividido, quem é validado é `valorTotalCompra`), e agora roda depois de
`setSalvando(true)` — por isso cada `return` precedido de `Alert.alert` neste novo corpo
também chama `setSalvando(false)` antes, para não deixar o botão travado em "salvando".

- [ ] **Passo 8: Rodar TypeScript**

Run: `cd mobile && npx tsc --noEmit`
Expected: mesma quantidade de erros pré-existentes, zero erros novos em `financeiro.tsx`.

- [ ] **Passo 9: Commit**

```bash
git add "mobile/app/(empresa)/financeiro.tsx"
git commit -m "feat: toggle valor total da compra em Editar despesa (mobile)"
```

---

### Task 9: Verificação completa

**Files:**
- Nenhum arquivo novo — só validação.

- [ ] **Passo 1: Rodar a suite completa de testes unitários**

Run: `cd web && npx vitest run`
Expected: todos os testes passando, incluindo os novos de `calcularParcelaDerivada`,
`dividirValorCompra` e da migration 060.

- [ ] **Passo 2: Rodar TypeScript no web e no mobile**

Run: `cd web && npx tsc --noEmit` e `cd mobile && npx tsc --noEmit`
Expected: zero erros no web; no mobile, só os erros pré-existentes já documentados em sessões
anteriores (nenhum erro novo em nenhum arquivo tocado por este plano).

- [ ] **Passo 3: Conferir manualmente a consistência dos 4 pontos de formulário**

Reler `NovaDespesaModal`, `EditarDespesaModal` (web), `nova-despesa.tsx` e
`ModalEditarDespesa` (mobile) lado a lado e confirmar que os 4 usam exatamente a mesma
condição para `usaValorDividido` (`recorrente && periodicidade === 'mensal' && modoRepeticao
=== 'parcelas' && modoValor === 'total'`) e a mesma chamada de `dividirValorCompra`, incluindo
o `|| 1` de proteção contra `totalParcelasNum` zero.

- [ ] **Passo 4: Commit (se o Passo 3 encontrar e corrigir alguma divergência)**

Se nenhuma divergência for encontrada, este passo não gera commit. Se alguma task anterior
tiver introduzido uma inconsistência entre os 4 pontos, corrigir e commitar com:

```bash
git add -A
git commit -m "fix: alinha condicao de valor dividido entre os 4 pontos de formulario"
```
