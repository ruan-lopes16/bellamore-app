# Paridade Clientes (web × app) — design

**Data:** 2026-10-22 · **Branch:** `feat/paridade-clientes` (um PR) · **Migration:** 095.

**Fontes:**
- inventário `docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md` (§ Clientes), conferido no código de 22/10 (main `a00aab9`);
- decisão de 29/09: "segmentação de clientes, juntar as regras do web e do mobile".

## Decisões do dono (2026-10-22)

1. **Segmentos únicos** nas duas plataformas. Uma cliente pode estar em mais de um segmento.

   | Segmento | Regra |
   |---|---|
   | VIP | total gasto ≥ R$ 2.000 **ou** ≥ 8 atendimentos |
   | Recorrente | ≥ 5 atendimentos e última visita há ≤ 45 dias |
   | Em risco | já veio e está há > 45 e ≤ 60 dias sem vir |
   | Sumida | já veio e está há > 60 dias sem vir |
   | Nova | cadastrada no mês corrente (Brasília) |
   | Nunca atendida | cadastrada há ≥ 30 dias e sem nenhum atendimento |
   | Retornos (filtro) | última visita nos últimos 30 dias |
   | Aniversariantes (filtro) | aniversário no mês corrente, ordenado por dia (29/02 → 28/02 em ano não bissexto) |

2. **Atendimento e total gasto.**
   - Atendimento = agendamento `concluido`, sessão de pacote incluída. Esta é a contagem de visitas.
   - Total gasto = a soma de três partes, sem contar a sessão de pacote (que vale 0):
     - `valorCobradoAtendimento` dos atendimentos concluídos;
     - extras de comanda (`valor_unit × quantidade − desconto_rateado`);
     - vendas avulsas (`valor_final`).
   - É a mesma regra da receita do Financeiro.
   - Última visita = o maior `data_hora_inicio` entre os concluídos.

## Defaults adotados (o dono aprovou seguir; revisar na spec)

- **Arquivadas:**
  - as duas listas ganham o filtro "Arquivadas";
  - o perfil de uma arquivada mostra "Reativar", com a mesma permissão de arquivar (`clientes.arquivar` + `clientes.editar`);
  - arquivadas ficam fora dos outros filtros e dos segmentos.
- **Fotos:** a aba "Fotos" do app é um placeholder sem função. Ela sai, já que nenhuma plataforma tem fotos. Fotos seria uma feature nova, fora desta fase.
- **Empresa ativa no web (`.limit(1)`):** fica fora desta fase. Ela atravessa todas as telas e será uma fase própria. Fica registrada.

## Arquitetura

### `shared/clientes-segmentos.ts` (novo)

| Função | Faz |
|---|---|
| `agregarClientes(clientes, atendimentos, extras, vendas, hojeChave)` | Devolve um `Map<clienteId, { atendimentos, totalGasto, ultimaVisita, servicoFavorito }>` |
| `segmentosDaCliente(cliente, agregado, hojeChave)` | Devolve um `Set` com `'vip' \| 'recorrente' \| 'em_risco' \| 'sumida' \| 'nova' \| 'nunca_atendida'` |
| `contarSegmentos(...)` | Contagem por segmento, para os cartões |
| `filtrarClientes(lista, filtro, busca)` | Os filtros são `todas \| novas \| aniversariantes \| retornos \| arquivadas \| <segmento>`. A busca é por nome, telefone (só os dígitos) e e-mail |
| `aniversariantesDoMes(lista, hojeChave)` | Aniversariantes do mês, ordenados por dia |
| `servicoFavorito(atendimentos)` | O serviço mais frequente. Empate fica com o mais recente |

- As constantes de segmento são exportadas (`VIP_GASTO = 2000`, `VIP_ATENDIMENTOS = 8`, `DIAS_EM_RISCO = 45`, `DIAS_SUMIDA = 60`, `DIAS_RETORNO = 30`, `DIAS_NUNCA_ATENDIDA = 30`, `RECORRENTE_ATENDIMENTOS = 5`).
- `shared/dashboard.ts`/`kpis-financeiros.ts` (`DIAS_RECONQUISTA`, `clientesSumidas`) passam a importar essas mesmas constantes. Os números do Dashboard não mudam.
- Datas sempre em Brasília (`shared/periodos.ts`).

