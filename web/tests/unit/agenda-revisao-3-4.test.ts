import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { msgBloqueio, valorDigitadoValido, montarAgendamento } from '../../../shared/agenda';

// Revisão das Tasks 3 e 4 da paridade da Agenda: regras únicas e travas iguais no web e no app.
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const web = ler('web/app/(app)/agenda/page.tsx');
const cliente = ler('web/app/(app)/clientes/[id]/page.tsx');
const app = ler('mobile/app/(empresa)/novo-agendamento.tsx');
const appLinhas = ler('mobile/components/agenda/LinhasServicoEditor.tsx');

describe('msgBloqueio (mesmo texto do trigger 074, com o rótulo do motivo)', () => {
  it('usa o rótulo do motivo', () => {
    expect(msgBloqueio('folga')).toBe('Horário bloqueado na agenda (Folga). Remova o bloqueio para agendar nesse período.');
  });
  it('sem motivo → "bloqueio"; motivo desconhecido → o próprio texto', () => {
    expect(msgBloqueio(null)).toBe('Horário bloqueado na agenda (bloqueio). Remova o bloqueio para agendar nesse período.');
    expect(msgBloqueio('xyz')).toBe('Horário bloqueado na agenda (xyz). Remova o bloqueio para agendar nesse período.');
  });
  it('web e app usam a mesma função', () => {
    expect(web).toContain('msgBloqueio(');
    expect(app).toContain('msgBloqueio(');
    expect(app).not.toMatch(/function msgBloqueio/);
    expect(web).not.toContain('Remova o bloqueio para agendar nesse horário.');
  });
});

describe('valorDigitadoValido (texto inválido nunca vira cortesia calada)', () => {
  it('vazio, zero escrito e número positivo valem', () => {
    for (const t of ['', '  ', '0', '0,00', 'R$ 0', '150', '150,50', '1.234,56', '0,5']) expect(valorDigitadoValido(t)).toBe(true);
  });
  it('texto inválido ou negativo não vale', () => {
    for (const t of ['abc', '-5', '12a', ',']) expect(valorDigitadoValido(t)).toBe(false);
  });
  it('app e web usam a de shared', () => {
    expect(appLinhas).not.toMatch(/export function valorDigitadoValido/);
    expect(web).toContain('valorDigitadoValido(');
    expect(cliente).toContain('valorDigitadoValido(');
  });
});

describe('web: valor da linha como texto (vazio = preço, "0" = cortesia)', () => {
  it('montarAgendamento: vazio usa o preço', () => {
    const l = { servico_id: 's', profissional_id: 'p', duracao_min: 30, preco: 80 };
    expect(montarAgendamento({ linhas: [{ ...l, valor: '' }], inicioIso: '2026-10-19T12:00:00Z' }).valorTotal).toBe(80);
    expect(montarAgendamento({ linhas: [{ ...l, valor: '0' }], inicioIso: '2026-10-19T12:00:00Z' }).valorTotal).toBe(0);
  });
  it('agenda: sem campo numérico de valor que transforma vazio em 0, e sem String(l.valor)', () => {
    expect(web).not.toContain('valor: Number(e.target.value)');
    expect(web).not.toContain('String(l.valor');
    expect(web).toMatch(/preco:\s*precoDe\(/);
  });
  it('agenda grava as linhas montadas (com o preço no vazio)', () => {
    expect(web).toContain('let linhasGravar = montado.linhas;');
    expect(web).toMatch(/linhasGravar\.map\(\(l, i\) => \(\{/);
  });
  it('perfil da cliente: sem parseFloat(valor) || 0', () => {
    expect(cliente).not.toContain('parseFloat(valor) || 0');
    expect(cliente).toMatch(/preco:\s*precoServico/);
  });
  it('taxa de reserva lida com parseValorBR nas duas telas do web', () => {
    expect(web).not.toContain("parseFloat(taxaReserva.replace(',', '.'))");
    expect(cliente).not.toContain("parseFloat(taxaReserva.replace(',', '.'))");
  });
});

describe('web: comanda fechada trava a edição (igual ao app)', () => {
  it('carrega comanda_id e mostra MSG_CONCLUIDO_COM_COMANDA', () => {
    // `*` traz comanda_id (e desconto_rateado com a 090); a Task 10 trocou a lista explícita por `*`.
    expect(web).toMatch(/select\(`\*,\s*cliente:clientes!agendamentos_cliente_id_fkey\(id,nome,telefone\)/);
    expect(web).toContain('MSG_CONCLUIDO_COM_COMANDA');
    expect(web).toMatch(/edicaoTravada = !!agEditar\?\.comanda_id/);
  });
});

describe('web: nova tentativa depois de falha nos serviços não duplica (igual ao app)', () => {
  it('guarda o id criado e só regrava as linhas', () => {
    expect(web).toContain('setIdCriado({ id: agId');
    expect(web).toMatch(/if \(idCriado\)/);
    expect(web).toContain('pacoteVendidoRef');
  });
});

describe('web: conflito e horário passado com os textos únicos', () => {
  it('usa msgConflito, MSG_HORARIO_PASSADO e instanteNoPassado', () => {
    expect(web).toContain('msgConflito(');
    expect(web).toContain('MSG_HORARIO_PASSADO');
    expect(web).toContain('instanteNoPassado(');
  });
  it('confere o erro da consulta de conflito', () => {
    expect(web).toMatch(/const \{ data: conf, error: errConf \} = await confQuery/);
  });
});
