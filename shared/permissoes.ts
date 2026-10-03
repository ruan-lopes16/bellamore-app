/**
 * Permissões configuráveis por papel e por pessoa
 * (spec docs/superpowers/specs/2026-10-02-permissoes-configuraveis-design.md).
 *
 * Fonte única do catálogo. A migration 083 repete as chaves (`permissoes_chaves()`) e os
 * padrões (`permissao_padrao()`) em SQL — o teste `permissoes-migration.test.ts` trava as
 * duas listas iguais. Ao criar uma chave: catálogo aqui + migration nova com as duas funções.
 *
 * Padrões = comportamento de antes desta feature (nada muda no deploy).
 */

export type Papel = 'gestor' | 'profissional';

export const GRUPOS_PERMISSAO = [
  'Agenda', 'Clientes', 'Comanda', 'Vendas', 'Serviços e pacotes',
  'Estoque', 'Financeiro', 'Equipe e comissões', 'Configurações',
] as const;
export type GrupoPermissao = (typeof GRUPOS_PERMISSAO)[number];

type DefPermissao = {
  chave: string;
  grupo: GrupoPermissao;
  rotulo: string;
  descricao: string;
  padrao: Record<Papel, boolean>;
};

const SIM_NAO = { gestor: true, profissional: false } as const;
const SIM_SIM = { gestor: true, profissional: true } as const;

export const CATALOGO_PERMISSOES = [
  { chave: 'agenda.ver_equipe', grupo: 'Agenda', rotulo: 'Ver agenda de toda a equipe', descricao: 'Desligado: vê só a própria agenda.', padrao: SIM_NAO },
  { chave: 'agenda.gerenciar_outras', grupo: 'Agenda', rotulo: 'Criar e editar agendamentos de outras profissionais', descricao: 'A própria agenda é sempre liberada.', padrao: SIM_NAO },
  { chave: 'agenda.excluir', grupo: 'Agenda', rotulo: 'Excluir agendamento', descricao: 'Atendimento concluído nunca pode ser excluído.', padrao: SIM_NAO },
  { chave: 'agenda.aprovar_bloqueios', grupo: 'Agenda', rotulo: 'Aprovar bloqueios e bloquear a agenda geral', descricao: 'Sem isso, o bloqueio da própria agenda fica pendente de aprovação.', padrao: SIM_NAO },
  { chave: 'clientes.ver_todas', grupo: 'Clientes', rotulo: 'Ver todas as clientes', descricao: 'Desligado: vê só as clientes que atendeu ou cadastrou.', padrao: SIM_SIM },
  { chave: 'clientes.cadastrar', grupo: 'Clientes', rotulo: 'Cadastrar cliente', descricao: 'Inclui o cadastro rápido dentro do agendamento.', padrao: SIM_SIM },
  { chave: 'clientes.editar', grupo: 'Clientes', rotulo: 'Editar cliente', descricao: 'Nome, contato, aniversário, endereço e observações.', padrao: SIM_SIM },
  { chave: 'clientes.arquivar', grupo: 'Clientes', rotulo: 'Arquivar e reativar cliente', descricao: 'A cliente some das listas, mas o histórico é mantido.', padrao: SIM_NAO },
  { chave: 'clientes.excluir', grupo: 'Clientes', rotulo: 'Excluir cliente para sempre', descricao: 'Só funciona para cliente sem nenhum histórico.', padrao: { gestor: false, profissional: false } },
  { chave: 'anamnese.ver', grupo: 'Clientes', rotulo: 'Ver ficha de anamnese', descricao: 'Dados de saúde da cliente.', padrao: SIM_SIM },
  { chave: 'anamnese.editar', grupo: 'Clientes', rotulo: 'Preencher e editar ficha de anamnese', descricao: 'Dados de saúde da cliente.', padrao: SIM_SIM },
  { chave: 'comanda.fechar', grupo: 'Comanda', rotulo: 'Fechar comanda', descricao: 'Profissional fecha só as comandas dos próprios atendimentos.', padrao: SIM_SIM },
  { chave: 'comanda.desconto', grupo: 'Comanda', rotulo: 'Dar desconto e cortesia', descricao: 'Campo de desconto e forma de pagamento "Cortesia".', padrao: SIM_SIM },
  { chave: 'comanda.editar_fechada', grupo: 'Comanda', rotulo: 'Editar comanda já fechada', descricao: 'Profissional edita só as comandas dos próprios atendimentos.', padrao: SIM_SIM },
  { chave: 'vendas.acessar', grupo: 'Vendas', rotulo: 'Registrar e ver vendas avulsas', descricao: 'Tela Vendas.', padrao: SIM_NAO },
  { chave: 'servicos.gerenciar', grupo: 'Serviços e pacotes', rotulo: 'Criar e editar serviços e categorias', descricao: 'Ver a lista de serviços é sempre liberado.', padrao: SIM_NAO },
  { chave: 'pacotes.gerenciar', grupo: 'Serviços e pacotes', rotulo: 'Criar e editar o catálogo de pacotes', descricao: 'Ver os pacotes é sempre liberado.', padrao: SIM_NAO },
  { chave: 'pacotes.vender', grupo: 'Serviços e pacotes', rotulo: 'Vender pacote para cliente', descricao: 'Na tela Pacotes, na agenda e na comanda.', padrao: SIM_SIM },
  { chave: 'estoque.acessar', grupo: 'Estoque', rotulo: 'Ver e movimentar estoque', descricao: 'A baixa automática de insumos na comanda continua para todos.', padrao: SIM_NAO },
  { chave: 'financeiro.ver', grupo: 'Financeiro', rotulo: 'Ver Financeiro, Relatórios e números da empresa', descricao: 'Inclui os cartões financeiros do Dashboard.', padrao: SIM_NAO },
  { chave: 'despesas.gerenciar', grupo: 'Financeiro', rotulo: 'Lançar, editar e pagar despesas', descricao: 'Excluir despesa continua só com a dona.', padrao: SIM_NAO },
  { chave: 'taxas.marcar_pagas', grupo: 'Financeiro', rotulo: 'Marcar taxas de reserva e cancelamento como pagas', descricao: '', padrao: SIM_NAO },
  { chave: 'financeiro.fechamentos', grupo: 'Financeiro', rotulo: 'Importar fechamentos mensais', descricao: '', padrao: SIM_NAO },
  { chave: 'equipe.gerenciar', grupo: 'Equipe e comissões', rotulo: 'Convidar, editar e desativar pessoas da equipe', descricao: 'Promover alguém a gestora é sempre só da dona.', padrao: SIM_NAO },
  { chave: 'comissoes.ver_todas', grupo: 'Equipe e comissões', rotulo: 'Ver comissões de todas', descricao: 'A própria comissão é sempre liberada.', padrao: SIM_NAO },
  { chave: 'comissoes.pagar', grupo: 'Equipe e comissões', rotulo: 'Pagar comissões', descricao: '', padrao: SIM_NAO },
  { chave: 'config.taxas', grupo: 'Configurações', rotulo: 'Editar taxas de reserva e cancelamento', descricao: 'Os demais dados da empresa são só da dona.', padrao: SIM_NAO },
] as const satisfies readonly DefPermissao[];

