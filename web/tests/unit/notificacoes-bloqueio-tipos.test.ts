import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(
  resolve(__dirname, '../..', 'app/(app)/notificacoes/page.tsx'),
  'utf8',
);

// A tela de notificações renderiza cada linha da tabela `notificacoes` de forma
// genérica — não há whitelist/filtro por `tipo` na query nem no map. O trigger da
// migration 069 grava 3 tipos novos com título/mensagem já em pt-BR; aqui só
// garantimos que a página dá ícone/cor a esses 3 tipos em vez de deixá-los no
// render sem ícone.

describe('notificacoes: rótulos dos tipos do fluxo de bloqueio', () => {
  it('mapeia os 3 tipos novos (bloqueio pendente/aprovado/recusado)', () => {
    for (const tipo of ['bloqueio_pendente', 'bloqueio_aprovado', 'bloqueio_recusado']) {
      expect(src).toContain(tipo);
    }
  });

  it('cada tipo tem entrada com ícone + cor + bg no mapa de estilo', () => {
    expect(src).toMatch(/bloqueio_pendente:\s*\{[\s\S]*?icon:[\s\S]*?cor:[\s\S]*?bg:[\s\S]*?\}/);
    expect(src).toMatch(/bloqueio_aprovado:\s*\{[\s\S]*?icon:[\s\S]*?cor:[\s\S]*?bg:[\s\S]*?\}/);
    expect(src).toMatch(/bloqueio_recusado:\s*\{[\s\S]*?icon:[\s\S]*?cor:[\s\S]*?bg:[\s\S]*?\}/);
  });

  it('importa os ícones lucide usados pelo mapa (Ban / X)', () => {
    expect(src).toMatch(/import\s*\{[\s\S]*?\bBan\b[\s\S]*?\}\s*from 'lucide-react'/);
    expect(src).toMatch(/import\s*\{[\s\S]*?\bX\b[\s\S]*?\}\s*from 'lucide-react'/);
  });

  it('o mapa é consumido no render das notificações salvas (não é código morto)', () => {
    expect(src).toMatch(/TIPO_NOTIF\[n\.tipo\]/);
  });
});
