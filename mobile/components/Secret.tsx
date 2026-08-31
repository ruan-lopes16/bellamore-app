import { Text, TouchableOpacity, type TextStyle, type StyleProp } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { usePrivacyStore } from '@/stores/privacyStore';

/**
 * Envolve um valor sensível. Modo privado desligado → mostra o filho normal.
 * Ligado → texto transparente com sombra borrada (rabisco ilegível), mantendo
 * a largura. Substitui um `<Text style={x}>{valor}</Text>` já existente.
 */
export function SecretText({
  children, style,
}: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const hidden = usePrivacyStore((s) => s.hidden);
  return (
    <Text
      selectable={!hidden}
      style={[
        style,
        hidden && {
          color: 'transparent',
          textShadowColor: 'rgba(0,0,0,0.62)',
          textShadowRadius: 10,
          textShadowOffset: { width: 0, height: 0 },
        },
      ]}
    >
      {children}
    </Text>
  );
}

/** Botão de olho para o cabeçalho de cada tela. */
export function PrivacyToggle({
  color = '#fff',
  bg = 'rgba(255,255,255,0.1)',
  borderColor = 'rgba(255,255,255,0.1)',
  size = 38,
}: { color?: string; bg?: string; borderColor?: string; size?: number }) {
  const { hidden, toggle } = usePrivacyStore();
  return (
    <TouchableOpacity
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={hidden ? 'Mostrar valores' : 'Ocultar valores'}
      style={{
        width: size, height: size, borderRadius: 12,
        backgroundColor: bg,
        borderWidth: 1, borderColor,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {hidden ? <EyeOff size={16} color={color} strokeWidth={2} /> : <Eye size={16} color={color} strokeWidth={2} />}
    </TouchableOpacity>
  );
}
