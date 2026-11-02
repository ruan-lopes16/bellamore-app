/** Campo de formulário das Configurações (empresa e profissional), no tema aplicado. */
import type { ReactNode } from 'react';
import { View, Text, TextInput, ActivityIndicator } from 'react-native';
import { useTema } from '@/lib/tema';

export function CampoConfig({
  label, icon, value, onChange, placeholder, secureTextEntry = false, keyboardType = 'default',
  editavel = true, buscando = false, maxLength, autoCapitalize, ultimo = false,
}: {
  label: string;
  icon?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'numeric' | 'decimal-pad' | 'email-address';
  /** false = somente leitura. */
  editavel?: boolean;
  /** Mostra um indicador ao lado (busca de CEP/CNPJ em andamento). */
  buscando?: boolean;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  /** Último campo do cartão: sem linha embaixo. */
  ultimo?: boolean;
}) {
  const { C } = useTema();
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: ultimo ? 0 : 1, borderBottomColor: C.border }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {icon && (
          <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {icon}
          </View>
        )}
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={C.text4}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          editable={editavel}
          maxLength={maxLength}
          autoCapitalize={autoCapitalize}
          style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: editavel ? C.text : C.text3 }}
        />
        {buscando && <ActivityIndicator size="small" color={C.accent} />}
      </View>
    </View>
  );
}
