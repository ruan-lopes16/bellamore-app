# Paridade Equipe (web × app) + revisão das permissões

**Data:** 2026-10-14 · Branch `feat/paridade-equipe` (sobre o hotfix da comanda, PR #150).
Inventário: `docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md`, bloco "Equipe / Comissões".

## Decisões do dono (2026-10-14)

1. **Faturado no mês** da profissional = atendimentos concluídos **sem pacote** (`pacote_cliente_id is null`, `valor`)
   + serviços extras da comanda (`receitaExtrasPorProfissional`), igual ao Financeiro. Pacote (não combo) é cobrado
   uma vez na venda; as sessões seguintes são cortesia. **Atendimentos no mês** continua contando todos os concluídos.
2. **Trocar o e-mail** de uma profissional troca também o login (Supabase Auth). E-mail já usado por outra conta →
   erro "Este e-mail já é usado por outra conta." e nada é salvo.
3. Revisar as permissões: "a tela deixa e o banco recusa" (ou o contrário) não pode existir em nenhuma das 27 chaves.

## Situação hoje

- `POST /api/profissionais` e `POST /api/convites` gravam `percentual_comissao: percentual_comissao ?? 0` no upsert do
  vínculo: reenviar convite para quem já está na equipe **zera a comissão**. Nenhum dos dois grava `tipo_contrato`.
- `PATCH /api/profissionais`: só aceita cookie (o app não consegue chamar); escolhe a empresa com `limit(1)` entre as
  empresas de quem chama; `tipo_contrato` vira `null` quando não vem; troca `users.email` mas não o login.
- App: o lápis da Equipe abre `/(empresa)/editar-profissional/[id]`, rota que não existe; cadastro sem comissão e sem
  tipo de contrato; lista sem a dona; sem "Pagar"; troca de papel sem conferir linhas afetadas; consulta de
  agendamentos sem conferir erro e sem paginação.
- Web: troca de papel sem conferir linhas afetadas; faturado soma sessões de pacote; cadastro sem tipo de contrato.

## Solução

### 1. API (`web/app/api/profissionais/route.ts`, `web/app/api/convites/route.ts`)
- Autenticação comum (`quemChama(req)`): Bearer (app) ou cookie (web) → `userId`; erro → 401.
- **POST (os dois):** aceitam `tipo_contrato` (`'pj' | 'clt' | null`). Vínculo **novo**: grava comissão
  (`percentual_comissao` válido 0–100, senão 0) e contrato. Vínculo **existente**: só sobrescreve comissão/contrato se
  vierem no corpo (`!== undefined`); reativa (`ativo: true`); nunca muda o papel. Resposta inclui `tipo_contrato`.
- **PATCH:** exige `empresaId` no corpo (o app e o web mandam a empresa ativa) e confere que quem chama é membro ativo
  dessa empresa com `equipe.gerenciar` e `podeGerenciarMembro`. Campos opcionais: só muda o que vier
  (`tipo_contrato` incluído). E-mail: se diferente do atual, `auth.admin.updateUserById(userId, { email, email_confirm: true })`
  antes de gravar em `users`; erro de duplicado → 409 com a mensagem da decisão 2. Comissão 0–100.
- Regra pura dos campos em `shared/equipe.ts` (`validarDadosProfissional`, `montarPatchVinculo`) para testar sem rede.

### 2. `shared/equipe.ts` e `shared/equipe-consultas.ts`
- `type MembroEquipe` (vínculo + `user` + `total_mes`, `atendimentos_mes`, `comissao_pendente`,
  `comissao_pendente_anterior`, `ids_pendentes_mes`).
- `carregarEquipe(db, empresaId, mesChave)`: membros da empresa com papel owner/gestor/profissional (ativos primeiro,
  depois por `created_at`), agendamentos concluídos do mês (Brasília, paginado, erro conferido), extras do mês,
  comissões pendentes (`carregarComissoesPendentes` + `pendentesPorProfissional`). Faturado pela decisão 1.
- `alterarAtivo(db, empresaId, membroId, ativo)` e `alterarPapel(db, empresaId, membroId, papel)`: UPDATE com
  `.eq('empresa_id')`, `.select('id')`, 0 linhas → erro de permissão em português.
- `chamarApiEquipe` **não** vai para shared (cada plataforma faz o `fetch` com seu cabeçalho).

### 3. Web — `web/app/(app)/equipe/page.tsx`
- Usa `carregarEquipe`/`alterarAtivo`/`alterarPapel`; cadastro com tipo de contrato; PATCH com `empresaId`; mensagens
  da API mostradas; faturado novo.

### 4. App
- `mobile/app/(empresa)/equipe.tsx`: mesma lista do web (dona inclusa, selo de exceções, papel, contrato, faturado,
  atendimentos, comissão pendente do mês e de meses anteriores), **Pagar** (pendentes do mês, `pagarComissoes`, sem
  otimismo), desativar com confirmação, reativar, trocar papel (`podeAtribuirRole`), exportação inalterada.
- Nova `mobile/app/(empresa)/editar-profissional/[id].tsx`: nome, telefone (máscara), e-mail, comissão, tipo de
  contrato → `PATCH /api/profissionais` com Bearer e `empresaId`; registrada no `_layout`.
- `convidar-profissional.tsx`: comissão e tipo de contrato (mesmos campos e validação do web).
- Gate de tela: `equipe.gerenciar` (sem permissão → aviso, igual às outras telas do app).
- Pagar/ativar/papel invalidam `['equipe']`, `['profissionais']` e `invalidarFinanceiro`.

### 5. Revisão das permissões (27 chaves × web/PWA × app)
- Para cada chave de `shared/permissoes.ts`: listar onde a **tela** usa (`pode('…')`) e onde o **banco** usa
  (`tem_permissao(…, '…')` nas policies/funções), e o que a profissional faz sem a chave.
- Divergências a corrigir: tela libera e banco recusa (como a comanda); banco libera e tela esconde; gravação com
  RETURNING em tabela cuja leitura é mais restrita que a escrita; `update/delete` sem `.select()` (sucesso falso).
- Resultado documentado em `docs/superpowers/notes/2026-10-14-matriz-permissoes.md` e travado por teste de varredura.
- Correções de banco, se houver, numa migration `089` (idempotente, sem `security definer` novo sem motivo).

## Fora do escopo
- Telas novas na área `(profissional)` do app (decisão de 2026-10-02).
- Reenvio de convite por e-mail sem SMTP próprio (decisão de 2026-09-24).

## Testes
- `shared/equipe.ts`: validação de comissão/contrato/e-mail, patch só com o que veio, faturado sem pacote.
- `shared/equipe-consultas.ts` com `fakeDb`: mês em Brasília, paginação, erro conferido, pendentes, update com 0 linhas.
- API: testes de função pura (corpo → patch); o restante por varredura.
- Telas por varredura (web e app usam as funções de shared; rota de edição existe; Pagar no app).
- Matriz de permissões: teste que lê as policies e as telas.

## Produção
Sem migration, salvo se a revisão de permissões exigir a 089 (o PR dirá).
