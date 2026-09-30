import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const tela = readFileSync(join(root, 'mobile/app/(empresa)/cliente/[id]/anamnese.tsx'), 'utf8');
const perfil = readFileSync(join(root, 'mobile/app/(empresa)/cliente/[id].tsx'), 'utf8');

describe('mobile: anamnese no formato canônico', () => {
  it('tela usa shared/anamnese e não tem lista de perguntas própria', () => {
    expect(tela).toContain("from '@shared/anamnese'");
    expect(tela).not.toMatch(/const PERGUNTAS:/);
    expect(tela).toContain('TEXTO_DECLARACAO');
  });
  it('só salva com a declaração aceita, via upsert, conferindo linhas', () => {
    expect(tela).toMatch(/declaracao_aceita/);
    expect(tela).toContain("onConflict: 'empresa_id,cliente_id'");
    expect(tela).toContain(".select('id')");
    expect(tela).not.toMatch(/profissional_id:\s*null/);
  });
  it('não permite salvar quando a ficha falhou ao carregar', () => {
    expect(tela).toContain('erroAnamnese');
    expect(tela).toContain('Não foi possível carregar a ficha de anamnese');
  });
  it('perfil calcula o alerta com restricoesAnamnese (não compara === "Sim")', () => {
    expect(perfil).toContain('restricoesAnamnese');
    expect(perfil).not.toMatch(/===\s*'Sim'/);
  });
});
