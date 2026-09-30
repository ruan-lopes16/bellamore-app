# Paridade — Fase 1: Fundação — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o app nativo (`mobile/`) operando sobre o mesmo modelo de dados do web. Para isso, remover a área da cliente final, unificar a anamnese numa fonte só e corrigir a navegação e o onboarding do app, que hoje impedem qualquer uso.

**Architecture:** Toda regra usada pelas duas plataformas vai para `shared/`: máscaras, formato de aniversário e endereço, formato canônico da anamnese. `web/` e `mobile/` passam a importar essas regras. A anamnese sai de `clientes.observacoes` (JSON num campo texto) e vai para `anamnese_fichas`, com RLS de escrita criada pela migration 080. O mobile deixa de usar `users`/`empresa_membros(role='cliente')` e passa a ler e gravar `public.clientes`, igual ao web.

**Tech Stack:** Next.js (web), Expo Router + React Native + TanStack Query (mobile), Supabase (Postgres + RLS + PostgREST), Vitest (testes em `web/tests/unit`, que também leem código-fonte do mobile e testam `shared/`).

**Spec:** `docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md` (seção P0 e "Decisões do dono").

## Global Constraints

- Toda comunicação, comentários e textos de UI em **português**.
- `cd web && npx tsc --noEmit` deve terminar com **zero erros** ao fim de cada task.
- `cd mobile && npx tsc --noEmit` deve manter **exatamente os 9 erros pré-existentes** (baseline abaixo) e **nenhum erro novo**.
- `cd web && npx vitest run` deve terminar verde ao fim de cada task.
- Todo `.update()` e `.delete()` do Supabase usa `.select('id')` e confere as linhas afetadas. Um RLS bloqueado devolve sucesso com 0 linhas.
- Migrations são **aplicadas à mão pelo dono no SQL Editor**. Nunca rodar `supabase db push`. Toda migration deve ser idempotente (`if not exists`, `drop policy if exists` antes de `create policy`) e terminar com `notify pgrst, 'reload schema';`.
- Não existe mais papel `cliente`. A cliente final não tem login nem acesso nenhum; só o estabelecimento vê os dados.
- Formato de dados de cliente (é o que está em produção, 217 linhas):
  - `data_nascimento` = `'1900-MM-DD'` (só dia e mês).
  - `endereco` = JSON `{"logradouro","numero","bairro","complemento"}`.
  - `telefone` mascarado `(XX) XXXXX-XXXX`.
- Commits terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

Baseline de erros do `tsc` mobile (não mexer; não podem aumentar):

```
app/(empresa)/comissoes.tsx(281,130) TS2769
app/(empresa)/configuracoes.tsx(191,7) TS2739
app/(empresa)/configuracoes.tsx(208,7) TS2739
app/(empresa)/estoque.tsx(498,11) TS2322
app/(empresa)/novo-cliente.tsx(203,90) TS2551   ← será corrigido na Task 7 (C.text2 inexistente); baseline cai para 8
app/(empresa)/relatorios.tsx(181,22) TS2322
hooks/useAgenda.ts(21,18) TS2430
hooks/useNotificacoes.ts(52,5) TS2322
hooks/useNotificacoes.ts(59,5) TS2322
```

Setup de worktree novo (se ainda não houver `node_modules`):

```bash
cd web && npm install --no-audit --no-fund && cd .. && git checkout -- web/package-lock.json
cd mobile && npm install --no-audit --no-fund --legacy-peer-deps && rm -f package-lock.json
```

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `shared/mascaras.ts` (novo) | Máscaras puras BR: `digits`, `maskPhone`, `maskCNPJ`, `maskCPF`, `maskCEP`, `maskMoeda`, `parseMoeda`, `formatMoeda`, `validaCNPJ`, `toWhatsApp`. Movidas de `web/lib/masks.ts` |
| `web/lib/masks.ts` | Reexporta `shared/mascaras` e mantém só `maskComCursor` (depende do DOM) |
| `shared/clientes.ts` (novo) | Formato de cliente: aniversário `1900-MM-DD`, idade, endereço JSON |
| `shared/anamnese.ts` (novo) | Formato canônico da ficha, perguntas, normalização de formatos antigos, alerta de restrição |
| `supabase/migrations/080_anamnese_fichas_fonte_unica.sql` (novo) | RLS de escrita, migração das fichas de `clientes.observacoes` |
| `shared/dominio.ts`, `web/types/index.ts`, `mobile/types/index.ts` | `PerfilRole` sem `'cliente'` |
| `web/lib/permissions.ts`, `mobile/lib/permissions.ts` | Remover papel cliente |
| `mobile/app/(cliente)/` | **Apagar** |
| `mobile/hooks/useCliente.ts` | **Apagar**. `useServicosEmpresa` vai para `mobile/hooks/useServicosEmpresa.ts` |
| `mobile/hooks/useClientes.ts` | Ler de `public.clientes` |
| `mobile/app/(empresa)/novo-cliente.tsx`, `cliente/[id]/editar.tsx`, `cliente/[id].tsx`, `cliente/[id]/anamnese.tsx`, `novo-agendamento.tsx` | Gravar e exibir no formato do web |
| `mobile/hooks/useAgenda.ts`, `useDashboard.ts`, `useProfissional.ts`, `app/(empresa)/agendamento/[id].tsx`, `app/(profissional)/agendamento/[id].tsx` | Embed `clientes!agendamentos_cliente_id_fkey` |
| `web/app/(app)/clientes/[id]/page.tsx` | Anamnese lida e gravada em `anamnese_fichas` via `shared/anamnese` |
| `mobile/app/_layout.tsx`, `mobile/app/index.tsx` (novo), `(empresa)/_layout.tsx`, `(profissional)/_layout.tsx`, `mobile/stores/authStore.ts`, `mobile/lib/notifications.ts` | Navegação e sessão |
| `mobile/app/(auth)/register.tsx`, `verificar-email.tsx` (novo), `mobile/app/criar-empresa.tsx` (novo) | Onboarding |

---

### Task 1: Máscaras e formato de cliente em `shared/`

**Files:**
- Create: `shared/mascaras.ts`, `shared/clientes.ts`
- Modify: `web/lib/masks.ts`
- Test: `web/tests/unit/shared-clientes-formato.test.ts`

**Interfaces:**
- Produces:
  - `shared/mascaras.ts`: `digits(v:string):string`, `maskPhone(v:string):string`, `maskCNPJ`, `maskCPF`, `maskCEP`, `maskMoeda`, `parseMoeda(masked:string):number`, `formatMoeda(value:number):string`, `validaCNPJ(v:string):boolean`, `toWhatsApp(phone:string):string`. O código é idêntico ao atual de `web/lib/masks.ts`.
  - `shared/clientes.ts`:
    - `type EnderecoCliente = { logradouro:string; numero:string; bairro:string; complemento:string }`
    - `parseEndereco(raw?: string|null): EnderecoCliente`
    - `serializarEndereco(e: EnderecoCliente): string|null`
    - `montarAniversario(mes: string, dia: string): string|null`
    - `partesAniversario(data?: string|null): { mes: string; dia: string }`
    - `idadeCliente(data?: string|null, hoje?: Date): number|null`
    - `formatarAniversario(data?: string|null): string`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/shared-clientes-formato.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { maskPhone, toWhatsApp, digits } from '@shared/mascaras';
import {
  parseEndereco, serializarEndereco, montarAniversario, partesAniversario,
  idadeCliente, formatarAniversario,
} from '@shared/clientes';

describe('shared/mascaras', () => {
  it('maskPhone formata celular e fixo', () => {
    expect(maskPhone('11987654321')).toBe('(11) 98765-4321');
    expect(maskPhone('1133334444')).toBe('(11) 3333-4444');
  });
  it('toWhatsApp não duplica o DDI 55', () => {
    expect(toWhatsApp('(34) 99178-0000')).toBe('5534991780000');
    expect(toWhatsApp('+55 34 99178-0000')).toBe('5534991780000');
  });
  it('web/lib/masks reexporta de shared (fonte única)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'lib', 'masks.ts'), 'utf8');
    expect(src).toContain("from '@shared/mascaras'");
    expect(src).not.toMatch(/export function maskPhone/);
    expect(digits('a1b2')).toBe('12');
  });
});

describe('shared/clientes — endereço', () => {
  it('lê JSON do web', () => {
    expect(parseEndereco('{"logradouro":"Rua A","numero":"10","bairro":"Centro"}'))
      .toEqual({ logradouro: 'Rua A', numero: '10', bairro: 'Centro', complemento: '' });
  });
  it('texto livre legado vira logradouro', () => {
    expect(parseEndereco('Rua B, 5')).toEqual({ logradouro: 'Rua B, 5', numero: '', bairro: '', complemento: '' });
  });
  it('vazio e nulo', () => {
    expect(parseEndereco(null)).toEqual({ logradouro: '', numero: '', bairro: '', complemento: '' });
  });
  it('serializa só quando há conteúdo', () => {
    expect(serializarEndereco({ logradouro: '', numero: '', bairro: '', complemento: '' })).toBeNull();
    expect(JSON.parse(serializarEndereco({ logradouro: ' Rua A ', numero: '1', bairro: '', complemento: '' })!))
      .toEqual({ logradouro: 'Rua A', numero: '1', bairro: '', complemento: '' });
  });
});

