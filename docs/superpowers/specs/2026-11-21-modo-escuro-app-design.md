# Modo escuro em todo o app (C1) — design

**Data:** 2026-11-21 · **Branch:** `feat/modo-escuro-app` · **Sem migration.**

## Decisões do dono (2026-11-21)

1. **Separar a cor de fundo da cor de texto.** Hoje o mesmo tom de roxo e de verde serve de fundo de botão (com texto branco) e de cor de texto. No escuro, não há tom que funcione bem nos dois usos.
2. **Todas as telas entram no modo escuro, inclusive login, cadastro, verificar e-mail e criar empresa.** Antes de a pessoa escolher um modo, essas telas seguem o do aparelho, porque a escolha padrão é "Sistema".

## Paleta (`mobile/lib/tema.tsx`)

Entram chaves novas para texto e ícone sobre `surface`/`bg`:

| Chave | Claro | Escuro | Uso |
|---|---|---|---|
| `primary` | `#2C1654` | **`#6A45C8`** | fundo (botão, chip ativo) com texto branco |
| `primaryTexto` | `#2C1654` | `#B497F5` | texto e ícone roxos sobre `surface`/`bg` |
| `green` | `#0D7E5F` | **`#17795A`** | fundo com texto branco |
| `greenTexto` | `#0D7E5F` | `#3CC995` | texto e ícone verdes |
| `amberTexto` | `#B45309` | `#E9A23B` | texto e ícone âmbar |
| `redTexto` | `#C0392B` | `#F07A70` | texto e ícone vermelhos |

- No claro, as chaves `*Texto` repetem os valores de hoje, então nada muda no tema claro.
- `amber` e `red` continuam sendo de fundo. Os valores escuros finais saem do teste de contraste.

**Teste de contraste** em `shared/contraste.ts`, com a fórmula de luminância do WCAG e teste em `web/tests/unit/`. Para as duas paletas:
- texto branco sobre `primary`, `green`, `amber` e `red`: pelo menos 4,5:1;
- `*Texto`, `text` e `text2` sobre `surface` e sobre `bg`: pelo menos 4,5:1;
- `text3` sobre `surface`: pelo menos 3:1 (texto secundário grande).

A paleta escura de `mobile/lib/tema.tsx` é a fonte; o teste a lê, e a paleta pode ser exportada de `shared/` se for preciso.

## Telas e componentes

Toda tela de `mobile/app` segue o padrão que já existe:
- `export default comTemaDoUsuario(Tela)`;
- cores de `useTema().C`, sem paleta local;
- `BarraDeStatus`.

Os componentes de `mobile/components` passam a ler `useTema().C`.

**Regra de troca:**
- `C.primary`/`C.green` usados como **texto, ícone ou borda de destaque** viram `C.primaryTexto`/`C.greenTexto`;
- usados como **fundo** com texto branco, ficam como estão;
- âmbar e vermelho seguem a mesma regra.

**Estilos.** `StyleSheet.create` com cor fixa vira estilo calculado no render (`useMemo` com `C`) ou cor inline. O padrão está em `dashboard.tsx`.

**Cores escritas à mão.** Hex como `#FFFFFF`, `#FEF3E2`, `'#C9527F'` e `rgba(...)` viram a chave correspondente da paleta. O branco fica só quando é texto sobre fundo de cor.

**Gráficos e SVG:** usam as cores do tema.

**Telas já migradas (12):** passam só pela regra de troca de `primary`/`green`.

## Fora do escopo

- O web/PWA, que tem o próprio modo escuro, não muda.
- O esquema de cores dos ícones das categorias fixas (paleta curada própria).

## Testes

- Teste de contraste das duas paletas.
- Varredura (`web/tests/unit/modo-escuro-app.test.ts`):
  - toda tela de `mobile/app` (exceto `_layout` e reexportações) usa `comTemaDoUsuario(`;
  - nenhuma tela nem componente define paleta própria. Os padrões procurados são `const C = {` e `bg: '#F4F1EE'`, com uma lista de exceções justificadas.

**Verificação:** vitest 100%, tsc do mobile só com o erro pré-existente, tsc do web 0. Sem verificação visual, porque o app nativo não é executado aqui.

## Deploy

Exige um build nativo novo, que já estava pendente das fases anteriores. Não há mudança no web nem no banco.
