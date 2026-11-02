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
import { CHAVE_TEMA_APP, lerModoTema, resolverEsquemaTema, type EsquemaTema, type ModoTema } from '@shared/tema';

/** Paleta clara: a mesma que as telas do app usavam, uma por arquivo. */
export const PALETA_CLARA = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8', accentSoft: 'rgba(155,111,232,0.06)',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  red: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
  linha: '#D8D0C8',
};

export type Paleta = { [K in keyof typeof PALETA_CLARA]: string };

/**
 * Paleta escura com as mesmas chaves. `primary`, `green`, `amber` e `red` servem tanto de fundo
 * (com texto branco) quanto de texto sobre `surface`: os tons foram escolhidos para os dois usos.
 */
export const PALETA_ESCURA: Paleta = {
  bg: '#121017', surface: '#1C1824', border: '#2E2838',
  primary: '#8F6BEA', primarySoft: '#2A2140',
  accent: '#B497F5', accentSoft: 'rgba(180,151,245,0.10)',
  green: '#2BA57C', greenSoft: '#12302A',
  amber: '#D98A1F', amberSoft: '#33260F',
  rose: '#E07AA0', roseSoft: '#3A1E2C',
  red: '#E05A4F', redSoft: '#3A1A1A',
  text: '#F2EEF8', text2: '#CFC6DE', text3: '#A094B8', text4: '#6E6482',
  linha: '#3A3346',
};

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

/** Cores do tema aplicado neste trecho. `escuro` serve para a StatusBar e detalhes. */
export function useTema(): { C: Paleta; escuro: boolean } {
  const esquema = useContext(TemaAplicadoContext);
  return esquema === 'escuro' ? { C: PALETA_ESCURA, escuro: true } : { C: PALETA_CLARA, escuro: false };
}
