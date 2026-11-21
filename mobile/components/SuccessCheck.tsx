import React, { useEffect } from 'react';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, useAnimatedStyle,
  withSpring, withDelay, withTiming, Easing,
} from 'react-native-reanimated';
import { useTema } from '@/lib/tema';

const APath = Animated.createAnimatedComponent(Path);
const CHECK_LEN = 30;

type Props = { size?: number; color?: string; bg?: string };

export default function SuccessCheck({ size = 84, color, bg }: Props) {
  const { C } = useTema();
  const scale = useSharedValue(0.5);
  const opacity = useSharedValue(0);
  const dash = useSharedValue(CHECK_LEN);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 150 });
    scale.value = withSpring(1, { damping: 12, stiffness: 220 });
    dash.value = withDelay(300, withTiming(0, { duration: 550, easing: Easing.out(Easing.ease) }));
  }, []);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const pathProps = useAnimatedProps(() => ({
    strokeDashoffset: dash.value,
  }));

  return (
    <Animated.View
      style={[{
        width: size, height: size, borderRadius: 999, backgroundColor: bg ?? C.greenSoft,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: '#2C1750', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
        elevation: 5,
      }, circleStyle]}
    >
      <Svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="none">
        <APath
          d="M20 6L9 17l-5-5"
          stroke={color ?? C.greenTexto} strokeWidth={2.5}
          strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={CHECK_LEN}
          animatedProps={pathProps}
        />
      </Svg>
    </Animated.View>
  );
}
