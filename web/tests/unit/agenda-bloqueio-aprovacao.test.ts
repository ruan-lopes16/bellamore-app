import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(process.cwd(), 'app', '(app)', 'agenda', 'page.tsx'), 'utf8');

describe('agenda: bloqueio com tipos + aprovacao', () => {
  it('importa os helpers compartilhados de bloqueio', () => {
    expect(src).toMatch(/from '@shared\/bloqueios'/);
    expect(src).toContain('montarInsertBloqueio');
    expect(src).toContain('podeSelecionarEscopoGeral');
  });
  it('carrega pendentes filtrando situacao pendente', () => {
    expect(src).toMatch(/\.eq\('situacao', 'pendente'\)/);
  });
  it('faz polling de 30s de pendentes', () => {
    expect(src).toContain('30_000');
  });
  it('fetchDia traz escopo/motivo/situacao/criado_por', () => {
    expect(src).toMatch(/agenda_bloqueios'\)\s*\.select\('id, profissional_id, titulo, data_inicio, data_fim, escopo, motivo, situacao, criado_por'\)/);
  });
});

describe('agenda: NovoBloqueioModal reescrito (escopo + motivo + papel)', () => {
  it('gate do toggle de escopo pelo helper de papel', () => {
    expect(src).toMatch(/const ehGestao = podeSelecionarEscopoGeral\(meuRole\)/);
  });
  it('oferece o toggle "Um profissional" / "Toda a agenda"', () => {
    expect(src).toContain('Um profissional');
    expect(src).toContain('Toda a agenda');
  });
  it('select de motivo montado a partir de MOTIVOS_BLOQUEIO', () => {
    expect(src).toContain('MOTIVOS_BLOQUEIO.map(');
  });
  it('caminho do profissional: sem toggle, texto de aprovacao e botao "Pedir bloqueio"', () => {
    expect(src).toContain('Vai para aprovação da dona ou gestora.');
    expect(src).toContain("ehGestao ? 'Bloquear' : 'Pedir bloqueio'");
  });
  it('usa montarInsertBloqueio em vez de objeto de insert manual', () => {
    expect(src).toContain('montarInsertBloqueio({');
    expect(src).toMatch(/\.insert\(insert\)\s*\.select\('id, profissional_id, titulo, data_inicio, data_fim, escopo, motivo, situacao, criado_por'\)/);
  });
  it('bloqueia submit quando gestao escolhe "Um profissional" sem selecionar ninguem', () => {
    expect(src).toMatch(/if \(ehGestao && escopo === 'profissional' && !profId\)[\s\S]*?Escolha o profissional\./);
  });
  it('remove a IIFE antiga de profsUnicos e passa a lista completa de membros', () => {
    expect(src).not.toContain('profsUnicos');
    expect(src).toContain('membros={membrosAtivos}');
    expect(src).toMatch(/meuNome=\{membrosAtivos\.find\(m => m\.id === meuUserId\)\?\.nome \?\? 'Você'\}/);
  });
  it('pedido pendente dispara toast neutro no call site', () => {
    expect(src).toMatch(/if \(b\.situacao === 'pendente'\) showErro\('Pedido de bloqueio enviado para aprovação\.'\)/);
  });
});
