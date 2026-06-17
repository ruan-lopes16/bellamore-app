// PressableScale — feedback tátil padrão Bellamore (scale 0.97, 140ms).
// Colocar em mobile/components/PressableScale.tsx
// Substitui TouchableOpacity/Pressable em cards e botões.

import React from 'react';
import { Pressable, type PressableProps, type ViewStyle, type StyleProp } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing,
} from 'react-native-reanimated';

const EASE_PRESS = Easing.bezier(0.2, 0.8, 0.3, 1);

type Props = PressableProps & {
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export default function PressableScale({ scaleTo = 0.97, style, children, ...rest }: Props) {
  const scale = useSharedValue(1);

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      {...rest}
      onPressIn={(e) => { scale.value = withTiming(scaleTo, { duration: 140, easing: EASE_PRESS }); rest.onPressIn?.(e); }}
      onPressOut={(e) => { scale.value = withTiming(1, { duration: 180, easing: EASE_PRESS }); rest.onPressOut?.(e); }}
    >
      <Animated.View style={[aStyle, style]}>{children}</Animated.View>
    </Pressable>
  );
}
