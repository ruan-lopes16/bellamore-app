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
