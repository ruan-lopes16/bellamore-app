/**
 * Formato único de dinheiro do Bellamore (web e app): "R$ 9.503,77", negativo "-R$ 10,00".
 * Sem Intl — o Hermes do app não tem o locale pt-BR completo. Arredonda para centavos
 * em inteiros (evita 2,675 → 2,67 do ponto flutuante). Não finito vira "R$ 0,00".
 */
export function formatarMoeda(valor: number): string {
  if (!Number.isFinite(valor)) return 'R$ 0,00';
  const centavos = Math.round(Math.abs(valor) * 100 + 1e-7);
  const negativo = valor < 0 && centavos > 0;
  const inteiro = Math.floor(centavos / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resto = String(centavos % 100).padStart(2, '0');
  return `${negativo ? '-' : ''}R$ ${inteiro},${resto}`;
}
