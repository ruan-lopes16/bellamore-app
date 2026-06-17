import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring,
} from 'react-native-reanimated';

type Props = {
  children: React.ReactNode;
  maxDeg?: number;
  style?: StyleProp<ViewStyle>;
};

export default function TiltCard({ children, maxDeg = 6, style }: Props) {
  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const w = useSharedValue(1);
  const h = useSharedValue(1);

  const pan = Gesture.Pan()
    .onBegin((e) => {
      rx.value = withSpring(-((e.y / h.value) - 0.5) * maxDeg, { damping: 18 });
      ry.value = withSpring(((e.x / w.value) - 0.5) * maxDeg, { damping: 18 });
    })
    .onUpdate((e) => {
      rx.value = -((e.y / h.value) - 0.5) * maxDeg;
      ry.value = ((e.x / w.value) - 0.5) * maxDeg;
    })
    .onFinalize(() => {
      rx.value = withSpring(0, { damping: 14 });
      ry.value = withSpring(0, { damping: 14 });
    });

  const aStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 700 },
      { rotateX: `${rx.value}deg` },
      { rotateY: `${ry.value}deg` },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[aStyle, style]}
        onLayout={(e) => { w.value = e.nativeEvent.layout.width; h.value = e.nativeEvent.layout.height; }}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
