import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'app', '(app)', 'clientes', '[id]', 'page.tsx'), 'utf8');

describe('perfil web: anamnese em anamnese_fichas', () => {
  it('usa o formato canônico de shared/anamnese', () => {
    expect(src).toContain("from '@shared/anamnese'");
    expect(src).toContain('PERGUNTAS_SIM_NAO');
    expect(src).toContain('PERGUNTAS_OPCOES');
    expect(src).not.toMatch(/type Anamnese = \{/);
  });
  it('não lê nem grava anamnese em clientes.observacoes', () => {
    expect(src).not.toMatch(/JSON\.parse\(cliente\.observacoes/);
    expect(src).not.toMatch(/update\(\{\s*observacoes:\s*JSON\.stringify/);
  });
  it('checa o erro da consulta da ficha e bloqueia a edição quando falha', () => {
    expect(src).toContain('rFicha.error');
    expect(src).toContain('Não foi possível carregar a ficha de anamnese');
    expect(src).toContain('!erroCargaAn');
  });
  it('grava com upsert por (empresa_id, cliente_id), conferindo erro e linhas', () => {
    const i = src.indexOf(".from('anamnese_fichas')");
    expect(i).toBeGreaterThan(-1);
    const salvar = src.slice(src.indexOf('.upsert('), src.indexOf('.upsert(') + 400);
    expect(salvar).toContain("onConflict: 'empresa_id,cliente_id'");
    expect(salvar).toContain(".select('id')");
  });
});
