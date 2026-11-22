import { horaBRT } from './periodos';

/**
 * Primeiro nome de um nome completo (null se vazio).
 */
export function primeiroNome(nome: string | null | undefined): string | null {
  const p = (nome ?? '').trim().split(/\s+/)[0];
  return p ? p : null;
}

/**
 * Saudação pela hora de Brasília: 5–11h "Bom dia", 12–17h "Boa tarde", resto "Boa noite".
 * Sem nome devolve só a saudação ("Bom dia").
 */
export function saudacao(primeiroNomeUsuario: string | null, agora: Date): string {
  const hora = Number(horaBRT(agora.toISOString()).slice(0, 2));
  const base = hora >= 5 && hora < 12 ? 'Bom dia' : hora >= 12 && hora < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = primeiroNomeUsuario?.trim();
  return nome ? `${base}, ${nome}` : base;
}
