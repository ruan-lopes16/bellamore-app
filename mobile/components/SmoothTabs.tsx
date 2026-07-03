import React, { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, Text, ScrollView, type ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';

export type SmoothTabItem = { key: string; label: string };

type Props = {
  tabs: SmoothTabItem[];
  active: string;
  onChange: (key: string) => void;
  /** 'pill' — trilho arredondado que rola horizontalmente (filtros) · 'segmented' — largura igual, sem rolar (período) */
  variant?: 'pill' | 'segmented';
  activeColor?: string;
  activeTextColor?: string;
  inactiveTextColor?: string;
  trackBg?: string;
  trackBorder?: string;
  fontFamily?: string;
  style?: ViewStyle;
};

/**
 * SmoothTabs — barra de abas/filtros com indicador que desliza suavemente
 * até a opção ativa (equivalente RN do componente web de mesmo nome).
 *
 * Estrutura: um "trilho" com fundo próprio (trackBg/trackBorder) contém os
 * botões, sempre com fundo transparente — só o indicador (Animated.View,
 * pintado ANTES dos botões, portanto atrás) fornece o preenchimento colorido
 * da aba ativa. Se os botões tivessem fundo opaco próprio, cobririam o
 * indicador por trás e ele nunca apareceria.
 */
export function SmoothTabs({
  tabs, active, onChange, variant = 'pill',
  activeColor = '#2C1750',
  activeTextColor = '#fff',
  inactiveTextColor = '#8878A6',
  trackBg = '#FFFFFF',
  trackBorder = '#E8E2DC',
  fontFamily = 'PlusJakartaSans_600SemiBold',
  style,
}: Props) {
  const layouts = useRef<Record<string, { x: number; width: number }>>({});
  const indicatorX = useSharedValue(0);
  const indicatorW = useSharedValue(0);
  const [ready, setReady] = useState(false);

  function onTabLayout(key: string, x: number, width: number) {
    layouts.current[key] = { x, width };
    if (key === active && !ready) {
      indicatorX.value = x;
      indicatorW.value = width;
      setReady(true);
    }
  }

  useEffect(() => {
    const l = layouts.current[active];
    if (l) {
      indicatorX.value = withTiming(l.x, { duration: 300, easing: Easing.out(Easing.cubic) });
      indicatorW.value = withTiming(l.width, { duration: 300, easing: Easing.out(Easing.cubic) });
    }
  }, [active]);

  const indicatorStyle = useAnimatedStyle(() => ({
    left: indicatorX.value,
    width: indicatorW.value,
  }));

  const isSegmented = variant === 'segmented';

  const track = (
    <View style={{
      flexDirection: 'row', padding: 4, gap: 4,
      borderRadius: isSegmented ? 12 : 999,
      backgroundColor: trackBg, borderWidth: 1, borderColor: trackBorder,
      flex: isSegmented ? 1 : undefined, alignSelf: isSegmented ? undefined : 'flex-start',
    }}>
      <View style={{ flexDirection: 'row', gap: 4, position: 'relative', flex: isSegmented ? 1 : undefined }}>
        {ready && (
          <Animated.View
            style={[
              { position: 'absolute', top: 0, bottom: 0, borderRadius: isSegmented ? 8 : 999, backgroundColor: activeColor },
              indicatorStyle,
            ]}
          />
        )}
        {tabs.map(t => {
          const isActive = t.key === active;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => onChange(t.key)}
              onLayout={e => onTabLayout(t.key, e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
              style={
                isSegmented
                  ? { flex: 1, paddingVertical: 7, paddingHorizontal: 12, alignItems: 'center' }
                  : { paddingHorizontal: 14, paddingVertical: 7, alignItems: 'center' }
              }
            >
              <Text style={{ fontFamily, fontSize: isSegmented ? 11 : 12, color: isActive ? activeTextColor : inactiveTextColor }}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  // Segmented: linha fixa (largura igual, sem rolagem). Pill: rolagem horizontal.
  return isSegmented
    ? <View style={style}>{track}</View>
    : (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={style}>
        {track}
      </ScrollView>
    );
}
