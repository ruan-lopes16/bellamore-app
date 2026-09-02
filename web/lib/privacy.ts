/**
 * Modo privado: oculta valores sensíveis (R$, %, metas, contagens) nas telas.
 * Aqui ficam só as funções puras de leitura/escrita da preferência — o provider
 * e os componentes (`Secret`, `PrivacyToggle`) vivem em `web/components/privacy.tsx`.
 */
export const PRIVACY_KEY = 'bm-privacy';

/** Lê a preferência salva. Nunca lança (localStorage pode estar bloqueado). */
export function readPrivacyPref(): boolean {
  try {
    return localStorage.getItem(PRIVACY_KEY) === '1';
  } catch {
    return false;
  }
}

/** Salva a preferência como "1"/"0". Nunca lança. */
export function writePrivacyPref(hidden: boolean): void {
  try {
    localStorage.setItem(PRIVACY_KEY, hidden ? '1' : '0');
  } catch {
    /* storage indisponível — o estado em memória continua valendo nesta sessão */
  }
}

/**
 * Estilo aplicado a um valor oculto: texto transparente + sombra borrada, sem
 * deslocamento. Vira um rabisco ilegível mantendo a largura do texto (a tela
 * não "pula" ao ligar/desligar). Sem seleção para não dar pra copiar o valor.
 */
export const SMEAR_STYLE: React.CSSProperties = {
  color: 'transparent',
  textShadow: '0 0 11px rgba(0,0,0,0.62)',
  WebkitUserSelect: 'none',
  userSelect: 'none',
  cursor: 'default',
};
