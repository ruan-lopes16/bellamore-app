/**
 * @file configuracoes-empresa.ts
 * Regras de Configurações iguais em web e app: segmento, troca de e-mail, buscas de CEP
 * (ViaCEP) e CNPJ (BrasilAPI), logo da empresa, payload do UPDATE de `empresas` e a gravação
 * das preferências de notificação (salvas na hora). Sem dependência de DOM/React Native.
 */
import type { ClienteDb } from './kpis-financeiros-consultas';
import type { EnderecoEmpresa } from './endereco';
import { digits, maskPhone, maskCEP } from './mascaras';
import { mensagemErroBanco } from './erros';

/** Segmentos oferecidos no cadastro da empresa (o padrão é o primeiro). */
export const SEGMENTOS_EMPRESA = ['Estúdio', 'Clínica', 'Salão', 'Barbearia', 'Spa', 'Ateliê', 'Outro'] as const;

/** Aviso exibido depois de pedir a troca de e-mail (`updateUser({ email })`). */
export const MENSAGEM_EMAIL_CONFIRMACAO = 'Enviamos um link de confirmação para o novo e-mail.';

/** Valida a troca de e-mail: formato, confirmação e diferente do atual. `null` = ok. */
export function validarTrocaEmail(novo: string, confirmacao: string, atual: string): string | null {
  const n = novo.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n)) return 'E-mail inválido.';
  if (n !== confirmacao.trim().toLowerCase()) return 'Os e-mails não coincidem.';
  if (n === atual.trim().toLowerCase()) return 'O novo e-mail deve ser diferente do atual.';
  return null;
}

type Json = Record<string, unknown> | null | undefined;
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/**
 * Resposta do ViaCEP → campos do endereço (o número é limpo para a pessoa preencher).
 * `null` quando o CEP não existe (`{ erro: true }`) ou a resposta é inválida.
 */
export function enderecoDoViaCep(data: Json): Partial<EnderecoEmpresa> | null {
  if (!data || typeof data !== 'object' || data.erro) return null;
  return { rua: txt(data.logradouro), bairro: txt(data.bairro), cidade: txt(data.localidade), uf: txt(data.uf), numero: '' };
}

/**
 * Resposta da BrasilAPI (CNPJ) → o que preencher. Nome e telefone só entram se os campos atuais
 * estão vazios (nunca sobrescreve o que a dona digitou); o endereço só vem com logradouro.
 */
export function dadosDoCnpj(
  data: Json,
  atuais: { nome: string; telefone: string },
): { nome?: string; telefone?: string; endereco?: Partial<EnderecoEmpresa> } {
  const out: { nome?: string; telefone?: string; endereco?: Partial<EnderecoEmpresa> } = {};
  if (!data || typeof data !== 'object') return out;
  const nome = txt(data.nome_fantasia) || txt(data.razao_social);
  if (nome && !atuais.nome.trim()) out.nome = nome;
  if (data.ddd_telefone_1 && !atuais.telefone.trim()) out.telefone = maskPhone(digits(txt(data.ddd_telefone_1) + txt(data.telefone_1)));
  if (data.logradouro) {
    out.endereco = {
      ...(data.cep ? { cep: maskCEP(txt(data.cep)) } : {}),
      rua: txt(data.logradouro), numero: txt(data.numero), bairro: txt(data.bairro),
      cidade: txt(data.municipio), uf: txt(data.uf),
    };
  }
  return out;
}

/** Tipos aceitos na logo (os mesmos do web). */
export const LOGO_TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Tamanho máximo da logo: 2 MB. */
export const LOGO_TAMANHO_MAXIMO = 2 * 1024 * 1024;

/** Caminho no bucket `logos`, igual ao web: nome único com o horário (evita cache do CDN). */
export function caminhoLogoEmpresa(empresaId: string, extensao: string, agora: number = Date.now()): string {
  const ext = (extensao || 'jpg').toLowerCase().replace(/^\./, '');
  return `empresa_${empresaId}_${agora}.${ext}`;
}

/** Confere tipo e tamanho da logo. `null` = ok. `tamanho` desconhecido não trava. */
export function validarArquivoLogo(mime: string | null | undefined, tamanho: number | null | undefined): string | null {
  if (!mime || !(LOGO_TIPOS_ACEITOS as readonly string[]).includes(mime)) return 'Formato inválido. Use JPEG, PNG ou WEBP.';
  if (typeof tamanho === 'number' && tamanho > LOGO_TAMANHO_MAXIMO) return 'Arquivo muito grande. Máximo 2 MB.';
  return null;
}

/**
 * Colunas do UPDATE de `empresas`: dados só da dona; quem tem `config.taxas` manda SÓ as colunas
 * taxa_* (o trigger da 083 recusa qualquer outra coluna vinda de quem não é a dona).
 */
export function montarPayloadEmpresa<D extends Record<string, unknown>, T extends Record<string, unknown>>(p: {
  ehDona: boolean; podeTaxas: boolean; dados: D; taxas: T;
}): Partial<D & T> {
  return { ...(p.ehDona ? p.dados : {}), ...(p.podeTaxas ? p.taxas : {}) } as Partial<D & T>;
}

export type PreferenciaNotificacao = 'notif_resumo_diario' | 'notif_lembrete_atendimento';

/**
 * Grava UMA preferência de notificação da própria pessoa, na hora do toque (sem botão Salvar).
 * Confere o erro e as linhas (0 linhas = nada gravado). Lança `Error` em português.
 */
export async function salvarPreferenciaNotificacao(
  db: ClienteDb, userId: string, campo: PreferenciaNotificacao, valor: boolean,
): Promise<void> {
  const { data, error } = await db.from('users').update({ [campo]: valor }).eq('id', userId).select('id');
  if (error) throw new Error(mensagemErroBanco(error, 'salvar a preferência de notificação'));
  if (!Array.isArray(data) || data.length === 0) throw new Error('Não foi possível salvar a preferência. Tente de novo.');
}
