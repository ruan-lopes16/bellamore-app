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
