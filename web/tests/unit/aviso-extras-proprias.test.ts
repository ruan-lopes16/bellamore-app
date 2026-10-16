// web/tests/unit/aviso-extras-proprias.test.ts
// Item 13 (Entrega 4): quem não vê as comandas das colegas (RLS de comanda_itens) vê só os
// próprios serviços extras no Financeiro e nos Relatórios — a tela avisa.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { avisoExtrasSoProprias, AVISO_EXTRAS_SO_PROPRIAS } from '@shared/permissoes';

const raiz = resolve(__dirname, '../../..');
const ler = (p: string) => readFileSync(resolve(raiz, p), 'utf8');

describe('avisoExtrasSoProprias', () => {
  it('texto do aviso', () => {
    expect(AVISO_EXTRAS_SO_PROPRIAS).toBe('Os serviços extras mostrados são só das suas comandas.');
  });
  it('profissional sem agenda.gerenciar_outras vê o aviso', () => {
    expect(avisoExtrasSoProprias({ isOwner: false, papel: 'profissional', chaves: ['financeiro.ver'] })).toBe(AVISO_EXTRAS_SO_PROPRIAS);
  });
  it('com agenda.gerenciar_outras, gestora ou dona: sem aviso', () => {
    expect(avisoExtrasSoProprias({ isOwner: false, papel: 'profissional', chaves: ['agenda.gerenciar_outras'] })).toBeNull();
    expect(avisoExtrasSoProprias({ isOwner: false, papel: 'gestor', chaves: [] })).toBeNull();
    expect(avisoExtrasSoProprias({ isOwner: true, papel: null, chaves: [] })).toBeNull();
  });
});

describe('Financeiro e Relatórios (web e app) mostram o aviso', () => {
  for (const arq of [
    'web/app/(app)/financeiro/page.tsx', 'web/app/(app)/relatorios/page.tsx',
    'mobile/app/(empresa)/financeiro.tsx', 'mobile/app/(empresa)/relatorios.tsx',
  ]) {
    it(arq, () => { expect(ler(arq)).toMatch(/avisoExtrasSoProprias\(/); });
  }
});
