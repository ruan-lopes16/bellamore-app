/**
 * Tema do app (modo escuro). A escolha (Claro / Escuro / Sistema) fica no AsyncStorage
 * (`CHAVE_TEMA_APP`) e é lida pelo `TemaProvider` da raiz.
 *
 * Migração gradual, sem tela ilegível:
 * - o tema APLICADO vem de um contexto cujo padrão é **claro**. Uma tela só fica escura se ela
 *   mesma pedir, exportando `comTemaDoUsuario(Tela)` e lendo as cores de `useTema().C`;
 * - telas ainda não migradas têm a própria paleta clara fixa e, se usarem um componente que já
 *   segue o tema (ex.: `SeletorEmpresa`), ele também sai claro (padrão do contexto);
 * - `TemaClaroFixo` força o claro num trecho de uma tela migrada (ex.: um painel ainda não migrado).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PALETA_CLARA, PALETA_ESCURA, type Paleta } from '@shared/paleta-tema';
import { CHAVE_TEMA_APP, lerModoTema, resolverEsquemaTema, type EsquemaTema, type ModoTema } from '@shared/tema';

export { PALETA_CLARA, PALETA_ESCURA, type Paleta };

type Preferencia = {
  /** Escolha da pessoa. */
  modo: ModoTema;
  /** Esquema que a escolha dá agora (no modo Sistema, o do aparelho). */
  esquema: EsquemaTema;
  definirModo: (m: ModoTema) => Promise<void>;
};

const PreferenciaContext = createContext<Preferencia>({
  modo: 'sistema', esquema: 'claro', definirModo: async () => {},
});

/** Tema aplicado. Padrão claro: tela que não pediu o tema do usuário fica clara. */
const TemaAplicadoContext = createContext<EsquemaTema>('claro');

/** Provider da raiz: lê e grava a escolha no AsyncStorage e acompanha o esquema do aparelho. */
export function TemaProvider({ children }: { children: ReactNode }) {
  const sistema = useColorScheme();
  const [modo, setModo] = useState<ModoTema>('sistema');

  useEffect(() => {
    let vivo = true;
    AsyncStorage.getItem(CHAVE_TEMA_APP)
      .then((v) => { if (vivo) setModo(lerModoTema(v)); })
      .catch(() => { /* sem leitura: segue o aparelho */ });
    return () => { vivo = false; };
  }, []);

  const definirModo = useCallback(async (m: ModoTema) => {
    setModo(m);
    try { await AsyncStorage.setItem(CHAVE_TEMA_APP, m); } catch { /* vale nesta sessão */ }
  }, []);

  const valor = useMemo(
    () => ({ modo, esquema: resolverEsquemaTema(modo, sistema), definirModo }),
    [modo, sistema, definirModo],
  );
  return <PreferenciaContext.Provider value={valor}>{children}</PreferenciaContext.Provider>;
}

/** Escolha da pessoa e o esquema resultante (abas, seletor de modo). */
export function usePreferenciaTema(): Preferencia {
  return useContext(PreferenciaContext);
}

/** Aplica o tema da pessoa a um trecho (telas migradas). */
export function TemaDoUsuario({ children }: { children: ReactNode }) {
  const { esquema } = usePreferenciaTema();
  return <TemaAplicadoContext.Provider value={esquema}>{children}</TemaAplicadoContext.Provider>;
}

/** Força o tema claro num trecho (componente ainda não migrado dentro de uma tela migrada). */
export function TemaClaroFixo({ children }: { children: ReactNode }) {
  return <TemaAplicadoContext.Provider value="claro">{children}</TemaAplicadoContext.Provider>;
}

/** Envolve uma tela migrada no tema da pessoa: `export default comTemaDoUsuario(function Tela() {...})`. */
export function comTemaDoUsuario<P extends object>(Tela: ComponentType<P>): ComponentType<P> {
  function ComTema(props: P) {
    return <TemaDoUsuario><Tela {...props} /></TemaDoUsuario>;
  }
  ComTema.displayName = `comTemaDoUsuario(${Tela.displayName ?? Tela.name ?? 'Tela'})`;
  return ComTema;
}

/**
 * StatusBar de tela sobre o fundo do tema: ícones escuros no claro e claros no escuro.
 * (Telas com cabeçalho roxo continuam com `barStyle="light-content"` direto.)
 */
export function BarraDeStatus({ comFundo = false }: { comFundo?: boolean }) {
  const { C, escuro } = useTema();
  return <StatusBar barStyle={escuro ? 'light-content' : 'dark-content'} backgroundColor={comFundo ? C.bg : undefined} />;
}

/**
 * Cores da ESCOLHA da pessoa, para o que fica na raiz do app, fora de qualquer tela
 * (cobertura de erro, "Sem acesso", faíscas do toque): segue Claro/Escuro/Sistema direto.
 */
export function useTemaGlobal(): { C: Paleta; escuro: boolean } {
  const { esquema } = usePreferenciaTema();
  return esquema === 'escuro' ? { C: PALETA_ESCURA, escuro: true } : { C: PALETA_CLARA, escuro: false };
}

/** Cores do tema aplicado neste trecho. `escuro` serve para a StatusBar e detalhes. */
export function useTema(): { C: Paleta; escuro: boolean } {
  const esquema = useContext(TemaAplicadoContext);
  return esquema === 'escuro' ? { C: PALETA_ESCURA, escuro: true } : { C: PALETA_CLARA, escuro: false };
}
