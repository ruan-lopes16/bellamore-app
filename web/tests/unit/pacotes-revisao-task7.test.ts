import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  avisoVendaPacoteAgenda, AVISO_PACOTE_A_COBRAR_AGENDA, AVISO_ESCOLHER_PACOTE_VENDIDO,
  type ResultadoVendaPacote,
} from '@shared/pacotes-venda';
import {
  TEXTO_ITEM_A_COBRAR, TITULO_TIRAR_A_COBRAR, MSG_A_COBRAR_SEM_090, AVISO_PENDENTES_NAO_CARREGADOS,
} from '@shared/comanda-gravacao';

// Revisão da Task 7 (Agenda e Comanda, web e app): mesma regra e mesmos textos nas duas plataformas.
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const agendaWeb = ler('web/app/(app)/agenda/page.tsx');
const agendaApp = ler('mobile/app/(empresa)/novo-agendamento.tsx');
const comandaWeb = ler('web/app/(app)/comanda/page.tsx');
const comandaApp = ler('mobile/app/(empresa)/nova-comanda.tsx');
const modal = ler('web/components/pacotes/VenderPacoteModal.tsx');
const sheet = ler('mobile/components/pacotes/VenderPacoteSheet.tsx');

const r = (x: Partial<ResultadoVendaPacote>): ResultadoVendaPacote => ({
  cobranca: 'comanda', vendaId: 'v', clienteId: 'c', pacoteId: 'p', quantidade: 1, pacoteClienteId: 'v', aviso: null, ...x,
});

describe('avisoVendaPacoteAgenda (aviso depois da venda pela Agenda)', () => {
  it('cobrar na comanda: avisa que o pacote foi vendido e fica a cobrar (mesmo sem salvar o agendamento)', () => {
    expect(AVISO_PACOTE_A_COBRAR_AGENDA).toBe('O pacote foi vendido e fica a cobrar na próxima comanda.');
    expect(avisoVendaPacoteAgenda(r({}))).toBe(AVISO_PACOTE_A_COBRAR_AGENDA);
  });
  it('cobrar agora com o vínculo: sem aviso', () => {
    expect(avisoVendaPacoteAgenda(r({ cobranca: 'agora' }))).toBe('');
  });
  it('sem o id do pacote (caminho antigo): pede para escolher em "Pacote do cliente"', () => {
    expect(avisoVendaPacoteAgenda(r({ cobranca: 'agora', pacoteClienteId: null }))).toBe(AVISO_ESCOLHER_PACOTE_VENDIDO);
  });
  it('o aviso da venda (pagamento não registrado) vem junto, nunca perdido', () => {
    expect(avisoVendaPacoteAgenda(r({ cobranca: 'agora', pacoteClienteId: null, aviso: 'Pagamento X.' })))
      .toBe(`Pagamento X. ${AVISO_ESCOLHER_PACOTE_VENDIDO}`);
    expect(avisoVendaPacoteAgenda(r({ aviso: 'Pagamento X.' }))).toBe(`Pagamento X. ${AVISO_PACOTE_A_COBRAR_AGENDA}`);
  });
});

describe('ResultadoVendaPacote único (shared)', () => {
  it('web e app usam o tipo de shared, com pacoteId e aviso', () => {
    for (const f of [modal, sheet]) {
      expect(f).not.toMatch(/export type ResultadoVendaPacote\s*=\s*\{/);
      expect(f).toMatch(/type ResultadoVendaPacote[\s\S]{0,40}from '@shared\/pacotes-venda'|ResultadoVendaPacote,?[^\n]*\n?[^\n]*from '@shared\/pacotes-venda'/);
    }
    expect(sheet).toMatch(/onVendido\(\{[^}]*pacoteId: pacote\.id[^}]*aviso[^}]*\}\)/);
  });
  it('as Agendas usam o pacote do resultado e o aviso único', () => {
    for (const f of [agendaWeb, agendaApp]) {
      expect(f).toContain('pacotesCatalogo.find(p => p.id === r.pacoteId)');
      expect(f).toContain('setAvisoPacote(avisoVendaPacoteAgenda(r))');
      expect(f).not.toContain('Escolha-o em "Pacote do cliente"');
    }
  });
});

describe('Agenda: vender pacote fica desligado com o formulário travado (web igual ao app)', () => {
  it('web define formTravado como o app (atendimento fechado ou agendamento já criado)', () => {
    expect(agendaWeb).toMatch(/const formTravado = edicaoTravada \|\| !!idCriado;/);
    const i = agendaWeb.indexOf('function onPacoteVenderChange(');
    expect(agendaWeb.slice(i, i + 200)).toContain('if (formTravado) return;');
    expect(agendaWeb).toMatch(/aria-disabled=\{formTravado\}/);
  });
  it('app mantém a trava', () => {
    const i = agendaApp.indexOf('function onPacoteVenderChange(');
    expect(agendaApp.slice(i, i + 200)).toContain('if (formTravado) return;');
    expect(agendaApp).toMatch(/disabled=\{formTravado\}\s*\n\s*onPress=\{\(\) => onPacoteVenderChange\(p\)\}/);
  });
});

describe('Comanda: textos do pacote "a cobrar" únicos (shared) e visíveis nas duas', () => {
  it('textos de shared', () => {
    expect(TEXTO_ITEM_A_COBRAR).toBe('Valor combinado na venda do pacote — para dar desconto, use o desconto da comanda. Tirar da comanda: o pacote continua a cobrar.');
    expect(TITULO_TIRAR_A_COBRAR).toBe('Tirar da comanda (o pacote continua a cobrar)');
    expect(MSG_A_COBRAR_SEM_090).toBe('Não foi possível cobrar o pacote a cobrar nesta versão do banco. Tire o item da comanda para fechar.');
    expect(AVISO_PENDENTES_NAO_CARREGADOS).toBe('Os pacotes a cobrar desta cliente não entraram na comanda.');
  });
  it('web e app usam as constantes (nada de cópia do texto)', () => {
    for (const f of [comandaWeb, comandaApp]) {
      for (const c of ['TEXTO_ITEM_A_COBRAR', 'TITULO_TIRAR_A_COBRAR', 'MSG_A_COBRAR_SEM_090', 'AVISO_PENDENTES_NAO_CARREGADOS']) {
        expect(f).toContain(c);
      }
      expect(f).not.toContain('Valor combinado na venda do pacote');
      expect(f).not.toContain('nesta versão do banco. Tire o item');
      expect(f).toMatch(/\{aCobrar && !emEdicao && \(/);
    }
  });
});

describe('Venda de pacote: rótulo do botão único (web e app)', () => {
  it('textoBotaoVenderPacote', async () => {
    const { textoBotaoVenderPacote } = await import('@shared/pacotes-venda');
    expect(textoBotaoVenderPacote('agora', 290)).toBe('Vender · R$ 290,00');
    expect(textoBotaoVenderPacote('comanda', 290)).toBe('Vender e cobrar na comanda');
  });
  it('modal e sheet usam a função (sem rótulo próprio)', () => {
    for (const f of [modal, sheet]) {
      expect(f).toContain('textoBotaoVenderPacote(cobranca, resumo.total)');
      expect(f).not.toContain('Vender (a cobrar)');
      expect(f).not.toContain("'Vender e cobrar na comanda'");
    }
  });
});