### `shared/clientes-consultas.ts` (novo)

- `carregarBaseClientes(db, empresaId)` busca clientes (ativas e arquivadas), atendimentos concluídos, extras de comanda com cliente e vendas com cliente. Tudo paginado por `@shared/paginacao` com desempate por id, para nunca cortar em 1000. Os erros são conferidos.
- `carregarHistoricoCliente(db, empresaId, clienteId)` é a fonte única do perfil:
  - atendimentos com serviços;
  - extras;
  - vendas avulsas com itens;
  - taxas de reserva e de cancelamento com `metodo`;
  - KPIs: atendimentos, total gasto, última visita e serviço favorito.
- `reativarCliente(db, empresaId, id)` e `arquivarCliente(...)` gravam com `.select('id')` e conferem as linhas afetadas.

### Migration 095 (`095_clientes_endereco.sql`)

- `alter table public.clientes add column if not exists endereco text;`. A coluna já existe em produção sem migration (verificado em 22/10); a migration só a versiona.
- Inclui comentário, rollback (não remove: é dado) e `notify`.
- Sem RLS nova.
- Corrigir o comentário errado em `shared/clientes.ts` ("desde a 006").

## Telas

### Lista (web e app)

- Mesmos filtros nas duas: Todas, Novas, Aniversariantes, Retornos, cada segmento e Arquivadas.
- Mesmos cartões de KPI: Total, Novas no mês, VIP, Em risco, Sumidas e Nunca atendidas. **Os cartões são clicáveis** e aplicam o filtro correspondente.
- Cada linha mostra:
  - nome e telefone;
  - as tags dos segmentos (VIP, Recorrente, Em risco, Sumida, Nova);
  - total gasto e última visita, com `Secret` onde o web já esconde valores.
- Busca por nome, telefone ou e-mail, com o placeholder dizendo isso.
- **Web:** os segmentos deixam de ser uma aba separada e viram filtros/cartões. Some o `.limit(5000)`.
- **App:**
  - a busca filtra no cliente, sem refazer as consultas a cada tecla (sai o `queryKey` com `busca`);
  - `useClientesStats` sai, e os cartões usam `contarSegmentos`.

### Perfil (web e app)

- 4 KPIs nas duas: Atendimentos, Total gasto, Última visita e Serviço favorito.
- Histórico nas duas, numa lista única por data:
  - atendimentos;
  - extras de comanda;
  - vendas avulsas, com os itens;
  - taxas de reserva e de cancelamento, com a forma de pagamento (`labelMetodo`).
- O alerta de restrições da anamnese continua nas duas (o web mantém o card lateral).
- Contatos por `contatosCliente`, que sai de `shared/agenda.ts` para `shared/clientes.ts`, com reexport para não quebrar a agenda. `tel:` usa só os dígitos.
- Arquivar/Reativar nas duas.
- App:
  - a aba "Fotos" sai;
  - na edição, o rótulo do telefone ganha "*" (obrigatório desde o PR #154).
- O web cadastra com endereço no modal (hoje o endereço só aparece na edição).

## Erros e testes

- **Erros:** o erro de carga mostra "—" e um aviso, nunca zero nem lista vazia. Toda gravação usa `.select('id')`.
- **Unitários de `shared/clientes-segmentos.ts`:** cada segmento nos limites (45/46, 60/61, 8 atendimentos, R$ 1.999,99/2.000), cliente em vários segmentos, arquivada fora dos segmentos, sessão de pacote conta visita mas não gasto, aniversário 29/02, favorito com empate.
- **Consultas:** paginação acima de 1000 linhas e erro conferido.
- **Varredura cruzada:** as duas listas e os dois perfis usam as funções de shared. Não sobra regra local de VIP ou Sumida, `.limit(5000)` nem aba Fotos.
- **Verificação:** vitest 100%, `tsc` web 0, `tsc` mobile 8 (baseline), `next build` OK.

## Fora do escopo

- Empresa ativa no web.
- Fotos da cliente.
- Tags manuais (as tags são só os segmentos calculados).
- Mesclar clientes duplicadas.
