/**
 * @file masks.ts
 * Funções puras de máscara de input para o Brasil.
 * Não dependem de nenhuma biblioteca externa — funcionam com onChange direto.
 *
 * Padrão de uso:
 *   <input value={tel} onChange={e => setTel(maskPhone(e.target.value))} maxLength={15} />
 *
 * Todas as funções são idempotentes: aplicar a máscara duas vezes dá o mesmo resultado.
 */

/** Remove tudo que não é dígito (0-9) */
export function digits(v: string) {
  return v.replace(/\D/g, '');
}

/**
 * Máscara de telefone brasileiro.
 * Detecta automaticamente fixo (10 dígitos) ou celular (11 dígitos).
 *
 * Fixo:   (XX) XXXX-XXXX
 * Celular: (XX) XXXXX-XXXX
 *
 * @example
 * maskPhone('11987654321') // → '(11) 98765-4321'
 * maskPhone('1133334444')  // → '(11) 3333-4444'
 */
export function maskPhone(v: string) {
  const d = digits(v).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2)  return `(${d}`;
  if (d.length <= 6)  return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return                     `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * Máscara de CNPJ.
 * Formato: XX.XXX.XXX/XXXX-XX
 *
 * @example
 * maskCNPJ('12345678000195') // → '12.345.678/0001-95'
 */
export function maskCNPJ(v: string) {
  const d = digits(v).slice(0, 14);
  if (d.length <= 2)  return d;
  if (d.length <= 5)  return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8)  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return                     `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Máscara de CPF.
 * Formato: XXX.XXX.XXX-XX
 *
 * @example
 * maskCPF('12345678909') // → '123.456.789-09'
 */
export function maskCPF(v: string) {
  const d = digits(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return                    `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Gera o número para link wa.me (sem +, sem espaços, com DDI 55).
 * Evita duplicar o DDI caso o número já esteja salvo com ele.
 *
 * @example
 * toWhatsApp('(34) 99178-0000') // → '5534991780000'
 * toWhatsApp('+55 34 99178-0000') // → '5534991780000'
 */
export function toWhatsApp(phone: string): string {
  const d = digits(phone);
  // Número já contém DDI: começa com 55 e tem 12+ dígitos (55 + DDD + 9 dígitos)
  if (d.startsWith('55') && d.length >= 12) return d;
  return `55${d}`;
}

/**
 * Máscara de CEP brasileiro.
 * Formato: XXXXX-XXX
 *
 * @example
 * maskCEP('01310100') // → '01310-100'
 */
export function maskCEP(v: string) {
  const d = digits(v).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/**
 * Máscara de moeda BR (milhar com ponto, centavos com vírgula) enquanto o
 * usuário digita — trata a string sempre como centavos acumulados.
 *
 * @example
 * maskMoeda('1000000') // → '10.000,00'
 */
export function maskMoeda(v: string): string {
  const d = digits(v);
  if (d.length === 0) return '';
  const semZeros = d.replace(/^0+(?=\d)/, '').padStart(3, '0');
  const inteiro  = semZeros.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centavos = semZeros.slice(-2);
  return `${inteiro},${centavos}`;
}

/**
 * Converte o valor mascarado por maskMoeda (ex.: "10.000,00") de volta para number.
 */
export function parseMoeda(masked: string): number {
  return parseFloat(masked.replace(/\./g, '').replace(',', '.')) || 0;
}

/**
 * Formata um number vindo do banco no mesmo formato de maskMoeda, para
 * popular o valor inicial de um input mascarado.
 *
 * @example
 * formatMoeda(10000) // → '10.000,00'
 */
export function formatMoeda(value: number): string {
  return maskMoeda(String(Math.round(value * 100)));
}

/**
 * Valida CNPJ pelo algoritmo de módulo 11.
 * Rejeita sequências iguais (00.000.000/0000-00, etc.).
 *
 * @example
 * validaCNPJ('11.222.333/0001-81') // → true
 * validaCNPJ('00.000.000/0000-00') // → false
 */
export function validaCNPJ(v: string): boolean {
  const d = digits(v);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const calc = (len: number) => {
    let sum = 0, pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += parseInt(d[len - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === parseInt(d[12]) && calc(13) === parseInt(d[13]);
}

/**
 * Valida CPF pelo algoritmo de módulo 11.
 * Rejeita sequências iguais (000.000.000-00, etc.).
 *
 * @example
 * validaCPF('529.982.247-25') // → true
 * validaCPF('111.111.111-11') // → false
 */
export function validaCPF(v: string): boolean {
  const d = digits(v);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === parseInt(d[9]) && calc(10) === parseInt(d[10]);
}

/**
 * Aplica uma máscara de dígitos (maskPhone, maskCNPJ, maskCPF, maskCEP,
 * maskMoeda...) num <input> controlado SEM perder a posição do cursor.
 *
 * Sem isso, toda máscara que reconstrói a string do zero a cada tecla faz o
 * React reatribuir `value` e o navegador joga o cursor pro fim do campo —
 * editar no meio do valor vira uma luta. Aqui a gente conta quantos dígitos
 * existem antes do cursor no valor digitado, aplica a máscara, e devolve o
 * cursor pra depois do dígito correspondente no valor já mascarado.
 *
 * Só funciona client-side (depende do elemento do DOM); use no onChange:
 *   onChange={e => maskComCursor(e.target, maskPhone, setTelefone)}
 */
export function maskComCursor(
  input: HTMLInputElement,
  maskFn: (v: string) => string,
  setValue: (masked: string) => void,
): void {
  const cursorPos = input.selectionStart ?? input.value.length;
  const digitsBeforeCursor = digits(input.value.slice(0, cursorPos)).length;
  const masked = maskFn(input.value);
  setValue(masked);

  requestAnimationFrame(() => {
    if (digitsBeforeCursor === 0) { input.setSelectionRange(0, 0); return; }
    let count = 0;
    for (let i = 0; i < masked.length; i++) {
      if (/\d/.test(masked[i])) {
        count++;
        if (count === digitsBeforeCursor) { input.setSelectionRange(i + 1, i + 1); return; }
      }
    }
    input.setSelectionRange(masked.length, masked.length);
  });
}