export type ChavePermissao = (typeof CATALOGO_PERMISSOES)[number]['chave'];
export const CHAVES_PERMISSAO: readonly ChavePermissao[] = CATALOGO_PERMISSOES.map(p => p.chave);

const POR_CHAVE = new Map<string, (typeof CATALOGO_PERMISSOES)[number]>(CATALOGO_PERMISSOES.map(p => [p.chave, p]));

export function ehChavePermissao(x: string): x is ChavePermissao {
  return POR_CHAVE.has(x);
}

export type LinhasPermissao = Partial<Record<ChavePermissao, boolean>>;

/** Permissões efetivas de quem está logado, prontas para a tela (serializáveis). */
export type PermissoesUsuario = { isOwner: boolean; papel: Papel | null; chaves: readonly ChavePermissao[] };

/** `'dona'` = coisas fixas da dona, fora do catálogo (dados da empresa, retiradas, mudar papel). */
export type Acesso = ChavePermissao | 'dona';

/** Decide se a pessoa logada pode fazer `a`. A dona sempre pode. */
export function pode(u: PermissoesUsuario, a: Acesso): boolean {
  if (u.isOwner) return true;
  if (a === 'dona') return false;
  return u.chaves.includes(a);
}

/** Chaves ligadas por padrão para o papel (comportamento de antes da feature). */
export function permissoesPadrao(papel: Papel | null): ChavePermissao[] {
  if (!papel) return [];
  return CATALOGO_PERMISSOES.filter(p => p.padrao[papel]).map(p => p.chave);
}

/**
 * Mesma ordem da função SQL `tem_permissao`: dona → exceção da pessoa → papel → padrão.
 * Usada pelas rotas de API (service role, sem auth.uid()) e pelos testes.
 */
export function resolverPermissao(
  s: { isOwner: boolean; papel: Papel | null; papelLinhas: LinhasPermissao; membroLinhas: LinhasPermissao },
  chave: ChavePermissao,
): boolean {
  if (s.isOwner) return true;
  if (!s.papel) return false;
  const membro = s.membroLinhas[chave];
  if (membro !== undefined) return membro;
  const papel = s.papelLinhas[chave];
  if (papel !== undefined) return papel;
  return POR_CHAVE.get(chave)!.padrao[s.papel];
}

// ── Estado do painel de Configurações ───────────────────────────

/** Linhas gravadas em `permissoes_papel` e `permissoes_membro` (sem os padrões). */
export type ConfigPermissoes = { papel: Record<Papel, LinhasPermissao>; membros: Record<string, LinhasPermissao> };

