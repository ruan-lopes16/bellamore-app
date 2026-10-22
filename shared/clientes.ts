/**
 * @file clientes.ts
 * Formato de dados da cliente, igual em web e mobile. É o formato que está em
 * produção desde a migration 006 (tabela `public.clientes`):
 * - `data_nascimento` = '1904-MM-DD' (novos) ou '1900-MM-DD' (legado) quando só
 *   dia/mês são conhecidos (o cadastro pede só aniversário); um ano real (> 1905)
 *   permite calcular idade. 1904 é bissexto, então aceita 29/02.
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
    if (p && typeof p === 'object' && p.logradouro !== undefined) {
      return {
        logradouro: String(p.logradouro ?? ''), numero: String(p.numero ?? ''),
        bairro: String(p.bairro ?? ''), complemento: String(p.complemento ?? ''),
      };
    }
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

/** Ano fictício de aniversário sem ano: bissexto (aceita 29/02) e ≤ 1905 (idadeCliente devolve null). */
export const ANO_ANIVERSARIO_SEM_ANO = 1904;

const DIAS_POR_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Quantos dias o mês ("1".."12" ou "01".."12") pode ter (fevereiro = 29). Vazio/inválido = 31. */
export function diasNoMes(mes: string): number {
  const n = Number(mes);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? DIAS_POR_MES[n - 1] : 31;
}

/** Monta '1904-MM-DD' a partir de mês e dia; `null` se faltar um ou o dia não existir no mês. */
export function montarAniversario(mes: string, dia: string): string | null {
  if (!mes || !dia) return null;
  if (Number(dia) > diasNoMes(mes)) return null;
  return `${ANO_ANIVERSARIO_SEM_ANO}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
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

/**
 * Valor de `data_nascimento` a gravar numa edição: mantém `original` (inclusive um
 * ano real) quando mês/dia escolhidos são os mesmos; senão monta o placeholder 1904;
 * `null` se mês/dia foram limpos ou são inválidos.
 */
export function aniversarioParaGravar(original: string | null | undefined, mes: string, dia: string): string | null {
  const o = partesAniversario(original);
  if (original && mes && dia && Number(o.mes) === Number(mes) && Number(o.dia) === Number(dia)) return original;
  return montarAniversario(mes, dia);
}

/** Regra única de nome da cliente (web e mobile): ao menos 2 caracteres sem contar espaços nas pontas. */
export function nomeClienteValido(nome: string): boolean {
  return nome.trim().length >= 2;
}

/** DDDs em uso no Brasil (Anatel). */
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Regra única de contato da cliente (web e mobile): telefone brasileiro real.
 * Aceita com ou sem máscara e com DDI 55. Exige DDD existente; celular = 11 dígitos
 * começando em 9; fixo = 10 dígitos começando em 2–5. Recusa números repetidos
 * (ex.: 99999-9999, inclusive o exemplo do campo).
 *
 * @returns mensagem de erro em português, ou `null` quando o telefone é válido.
 */
export function erroTelefoneCliente(telefone: string): string | null {
  let d = telefone.replace(/\D/g, '');
  if (!d) return 'O telefone de contato é obrigatório.';
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return 'Telefone inválido: informe DDD + número (ex.: (11) 98765-4321).';
  if (!DDDS_VALIDOS.has(Number(d.slice(0, 2)))) return 'Telefone inválido: DDD inexistente.';
  const local = d.slice(2);
  if (d.length === 11 && local[0] !== '9') return 'Telefone inválido: celular deve começar com 9 depois do DDD.';
  if (d.length === 10 && !/[2-5]/.test(local[0])) return 'Telefone inválido: confira o número.';
  if (/^(\d)\1+$/.test(local)) return 'Telefone inválido: confira o número.';
  return null;
}

/** `true` quando `erroTelefoneCliente` não acusa problema. */
export function telefoneClienteValido(telefone: string): boolean {
  return erroTelefoneCliente(telefone) === null;
}

/**
 * Regra única de e-mail da cliente (web e mobile). O campo continua opcional:
 * vazio é aceito; preenchido precisa ser um endereço válido (nome@dominio.tld,
 * sem espaços, domínio com ponto e extensão de ao menos 2 letras).
 *
 * @returns mensagem de erro em português, ou `null` quando vazio/válido.
 */
export function erroEmailCliente(email: string): string | null {
  const e = email.trim();
  if (!e) return null;
  const ok = e.length <= 254
    && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e)
    && !e.includes('..') && !e.startsWith('.') && !e.split('@')[0].endsWith('.');
  return ok ? null : 'E-mail inválido: use o formato nome@exemplo.com.';
}
