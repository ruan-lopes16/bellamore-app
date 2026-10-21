import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const mob = join(__dirname, '..', '..', '..', 'mobile');
const ler = (p: string) => readFileSync(join(mob, p), 'utf8');

describe('app: agendar pela área da profissional e editar pelo detalhe', () => {
  it('a rota (profissional)/novo-agendamento existe e reaproveita a tela da empresa', () => {
    expect(existsSync(join(mob, 'app/(profissional)/novo-agendamento.tsx'))).toBe(true);
    expect(ler('app/(profissional)/novo-agendamento.tsx')).toContain("../(empresa)/novo-agendamento");
  });
  it('a rota fica registrada no layout sem aparecer nas abas', () => {
    expect(ler('app/(profissional)/_layout.tsx')).toMatch(/name="novo-agendamento"[^/]*href: null/);
  });
  it('as duas agendas mandam ?data=AAAA-MM-DD&hora=HH:MM', () => {
    for (const arq of ['app/(profissional)/agenda.tsx', 'app/(empresa)/agenda.tsx']) {
      const s = ler(arq);
      expect(s).toContain('?data=${');
      expect(s).toContain('&hora=${');
      expect(s).not.toContain("novo-agendamento?hora=");
      expect(s).not.toContain("yyyy-MM-dd'T'HH:mm");
    }
  });
  it('a agenda da profissional trava o agendamento nela mesma', () => {
    expect(ler('app/(profissional)/agenda.tsx')).toContain('&profissional=${');
  });
  it('na área da profissional o seletor de profissional fica travado nela, mesmo com gerenciar_outras', () => {
    const s = ler('app/(empresa)/novo-agendamento.tsx');
    expect(s).toContain("useSegments()[0] === '(profissional)'");
    expect(s).toMatch(/podeOutras\s*=\s*pode\('agenda\.gerenciar_outras'\)\s*&&\s*!naAreaProfissional/);
  });
  it('os dois detalhes têm o botão Editar para quem pode mexer, escondido com comanda fechada', () => {
    for (const [arq, rota] of [
      ['app/(empresa)/agendamento/[id].tsx', '/(empresa)/novo-agendamento?id='],
      ['app/(profissional)/agendamento/[id].tsx', '/(profissional)/novo-agendamento?id='],
    ]) {
      const s = ler(arq);
      expect(s).toContain(rota);
      expect(s).toContain('podeMexerNoAgendamento');
      expect(s).toMatch(/podeEditar\s*=[\s\S]{0,300}comanda_id/);
      expect(s).toContain('Editar');
    }
  });
});