export function configVazia(): ConfigPermissoes {
  return { papel: { gestor: {}, profissional: {} }, membros: {} };
}

/** Valor efetivo de uma chave para um papel (linha gravada ou padrão). */
export function valorDoPapel(cfg: ConfigPermissoes, papel: Papel, chave: ChavePermissao): boolean {
  return cfg.papel[papel][chave] ?? POR_CHAVE.get(chave)!.padrao[papel];
}

export type EstadoExcecao = 'padrao' | 'permitir' | 'bloquear';

export function estadoDoMembro(cfg: ConfigPermissoes, userId: string, chave: ChavePermissao): EstadoExcecao {
  const v = cfg.membros[userId]?.[chave];
  return v === undefined ? 'padrao' : v ? 'permitir' : 'bloquear';
}

export function contarExcecoes(cfg: ConfigPermissoes, userId: string): number {
  return Object.keys(cfg.membros[userId] ?? {}).length;
}

/** Uma alteração pendente. Para membro, `permitido: null` = voltar ao padrão do papel. */
export type MudancaPermissao =
  | { tipo: 'papel'; alvo: Papel; chave: ChavePermissao; permitido: boolean }
  | { tipo: 'membro'; alvo: string; chave: ChavePermissao; permitido: boolean | null };

/** Identidade de uma mudança no rascunho (a última para o mesmo alvo+chave vence). */
export function chaveMudanca(m: MudancaPermissao): string {
  return `${m.tipo}:${m.alvo}:${m.chave}`;
}

/** Aplica o rascunho sobre a config gravada, sem mutar o original (para pré-visualizar). */
export function aplicarMudancas(cfg: ConfigPermissoes, mudancas: readonly MudancaPermissao[]): ConfigPermissoes {
  const novo: ConfigPermissoes = {
    papel: { gestor: { ...cfg.papel.gestor }, profissional: { ...cfg.papel.profissional } },
    membros: Object.fromEntries(Object.entries(cfg.membros).map(([k, v]) => [k, { ...v }])),
  };
  for (const m of mudancas) {
    if (m.tipo === 'papel') {
      novo.papel[m.alvo][m.chave] = m.permitido;
    } else {
      const linhas = (novo.membros[m.alvo] ??= {});
      if (m.permitido === null) delete linhas[m.chave];
      else linhas[m.chave] = m.permitido;
    }
  }
  return novo;
}

// ── Quem pode editar o quê (espelha a função SQL salvar_permissoes) ──

export type EditorPermissoes = { isOwner: boolean; papel: Papel | null; userId: string };
export type AlvoPermissao = { tipo: 'papel'; papel: Papel } | { tipo: 'membro'; userId: string; papel: Papel | 'owner' };

/**
 * Dona: qualquer papel e qualquer membro que não seja dona.
 * Gestora: só o papel `profissional` e membros `profissional` que não sejam ela mesma.
 */
export function podeEditarAlvo(editor: EditorPermissoes, alvo: AlvoPermissao): boolean {
  if (alvo.tipo === 'membro' && alvo.papel === 'owner') return false;
  if (editor.isOwner) return true;
  if (editor.papel !== 'gestor') return false;
  if (alvo.tipo === 'papel') return alvo.papel === 'profissional';
  return alvo.papel === 'profissional' && alvo.userId !== editor.userId;
}

// ── Histórico ───────────────────────────────────────────────────

export type LinhaHistorico = {
  id: string;
  criado_em: string;
  alterado_por: string | null;
  alvo_tipo: 'papel' | 'membro';
  alvo: string;
  chave: string;
  de: boolean | null;
  para: boolean | null;
};

const ROTULO_PAPEL: Record<Papel, string> = { gestor: 'Gestora', profissional: 'Profissional' };
const simbolo = (v: boolean | null) => (v === null ? 'padrão' : v ? '✔' : '✘');
const dois = (n: number) => String(n).padStart(2, '0');

/**
 * "02/10 14:30 · Carla · Profissional · Excluir agendamento: ✘ → ✔".
 * Horário de Brasília (UTC−3 fixo, mesma regra de shared/periodos) sem Intl — o Hermes do
 * app não tem locale pt-BR completo.
 */
export function descreverHistorico(l: LinhaHistorico, nomes: Record<string, string>): string {
  const d = new Date(Date.parse(l.criado_em) - 3 * 3600_000);
  const quando = `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)} ${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}`;
  const autor = (l.alterado_por && nomes[l.alterado_por]) || 'Alguém';
  const alvo = l.alvo_tipo === 'papel' ? (ROTULO_PAPEL[l.alvo as Papel] ?? l.alvo) : (nomes[l.alvo] ?? 'Membro removido');
  const rotulo = POR_CHAVE.get(l.chave)?.rotulo ?? l.chave;
  return `${quando} · ${autor} · ${alvo} · ${rotulo}: ${simbolo(l.de)} → ${simbolo(l.para)}`;
}
