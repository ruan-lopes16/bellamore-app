/**
 * Taxas da maquininha (web e app). Configuráveis por empresa (migration 084:
 * empresas.taxa_cartao_debito / _credito_avista / _credito_parcelado); sem as colunas
 * (migration não aplicada) ou com valor inválido, vale o padrão InfinitePay.
 */
export type TaxasCartao = { debito: number; creditoAvista: number; creditoParcelado: number };

export const TAXAS_PADRAO: TaxasCartao = { debito: 0.0239, creditoAvista: 0.0499, creditoParcelado: 0.0559 };

function taxaValida(v: unknown, padrao: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 0.2 ? n : padrao;
}

/** Taxas da empresa a partir da linha de `empresas` (qualquer coluna ausente → padrão). */
export function taxasDaEmpresa(empresa: Record<string, unknown> | null | undefined): TaxasCartao {
  return {
    debito:           taxaValida(empresa?.taxa_cartao_debito, TAXAS_PADRAO.debito),
    creditoAvista:    taxaValida(empresa?.taxa_cartao_credito_avista, TAXAS_PADRAO.creditoAvista),
    creditoParcelado: taxaValida(empresa?.taxa_cartao_credito_parcelado, TAXAS_PADRAO.creditoParcelado),
  };
}

/** "4,99%". */
export function fmtTaxa(taxa: number): string {
  return `${(taxa * 100).toFixed(2).replace('.', ',')}%`;
}

/** Valor líquido após a taxa, arredondado em centavos. */
export function valorLiquido(bruto: number, taxa: number): number {
  return Math.round(bruto * (1 - taxa) * 100) / 100;
}

/** Decimal (0.0499) → texto do campo de percentual ("4,99"). */
export function taxaParaCampo(taxa: number): string {
  return (taxa * 100).toFixed(2).replace('.', ',');
}

/** Máscara do campo de percentual: só dígitos e uma vírgula, no máximo 2 casas. */
export function mascararPercentual(texto: string): string {
  const limpo = texto.replace('.', ',').replace(/[^\d,]/g, '');
  const [inteiro, ...resto] = limpo.split(',');
  return resto.length ? `${inteiro},${resto.join('').slice(0, 2)}` : inteiro;
}

/** Texto do campo ("4,99") → decimal (0.0499); null se vazio/inválido ou fora de 0–20%. */
export function campoParaTaxa(texto: string): number | null {
  const n = parseFloat(texto.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 20) return null;
  return Math.round(n * 100) / 10000;
}

// ── Cartões configuráveis (migration 086): maquininhas, bandeiras e taxas por parcela ──

/** Modalidade de cobrança no cartão. */
export type Modalidade = 'debito' | 'credito';

/** Bandeira cadastrada pela empresa. `chave` nunca muda (pagamentos antigos usam ela). */
export type BandeiraCartao = { id: string; chave: string; nome: string; ativa: boolean; ordem: number };

/** Linha da tabela de taxas. `bandeiraId` null = taxa padrão; preenchido = exceção da bandeira. */
export type TaxaLinha = { id?: string; bandeiraId: string | null; modalidade: Modalidade; parcelas: number; taxa: number };

/** Maquininha com sua tabela de taxas. */
export type Maquininha = {
  id: string; nome: string; maxParcelas: number; ativa: boolean; padrao: boolean; ordem: number; taxas: TaxaLinha[];
};

/**
 * Configuração completa de cartões da empresa. `legado` = migration 086 ainda não aplicada (somente
 * leitura). `indisponivel` = a leitura falhou (configIndisponivel): nenhuma taxa disponível.
 */
export type ConfigCartoes = { maquininhas: Maquininha[]; bandeiras: BandeiraCartao[]; legado: boolean; indisponivel?: boolean };

/** Máximo de parcelas permitido em qualquer maquininha. */
export const MAX_PARCELAS = 18;

/** Bandeiras criadas para toda empresa (mesmo seed da migration 086). */
export const BANDEIRAS_INICIAIS: { chave: string; nome: string }[] = [
  { chave: 'visa', nome: 'Visa' },
  { chave: 'mastercard', nome: 'Master' },
  { chave: 'elo', nome: 'Elo' },
  { chave: 'amex', nome: 'Amex' },
  { chave: 'hipercard', nome: 'Hipercard' },
];

/**
 * Configuração equivalente quando a 086 não existe: uma maquininha virtual ("legado", até 18x,
 * como o seletor antigo) com as taxas da migration 084 e as 5 bandeiras fixas.
 */
