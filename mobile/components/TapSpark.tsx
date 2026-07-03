import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, AccessibilityInfo } from 'react-native';
import { MotiView } from 'moti';
import { Easing } from 'react-native-reanimated';

/**
 * TapSpark — pequenas faíscas que se espalham do ponto tocado.
 * Envolve o app inteiro uma única vez em `app/_layout.tsx` (efeito global).
 *
 * Usa onStartShouldSetResponderCapture retornando `false`: captura a
 * coordenada do toque na fase de captura sem nunca reivindicar o
 * responder, então não interfere em nenhum toque/gesto existente.
 */

type Burst = { id: number; x: number; y: number };

const QTD       = 7;
const COMPRIMENTO = 14;
const DISTANCIA   = 20;
const DURACAO     = 450;
const COR         = '#2C1750';

export function TapSpark({ children }: { children: React.ReactNode }) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const idRef = useRef(0);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(v => { reducedMotionRef.current = v; });
  }, []);

  const onCapture = useCallback((e: any) => {
    if (reducedMotionRef.current) return false;
    const { pageX, pageY } = e.nativeEvent;
    const id = idRef.current++;
    setBursts(prev => [...prev, { id, x: pageX, y: pageY }]);
    setTimeout(() => setBursts(prev => prev.filter(b => b.id !== id)), DURACAO + 50);
    return false; // nunca reivindica o responder — toques seguem normalmente
  }, []);

  return (
    <View style={{ flex: 1 }} onStartShouldSetResponderCapture={onCapture}>
      {children}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {bursts.map(b => (
          <View key={b.id} style={{ position: 'absolute', left: b.x, top: b.y }}>
            {Array.from({ length: QTD }).map((_, i) => {
              const angulo = `${(360 * i) / QTD}deg`;
              return (
                <MotiView
                  key={i}
                  from={{ opacity: 1, translateX: 0, rotate: angulo }}
                  animate={{ opacity: 0, translateX: DISTANCIA, rotate: angulo }}
                  transition={{ type: 'timing', duration: DURACAO, easing: Easing.out(Easing.ease) }}
                  style={{
                    position: 'absolute',
                    width: COMPRIMENTO, height: 2, borderRadius: 1,
                    backgroundColor: COR,
                  }}
                />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
