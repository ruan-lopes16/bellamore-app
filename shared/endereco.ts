/**
 * @file endereco.ts
 * Endereço da EMPRESA (`empresas.endereco`, texto), igual em web e app. Sem coluna nova:
 * grava um JSON {cep, rua, numero, complemento, bairro, cidade, uf} numa string.
 * Leitura tolerante:
 * - formato antigo do web, separado por vírgula: "rua, número, [complemento,] bairro, Cidade - UF"
 *   (a mesma leitura que Configurações fazia, agora num lugar só);
 * - texto livre curto (cadastro da empresa, app antigo) vai inteiro para `rua`.
 * O endereço de CLIENTE tem formato próprio em `./clientes` (parseEndereco/serializarEndereco).
 */

export type EnderecoEmpresa = {
  cep: string;
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export const ENDERECO_EMPRESA_VAZIO: Readonly<EnderecoEmpresa> = Object.freeze({
  cep: '', rua: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '',
});

const CAMPOS: (keyof EnderecoEmpresa)[] = ['cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];

function vazio(): EnderecoEmpresa {
  return { ...ENDERECO_EMPRESA_VAZIO };
}

function limpar(e: Partial<EnderecoEmpresa>): EnderecoEmpresa {
  const out = vazio();
  for (const c of CAMPOS) {
    const v = e[c];
    out[c] = v === null || v === undefined ? '' : String(v).trim();
  }
  out.uf = out.uf.toUpperCase();
  return out;
}

/** "Cidade - UF" (o que ViaCEP/BrasilAPI preenchem) → cidade e UF. */
function separarLocalidade(texto: string): { cidade: string; uf: string } {
  const m = texto.match(/^(.*?)\s*[-/]\s*([A-Za-z]{2})$/);
  return m ? { cidade: m[1].trim(), uf: m[2].toUpperCase() } : { cidade: texto.trim(), uf: '' };
}

/** Formato antigo do web: partes separadas por vírgula (mesma regra de Configurações até 10/2026). */
function lerFormatoAntigo(raw: string): EnderecoEmpresa {
  const e = vazio();
  const partes = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (partes.length < 3) {
    e.rua = raw;
    return e;
  }
  e.rua = partes[0];
  Object.assign(e, separarLocalidade(partes[partes.length - 1]));
  if (partes.length >= 4 && /^\d/.test(partes[1])) {
    e.numero = partes[1];
    if (partes.length >= 5) {
      e.complemento = partes[2];
      e.bairro = partes.slice(3, -1).join(', ');
    } else {
      e.bairro = partes[2];
    }
  } else {
    e.bairro = partes.slice(1, -1).join(', ');
  }
  return e;
}

/** Lê `empresas.endereco` (JSON, formato antigo por vírgula ou texto livre). Nunca lança. */
export function lerEnderecoEmpresa(raw: string | null | undefined): EnderecoEmpresa {
  const texto = (raw ?? '').trim();
  if (!texto) return vazio();
  if (texto.startsWith('{')) {
    try {
      const p = JSON.parse(texto);
      if (p && typeof p === 'object' && !Array.isArray(p)) return limpar(p as Partial<EnderecoEmpresa>);
    } catch { /* não é JSON: segue como texto */ }
  }
  return lerFormatoAntigo(texto);
}

/** Texto para gravar em `empresas.endereco`; `null` quando todos os campos estão vazios. */
export function serializarEnderecoEmpresa(e: Partial<EnderecoEmpresa>): string | null {
  const limpo = limpar(e);
  return CAMPOS.some(c => limpo[c]) ? JSON.stringify(limpo) : null;
}

/** "Cidade - UF" (ou só um dos dois). */
export function localidadeEndereco(e: EnderecoEmpresa): string {
  return [e.cidade, e.uf].filter(Boolean).join(' - ');
}

/** Endereço numa linha, para exibir (recibo, cabeçalho): sem partes vazias. */
export function enderecoEmpresaEmLinha(e: EnderecoEmpresa): string {
  const partes = [e.rua, e.numero, e.complemento, e.bairro, localidadeEndereco(e)];
  if (e.cep) partes.push(`CEP ${e.cep}`);
  return partes.filter(Boolean).join(', ');
}