export function configLegada(empresa: Record<string, unknown> | null | undefined): ConfigCartoes {
  const t = taxasDaEmpresa(empresa);
  const taxas: TaxaLinha[] = [{ bandeiraId: null, modalidade: 'debito', parcelas: 1, taxa: t.debito }];
  for (let n = 1; n <= MAX_PARCELAS; n++) {
    taxas.push({ bandeiraId: null, modalidade: 'credito', parcelas: n, taxa: n === 1 ? t.creditoAvista : t.creditoParcelado });
  }
  return {
    legado: true,
    maquininhas: [{ id: 'legado', nome: 'Maquininha', maxParcelas: MAX_PARCELAS, ativa: true, padrao: true, ordem: 1, taxas }],
    bandeiras: BANDEIRAS_INICIAIS.map((b, i) => ({ id: `legado-${b.chave}`, chave: b.chave, nome: b.nome, ativa: true, ordem: i + 1 })),
  };
}

/**
 * Configuração usada quando a leitura falhou por um erro que não é "tabela ausente" (rede, RLS…):
 * nenhuma maquininha, as 5 bandeiras iniciais. Assim `taxaDoCartao` dá null em todo cartão (aviso
 * "Taxa não cadastrada" e pagamento gravado sem taxa) — nunca as taxas antigas da 084 nem o padrão
 * InfinitePay. Pagamento reaberto inalterado mantém a taxa e a maquininha gravadas.
 */
export function configIndisponivel(): ConfigCartoes {
  return {
    legado: false,
    indisponivel: true,
    maquininhas: [],
    bandeiras: BANDEIRAS_INICIAIS.map((b, i) => ({ id: `indisponivel-${b.chave}`, chave: b.chave, nome: b.nome, ativa: true, ordem: i + 1 })),
  };
}

/** Complemento do aviso de erro ao carregar a configuração (as telas usam configIndisponivel). */
export const AVISO_CARTOES_SEM_TAXA = 'Pagamentos no cartão serão registrados sem taxa até recarregar a tela.';

