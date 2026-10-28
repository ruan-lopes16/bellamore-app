# Paridade Configurações, Notificações e Papéis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Spec:** `docs/superpowers/specs/2026-10-28-paridade-configuracoes-notificacoes-design.md`. Leitura obrigatória para todas as tasks.

## Global Constraints
- **Idioma e importação:** tudo em português. O web nunca importa `mobile/`.
- **Testes e tipos:** vitest 100%, tsc do web com 0 erros, tsc do mobile com 8 erros (baseline).
- **Migrations:**
  - aplicadas à mão, idempotentes, com rollback e `notify pgrst, 'reload schema';`;
  - nunca executar nada contra o banco.
- **Commits e arquivos:**
  - preservar CRLF;
  - commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - nunca commitar `.superpowers/` nem `.env*`.
- **Dados e erros:**
  - datas em Brasília;
  - cargas paginadas e com erro conferido;
  - "—" quando há erro.
- **Textos exatos:**
  - "Ativar notificações"
  - "Notificações no celular"
  - "Alertas"
  - "Avisos"
  - "Não lidas"
  - "Trocar empresa"
  - "Enviamos um link de confirmação para o novo e-mail."
  - "Convite inválido ou expirado"
  - "Sem acesso"

---

### Task 1: Regras em shared
- **Files:** criar `shared/empresa-ativa.ts`, `shared/notificacoes.ts` e `shared/endereco.ts`; alterar `shared/permissoes.ts` (`permissaoDaRota`) e `shared/permissoes-consultas.ts` (RPC com falha devolve `null`); criar `shared/navegacao.ts` (`nextSeguro`). Testes unitários de cada um.
- **Requisitos:** os da spec, seções "Empresa ativa", "Notificações" (só a parte pura: `alertasCalculados`, `contagemSino`, `TIPOS_NOTIFICACAO`, `rotaDoAviso`), "Endereço" e "Papéis".
  - Para `alertasCalculados`, leia antes o web `web/app/(app)/notificacoes/page.tsx` (~110-267) e copie a regra de cada alerta.
  - `permissaoDaRota` reproduz o mapa dos layouts do web que chamam `exigirAcesso`.
  - **Atenção:** mudar `carregarMinhasPermissoes` para devolver `null` muda quem consome. Ajuste os consumidores nas duas plataformas (stores e provider) para mostrar erro com "Tentar de novo", sem liberar nada.
- **Commit:** `feat(shared): empresa ativa, notificacoes, endereco, rotas por permissao e next seguro`.

### Task 2: Migration 097 e consultas de notificação/push
- **Files:** `supabase/migrations/097_push_dispositivos_e_notificacoes.sql`, `shared/notificacoes-consultas.ts`, `shared/push-dispositivos.ts` (registrar e remover). Testes de texto e PGlite.
- **Requisitos:** spec, seção "Push" (tabela, RLS, backfill, UPDATE de `notificacoes`).
  - Antes de escrever, confira nas migrations 001, 005, 028, 069, 072, 076 e 077 as colunas reais de `notificacoes`, `users.push_token` e `web_push_subscriptions`.
- **Commit:** `feat(banco): dispositivos de push e marcar notificacao como lida (097)`.

### Task 3: Crons com push no app e resumo por permissão
- **Files:** `web/app/api/cron/lembretes/route.ts`, `web/app/api/cron/resumo-diario/route.ts`, e um `web/lib/push/expo.ts` novo (envio em lotes, apagando tokens inválidos). Teste com `fetch` falso.
- **Requisitos:**
  - spec, seção "Push" (crons, resumo por permissão);
  - sem a 097, usar `users.push_token` (caminho atual, só leitura);
  - nunca enviar para dispositivo de outra empresa.
- **Commit:** `feat(push): lembrete e resumo tambem no app nativo, resumo respeitando permissoes`.

### Task 4: Web — empresa ativa
- **Files:** `web/lib/auth/server-context.ts`, `web/app/api/empresa-ativa/route.ts` (novo), um helper cliente, as 17 telas com `.limit(1)` (lista na spec/inventário), `web/app/api/push/subscribe/route.ts` e o seletor na Sidebar/menu.
- **Requisitos:** spec, seção "Empresa ativa", com teste de varredura sem `.limit(1)` de empresa.
- **Commit:** `feat(web): empresa ativa escolhida e salva, usada em todas as telas`.

### Task 5: Web — Notificações, Configurações e login
- **Files:**
  - `web/app/(app)/notificacoes/page.tsx` e o sino da `Sidebar`;
  - `web/app/(app)/configuracoes/page.tsx` (trocar senha, taxas com `parseValorBR`, endereço por `shared/endereco.ts`);
  - `web/lib/auth/proxy-rules.ts`, `web/app/login/page.tsx`, `web/app/auth/callback/route.ts`, `web/app/criar-empresa/page.tsx`, cadastro e verificar-email.
- **Requisitos:** spec, seções "Notificações", "Configurações" (parte web) e "Login, convite e cadastro".
- **Commit:** `feat(web): notificacoes com alertas e avisos, troca de senha, taxas e fluxo de login corrigido`.

### Task 6: App — push, empresa ativa, notificações e guardas
- **Files:**
  - `mobile/lib/notifications.ts`, `mobile/app/_layout.tsx` (sem pedido automático);
  - `mobile/stores/authStore.ts` (empresa salva em AsyncStorage);
  - `mobile/app/(empresa)/_layout.tsx` (guarda por `permissaoDaRota`);
  - Notificações da empresa e da profissional (tela nova na área da profissional, que **é exceção à regra de 02/10**: vem do pedido do dono nesta fase, e o teste "área da profissional sem telas novas" ganha essa exceção explícita);
  - sino e badges;
  - seletor de empresa nos dois menus.
- **Requisitos:** spec, seções "Push" (app), "Empresa ativa" (app), "Notificações" e "Papéis".
- **Commit:** `feat(app): push pelo servidor, empresa salva, notificacoes com alertas e guardas de rota`.

### Task 7: App — Configurações
- **Files:** `mobile/app/(empresa)/configuracoes.tsx`, `mobile/app/(profissional)/configuracoes.tsx`; componentes em `mobile/components/configuracoes/`; tema escuro (provider de tema + paleta escura, aplicado nas telas com a paleta central do app).
- **Requisitos:** spec, seção "Configurações" (app):
  - logo;
  - CNPJ e CEP com busca;
  - endereço em campos;
  - segmento;
  - meta mensal;
  - trocar e-mail;
  - card de notificações com "Ativar";
  - preferências salvas na hora;
  - modo escuro.
- **Modo escuro:**
  - se a paleta do app for constante importada em todas as telas, crie um hook de tema e migre as telas principais (abas, Dashboard, Agenda, Comanda, Clientes, Configurações, Mais);
  - registre no relatório quais telas ficaram para depois;
  - não deixe nenhuma tela ilegível no escuro: as que ainda não foram migradas ficam sempre no claro.
- **Commit:** `feat(app): configuracoes completas e modo escuro`.

### Task 8: Teste cruzado
- **Files:** `web/tests/unit/paridade-configuracoes-cruzada.test.ts`.
- **Requisitos:** a varredura confere que:
  - os textos exatos aparecem nas duas plataformas;
  - as duas usam as funções de shared;
  - não sobra `.limit(1)` de empresa no web;
  - não sobra pedido automático de push no app;
  - Notificações tem as mesmas seções nas duas.
- **Commit:** `test(configuracoes): teste cruzado de paridade`.
