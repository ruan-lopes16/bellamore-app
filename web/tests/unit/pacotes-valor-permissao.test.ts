import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  motivoBloqueioVendaPacote, valorPacoteEditavel, MSG_SEM_PERMISSAO_VALOR_PACOTE,
} from '@shared/pacotes-venda';

// Brecha de preço da 096: valor_unit diferente do preço do catálogo exige comanda.desconto (como o
// desconto). A tela só deixa editar o valor com a permissão; a regra é única (shared) e o banco confere.
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const modal = ler('web/components/pacotes/VenderPacoteModal.tsx');
const sheet = ler('mobile/components/pacotes/VenderPacoteSheet.tsx');
const migr = ler('supabase/migrations/096_pacotes_venda_unica.sql');
const contrato = ler('docs/superpowers/notes/2026-10-23-contrato-pacotes.md');

const ok = { podeFechar: true, motivo: null };
const d = {
  temPacote: true, temCliente: true, quantidade: 2, valorTxt: '300', valorUnit: 300, erroDesconto: null,
  cobranca: 'agora' as const, resumo: ok, configPronta: true, precoCatalogo: 300, podeDesconto: false,
};

describe('regra única do valor do pacote', () => {
  it('mensagem igual à do banco', () => {
    expect(MSG_SEM_PERMISSAO_VALOR_PACOTE).toBe('Você não tem permissão para mudar o valor do pacote.');
    expect(migr).toContain(`raise exception '${MSG_SEM_PERMISSAO_VALOR_PACOTE}' using errcode = '42501'`);
  });
  it('o valor só é editável com comanda.desconto', () => {
    expect(valorPacoteEditavel(true)).toBe(true);
    expect(valorPacoteEditavel(false)).toBe(false);
  });
  it('sem a permissão: preço do catálogo passa; qualquer outro valor é recusado (para baixo, para cima, R$ 0)', () => {
    expect(motivoBloqueioVendaPacote(d)).toBeNull();
    for (const v of [299.99, 300.01, 0]) {
      expect(motivoBloqueioVendaPacote({ ...d, valorTxt: String(v), valorUnit: v })).toBe(MSG_SEM_PERMISSAO_VALOR_PACOTE);
      expect(motivoBloqueioVendaPacote({ ...d, cobranca: 'comanda', valorTxt: String(v), valorUnit: v })).toBe(MSG_SEM_PERMISSAO_VALOR_PACOTE);
    }
  });
  it('com a permissão: valor combinado livre', () => {
    expect(motivoBloqueioVendaPacote({ ...d, podeDesconto: true, valorTxt: '250', valorUnit: 250 })).toBeNull();
  });
  it('compara em centavos (300 = 300,00)', () => {
    expect(motivoBloqueioVendaPacote({ ...d, valorUnit: 300.0000001 })).toBeNull();
  });
});

describe('telas: campo de valor só editável com a permissão (web e app)', () => {
  it('modal (web) e sheet (app) usam a regra de shared e passam preço e permissão ao bloqueio', () => {
    for (const f of [modal, sheet]) {
      expect(f).toMatch(/const valorEditavel = valorPacoteEditavel\(podeDesconto\);/);
      expect(f).toMatch(/precoCatalogo: pacote\?\.preco \?\? null, podeDesconto/);
    }
    expect(modal).toMatch(/readOnly=\{!valorEditavel\}/);
    expect(sheet).toMatch(/editable=\{valorEditavel\}/);
  });
  it('contrato atualizado', () => {
    expect(contrato).toContain(MSG_SEM_PERMISSAO_VALOR_PACOTE);
    expect(contrato).toMatch(/`valor_unit` diferente do preço do catálogo[^\n]*`comanda\.desconto`/);
  });
});