/** Maquininhas ativas, por ordem e depois por nome. */
export function maquininhasAtivas(c: ConfigCartoes): Maquininha[] {
  return c.maquininhas.filter(m => m.ativa)
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Maquininha padrão ativa; se não houver, a primeira ativa; senão null. */
export function maquininhaPadrao(c: ConfigCartoes): Maquininha | null {
  const ativas = maquininhasAtivas(c);
  return ativas.find(m => m.padrao) ?? ativas[0] ?? null;
}

/** Bandeiras ativas, por ordem e depois por nome. */
export function bandeirasAtivas(c: ConfigCartoes): BandeiraCartao[] {
  return c.bandeiras.filter(b => b.ativa)
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Nome cadastrado da bandeira; chave desconhecida → a própria chave; vazio → ''. */
export function nomeBandeira(c: ConfigCartoes, chave: string | null | undefined): string {
  if (!chave) return '';
  return c.bandeiras.find(b => b.chave === chave)?.nome ?? chave;
}

/** Parcelas oferecidas pela maquininha: 1..maxParcelas. */
export function parcelasDisponiveis(m: Maquininha): number[] {
  return Array.from({ length: m.maxParcelas }, (_, i) => i + 1);
}

/**
 * Taxa decimal da combinação. Pix/dinheiro/cortesia → 0. Débito/crédito: exceção da bandeira
 * se existir, senão a padrão da maquininha; sem linha cadastrada → null (nunca inventa taxa).
 * Maquininha ausente/desconhecida usa a padrão.
 */
export function taxaDoCartao(
  c: ConfigCartoes,
  s: { maquininhaId: string | null | undefined; bandeiraChave: string | null | undefined; metodo: string; parcelas?: number },
): number | null {
  if (s.metodo !== 'debito' && s.metodo !== 'credito') return 0;
  const maq = c.maquininhas.find(m => m.id === s.maquininhaId) ?? maquininhaPadrao(c);
  if (!maq) return null;
  const parcelas = s.metodo === 'credito' ? (s.parcelas ?? 1) : 1;
  const bandeiraId = s.bandeiraChave ? c.bandeiras.find(b => b.chave === s.bandeiraChave)?.id ?? null : null;
  const achar = (bid: string | null) => maq.taxas.find(t => t.bandeiraId === bid && t.modalidade === s.metodo && t.parcelas === parcelas);
  const linha = (bandeiraId ? achar(bandeiraId) : undefined) ?? achar(null);
  return linha ? linha.taxa : null;
}

/**
 * Valida a tabela de uma maquininha. Devolve null se estiver ok, senão a mensagem para a tela.
 * Exige a tabela padrão completa (débito e crédito 1..max); exceções por bandeira podem ser parciais.
 * Linhas com parcelas acima do máximo são ignoradas (serão apagadas ao salvar).
 */
export function validarTabela(m: Pick<Maquininha, 'maxParcelas' | 'taxas'>): string | null {
  if (!Number.isInteger(m.maxParcelas) || m.maxParcelas < 1 || m.maxParcelas > MAX_PARCELAS) {
    return `O máximo de parcelas precisa ficar entre 1 e ${MAX_PARCELAS}`;
  }
  const validas = m.taxas.filter(t => t.parcelas <= m.maxParcelas);
  if (validas.some(t => !Number.isFinite(t.taxa) || t.taxa < 0 || t.taxa > 0.2)) {
    return 'As taxas precisam ficar entre 0% e 20%';
  }
  if (validas.some(t => t.modalidade === 'debito' && t.parcelas !== 1)) return 'O débito só tem taxa em 1x';
  const vistas = new Set<string>();
  for (const t of validas) {
    const k = `${t.bandeiraId ?? ''}|${t.modalidade}|${t.parcelas}`;
    if (vistas.has(k)) return 'Há taxas repetidas para a mesma combinação';
    vistas.add(k);
  }
  const padrao = validas.filter(t => t.bandeiraId === null);
  if (!padrao.some(t => t.modalidade === 'debito' && t.parcelas === 1)) return 'Preencha a taxa do débito';
  for (let n = 1; n <= m.maxParcelas; n++) {
    if (!padrao.some(t => t.modalidade === 'credito' && t.parcelas === n)) return `Preencha a taxa do crédito em ${n}x`;
  }
  return null;
}

/** Chave (slug sem acento) para uma bandeira nova; sufixa -2, -3… se já existir. */
/** Acentos separados pelo NFD (U+0300–U+036F), escrito por código para não depender de \p{M} (Hermes). */
const MARCAS_ACENTO = new RegExp('[\u0300-\u036f]', 'g');

export function chaveBandeira(nome: string, existentes: string[]): string {
  const base = nome.normalize('NFD').replace(MARCAS_ACENTO, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bandeira';
  if (!existentes.includes(base)) return base;
  let n = 2;
  while (existentes.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// ── Grade editável de taxas (tela Configurações → Cartões, web e app) ──

/** Tabela como campos de texto em percentual ("4,99"): débito (1x) e crédito 1x..N (índice 0 = 1x). */
export type GradeTaxas = { debito: string; credito: string[] };

/**
 * Monta a grade editável de uma bandeira (`null` = tabela padrão) a partir das linhas.
 * Combinação sem linha → campo vazio.
 */
export function taxasParaGrade(taxas: TaxaLinha[], bandeiraId: string | null, maxParcelas: number): GradeTaxas {
  const campo = (modalidade: Modalidade, parcelas: number) => {
    const l = taxas.find(t => t.bandeiraId === bandeiraId && t.modalidade === modalidade && t.parcelas === parcelas);
    return l ? taxaParaCampo(l.taxa) : '';
  };
  return {
    debito: campo('debito', 1),
    credito: Array.from({ length: maxParcelas }, (_, i) => campo('credito', i + 1)),
  };
}

/**
 * Converte a grade em linhas de taxa. Campo vazio ou inválido (fora de 0–20%): na tabela padrão
 * (`completa` = true) devolve null; na exceção, o campo é simplesmente ignorado (usa a padrão).
 */
export function gradeParaTaxas(grade: GradeTaxas, bandeiraId: string | null, maxParcelas: number, completa: boolean): TaxaLinha[] | null {
  const out: TaxaLinha[] = [];
  const deb = campoParaTaxa(grade.debito);
  if (deb === null) { if (completa) return null; } else out.push({ bandeiraId, modalidade: 'debito', parcelas: 1, taxa: deb });
  for (let n = 1; n <= maxParcelas; n++) {
    const t = campoParaTaxa(grade.credito[n - 1] ?? '');
    if (t === null) { if (completa) return null; continue; }
    out.push({ bandeiraId, modalidade: 'credito', parcelas: n, taxa: t });
  }
  return out;
}

/** Remove das exceções as linhas idênticas à taxa padrão da mesma combinação (não gravar redundância). */
export function descartarExcecoesRedundantes(taxas: TaxaLinha[]): TaxaLinha[] {
  return taxas.filter(t => {
    if (t.bandeiraId === null) return true;
    const p = taxas.find(x => x.bandeiraId === null && x.modalidade === t.modalidade && x.parcelas === t.parcelas);
    return !p || p.taxa !== t.taxa;
  });
}

/** Bandeiras (ids) que têm ao menos uma exceção nas linhas. */
export function bandeirasComExcecao(taxas: TaxaLinha[]): string[] {
  return Array.from(new Set(taxas.filter(t => t.bandeiraId !== null).map(t => t.bandeiraId as string)));
}
