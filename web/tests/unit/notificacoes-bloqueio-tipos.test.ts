import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { TIPOS_NOTIFICACAO } from '@shared/notificacoes';

const src = readFileSync(
  resolve(__dirname, '../..', 'app/(app)/notificacoes/page.tsx'),
  'utf8',
);

// A tela de notificações renderiza cada linha da tabela `notificacoes` de forma
// genérica — sem whitelist por `tipo`. O visual de cada tipo (inclusive os 3 do
// fluxo de bloqueio, trigger da 069) vem de TIPOS_NOTIFICACAO em shared, igual ao app.

describe('notificacoes: rótulos dos tipos do fluxo de bloqueio', () => {
  it('shared tem ícone + cor + rótulo para os 3 tipos de bloqueio', () => {
    for (const tipo of ['bloqueio_pendente', 'bloqueio_aprovado', 'bloqueio_recusado'] as const) {
      const v = TIPOS_NOTIFICACAO[tipo];
      expect(v.icone).toBeTruthy();
      expect(v.cor).toBeTruthy();
      expect(v.rotulo).toBeTruthy();
    }
  });

  it('a tela importa os ícones lucide usados pelos tipos (Ban / X / Check)', () => {
    expect(src).toMatch(/import\s*\{[\s\S]*?\bBan\b[\s\S]*?\}\s*from 'lucide-react'/);
    expect(src).toMatch(/import\s*\{[\s\S]*?\bX\b[\s\S]*?\}\s*from 'lucide-react'/);
    expect(src).toMatch(/import\s*\{[\s\S]*?\bCheck\b[\s\S]*?\}\s*from 'lucide-react'/);
  });

  it('o mapa de shared é consumido no render dos avisos (não é código morto)', () => {
    expect(src).toMatch(/TIPOS_NOTIFICACAO\[t\]/);
  });
});
