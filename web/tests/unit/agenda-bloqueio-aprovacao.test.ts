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

describe('agenda: pílula + modal de bloqueios pendentes (aprovar/recusar)', () => {
  it('tem fluxo de aprovar/recusar pendente', () => {
    expect(src).toContain("update({ situacao: 'aprovado'");
    expect(src).toContain('PendentesBloqueioBtn');
  });
  it('handler de aprovar mantém .select(\'id\') + guarda de zero linhas', () => {
    expect(src).toMatch(/async function aprovarBloqueio\(id: string\)[\s\S]*?\.select\('id'\);[\s\S]*?if \(error \|\| !rows \|\| rows\.length === 0\)/);
  });
  it('handler de recusar apaga a linha e mantém guarda de zero linhas', () => {
    expect(src).toMatch(/async function recusarBloqueio\(id: string\)[\s\S]*?\.delete\(\)[\s\S]*?\.select\('id'\);[\s\S]*?if \(error \|\| !rows \|\| rows\.length === 0\)/);
  });
  it('pílula só renderiza para a gestão', () => {
    expect(src).toMatch(/ehGestao && \(\s*<PendentesBloqueioBtn/);
  });
  it('componente esconde-se quando não há pendentes e usa o rótulo de motivo compartilhado', () => {
    expect(src).toMatch(/if \(pendentes\.length === 0\) return null/);
    expect(src).toContain('motivoBloqueioLabel(b.motivo)');
  });
  it('recusar exige passo de confirmação inline', () => {
    expect(src).toContain('Confirmar recusa');
    expect(src).toContain('confirmarRecusa');
  });
});

describe('agenda: TimelineView desenha bloqueio pendente + trava do remover', () => {
  it('TimelineView recebe meuRole e meuUserId (destructure + type + call site)', () => {
    expect(src).toMatch(/function TimelineView\(\{[\s\S]*?meuRole, meuUserId,[\s\S]*?\}: \{/);
    expect(src).toMatch(/onDeletarBloqueio: \(id: string\) => void;\s*meuRole: string; meuUserId: string;/);
    expect(src).toMatch(/<TimelineView[\s\S]*?meuRole=\{meuRole\}[\s\S]*?meuUserId=\{meuUserId\}[\s\S]*?\/>/);
  });

  it('filtro visual esconde pendente de quem não é gestão nem criador', () => {
    expect(src).toMatch(/\.filter\(b =>[\s\S]*?b\.situacao === 'aprovado'[\s\S]*?meuRole === 'owner' \|\| meuRole === 'gestor'[\s\S]*?b\.criado_por === meuUserId,\s*\)/);
  });

  it('podeRemover libera o "X" para gestão ou para o criador do bloco ainda pendente', () => {
    expect(src).toMatch(/const podeRemover = meuRole === 'owner' \|\| meuRole === 'gestor'\s*\|\| \(pendente && bl\.criado_por === meuUserId\)/);
    expect(src).toMatch(/\{podeRemover && \([\s\S]*?onDeletarBloqueio\(bl\.id\)/);
  });

  it('bloco pendente ganha hachura + pílula "aguardando aprovação"; aprovado fica sólido', () => {
    expect(src).toMatch(/const pendente\s+= bl\.situacao === 'pendente'/);
    expect(src).toMatch(/background: pendente\s*\?\s*'repeating-linear-gradient\(45deg[\s\S]*?:\s*'var\(--color-rose-soft\)'/);
    expect(src).toMatch(/\{pendente && \([\s\S]*?aguardando aprovação/);
  });

  it('deletarBloqueio: guarda estado anterior, .select(\'id\'), restaura em zero linhas e limpa pendentes no sucesso', () => {
    expect(src).toMatch(/async function deletarBloqueio\(id: string\) \{\s*const anterior = bloqueios;/);
    expect(src).toMatch(/\.from\('agenda_bloqueios'\)\.delete\(\)\.eq\('id', id\)\.select\('id'\);/);
    expect(src).toMatch(/if \(error \|\| !rows \|\| rows\.length === 0\) \{\s*setBloqueios\(anterior\);[\s\S]*?return;\s*\}\s*setBloqueiosPendentes\(prev => prev\.filter\(b => b\.id !== id\)\);/);
  });
});
