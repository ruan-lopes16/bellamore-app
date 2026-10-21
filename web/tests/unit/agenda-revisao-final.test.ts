import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { instanteBRT } from '@shared/agenda';

// Revisão final da Paridade Agenda (2026-10-21): costura entre as tasks.
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const PAGE = 'web/app/(app)/agenda/page.tsx';
const NOVO_APP = 'mobile/app/(empresa)/novo-agendamento.tsx';
const DET_EMP = 'mobile/app/(empresa)/agendamento/[id].tsx';

/** Trecho do NovoAgModal do web (do início da função até o modal de bloqueio (NovoBloqueioModal)). */
function modalWeb(): string {
  const cod = semComentarios(ler(PAGE));
  const ini = cod.indexOf('function NovoAgModal(');
  const fim = cod.indexOf('function NovoBloqueioModal(');
  expect(ini).toBeGreaterThan(0);
  expect(fim).toBeGreaterThan(ini);
  return cod.slice(ini, fim);
}

describe('instanteBRT: dia + hora de Brasília → instante', () => {
  it('monta o instante em UTC−3, independente do fuso de quem usa', () => {
    expect(instanteBRT('2026-10-21', '09:30')).toBe('2026-10-21T12:30:00.000Z');
    expect(instanteBRT('2026-10-21', '22:15')).toBe('2026-10-22T01:15:00.000Z');
    expect(instanteBRT('2026-10-21', '00:00')).toBe('2026-10-21T03:00:00.000Z');
  });
});

describe('agendar no web: hora sempre em Brasília (nunca no fuso do navegador)', () => {
  it('o NovoAgModal monta o horário com instanteBRT e não usa setHours', () => {
    const m = modalWeb();
    expect(m).toContain('instanteBRT(');
    expect(m).not.toMatch(/\.setHours\(/);
  });

  it('horas mostradas no modal vêm de horaBRT (conflito, término, sucesso, bloqueio, edição)', () => {
    const m = modalWeb();
    expect(m).not.toMatch(/format\(parseISO\([^)]*\),\s*'HH:mm'\)/);
    expect(m).not.toMatch(/format\(sucesso\./);
    expect(m).not.toMatch(/format\(fim,\s*'HH:mm'\)/);
  });

  it('o bloqueio novo do web também é gravado em Brasília', () => {
    const cod = semComentarios(ler(PAGE));
    const ini = cod.indexOf('function NovoBloqueioModal(');
    const trecho = cod.slice(ini, ini + 4000);
    expect(trecho).not.toMatch(/new Date\(`\$\{dataBl\}T\$\{hora(Ini|Fim)\}:00`\)/);
    expect(trecho).toContain('instanteBRT(dataBl');
  });

  it('o app usa a mesma função de shared (sem cópia local)', () => {
    const app = semComentarios(ler(NOVO_APP));
    expect(app).not.toMatch(/function instanteBRT\b/);
    expect(app).toMatch(/import\s*\{[^}]*\binstanteBRT\b[^}]*\}\s*from\s*'@shared\/agenda'/);
  });

  it('horários de 15 em 15 sugeridos no campo do web (horariosDoDia), com digitação livre', () => {
    const m = modalWeb();
    expect(m).toContain('horariosDoDia(');
    expect(m).toMatch(/<datalist/);
    expect(m).toMatch(/type="time"[^>]*list=/);
  });
});

describe('editar no web: nada muda em silêncio (igual ao app)', () => {
  it('o pacote já vinculado ao atendimento não é desvinculado quando sai da lista de pacotes ativos', () => {
    const m = modalWeb();
    expect(m).toMatch(/setPacoteClienteId\(prev\s*=>[^;]*agEditar\?\.pacote_cliente_id/);
  });

  it('atendimento antigo sem linhas mantém a duração real (o fim não muda ao editar só a observação)', () => {
    const m = modalWeb();
    expect(m).toMatch(/duracaoAg\s*=\s*duracaoReal/);
  });
});

describe('agendar pelo perfil da cliente (web): mesmas regras da agenda', () => {
  const trecho = () => {
    const cod = semComentarios(ler('web/app/(app)/clientes/[id]/page.tsx'));
    const ini = cod.indexOf('function NovoAgModal(');
    expect(ini).toBeGreaterThan(0);
    return cod.slice(ini, ini + 9000);
  };

  it('hora em Brasília (instanteBRT), sem setHours', () => {
    expect(trecho()).toContain('instanteBRT(');
    expect(trecho()).not.toMatch(/\.setHours\(/);
  });

  it('avisa conflito de horário e horário passado com os textos únicos', () => {
    const t = trecho();
    expect(t).toContain('conflitosDeHorario(');
    expect(t).toContain('msgConflito(');
    expect(t).toContain('instanteNoPassado(');
    expect(t).toContain('MSG_HORARIO_PASSADO');
  });

  it('grava agendamento_servicos como a agenda, sem duplicar o agendamento na nova tentativa', () => {
    const t = trecho();
    expect(t).toMatch(/from\('agendamento_servicos'\)\.insert/);
    expect(t).toContain('idCriado');
  });
});

describe('excluir no app: erro em português, igual ao web', () => {
  it('usa mensagemErroBanco com o mesmo contexto do web', () => {
    const app = semComentarios(ler(DET_EMP));
    expect(app).toContain("mensagemErroBanco(error, 'excluir este agendamento')");
    expect(app).not.toMatch(/Alert\.alert\('Erro',\s*error\.message\)/);
    expect(semComentarios(ler(PAGE))).toContain("mensagemErroBanco(error, 'excluir este agendamento')");
  });
});
