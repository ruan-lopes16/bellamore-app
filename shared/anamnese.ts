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

// Factory privada para evitar structuredClone que não existe em React Native Hermes
function fichaVazia(): AnamneseRespostas {
  return {
    alergias: { ...SN }, problemas_saude: { ...SN }, medicamentos: { ...SN },
    autoimune: { ...SN }, procedimento_anterior: { ...SN },
    gestante: '', tipo_pele: '', sensibilidade_olhos: '',
    info_adicionais: '', declaracao_aceita: false,
  };
}

export const ANAMNESE_VAZIA: AnamneseRespostas = fichaVazia();

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
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
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
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fichaVazia();
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

/** Perguntas sim/não cuja resposta "Sim" é restrição (destaque vermelho em web e mobile). */
export function ehRestricao(key: string): boolean {
  return key === 'alergias' || key === 'problemas_saude' || key === 'medicamentos' || key === 'autoimune';
}

/** Restrições a destacar no perfil (alerta). Procedimento anterior não é restrição. */
export function restricoesAnamnese(a: AnamneseRespostas): string[] {
  const out: string[] = [];
  for (const k of ['alergias', 'problemas_saude', 'medicamentos', 'autoimune'] as const) {
    if (ehRestricao(k) && a[k].resposta === 'sim') out.push(a[k].detalhe ? `${ROTULO_RESTRICAO[k]}: ${a[k].detalhe}` : ROTULO_RESTRICAO[k]);
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
