// anim.ts — presets de animação Bellamore (Reanimated 3)
// Colocar em mobile/lib/anim.ts

import { FadeIn, FadeInDown, ZoomIn, Easing } from 'react-native-reanimated';
import { AccessibilityInfo } from 'react-native';

// Curvas do design system
export const EASE_SPRING = Easing.bezier(0.2, 0.9, 0.3, 1);
export const EASE_ENTER  = Easing.bezier(0.2, 0.85, 0.3, 1);

// Respeitar reduced motion do sistema
export let motionEnabled = true;
AccessibilityInfo.isReduceMotionEnabled().then((reduced) => { motionEnabled = !reduced; });
AccessibilityInfo.addEventListener('reduceMotionChanged', (reduced) => { motionEnabled = !reduced; });

/**
 * Entrada em cascata para itens de lista.
 *   <Animated.View entering={enterStagger(index)}>
 * step: 60 (listas) · 55 (KPIs) · 35 (dias da semana) · 8 (grid mensal)
 */
export function enterStagger(index: number, step = 60) {
  if (!motionEnabled) return FadeIn.duration(120);
  return FadeInDown.duration(450).delay(index * step).easing(EASE_ENTER);
}

/** Entrada de tela/painel inteiro. */
export function enterScreen() {
  if (!motionEnabled) return FadeIn.duration(120);
  return FadeInDown.duration(340).easing(EASE_ENTER);
}

/** Barras de gráfico (combinar com transformOrigin no estilo se necessário). */
export function growBar(index: number, step = 70) {
  if (!motionEnabled) return FadeIn.duration(120);
  return ZoomIn.duration(700).delay(index * step).easing(EASE_SPRING);
}

/** Pop para badges/ícones que acabam de ficar ativos. */
export function popIn(delay = 0) {
  if (!motionEnabled) return FadeIn.duration(120);
  return ZoomIn.duration(320).delay(delay).easing(EASE_SPRING);
}
