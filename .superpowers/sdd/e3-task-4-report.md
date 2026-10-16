# E3 Task 4 (app) - relatorio

- Banner da convidada: `mobile/components/BannerConvites.tsx`, flutuante (absolute) nos layouts (empresa), (profissional) e em criar-empresa. Aceitar: `aceitarConvite` -> `carregarSessao({ manterEmpresaId })` -> `invalidateQueries()` -> `router.replace(rotaInicial)`. Recusar: `recusarConvite`. Trava de duplo toque, erros em portugues.
- Equipe: `mobile/components/EquipeConvites.tsx` (Convites pendentes com Alert de confirmacao; Historico paginado com Mostrar mais), so com `equipe.gerenciar` ou dona. Somem sem a 092 (`[]` / `disponivel: false`).
- `convidar-profissional`: `convite_pendente` com o texto da spec ("Convite enviado. Ela precisa aceitar no app ou no site."; difere do texto do pedido, conforme instrucao usou-se o da spec); 403/409 mostram `resultado.error`; 503 sem corpo cai em mensagem da 092; texto "Como funciona" corrigido; invalida convites-pendentes e equipe-historico.
- Cancelar usa `cancelarConvite` (RPC direta), sem passar pela rota DELETE.
- Nenhum insert/upsert em empresa_membros.
- Teste: `web/tests/unit/convites-telas-app.test.ts`.
