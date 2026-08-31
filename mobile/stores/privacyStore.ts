import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Modo privado: oculta valores sensíveis (R$, %, metas, contagens) nas telas.
 * Estado global, lembrado no aparelho (AsyncStorage).
 */
interface PrivacyStore {
  hidden: boolean;
  toggle: () => void;
}

export const usePrivacyStore = create<PrivacyStore>()(
  persist(
    (set) => ({
      hidden: false,
      toggle: () => set((s) => ({ hidden: !s.hidden })),
    }),
    {
      name: 'bm-privacy',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