describe('shared/clientes — aniversário (formato 1900-MM-DD)', () => {
  it('monta só com mês e dia', () => {
    expect(montarAniversario('3', '7')).toBe('1900-03-07');
    expect(montarAniversario('', '7')).toBeNull();
  });
  it('partes de uma data gravada', () => {
    expect(partesAniversario('1900-03-07')).toEqual({ mes: '03', dia: '07' });
    expect(partesAniversario('1990-12-25')).toEqual({ mes: '12', dia: '25' });
    expect(partesAniversario(null)).toEqual({ mes: '', dia: '' });
  });
  it('idade só quando o ano é real (> 1905)', () => {
    const hoje = new Date(2026, 8, 29);
    expect(idadeCliente('1900-03-07', hoje)).toBeNull();
    expect(idadeCliente('1990-12-25', hoje)).toBe(35);
    expect(idadeCliente('1990-09-29', hoje)).toBe(36);
  });
  it('formata dd/MM sem deslocar fuso', () => {
    expect(formatarAniversario('1900-03-07')).toBe('07/03');
    expect(formatarAniversario(undefined)).toBe('');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/shared-clientes-formato.test.ts`
Expected: FAIL, com o erro de módulo `@shared/mascaras` não encontrado.

- [ ] **Step 3: Criar `shared/mascaras.ts`**

Copie para `shared/mascaras.ts`, **sem nenhuma alteração de lógica**, as funções de `web/lib/masks.ts`: `digits`, `maskPhone`, `maskCNPJ`, `maskCPF`, `toWhatsApp`, `maskCEP`, `maskMoeda`, `parseMoeda`, `formatMoeda` e `validaCNPJ`, com os respectivos JSDoc. O cabeçalho do arquivo deve ser:

```ts
/**
 * @file mascaras.ts
 * Máscaras e utilitários puros de dados brasileiros (telefone, CNPJ, CPF, CEP,
 * moeda, WhatsApp). Fonte ÚNICA para web e mobile — não duplicar nos apps.
 * Sem dependência de DOM/React Native.
 */
```

- [ ] **Step 4: Transformar `web/lib/masks.ts` em reexportação**

Substitua o conteúdo inteiro de `web/lib/masks.ts` pelo bloco abaixo. `maskComCursor` continua aqui, porque depende de `HTMLInputElement`. O corpo dela é copiado sem mudança do arquivo atual:

```ts
/**
 * @file masks.ts
 * Reexporta as máscaras puras de `@shared/mascaras` (fonte única web + mobile)
 * e mantém aqui só o que depende do DOM.
 */
import { digits } from '@shared/mascaras';

export {
  digits, maskPhone, maskCNPJ, maskCPF, maskCEP, maskMoeda, parseMoeda,
  formatMoeda, validaCNPJ, toWhatsApp,
} from '@shared/mascaras';

/**
 * Aplica uma máscara de dígitos num <input> controlado SEM perder a posição do
 * cursor. Só funciona client-side; use no onChange:
 *   onChange={e => maskComCursor(e.target, maskPhone, setTelefone)}
 */
export function maskComCursor(
  input: HTMLInputElement,
  maskFn: (v: string) => string,
  setValue: (masked: string) => void,
): void {
  const cursorPos = input.selectionStart ?? input.value.length;
  const digitsBeforeCursor = digits(input.value.slice(0, cursorPos)).length;
  const masked = maskFn(input.value);
  setValue(masked);

  requestAnimationFrame(() => {
    if (digitsBeforeCursor === 0) { input.setSelectionRange(0, 0); return; }
    let count = 0;
    for (let i = 0; i < masked.length; i++) {
      if (/\d/.test(masked[i])) {
        count++;
        if (count === digitsBeforeCursor) { input.setSelectionRange(i + 1, i + 1); return; }
      }
    }
    input.setSelectionRange(masked.length, masked.length);
  });
}
```

- [ ] **Step 5: Criar `shared/clientes.ts`**

```ts
/**
 * @file clientes.ts
 * Formato de dados da cliente, igual em web e mobile. É o formato que está em
 * produção desde a migration 006 (tabela `public.clientes`):
 * - `data_nascimento` = '1900-MM-DD' quando só dia/mês são conhecidos (o
 *   cadastro pede só aniversário); um ano real (> 1905) permite calcular idade.
 * - `endereco` = JSON {logradouro, numero, bairro, complemento}. Texto livre
 *   antigo é tratado como logradouro.
 */

export type EnderecoCliente = { logradouro: string; numero: string; bairro: string; complemento: string };

const ENDERECO_VAZIO: EnderecoCliente = { logradouro: '', numero: '', bairro: '', complemento: '' };

/** Lê `clientes.endereco` (JSON ou texto livre legado). Nunca lança. */
export function parseEndereco(raw?: string | null): EnderecoCliente {
  if (!raw) return { ...ENDERECO_VAZIO };
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object' && p.logradouro !== undefined) return { ...ENDERECO_VAZIO, ...p };
  } catch { /* texto livre */ }
  return { ...ENDERECO_VAZIO, logradouro: raw };
}

/** Serializa para gravar em `clientes.endereco`; `null` quando tudo está vazio. */
export function serializarEndereco(e: EnderecoCliente): string | null {
  const limpo: EnderecoCliente = {
    logradouro: e.logradouro.trim(), numero: e.numero.trim(),
    bairro: e.bairro.trim(), complemento: e.complemento.trim(),
  };
  return Object.values(limpo).some(Boolean) ? JSON.stringify(limpo) : null;
}

/** Monta '1900-MM-DD' a partir de mês e dia (strings "1".."12" / "1".."31"). */
export function montarAniversario(mes: string, dia: string): string | null {
  if (!mes || !dia) return null;
  return `1900-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

/** Extrai mês e dia de uma data 'AAAA-MM-DD' gravada. */
export function partesAniversario(data?: string | null): { mes: string; dia: string } {
  if (!data) return { mes: '', dia: '' };
  const [, mes = '', dia = ''] = data.split('-');
  return { mes, dia: dia.slice(0, 2) };
}

/** Idade em anos; `null` quando o ano é o placeholder 1900 (≤ 1905) ou não há data. */
export function idadeCliente(data?: string | null, hoje: Date = new Date()): number | null {
  if (!data) return null;
  const [ano, mes, dia] = data.split('-').map(Number);
  if (!ano || ano <= 1905) return null;
  let idade = hoje.getFullYear() - ano;
  const antesDoAniversario = hoje.getMonth() + 1 < mes || (hoje.getMonth() + 1 === mes && hoje.getDate() < dia);
  if (antesDoAniversario) idade--;
  return idade;
}

/** 'dd/MM' direto da string (sem `new Date`, que em UTC-3 volta um dia). */
export function formatarAniversario(data?: string | null): string {
  const { mes, dia } = partesAniversario(data);
  return mes && dia ? `${dia}/${mes}` : '';
}
```

- [ ] **Step 6: Rodar o teste, o tsc e a suíte**

Run: `cd web && npx vitest run tests/unit/shared-clientes-formato.test.ts && npx tsc --noEmit && npx vitest run`
Expected: PASS em tudo; tsc sem erros.

- [ ] **Step 7: Commit**

```bash
git add shared/mascaras.ts shared/clientes.ts web/lib/masks.ts web/tests/unit/shared-clientes-formato.test.ts
git commit -m "refactor(shared): mascaras e formato de cliente (aniversario, endereco) como fonte unica web+mobile"
```

---

### Task 2: Remover por completo a área e o papel da cliente final

**Files:**
- Delete: `mobile/app/(cliente)/` (a pasta inteira), `mobile/hooks/useCliente.ts`
- Create: `mobile/hooks/useServicosEmpresa.ts`
- Modify: `shared/dominio.ts:8`, `web/types/index.ts:1`, `mobile/types/index.ts:5`, `web/lib/permissions.ts`, `mobile/lib/permissions.ts`, `mobile/app/(empresa)/novo-agendamento.tsx:33`
- Test: `web/tests/unit/sem-area-cliente.test.ts`

**Interfaces:**
- Produces:
  - `PerfilRole = 'gestor' | 'profissional'` nos três arquivos de tipos.
  - `useServicosEmpresa()` em `mobile/hooks/useServicosEmpresa.ts`, com a mesma assinatura e o mesmo retorno de hoje (`ServicoCliente[]`).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/sem-area-cliente.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

// Decisão do dono (2026-09-29): a cliente final não tem login nem acesso.
describe('sem área nem papel de cliente final', () => {
  it('pasta mobile/app/(cliente) e hook useCliente não existem', () => {
    expect(existsSync(join(root, 'mobile/app/(cliente)'))).toBe(false);
    expect(existsSync(join(root, 'mobile/hooks/useCliente.ts'))).toBe(false);
  });

  for (const arq of ['shared/dominio.ts', 'web/types/index.ts', 'mobile/types/index.ts']) {
    it(`${arq}: PerfilRole sem 'cliente'`, () => {
      const linha = ler(arq).split('\n').find(l => l.includes('export type PerfilRole'))!;
      expect(linha).toBeDefined();
      expect(linha).not.toContain("'cliente'");
    });
  }

  for (const arq of ['web/lib/permissions.ts', 'mobile/lib/permissions.ts']) {
    it(`${arq}: sem papel nem rota de cliente`, () => {
      const src = ler(arq);
      expect(src).not.toMatch(/cliente:\s*\[\]/);
      expect(src).not.toMatch(/case 'cliente'/);
    });
  }

  it("nenhum código do mobile grava empresa_membros com role 'cliente'", () => {
    for (const arq of ['mobile/app/(empresa)/novo-cliente.tsx', 'mobile/app/(empresa)/novo-agendamento.tsx', 'mobile/hooks/useClientes.ts']) {
      expect(ler(arq)).not.toMatch(/role['"]?\s*[:,=]\s*'cliente'/);
    }
  });
});
```

Observação: o último `it` só passa depois das Tasks 3 e 7. Enquanto isso, marque-o com `it.todo` e troque para `it` na Task 7. Nesta task, escreva-o como:

```ts
  it.todo("nenhum código do mobile grava empresa_membros com role 'cliente' (ativado na Task 7)");
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/sem-area-cliente.test.ts`
Expected: FAIL, porque a pasta `(cliente)` existe e o `PerfilRole` contém `'cliente'`.

- [ ] **Step 3: Mover `useServicosEmpresa` antes de apagar o hook**

Crie `mobile/hooks/useServicosEmpresa.ts` com a função `useServicosEmpresa` e o tipo `ServicoCliente`. Copie de `mobile/hooks/useCliente.ts`: a função (linhas 174-199), a definição de `ServicoCliente` e os imports de que ela depende (`useQuery`, `supabase`, `useAuthStore`, `CATEGORIA_CONFIG`). No `mobile/app/(empresa)/novo-agendamento.tsx:33`, troque:

```ts
import { useServicosEmpresa } from '@/hooks/useCliente';
```
por
```ts
import { useServicosEmpresa } from '@/hooks/useServicosEmpresa';
```

- [ ] **Step 4: Apagar a área da cliente**

```bash
git rm -r "mobile/app/(cliente)" mobile/hooks/useCliente.ts
```

- [ ] **Step 5: Tipos sem `'cliente'`**

Em `shared/dominio.ts:8`, `web/types/index.ts:1` e `mobile/types/index.ts:5`, troque a união por:

```ts
export type PerfilRole = 'gestor' | 'profissional';
```

(mantendo o alinhamento de espaços do `shared/dominio.ts`).

- [ ] **Step 6: Permissões sem cliente**

Em `web/lib/permissions.ts`:
- remova a linha `cliente: [],`;
- em `rotaInicial`, remova `case 'cliente':     return '/inicio';`.

Em `mobile/lib/permissions.ts`:
- remova `cliente: [],`;
- em `rotaInicial`, remova o bloco `case 'cliente': return '/(cliente)/inicio';`.

- [ ] **Step 7: Corrigir o que o tsc apontar**

Run: `cd web && npx tsc --noEmit` e `cd mobile && npx tsc --noEmit`

Todo erro novo vem de código que comparava com `'cliente'` ou importava `@/hooks/useCliente`. Remova o ramo morto. Exemplo: o rótulo do cartão de perfil em `mobile/app/(empresa)/mais.tsx:203`, que tratava cliente como "Profissional", passa a considerar só `gestor`/`profissional`. O mobile deve voltar a exatamente 9 erros, e o web a 0.

- [ ] **Step 8: Rodar os testes**

Run: `cd web && npx vitest run`
Expected: PASS (o `it.todo` aparece como todo).

- [ ] **Step 9: Commit**

```bash
git add -A shared/dominio.ts web/types/index.ts mobile/types/index.ts web/lib/permissions.ts mobile/lib/permissions.ts mobile/hooks mobile/app web/tests/unit/sem-area-cliente.test.ts
git commit -m "refactor: remove area e papel de cliente final (web e mobile) — so o estabelecimento acessa"
```

---

### Task 3: Mobile lê a cliente de `public.clientes` (lista, detalhe e embeds)

**Files:**
- Modify: `mobile/hooks/useClientes.ts`, `mobile/hooks/useAgenda.ts:108`, `mobile/hooks/useDashboard.ts:31`, `mobile/hooks/useProfissional.ts:52,145,365`, `mobile/app/(empresa)/agendamento/[id].tsx:96`, `mobile/app/(profissional)/agendamento/[id].tsx:87`, `mobile/types/index.ts`
- Test: `web/tests/unit/mobile-cliente-entidade.test.ts`

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces:
  - Em `mobile/types/index.ts`:
    ```ts
    export interface Cliente {
      id: string; empresa_id: string; nome: string;
      telefone: string | null; email: string | null;
      data_nascimento: string | null; observacoes: string | null;
      endereco: string | null; ativo: boolean; created_at: string;
    }
    ```
  - `ClienteResumo extends Cliente` (não mais `User`), com os mesmos campos agregados de hoje: `total_gasto`, `total_visitas`, `ultima_visita`, `tags`.
  - `useClienteDetalhe(clienteId)` retorna `ClienteDetalhe | null`. O `null` significa "não encontrada" e substitui o objeto vazio.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/mobile-cliente-entidade.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

// Desde a migration 031, agendamentos.cliente_id → public.clientes. O embed
// `users!agendamentos_cliente_id_fkey` dá erro no PostgREST de produção
// (verificado em 2026-09-29) e derrubava agenda, dashboard e área da profissional.
const ARQUIVOS_COM_EMBED = [
  'mobile/hooks/useAgenda.ts',
  'mobile/hooks/useDashboard.ts',
  'mobile/hooks/useProfissional.ts',
  'mobile/app/(empresa)/agendamento/[id].tsx',
  'mobile/app/(profissional)/agendamento/[id].tsx',
];

describe('mobile usa public.clientes como entidade de cliente', () => {
  for (const arq of ARQUIVOS_COM_EMBED) {
    it(`${arq}: embed de cliente via clientes!`, () => {
      const src = ler(arq);
      expect(src).not.toContain('users!agendamentos_cliente_id_fkey');
      expect(src).toContain('clientes!agendamentos_cliente_id_fkey');
    });
  }

  it('useClientes lê de clientes (ativos, da empresa) e não de empresa_membros/users', () => {
    const src = ler('mobile/hooks/useClientes.ts');
    expect(src).toContain(".from('clientes')");
    expect(src).not.toContain(".from('empresa_membros')");
    expect(src).not.toContain(".from('users')");
    expect(src).toContain(".eq('ativo', true)");
  });

  it('anamnese do detalhe usa maybeSingle (sem erro PGRST116 quando não há ficha)', () => {
    const src = ler('mobile/hooks/useClientes.ts');
    const trecho = src.slice(src.indexOf(".from('anamnese_fichas')"));
    expect(trecho.slice(0, 300)).toContain('.maybeSingle()');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/mobile-cliente-entidade.test.ts`
Expected: FAIL em todos os casos.

- [ ] **Step 3: Trocar os embeds**

Em cada um dos 5 arquivos, substitua `users!agendamentos_cliente_id_fkey` por `clientes!agendamentos_cliente_id_fkey`. A lista de colunas de cada embed só pode conter colunas que existem em `clientes`: `id, nome, telefone, email, data_nascimento, observacoes, endereco, ativo, created_at, empresa_id`. **`foto_url` não existe em `clientes`**, então remova-a dos embeds em `useAgenda.ts:108`, `useDashboard.ts:31` e `useProfissional.ts:52`. Se algum componente lia `cliente.foto_url`, deixe-o cair no fallback de iniciais que já existe (o tipo passa a ser `foto_url?: undefined`). Exemplo do resultado em `useAgenda.ts`:

```ts
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
```

- [ ] **Step 4: Reescrever `useClientes` e `useClientesStats`**

Em `mobile/hooks/useClientes.ts`:
- troque o import `User` por `Cliente`;
- faça `ClienteResumo extends Cliente` e tire os campos redundantes (`telefone`, `data_nascimento`, `email`, `endereco` já vêm de `Cliente`).

Substitua o início do `queryFn` de `useClientes`, da busca de membros até a busca de agendamentos:

```ts
    queryFn: async () => {
      const { data: base, error } = await supabase
        .from('clientes')
        .select('*')
        .eq('empresa_id', empresaId!)
        .eq('ativo', true)
        .order('nome');
      if (error) throw error;
      if (!base?.length) return [];

      const clienteIds = base.map((c) => c.id);

      // Agregados de atendimentos concluídos, paginados (PostgREST corta em 1000).
      const agendamentos = await buscarTodasPaginas<{ cliente_id: string; valor: number; data_hora_inicio: string }>(
        (from, to) => supabase
          .from('agendamentos')
          .select('cliente_id, valor, data_hora_inicio')
          .eq('empresa_id', empresaId!)
          .eq('status', 'concluido')
          .not('cliente_id', 'is', null)
          .order('data_hora_inicio')
          .range(from, to) as any,
      );
```

No resto do `queryFn`:
- a agregação passa a iterar `agendamentos` e ignora `cliente_id` que não esteja em `clienteIds`;
- o `map` final usa `base` no lugar de `users`;
- a busca também procura por e-mail:

```ts
        clientes = clientes.filter(
          (c) => c.nome.toLowerCase().includes(b) || (c.telefone ?? '').includes(b) || (c.email ?? '').toLowerCase().includes(b),
        );
```

Em `useClientesStats`, troque a leitura de `empresa_membros` por:

```ts
      const { data: base } = await supabase
        .from('clientes')
        .select('id, created_at')
        .eq('empresa_id', empresaId!)
        .eq('ativo', true);

      if (!base?.length) return { total: 0, novasMes: 0, sumidas: 0 };
      const clienteIds = base.map((c) => c.id);
      const inicioMes = startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)).toISOString();
      const novasMes = base.filter((c) => c.created_at >= inicioMes).length;
```

O cálculo de `sumidas` e o `return` usam `base.length` como total. As regras de tags, filtros e segmentos **não mudam nesta fase**: a unificação com o web é da fase Clientes.

- [ ] **Step 5: Detalhe da cliente**

No `useClienteDetalhe`:
- troque `supabase.from('users').select('*').eq('id', clienteId).single()` por `supabase.from('clientes').select('*').eq('id', clienteId).eq('empresa_id', empresaId!).maybeSingle()`;
- troque o `.single()` da consulta de `anamnese_fichas` por `.maybeSingle()`;
- depois do `Promise.all`, antes de montar o retorno, inclua:

```ts
      const user = userRes.data;
      if (!user) return null;
```

O retorno final vira `as ClienteDetalhe` e a assinatura do hook passa a ser `useQuery<ClienteDetalhe | null>`.

Em `mobile/app/(empresa)/cliente/[id].tsx`, troque o `return null` que ocorre quando `!cliente` (linha ~223) por um estado visível de não encontrada, no mesmo estilo do web:

```tsx
  if (!cliente) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 15, color: C.text }}>Cliente não encontrada.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.primary }}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }
```

(Enquanto `isLoading`, continue retornando o loader que a tela já tem. Se não tiver, retorne `null` só enquanto estiver carregando.)

- [ ] **Step 6: tsc, testes e commit**

Run: `cd mobile && npx tsc --noEmit` (continua com 9 erros, nenhum novo), `cd web && npx tsc --noEmit && npx vitest run`
Expected: tudo verde.

```bash
git add mobile/hooks mobile/types/index.ts "mobile/app/(empresa)/agendamento/[id].tsx" "mobile/app/(profissional)/agendamento/[id].tsx" "mobile/app/(empresa)/cliente/[id].tsx" web/tests/unit/mobile-cliente-entidade.test.ts
git commit -m "fix(mobile): cliente vem de public.clientes — agenda, dashboard e area da profissional voltam a carregar"
```

---

### Task 4: Formato canônico da anamnese em `shared/` + migration 080

**Files:**
- Create: `shared/anamnese.ts`, `supabase/migrations/080_anamnese_fichas_fonte_unica.sql`
- Test: `web/tests/unit/anamnese-canonica.test.ts`

**Interfaces:**
- Produces (`shared/anamnese.ts`):
  ```ts
  export type RespostaSimNao = { resposta: 'sim' | 'nao' | ''; detalhe: string };
  export type AnamneseRespostas = {
    alergias: RespostaSimNao; problemas_saude: RespostaSimNao; medicamentos: RespostaSimNao;
    autoimune: RespostaSimNao; procedimento_anterior: RespostaSimNao;
    gestante: '' | 'nao' | 'gestante' | 'lactante';
    tipo_pele: '' | 'normal' | 'seca' | 'oleosa' | 'mista' | 'sensivel';
    sensibilidade_olhos: '' | 'nenhuma' | 'leve' | 'moderada' | 'alta';
    info_adicionais: string; declaracao_aceita: boolean; salvo_em?: string;
  };
  export const ANAMNESE_VAZIA: AnamneseRespostas;
  export const PERGUNTAS_SIM_NAO: { key: ChaveSimNao; label: string; placeholder: string }[];
  export const PERGUNTAS_OPCOES: { key: 'gestante'|'tipo_pele'|'sensibilidade_olhos'; label: string; opcoes: { valor: string; rotulo: string }[] }[];
  export const TEXTO_DECLARACAO: string;
  export function normalizarAnamnese(raw: unknown): AnamneseRespostas;
  export function restricoesAnamnese(a: AnamneseRespostas): string[];
  export function anamnesePreenchida(a: AnamneseRespostas): boolean;
  ```

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/anamnese-canonica.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ANAMNESE_VAZIA, normalizarAnamnese, restricoesAnamnese, anamnesePreenchida,
  PERGUNTAS_SIM_NAO, PERGUNTAS_OPCOES,
} from '@shared/anamnese';

describe('normalizarAnamnese', () => {
  it('lixo/vazio vira ficha vazia', () => {
    expect(normalizarAnamnese(null)).toEqual(ANAMNESE_VAZIA);
    expect(normalizarAnamnese('texto')).toEqual(ANAMNESE_VAZIA);
  });

  it('formato do web (produção, 9 fichas) é preservado', () => {
    const web = {
      alergias: { resposta: 'sim', detalhe: 'látex' }, problemas_saude: { resposta: 'nao', detalhe: '' },
      medicamentos: { resposta: '', detalhe: '' }, gravida_amamentando: { resposta: 'sim', detalhe: '' },
      info_adicionais: 'obs', declaracao_aceita: true, salvo_em: '2026-08-01T10:00:00.000Z',
    };
    const a = normalizarAnamnese(web);
    expect(a.alergias).toEqual({ resposta: 'sim', detalhe: 'látex' });
    expect(a.problemas_saude.resposta).toBe('nao');
    expect(a.gestante).toBe('gestante');           // gravida_amamentando=sim → gestante
    expect(a.info_adicionais).toBe('obs');
    expect(a.declaracao_aceita).toBe(true);
    expect(a.salvo_em).toBe('2026-08-01T10:00:00.000Z');
  });

  it('formato antigo do mobile (strings livres) é convertido', () => {
    const a = normalizarAnamnese({
      alergia: 'Dipirona', medicamentos: 'Não', gestante: 'Lactante',
      tipo_pele: 'Oleosa', sensibilidade: 'Alta', autoimune: '', observacoes: 'x',
    });
    expect(a.alergias).toEqual({ resposta: 'sim', detalhe: 'Dipirona' });
    expect(a.medicamentos).toEqual({ resposta: 'nao', detalhe: '' });
    expect(a.gestante).toBe('lactante');
    expect(a.tipo_pele).toBe('oleosa');
    expect(a.sensibilidade_olhos).toBe('alta');
    expect(a.autoimune.resposta).toBe('');
    expect(a.info_adicionais).toBe('x');
    expect(a.declaracao_aceita).toBe(false);
  });

  it('formato canônico é idempotente', () => {
    const a = normalizarAnamnese({ ...ANAMNESE_VAZIA, tipo_pele: 'seca', alergias: { resposta: 'sim', detalhe: 'y' } });
    expect(normalizarAnamnese(a)).toEqual(a);
  });
});

describe('restricoesAnamnese', () => {
  it('lista sim-com-detalhe, gestação/lactação e sensibilidade alta', () => {
    const r = restricoesAnamnese({
      ...ANAMNESE_VAZIA,
      alergias: { resposta: 'sim', detalhe: 'látex' },
      medicamentos: { resposta: 'nao', detalhe: '' },
      gestante: 'lactante', sensibilidade_olhos: 'alta',
    });
    expect(r).toEqual(['Alergia: látex', 'Lactante', 'Sensibilidade nos olhos: alta']);
  });
  it('ficha vazia não tem restrição e não está preenchida', () => {
    expect(restricoesAnamnese(ANAMNESE_VAZIA)).toEqual([]);
    expect(anamnesePreenchida(ANAMNESE_VAZIA)).toBe(false);
    expect(anamnesePreenchida({ ...ANAMNESE_VAZIA, salvo_em: '2026-01-01T00:00:00Z' })).toBe(true);
  });
});

it('perguntas cobrem a união dos campos de web e mobile', () => {
  expect(PERGUNTAS_SIM_NAO.map(p => p.key)).toEqual(
    ['alergias', 'problemas_saude', 'medicamentos', 'autoimune', 'procedimento_anterior']);
  expect(PERGUNTAS_OPCOES.map(p => p.key)).toEqual(['gestante', 'tipo_pele', 'sensibilidade_olhos']);
});

describe('migration 080', () => {
  const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', '080_anamnese_fichas_fonte_unica.sql'), 'utf8');
  it('cria policies de SELECT/INSERT/UPDATE idempotentes para membros da empresa', () => {
    for (const nome of ['anamnese: ver', 'anamnese: inserir', 'anamnese: atualizar']) {
      expect(sql).toContain(`drop policy if exists "${nome}"`);
      expect(sql).toContain(`create policy "${nome}"`);
    }
    expect(sql).toMatch(/empresa_id in \(select minha_empresas\(\)\)/);
    expect(sql).not.toMatch(/cliente_id\s*=\s*auth\.uid\(\)/);
  });
  it('migra fichas de clientes.observacoes com on conflict e limpa só as migradas', () => {
    expect(sql).toMatch(/insert into public\.anamnese_fichas/i);
    expect(sql).toMatch(/on conflict \(empresa_id, cliente_id\) do nothing/i);
    expect(sql).toMatch(/update public\.clientes\s+set observacoes = null/i);
  });
  it('recarrega o schema do PostgREST', () => {
    expect(sql.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/anamnese-canonica.test.ts`
Expected: FAIL, porque `@shared/anamnese` não existe.

- [ ] **Step 3: Criar `shared/anamnese.ts`**

```ts
/**
 * @file anamnese.ts
 * Ficha de anamnese — formato canônico ÚNICO (web e mobile), gravado em
 * `anamnese_fichas.respostas` (jsonb). Une os campos que existiam só no web
 * (problemas de saúde, declaração LGPD, data) e só no mobile (tipo de pele,
 * sensibilidade, autoimune, procedimento anterior).
 *
 * `normalizarAnamnese` aceita também os dois formatos antigos:
 * - web: JSON que ficava em `clientes.observacoes` (`gravida_amamentando`, `alergias` objeto)
 * - mobile: strings livres (`alergia`, `gestante: 'Gestante'`, `sensibilidade`, `observacoes`)
 */

export type RespostaSimNao = { resposta: 'sim' | 'nao' | ''; detalhe: string };
type ChaveSimNao = 'alergias' | 'problemas_saude' | 'medicamentos' | 'autoimune' | 'procedimento_anterior';

export type AnamneseRespostas = {
  alergias: RespostaSimNao;
  problemas_saude: RespostaSimNao;
  medicamentos: RespostaSimNao;
  autoimune: RespostaSimNao;
  procedimento_anterior: RespostaSimNao;
  gestante: '' | 'nao' | 'gestante' | 'lactante';
  tipo_pele: '' | 'normal' | 'seca' | 'oleosa' | 'mista' | 'sensivel';
  sensibilidade_olhos: '' | 'nenhuma' | 'leve' | 'moderada' | 'alta';
  info_adicionais: string;
  declaracao_aceita: boolean;
  salvo_em?: string;
};

const SN: RespostaSimNao = { resposta: '', detalhe: '' };

export const ANAMNESE_VAZIA: AnamneseRespostas = {
  alergias: { ...SN }, problemas_saude: { ...SN }, medicamentos: { ...SN },
  autoimune: { ...SN }, procedimento_anterior: { ...SN },
  gestante: '', tipo_pele: '', sensibilidade_olhos: '',
  info_adicionais: '', declaracao_aceita: false,
};

export const PERGUNTAS_SIM_NAO: { key: ChaveSimNao; label: string; placeholder: string }[] = [
  { key: 'alergias',              label: 'Possui alguma alergia?',        placeholder: 'Ex: látex, parabenos...' },
  { key: 'problemas_saude',       label: 'Tem algum problema de saúde?',  placeholder: 'Ex: hipertensão, diabetes...' },
  { key: 'medicamentos',          label: 'Faz uso de medicamentos?',      placeholder: 'Ex: anticoagulantes...' },
  { key: 'autoimune',             label: 'Tem doença autoimune?',         placeholder: 'Qual?' },
  { key: 'procedimento_anterior', label: 'Já fez procedimento anterior?', placeholder: 'Qual e quando?' },
];

export const PERGUNTAS_OPCOES: {
  key: 'gestante' | 'tipo_pele' | 'sensibilidade_olhos';
  label: string;
  opcoes: { valor: string; rotulo: string }[];
}[] = [
  { key: 'gestante', label: 'Gestante ou lactante?', opcoes: [
    { valor: 'nao', rotulo: 'Não' }, { valor: 'gestante', rotulo: 'Gestante' }, { valor: 'lactante', rotulo: 'Lactante' },
  ] },
  { key: 'tipo_pele', label: 'Tipo de pele', opcoes: [
    { valor: 'normal', rotulo: 'Normal' }, { valor: 'seca', rotulo: 'Seca' }, { valor: 'oleosa', rotulo: 'Oleosa' },
    { valor: 'mista', rotulo: 'Mista' }, { valor: 'sensivel', rotulo: 'Sensível' },
  ] },
  { key: 'sensibilidade_olhos', label: 'Sensibilidade nos olhos', opcoes: [
    { valor: 'nenhuma', rotulo: 'Nenhuma' }, { valor: 'leve', rotulo: 'Leve' },
    { valor: 'moderada', rotulo: 'Moderada' }, { valor: 'alta', rotulo: 'Alta' },
  ] },
];

export const TEXTO_DECLARACAO =
  'Declaro que as informações acima são verdadeiras e autorizo seu uso para fins da realização do procedimento estético.';

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function simNao(v: unknown): RespostaSimNao {
  if (v && typeof v === 'object' && 'resposta' in (v as any)) {
    const r = (v as any).resposta;
    return { resposta: r === 'sim' || r === 'nao' ? r : '', detalhe: String((v as any).detalhe ?? '') };
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return { ...SN };
    const n = semAcento(t);
    if (n === 'nao' || n === 'nenhum' || n === 'nenhuma') return { resposta: 'nao', detalhe: '' };
    return { resposta: 'sim', detalhe: t };
  }
  return { ...SN };
}

function opcao<T extends string>(v: unknown, validas: readonly T[]): T | '' {
  if (typeof v !== 'string') return '';
  const n = semAcento(v) as T;
  return validas.includes(n) ? n : '';
}

/** Converte qualquer formato (canônico, web antigo, mobile antigo) no canônico. Nunca lança. */
export function normalizarAnamnese(raw: unknown): AnamneseRespostas {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return structuredClone(ANAMNESE_VAZIA);
  const r = raw as Record<string, any>;

  let gestante = opcao(r.gestante, ['nao', 'gestante', 'lactante'] as const);
  if (!gestante && r.gravida_amamentando) {
    const g = simNao(r.gravida_amamentando).resposta;
    gestante = g === 'sim' ? 'gestante' : g === 'nao' ? 'nao' : '';
  }

  return {
    alergias:              simNao(r.alergias ?? r.alergia),
    problemas_saude:       simNao(r.problemas_saude),
    medicamentos:          simNao(r.medicamentos),
    autoimune:             simNao(r.autoimune),
    procedimento_anterior: simNao(r.procedimento_anterior),
    gestante,
    tipo_pele:             opcao(r.tipo_pele, ['normal', 'seca', 'oleosa', 'mista', 'sensivel'] as const),
    sensibilidade_olhos:   opcao(r.sensibilidade_olhos ?? r.sensibilidade, ['nenhuma', 'leve', 'moderada', 'alta'] as const),
    info_adicionais:       String(r.info_adicionais ?? r.observacoes ?? ''),
    declaracao_aceita:     r.declaracao_aceita === true,
    ...(typeof r.salvo_em === 'string' ? { salvo_em: r.salvo_em } : {}),
  };
}

const ROTULO_RESTRICAO: Record<ChaveSimNao, string> = {
  alergias: 'Alergia', problemas_saude: 'Problema de saúde', medicamentos: 'Medicamentos',
  autoimune: 'Doença autoimune', procedimento_anterior: 'Procedimento anterior',
};

/** Restrições a destacar no perfil (alerta). Procedimento anterior não é restrição. */
export function restricoesAnamnese(a: AnamneseRespostas): string[] {
  const out: string[] = [];
  for (const k of ['alergias', 'problemas_saude', 'medicamentos', 'autoimune'] as const) {
    if (a[k].resposta === 'sim') out.push(a[k].detalhe ? `${ROTULO_RESTRICAO[k]}: ${a[k].detalhe}` : ROTULO_RESTRICAO[k]);
  }
  if (a.gestante === 'gestante') out.push('Gestante');
  if (a.gestante === 'lactante') out.push('Lactante');
  if (a.sensibilidade_olhos === 'alta') out.push('Sensibilidade nos olhos: alta');
  return out;
}

/** Ficha considerada preenchida quando já foi salva ao menos uma vez. */
export function anamnesePreenchida(a: AnamneseRespostas): boolean {
  return !!a.salvo_em;
}
```

- [ ] **Step 4: Criar a migration 080**

```sql
-- 080_anamnese_fichas_fonte_unica.sql
--
-- Anamnese passa a ter UMA fonte: public.anamnese_fichas (web e mobile).
--
-- Antes: o web gravava a ficha como JSON dentro de clientes.observacoes (texto),
-- e o mobile tentava gravar em anamnese_fichas — mas a tabela só tinha policy de
-- SELECT (001), então todo INSERT/UPDATE do mobile era barrado pelo RLS. E a
-- policy de SELECT ainda comparava cliente_id = auth.uid(), que perdeu sentido
-- desde a 031 (cliente_id aponta para public.clientes, não para auth.users).
--
-- Esta migration:
--  1. recria as policies (ver/inserir/atualizar) para membros da empresa;
--  2. copia as fichas de clientes.observacoes para anamnese_fichas.respostas
--     (formato antigo do web; o app normaliza na leitura via shared/anamnese.ts);
--  3. limpa clientes.observacoes SÓ nas linhas migradas — o campo volta a ser
--     "observações internas" em texto livre.
-- Idempotente: pode rodar mais de uma vez.
--
-- Rollback do passo 3 (se precisar): as fichas continuam em anamnese_fichas;
--   update public.clientes c set observacoes = f.respostas::text
--   from public.anamnese_fichas f where f.cliente_id = c.id and c.observacoes is null;

alter table public.anamnese_fichas enable row level security;

drop policy if exists "anamnese: ver" on public.anamnese_fichas;
create policy "anamnese: ver" on public.anamnese_fichas
  for select using (empresa_id in (select minha_empresas()));

drop policy if exists "anamnese: inserir" on public.anamnese_fichas;
create policy "anamnese: inserir" on public.anamnese_fichas
  for insert with check (empresa_id in (select minha_empresas()));

drop policy if exists "anamnese: atualizar" on public.anamnese_fichas;
create policy "anamnese: atualizar" on public.anamnese_fichas
  for update using (empresa_id in (select minha_empresas()))
  with check (empresa_id in (select minha_empresas()));

-- 2. Migra as fichas que o web guardava em clientes.observacoes.
insert into public.anamnese_fichas (empresa_id, cliente_id, respostas, created_at, updated_at)
select c.empresa_id,
       c.id,
       c.observacoes::jsonb,
       coalesce((c.observacoes::jsonb ->> 'salvo_em')::timestamptz, now()),
       coalesce((c.observacoes::jsonb ->> 'salvo_em')::timestamptz, now())
from public.clientes c
where c.observacoes is not null
  and c.observacoes ~ '^\s*\{'
  and (c.observacoes::jsonb ? 'alergias')
on conflict (empresa_id, cliente_id) do nothing;

-- 3. Libera clientes.observacoes nas linhas já migradas.
update public.clientes
   set observacoes = null
 where observacoes is not null
   and observacoes ~ '^\s*\{'
   and (observacoes::jsonb ? 'alergias')
   and exists (select 1 from public.anamnese_fichas f
                where f.cliente_id = clientes.id and f.empresa_id = clientes.empresa_id);

notify pgrst, 'reload schema';
```

- [ ] **Step 5: Rodar testes e tsc**

Run: `cd web && npx vitest run tests/unit/anamnese-canonica.test.ts && npx tsc --noEmit`
Expected: PASS e zero erros.

- [ ] **Step 6: Commit**

```bash
git add shared/anamnese.ts supabase/migrations/080_anamnese_fichas_fonte_unica.sql web/tests/unit/anamnese-canonica.test.ts
git commit -m "feat(anamnese): formato canonico unico em shared + migration 080 (RLS de escrita e migracao das fichas do web)"
```

---

### Task 5: Web lê e grava a anamnese em `anamnese_fichas`

**Files:**
- Modify: `web/app/(app)/clientes/[id]/page.tsx` (tipos de anamnese nas linhas ~534-550, leitura nas ~633-642, `PERGUNTAS` nas ~912-917, UI da aba nas ~1361-1500, card de status nas ~1567-1586)
- Test: `web/tests/unit/web-anamnese-fichas.test.ts`

**Interfaces:**
- Consumes: `ANAMNESE_VAZIA`, `AnamneseRespostas`, `normalizarAnamnese`, `PERGUNTAS_SIM_NAO`, `PERGUNTAS_OPCOES`, `TEXTO_DECLARACAO`, `anamnesePreenchida` e `restricoesAnamnese` de `@shared/anamnese` (Task 4).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/web-anamnese-fichas.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'app', '(app)', 'clientes', '[id]', 'page.tsx'), 'utf8');

describe('perfil web: anamnese em anamnese_fichas', () => {
  it('usa o formato canônico de shared/anamnese', () => {
    expect(src).toContain("from '@shared/anamnese'");
    expect(src).toContain('PERGUNTAS_SIM_NAO');
    expect(src).toContain('PERGUNTAS_OPCOES');
    expect(src).not.toMatch(/type Anamnese = \{/);
  });
  it('não lê nem grava anamnese em clientes.observacoes', () => {
    expect(src).not.toMatch(/JSON\.parse\(cliente\.observacoes/);
    expect(src).not.toMatch(/update\(\{\s*observacoes:\s*JSON\.stringify/);
  });
  it('grava com upsert por (empresa_id, cliente_id), conferindo erro e linhas', () => {
    const i = src.indexOf(".from('anamnese_fichas')");
    expect(i).toBeGreaterThan(-1);
    const salvar = src.slice(src.indexOf('.upsert('), src.indexOf('.upsert(') + 400);
    expect(salvar).toContain("onConflict: 'empresa_id,cliente_id'");
    expect(salvar).toContain(".select('id')");
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/web-anamnese-fichas.test.ts`
Expected: FAIL.

- [ ] **Step 3: Estado e carga**

Nesta ordem:

1. No topo do arquivo, adicione:
   ```ts
   import {
     ANAMNESE_VAZIA, normalizarAnamnese, anamnesePreenchida, restricoesAnamnese,
     PERGUNTAS_SIM_NAO, PERGUNTAS_OPCOES, TEXTO_DECLARACAO, type AnamneseRespostas,
   } from '@shared/anamnese';
   ```
2. Apague os tipos locais `AnamneseItem` e `Anamnese` e as constantes `ITEM` e `VAZIA` (linhas ~535-546). Os estados passam a ser:
   ```ts
   const [anamnese,   setAnamnese]   = useState<AnamneseRespostas>(ANAMNESE_VAZIA);
   const [rascunho,   setRascunho]   = useState<AnamneseRespostas>(ANAMNESE_VAZIA);
   const [erroAn,     setErroAn]     = useState('');
   ```
   (`editAn` e `salvandoAn` continuam como estão.)
3. Apague o bloco `// anamnese` do `useEffect` que depende de `[cliente]` (linhas ~635-642, o `JSON.parse(cliente.observacoes ...)`). Deixe só a parte do rascunho de info.
4. No carregamento principal da cliente (o efeito que faz `supabase.from('clientes').select('*').eq('id', id).single()`, linha ~580), inclua em paralelo:
   ```ts
   supabase.from('anamnese_fichas').select('respostas').eq('cliente_id', id).maybeSingle(),
   ```
   Com o resultado:
   ```ts
   const ficha = normalizarAnamnese(rFicha.data?.respostas);
   setAnamnese(ficha); setRascunho(ficha);
   ```

- [ ] **Step 4: Salvar**

Substitua o `onClick` do botão "Salvar ficha" por:

```tsx
                        onClick={async () => {
                          if (!empresaId) return;
                          setSalvandoAn(true); setErroAn('');
                          const { data: { user } } = await supabase.auth.getUser();
                          const dados: AnamneseRespostas = { ...rascunho, salvo_em: new Date().toISOString() };
                          const { data, error } = await supabase.from('anamnese_fichas')
                            .upsert({
                              empresa_id: empresaId, cliente_id: id, respostas: dados,
                              profissional_id: user?.id ?? null, updated_at: new Date().toISOString(),
                            }, { onConflict: 'empresa_id,cliente_id' })
                            .select('id');
                          setSalvandoAn(false);
                          if (error) { setErroAn(error.message); return; }
                          if (!data || data.length === 0) { setErroAn('Sem permissão para salvar a ficha.'); return; }
                          setAnamnese(dados);
                          setEditAn(false);
                        }}
```

Logo acima da linha de botões, mostre o erro: `{erroAn && <p className="text-red text-sm">{erroAn}</p>}`.

- [ ] **Step 5: UI a partir do shared**

1. Apague o `const PERGUNTAS = [...]` local (linhas ~912-917). No modo edição, o `.map` dos botões Sim/Não e o textarea de detalhe passam a iterar `PERGUNTAS_SIM_NAO`, usando `p.key`, `p.label` e `p.placeholder`. O JSX de hoje continua igual, só troca a fonte.
2. Depois das perguntas sim/não, renderize `PERGUNTAS_OPCOES` como grupos de chips, no mesmo estilo dos botões Sim/Não:
   ```tsx
                    {PERGUNTAS_OPCOES.map(p => (
                      <div key={p.key} className="flex flex-col gap-2">
                        <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide">{p.label}</label>
                        <div className="flex flex-wrap gap-2">
                          {p.opcoes.map(o => (
                            <button key={o.valor} type="button"
                              onClick={() => setRascunho(r => ({ ...r, [p.key]: o.valor }))}
                              className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition ${
                                rascunho[p.key] === o.valor ? 'bg-primary-soft border-primary/30 text-primary' : 'bg-bg border-border text-text-3 hover:border-accent'
                              }`}>
                              {o.rotulo}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
   ```
3. No modo leitura, faça o mesmo: `PERGUNTAS_SIM_NAO` no lugar de `PERGUNTAS`. Para `PERGUNTAS_OPCOES`, mostre o rótulo da opção escolhida (`p.opcoes.find(o => o.valor === anamnese[p.key])?.rotulo`) ou "Não respondido" em itálico, como já é feito para sim/não.
4. Substitua os dois textos literais da declaração por `{TEXTO_DECLARACAO}`.
5. Troque todo `anamnese.salvo_em` usado como condição por `anamnesePreenchida(anamnese)`. As datas exibidas continuam lendo `anamnese.salvo_em!`.
6. No card de status da coluna direita, abaixo de "Preenchida em ...", liste as restrições quando houver. Isso reproduz o alerta que antes existia só no mobile:
   ```tsx
            {restricoesAnamnese(anamnese).length > 0 && (
              <ul className="mt-2 flex flex-col gap-0.5">
                {restricoesAnamnese(anamnese).map(r => (
                  <li key={r} className="text-xs font-semibold text-red">⚠ {r}</li>
                ))}
              </ul>
            )}
   ```

- [ ] **Step 6: tsc, testes e commit**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tudo verde.

```bash
git add "web/app/(app)/clientes/[id]/page.tsx" web/tests/unit/web-anamnese-fichas.test.ts
git commit -m "feat(web): anamnese lida/gravada em anamnese_fichas com o formato canonico compartilhado"
```

---

### Task 6: Mobile — ficha de anamnese no formato canônico, com declaração obrigatória

**Files:**
- Modify: `mobile/app/(empresa)/cliente/[id]/anamnese.tsx`, `mobile/app/(empresa)/cliente/[id].tsx` (alerta de restrições ~238-245 e 469-496, aba anamnese ~635-654), `mobile/types/index.ts` (tipo `AnamneseFicha.respostas`)
- Test: `web/tests/unit/mobile-anamnese-canonica.test.ts`

**Interfaces:**
- Consumes: `@shared/anamnese` (Task 4). `useClienteDetalhe` retorna `anamnese?: { respostas: unknown } | null` (Task 3).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/mobile-anamnese-canonica.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const tela = readFileSync(join(root, 'mobile/app/(empresa)/cliente/[id]/anamnese.tsx'), 'utf8');
const perfil = readFileSync(join(root, 'mobile/app/(empresa)/cliente/[id].tsx'), 'utf8');

describe('mobile: anamnese no formato canônico', () => {
  it('tela usa shared/anamnese e não tem lista de perguntas própria', () => {
    expect(tela).toContain("from '@shared/anamnese'");
    expect(tela).not.toMatch(/const PERGUNTAS:/);
    expect(tela).toContain('TEXTO_DECLARACAO');
  });
  it('só salva com a declaração aceita, via upsert, conferindo linhas', () => {
    expect(tela).toMatch(/declaracao_aceita/);
    expect(tela).toContain("onConflict: 'empresa_id,cliente_id'");
    expect(tela).toContain(".select('id')");
    expect(tela).not.toMatch(/profissional_id:\s*null/);
  });
  it('perfil calcula o alerta com restricoesAnamnese (não compara === "Sim")', () => {
    expect(perfil).toContain('restricoesAnamnese');
    expect(perfil).not.toMatch(/===\s*'Sim'/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/mobile-anamnese-canonica.test.ts`
Expected: FAIL.

- [ ] **Step 3: Reescrever o estado e o salvar da tela**

Em `anamnese.tsx`, apague `const PERGUNTAS` e importe:

```ts
import {
  ANAMNESE_VAZIA, normalizarAnamnese, PERGUNTAS_SIM_NAO, PERGUNTAS_OPCOES,
  TEXTO_DECLARACAO, type AnamneseRespostas,
} from '@shared/anamnese';
```

Estado e carga (o `useEffect` fica **antes** de qualquer `return`, para respeitar a regra de hooks):

```ts
  const [respostas, setRespostas] = useState<AnamneseRespostas>(ANAMNESE_VAZIA);
  useEffect(() => {
    setRespostas(normalizarAnamnese(cliente?.anamnese?.respostas));
  }, [cliente?.anamnese]);
```

Salvar:

```ts
  async function salvar() {
    if (!empresaAtiva) return;
    if (!respostas.declaracao_aceita) {
      Alert.alert('Declaração', 'A cliente precisa aceitar a declaração antes de salvar.');
      return;
    }
    setSalvando(true);
    const { data: { user } } = await supabase.auth.getUser();
    const dados: AnamneseRespostas = { ...respostas, salvo_em: new Date().toISOString() };
    const { data, error } = await supabase.from('anamnese_fichas')
      .upsert({
        empresa_id: empresaAtiva.id, cliente_id: id, respostas: dados,
        profissional_id: user?.id ?? null, updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id,cliente_id' })
      .select('id');
    setSalvando(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    if (!data || data.length === 0) { Alert.alert('Erro', 'Sem permissão para salvar a ficha.'); return; }
    qc.invalidateQueries({ queryKey: ['cliente-detalhe', empresaAtiva.id, id] });
    Alert.alert('Ficha salva!', 'Anamnese atualizada com sucesso.', [{ text: 'OK', onPress: () => router.back() }]);
  }
```

- [ ] **Step 4: Renderizar o formulário**

Mantenha o header e o estilo de cartão já existentes. O corpo do formulário deve renderizar, nesta ordem:

(a) Para cada item de `PERGUNTAS_SIM_NAO`: o rótulo, dois chips "Sim"/"Não" e, quando `resposta === 'sim'`, um `TextInput` multiline com o `placeholder` da pergunta. Use o mesmo estilo de chips que hoje é usado para `tipo: 'opcoes'`. Ao escolher:

```ts
setRespostas(r => ({ ...r, [p.key]: { ...r[p.key], resposta: v } }))
```

(b) Para cada item de `PERGUNTAS_OPCOES`: o rótulo e chips de `p.opcoes`. Ao escolher:

```ts
setRespostas(r => ({ ...r, [p.key]: o.valor }))
```

(c) O campo "Informações adicionais", ligado a `respostas.info_adicionais`.

(d) Uma caixa de declaração com `TEXTO_DECLARACAO` e um toggle (TouchableOpacity com um quadrado marcado ou desmarcado) que alterna `declaracao_aceita`.

O botão Salvar fica com opacidade 0.5 e `disabled` quando `!respostas.declaracao_aceita || salvando`.

- [ ] **Step 5: Alerta no perfil**

Em `cliente/[id].tsx`:
- substitua o cálculo manual de restrições (linhas ~236-245, que comparava `=== 'Sim'`) por:
  ```ts
  const fichaAnamnese = normalizarAnamnese(cliente.anamnese?.respostas);
  const restricoes = restricoesAnamnese(fichaAnamnese);
  const temAnamnese = anamnesePreenchida(fichaAnamnese);
  ```
- use `restricoes` (`string[]`) no bloco de alerta (linhas ~469-496);
- na aba Anamnese (linhas ~635-654), a lista de respostas somente leitura passa a iterar `PERGUNTAS_SIM_NAO` e `PERGUNTAS_OPCOES`, igual ao modo leitura do web (Task 5, passo 3 da seção UI).

Adicione o import `normalizarAnamnese, restricoesAnamnese, anamnesePreenchida, PERGUNTAS_SIM_NAO, PERGUNTAS_OPCOES` de `@shared/anamnese`.

Em `mobile/types/index.ts`, o tipo `AnamneseFicha.respostas` passa a ser `unknown`.

- [ ] **Step 6: tsc, testes e commit**

Run: `cd mobile && npx tsc --noEmit` (continua com 9 erros, nenhum novo), `cd web && npx vitest run`

```bash
git add "mobile/app/(empresa)/cliente" mobile/types/index.ts web/tests/unit/mobile-anamnese-canonica.test.ts
git commit -m "feat(mobile): anamnese com formato canonico, declaracao obrigatoria e alerta de restricoes igual ao web"
```

---

### Task 7: Mobile — cadastro, edição e exibição da cliente no formato do web

**Files:**
- Modify: `mobile/app/(empresa)/novo-cliente.tsx`, `mobile/app/(empresa)/cliente/[id]/editar.tsx`, `mobile/app/(empresa)/cliente/[id].tsx` (idade ~227-229, aniversário ~458, endereço ~464, WhatsApp ~328), `mobile/app/(empresa)/novo-agendamento.tsx` (cadastro rápido ~259-279, input de telefone ~1116)
- Modify: `web/tests/unit/sem-area-cliente.test.ts` (troca o `it.todo` por `it`)
- Test: `web/tests/unit/mobile-cliente-cadastro.test.ts`

**Interfaces:**
- Consumes:
  - `maskPhone` e `toWhatsApp` de `@shared/mascaras`;
  - `montarAniversario`, `partesAniversario`, `idadeCliente`, `formatarAniversario`, `parseEndereco`, `serializarEndereco` e `EnderecoCliente` de `@shared/clientes` (Task 1);
  - tipo `Cliente` (Task 3).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/mobile-cliente-cadastro.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('mobile grava cliente em public.clientes no formato do web', () => {
  for (const arq of ['mobile/app/(empresa)/novo-cliente.tsx', 'mobile/app/(empresa)/novo-agendamento.tsx']) {
    it(`${arq}: insert em clientes, sem users/empresa_membros/randomUUID`, () => {
      const src = ler(arq);
      expect(src).toContain(".from('clientes').insert(");
      expect(src).not.toContain('crypto.randomUUID');
      expect(src).not.toMatch(/from\('users'\)\s*\.insert/);
      expect(src).toContain('maskPhone');
    });
  }
  it('novo-cliente usa aniversário dia/mês, endereço JSON e grava observacoes', () => {
    const src = ler('mobile/app/(empresa)/novo-cliente.tsx');
    expect(src).toContain('montarAniversario(');
    expect(src).toContain('serializarEndereco(');
    expect(src).toMatch(/observacoes:\s*obs/);
  });
  it('editar grava em clientes com .select e invalida a key certa', () => {
    const src = ler('mobile/app/(empresa)/cliente/[id]/editar.tsx');
    expect(src).toContain(".from('clientes').update(");
    expect(src).toContain(".select('id')");
    expect(src).not.toContain("['cliente-detalhe', undefined");
  });
  it('perfil usa idade/aniversário/endereço/WhatsApp do shared', () => {
    const src = ler('mobile/app/(empresa)/cliente/[id].tsx');
    for (const f of ['idadeCliente(', 'formatarAniversario(', 'parseEndereco(', 'toWhatsApp(']) expect(src).toContain(f);
  });
  it('após cadastrar, vai para a anamnese (igual ao web)', () => {
    expect(ler('mobile/app/(empresa)/novo-cliente.tsx')).toMatch(/cliente\/\$\{[^}]+\}\/anamnese/);
  });
});
```

Em `web/tests/unit/sem-area-cliente.test.ts`, troque o `it.todo(...)` pelo `it` completo:

```ts
  it("nenhum código do mobile grava empresa_membros com role 'cliente'", () => {
    for (const arq of ['mobile/app/(empresa)/novo-cliente.tsx', 'mobile/app/(empresa)/novo-agendamento.tsx', 'mobile/hooks/useClientes.ts']) {
      expect(ler(arq)).not.toMatch(/role['"]?\s*[:,=]\s*'cliente'/);
    }
  });
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/mobile-cliente-cadastro.test.ts tests/unit/sem-area-cliente.test.ts`
Expected: FAIL.

- [ ] **Step 3: `novo-cliente.tsx`**

1. Troque o campo de data completa DD/MM/AAAA por dois seletores de chips, "Mês" (1-12) e "Dia" (1-31), guardados em `nascMes`/`nascDia` como string. Um `ScrollView` horizontal de chips basta.
2. O endereço vira 4 campos (Logradouro, Número, Bairro, Complemento) num estado `endereco: EnderecoCliente`.
3. O telefone usa `onChangeText={(v) => setTelefone(maskPhone(v))}` e `maxLength={15}`.
4. A validação do nome passa a ser `nome.trim().length > 1`. Essa é a regra única também para o web, ajustada na fase Clientes.
5. Corrija `C.text2` (linha ~203) para `C.text3`.
6. Substitua todo o `salvar`, dos passos 1 e 2 (users e empresa_membros), por:

```ts
    setSalvando(true);
    const { data, error } = await supabase.from('clientes').insert({
      empresa_id:      empresaAtiva.id,
      nome:            nome.trim(),
      telefone:        telefone.trim() || null,
      email:           email.trim() || null,
      data_nascimento: montarAniversario(nascMes, nascDia),
      endereco:        serializarEndereco(endereco),
      observacoes:     obs.trim() || null,
    }).select('id, nome').single();
    setSalvando(false);
    if (error || !data) { Alert.alert('Erro', error?.message ?? 'Não foi possível cadastrar.'); return; }
    qc.invalidateQueries({ queryKey: ['clientes'] });
    qc.invalidateQueries({ queryKey: ['clientes-stats'] });
    router.replace(`/(empresa)/cliente/${data.id}/anamnese` as any);
```

`qc` vem de `useQueryClient()` e `observacoes` agora é observação interna em texto livre (Task 4 liberou o campo). A tela de sucesso intermediária sai: o web também vai direto para a anamnese.

- [ ] **Step 4: `cliente/[id]/editar.tsx`**

Mesmos campos do cadastro: nome, telefone com máscara, e-mail, aniversário mês/dia (pré-preenchido com `partesAniversario(cliente.data_nascimento)`), endereço em 4 campos (pré-preenchido com `parseEndereco(cliente.endereco)`) e observações internas. O salvar fica assim:

```ts
    const { data, error } = await supabase.from('clientes').update({
      nome: nome.trim(), telefone: telefone.trim() || null, email: email.trim() || null,
      data_nascimento: montarAniversario(nascMes, nascDia),
      endereco: serializarEndereco(endereco), observacoes: obs.trim() || null,
    }).eq('id', id).eq('empresa_id', empresaAtiva!.id).select('id');
    setSalvando(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    if (!data || data.length === 0) { Alert.alert('Erro', 'Sem permissão para editar esta cliente.'); return; }
    qc.invalidateQueries({ queryKey: ['cliente-detalhe', empresaAtiva!.id, id] });
    qc.invalidateQueries({ queryKey: ['clientes'] });
    router.back();
```

- [ ] **Step 5: Perfil `cliente/[id].tsx`**

- Idade: `const idade = idadeCliente(cliente.data_nascimento);` no lugar do cálculo local.
- Aniversário exibido: `formatarAniversario(cliente.data_nascimento)`.
- Endereço: `const end = parseEndereco(cliente.endereco);`, exibido como `[end.logradouro, end.numero].filter(Boolean).join(', ')`, com bairro e complemento em linhas abaixo, igual ao web.
- WhatsApp: `Linking.openURL(\`https://wa.me/${toWhatsApp(cliente.telefone ?? '')}\`)`.
- Se `cliente.observacoes` existir, mostre-a num bloco "Observações internas" na aba de dados.

- [ ] **Step 6: Cadastro rápido em `novo-agendamento.tsx`**

Substitua o insert em `users` + `empresa_membros` (linhas ~259-279) por:

```ts
      const { data: nova, error: errNova } = await supabase.from('clientes').insert({
        empresa_id: empresaAtiva!.id,
        nome: novoNome.trim(),
        telefone: novoTelefone.trim() || null,
      }).select('id, nome, telefone').single();
      if (errNova || !nova) { Alert.alert('Erro', errNova?.message ?? 'Não foi possível cadastrar a cliente.'); return; }
```

Use `nova` como a cliente selecionada, como já é feito hoje com o objeto de `users`. Os nomes exatos dos estados (`novoNome`, `novoTelefone`) seguem os que já existem no arquivo; ajuste se forem outros. No input de telefone do cadastro rápido (~1116), aplique `maskPhone` com `maxLength={15}`.

- [ ] **Step 7: tsc, testes e commit**

Run: `cd mobile && npx tsc --noEmit`. Espera-se **8 erros**: o de `novo-cliente.tsx(203)` sumiu e não pode haver nenhum novo. Depois rode `cd web && npx tsc --noEmit && npx vitest run`.

```bash
git add "mobile/app/(empresa)" web/tests/unit/mobile-cliente-cadastro.test.ts web/tests/unit/sem-area-cliente.test.ts
git commit -m "fix(mobile): cadastro/edicao de cliente em public.clientes no formato do web (aniversario, endereco, telefone)"
```

---

### Task 8: Navegação e sessão do app nativo

**Files:**
- Create: `mobile/app/index.tsx`
- Modify: `mobile/app/_layout.tsx`, `mobile/app/(empresa)/_layout.tsx`, `mobile/app/(profissional)/_layout.tsx`, `mobile/stores/authStore.ts`, `mobile/lib/notifications.ts`, `mobile/app/(empresa)/mais.tsx:93`, `mobile/app/(empresa)/dashboard.tsx:105`
- Test: `web/tests/unit/mobile-navegacao.test.ts`

**Interfaces:**
- Produces:
  - `authStore.carregarSessao(opts?: { manterEmpresaId?: string })`: preserva a empresa ativa quando ela ainda está disponível.
  - `authStore.semEmpresa: boolean`: verdadeiro quando o usuário está logado mas não tem nenhuma empresa. É consumido pela Task 9.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/mobile-navegacao.test.ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

/** Rotas de primeiro nível de um grupo (arquivos .tsx e pastas), sem _layout. */
function rotasDoGrupo(grupo: string): string[] {
  const dir = join(root, 'mobile/app', grupo);
  return readdirSync(dir)
    .filter(n => n !== '_layout.tsx')
    .map(n => (statSync(join(dir, n)).isDirectory() ? n : n.replace(/\.tsx$/, '')));
}

describe('navegação do app nativo', () => {
  for (const grupo of ['(empresa)', '(profissional)']) {
    it(`${grupo}: toda rota está declarada no Tabs (as que não são aba com href: null)`, () => {
      const layout = ler(`mobile/app/${grupo}/_layout.tsx`);
      for (const rota of rotasDoGrupo(grupo)) {
        // aceita name="rota" ou 'rota' dentro da lista mapeada para <Tabs.Screen>
        expect(layout, `rota ${rota} não declarada`).toMatch(new RegExp(`["']${rota.replace(/[[\]]/g, '\\$&')}["']`));
      }
    });
  }

  it('existe mobile/app/index.tsx', () => {
    expect(existsSync(join(root, 'mobile/app/index.tsx'))).toBe(true);
  });

  it('root layout só recarrega sessão em SIGNED_IN/INITIAL_SESSION (não em TOKEN_REFRESHED/USER_UPDATED)', () => {
    const src = ler('mobile/app/_layout.tsx');
    expect(src).toMatch(/event === 'SIGNED_IN'|\['SIGNED_IN'/);
    expect(src).toContain('INITIAL_SESSION');
  });

  it('papel desconhecido falha fechado (profissional), nunca gestor', () => {
    for (const arq of ['mobile/app/(empresa)/_layout.tsx', 'mobile/app/(empresa)/mais.tsx', 'mobile/app/(empresa)/dashboard.tsx']) {
      expect(ler(arq)).not.toMatch(/roleAtivo \?\? 'gestor'/);
    }
  });

  it('rotaParaNotificacao só aponta para rotas que existem', () => {
    const src = ler('mobile/lib/notifications.ts');
    expect(src).not.toContain('/(profissional)/financeiro');
    expect(src).not.toContain('${base}/notificacoes');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/mobile-navegacao.test.ts`
Expected: FAIL.

- [ ] **Step 3: Layouts de abas declaram todas as rotas**

Em `(empresa)/_layout.tsx`:
- troque `roleAtivo ?? 'gestor'` por `roleAtivo ?? 'profissional'`;
- depois das 5 abas visíveis, declare **cada** rota do grupo que não é aba com `href: null`. O teste acima pega qualquer rota esquecida.

```tsx
      {[
        'agendamento', 'cliente', 'comissoes', 'configuracoes', 'convidar-profissional',
        'editar-pacote', 'editar-produto', 'editar-servico', 'equipe', 'estoque',
        'notificacoes', 'nova-comanda', 'nova-despesa', 'nova-retirada', 'novo-agendamento',
        'novo-cliente', 'novo-pacote', 'novo-produto', 'novo-servico', 'pacotes',
        'relatorios', 'servicos',
      ].map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
```

Em `(profissional)/_layout.tsx`, depois das 6 abas, faça o mesmo:

```tsx
      <Tabs.Screen name="agendamento" options={{ href: null }} />
```

(Rode o teste. Se o grupo tiver outra rota solta, declare-a do mesmo jeito.)

Em `mais.tsx:93` e `dashboard.tsx:105`, troque `roleAtivo ?? 'gestor'` por `roleAtivo ?? 'profissional'`.

- [ ] **Step 4: `mobile/app/index.tsx`**

```tsx
import { View, ActivityIndicator } from 'react-native';

/**
 * Rota raiz: só mostra um loader. O redirecionamento para login, dashboard
 * ou criar-empresa é feito pelo _layout raiz assim que a sessão carrega —
 * sem este arquivo o expo-router abre "rota não encontrada" antes do redirect.
 */
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F1EE' }}>
      <ActivityIndicator color="#2C1654" />
    </View>
  );
}
```

- [ ] **Step 5: Sessão sem resetes indevidos**

Em `authStore.ts`:
- adicione `semEmpresa: false` ao estado inicial e ao `sair`;
- `carregarSessao` recebe `opts?: { manterEmpresaId?: string }`;
- o bloco "Seleciona a primeira empresa por padrão" passa a ser:

```ts
    const manter = opts?.manterEmpresaId
      ? disponíveis.find((d) => d.empresa.id === opts.manterEmpresaId)
      : undefined;
    const escolhida = manter ?? disponíveis[0];

    set({
      user: userProfile,
      empresasDisponiveis: disponíveis,
      empresaAtiva: escolhida?.empresa ?? null,
      roleAtivo: escolhida?.isOwner ? 'gestor' : (escolhida?.role ?? null),
      isOwner: escolhida?.isOwner ?? false,
      semEmpresa: disponíveis.length === 0,
    });
```

Atualize a interface `AuthStore` com `semEmpresa: boolean` e a nova assinatura.

Em `mobile/app/_layout.tsx`, troque o callback do `onAuthStateChange` por:

```ts
      async (event, session) => {
        if (!session) {
          router.replace('/(auth)/login');
        } else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          // TOKEN_REFRESHED (a cada ~1h) e USER_UPDATED (trocar senha) NÃO
          // recarregam: recarregar recriava `user`, disparava o redirect para a
          // rota inicial e desfazia a troca de empresa.
          await carregarSessao({ manterEmpresaId: useAuthStore.getState().empresaAtiva?.id });
        }
        SplashScreen.hideAsync();
      }
```

- [ ] **Step 6: Destinos de notificação válidos**

Em `mobile/lib/notifications.ts`, substitua `rotaParaNotificacao` por:

```ts
export function rotaParaNotificacao(tipo?: string, role?: string): string {
  const profissional = role === 'profissional';
  switch (tipo) {
    case 'agendamento':    return profissional ? '/(profissional)/agenda' : '/(empresa)/agenda';
    case 'comissao':       return profissional ? '/(profissional)/comissoes' : '/(empresa)/comissoes';
    case 'pagamento':      return profissional ? '/(profissional)/comissoes' : '/(empresa)/financeiro';
    case 'estoque_baixo':  return profissional ? '/(profissional)/inicio' : '/(empresa)/estoque';
    case 'cliente_sumido': return profissional ? '/(profissional)/inicio' : '/(empresa)/clientes';
    default:               return profissional ? '/(profissional)/inicio' : '/(empresa)/notificacoes';
  }
}
```

(A tela de Notificações da profissional entra na fase Papéis. Até lá, o destino dela é o Início, que existe.)

- [ ] **Step 7: tsc, testes e commit**

Run: `cd mobile && npx tsc --noEmit` (continua com 8 erros, nenhum novo), `cd web && npx vitest run`

```bash
git add mobile/app mobile/stores/authStore.ts mobile/lib/notifications.ts web/tests/unit/mobile-navegacao.test.ts
git commit -m "fix(mobile): rotas soltas viram abas escondidas, sessao nao reseta em refresh de token, papel desconhecido falha fechado"
```

---

### Task 9: Onboarding do app nativo (cadastro, verificar e-mail, criar empresa)

**Files:**
- Create: `mobile/app/(auth)/verificar-email.tsx`, `mobile/app/criar-empresa.tsx`
- Modify: `mobile/app/(auth)/register.tsx`, `mobile/app/(auth)/login.tsx` (mensagem de erro), `mobile/app/_layout.tsx` (redirect para criar-empresa)
- Reference (ler antes): `web/app/criar-empresa/page.tsx`, `web/app/cadastro/page.tsx`, `web/app/verificar-email/page.tsx`
- Test: `web/tests/unit/mobile-onboarding.test.ts`

**Interfaces:**
- Consumes: `authStore.semEmpresa` e `carregarSessao` (Task 8).

- [ ] **Step 1: Ler as referências do web**

Leia `web/app/criar-empresa/page.tsx` inteiro e anote:
- o nome da RPC (`criar_empresa_completo`) e os parâmetros exatos que ela recebe;
- os campos do formulário;
- as mensagens de erro.

Leia também `web/app/cadastro/page.tsx` e anote: campos, confirmação de senha, texto "Acesso mediante convite do administrador", tratamento de cadastro desativado e o `options` do `signUp` (`emailRedirectTo`, `data`). O mobile vai reproduzir **exatamente** esses campos, validações e textos.

- [ ] **Step 2: Escrever o teste que falha**

```ts
// web/tests/unit/mobile-onboarding.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('onboarding do app nativo igual ao web', () => {
  it('register não insere em users (o trigger handle_new_user já cria) e manda nome no metadata', () => {
    const src = ler('mobile/app/(auth)/register.tsx');
    expect(src).not.toMatch(/from\('users'\)\s*\.insert/);
    expect(src).toMatch(/options:\s*\{[\s\S]*data:\s*\{[\s\S]*nome/);
    expect(src).toContain('emailRedirectTo');
    expect(src).toMatch(/confirmar|confirmacao/i);
  });
  it('telas de verificar e-mail e criar empresa existem', () => {
    expect(existsSync(join(root, 'mobile/app/(auth)/verificar-email.tsx'))).toBe(true);
    expect(existsSync(join(root, 'mobile/app/criar-empresa.tsx'))).toBe(true);
  });
  it('criar-empresa usa a mesma RPC do web', () => {
    expect(ler('mobile/app/criar-empresa.tsx')).toContain("rpc('criar_empresa_completo'");
  });
  it('root layout manda quem não tem empresa para criar-empresa', () => {
    const src = ler('mobile/app/_layout.tsx');
    expect(src).toContain('semEmpresa');
    expect(src).toContain("'/criar-empresa'");
  });
  it('login mostra mensagem genérica (não o erro cru do Supabase)', () => {
    expect(ler('mobile/app/(auth)/login.tsx')).toContain('E-mail ou senha incorretos.');
  });
});
```

- [ ] **Step 3: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/mobile-onboarding.test.ts`
Expected: FAIL.

- [ ] **Step 4: `register.tsx`**

- Remova o `insert` em `users` (linhas ~126-128). O trigger `handle_new_user` (migration 016) já cria a linha.
- Adicione o campo "Confirmar senha", com a mesma validação do web: senhas iguais e o mesmo tamanho mínimo.
- Remova o campo telefone. O web não tem esse campo e ele era descartado.
- O `signUp` fica:

```ts
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password: senha,
      options: {
        data: { nome: nome.trim() },
        emailRedirectTo: `${process.env.EXPO_PUBLIC_API_URL}/auth/callback?next=/dashboard`,
      },
    });
    setCarregando(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    router.replace({ pathname: '/(auth)/verificar-email', params: { email: email.trim() } } as any);
```

- Copie do `web/app/cadastro/page.tsx` o texto de apoio e o tratamento de cadastro desativado, com o mesmo texto.

- [ ] **Step 5: `verificar-email.tsx`**

Tela com o mesmo texto de `web/app/verificar-email/page.tsx`, adaptado para RN: "Enviamos um link para {email}...". Ela tem um botão "Já confirmei, entrar", que leva a `router.replace('/(auth)/login')`, e um botão "Reenviar e-mail", que chama `supabase.auth.resend({ type: 'signup', email })` e mostra `Alert` de sucesso ou erro. Use o mesmo visual de `esqueci-senha.tsx`: componentes, cores e tipografia.

- [ ] **Step 6: `criar-empresa.tsx`**

Tela fora dos grupos (`mobile/app/criar-empresa.tsx`), no mesmo visual de `register.tsx`. Ela tem os mesmos campos e validações de `web/app/criar-empresa/page.tsx`, anotados no Step 1. O envio fica:

```ts
    const { error } = await supabase.rpc('criar_empresa_completo', { /* mesmos parâmetros do web */ });
    if (error) { setErro(error.message); setSalvando(false); return; }
    await useAuthStore.getState().carregarSessao();
    // o _layout raiz redireciona para o dashboard quando roleAtivo aparece
```

- [ ] **Step 7: Redirect no root layout**

No efeito "Redireciona quando o perfil carrega" de `mobile/app/_layout.tsx`, leia `semEmpresa` do store e redirecione antes do bloco de role:

```ts
  useEffect(() => {
    if (user && semEmpresa) { router.replace('/criar-empresa' as any); return; }
    if (user && roleAtivo) {
      const rota = rotaInicial(isOwner ? 'owner' : roleAtivo);
      router.replace(rota as any);
    }
  }, [user, roleAtivo, isOwner, semEmpresa]);
```

- [ ] **Step 8: Mensagem genérica no login**

Em `login.tsx:111`, troque `Alert.alert('Erro', error.message)` pela mensagem do web:

```ts
      Alert.alert('Erro', 'E-mail ou senha incorretos.');
```

- [ ] **Step 9: tsc, testes e commit**

Run: `cd mobile && npx tsc --noEmit` (continua com 8 erros, nenhum novo), `cd web && npx vitest run`

```bash
git add mobile/app web/tests/unit/mobile-onboarding.test.ts
git commit -m "feat(mobile): onboarding igual ao web — cadastro sem erro de perfil, verificar e-mail e criar empresa"
```

(Aceitar convite e redefinir senha continuam abrindo a página do web pelo link do e-mail, nas duas plataformas. É o mesmo fluxo que `esqueci-senha` já usa. O app só vai receber deep link quando for publicado.)

---

### Task 10: Verificação final da fase e registro

**Files:**
- Modify: `CLAUDE.md` (nova seção de auditoria), `docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md` (marcar P0 como entregue)

- [ ] **Step 1: Verificação completa**

Run:
```bash
cd web && npx tsc --noEmit && npx vitest run
cd ../mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: web com zero erros e todos os testes verdes; mobile com **8** erros.

- [ ] **Step 2: Varreduras de regressão**

```bash
grep -rn "users!agendamentos_cliente_id_fkey\|role', 'cliente'\|(cliente)/\|useCliente'" mobile web shared --include=*.ts --include=*.tsx | grep -v node_modules
```
Expected: nenhuma linha.

- [ ] **Step 3: Registrar no CLAUDE.md**

Adicione ao `CLAUDE.md`, na seção "HISTÓRICO DE AUDITORIAS", uma entrada "Sessão 2026-09-29 — Paridade Fase 1 (fundação)". Ela deve seguir o formato das sessões anteriores (tabela de critérios e bugs encontrados) e listar:
- a pendência de produção: aplicar a migration `080_anamnese_fichas_fonte_unica.sql` no SQL Editor;
- a consulta de conferência depois de aplicar:
  ```sql
  select count(*) from public.anamnese_fichas;          -- esperado: 9
  select count(*) from public.clientes where observacoes ~ '^\s*\{';  -- esperado: 0
  select policyname, cmd from pg_policies where tablename = 'anamnese_fichas';  -- ver/inserir/atualizar
  ```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md
git commit -m "docs: auditoria da fase 1 de paridade (fundacao)"
```
