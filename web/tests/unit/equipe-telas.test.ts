// web/tests/unit/equipe-telas.test.ts
// Trava a tela Equipe do web (Task 3 da paridade de equipe): usa as funções de shared, manda empresaId
// e só os campos alterados no PATCH, e mostra os erros da API. A Task 4 acrescenta o bloco do app.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

describe('web', () => {
  const src = ler('web/app/(app)/equipe/page.tsx');

  it('carrega e grava pelas funções de shared', () => {
    expect(src).toContain('carregarEquipe(');
    expect(src).toContain('chaveMesBRT(new Date())');
    expect(src).toContain('alterarAtivo(');
    expect(src).toContain('alterarPapel(');
    expect(src).toContain('rotuloContrato');
    expect(src).toContain('MembroEquipe');
    expect(src).not.toContain(".from('empresa_membros').update(");
    expect(src).not.toMatch(/\balert\(/);
  });

  it('erro de carga vira banner com "Tentar de novo" e há contador de requisição', () => {
    expect(src).toContain('Tentar de novo');
    expect(src).toMatch(/reqRef/);
  });

  it('NovoProfModal manda tipo_contrato e comissão nos dois caminhos', () => {
    const ini = src.indexOf('function NovoProfModal(');
    const fim = src.indexOf('function camposAlterados(');
    const novo = src.slice(ini, fim);
    expect(novo).toContain('percentual_comissao');
    expect(novo).toContain('Tipo de contrato');
    // um único fetch com o mesmo corpo para convite e senha
    expect(novo.match(/tipo_contrato:/g)?.length).toBe(1);
    expect(novo).toContain("usarConvite ? '/api/convites' : '/api/profissionais'");
  });

  it('PATCH manda empresaId e só o que mudou', () => {
    const ini = src.indexOf('function camposAlterados(');
    const fim = src.indexOf('function ProfCard(');
    const edit = src.slice(ini, fim);
    expect(edit).toContain('empresaId');
    expect(edit).toContain("method:  'PATCH'");
    expect(edit).toContain('camposAlterados(prof, empresaId');
    expect(edit).toContain('Trocar o e-mail troca também o login dela no app.');
    // e-mail, comissão e contrato só entram no corpo se mudaram
    expect(edit).toMatch(/if \(v\.emailNovo !== v\.emailAntigo\)/);
    expect(edit).toMatch(/if \(normalizarComissao\(v\.comissao\.trim\(\)\) !== prof\.percentual_comissao\)/);
    expect(edit).not.toContain('parseFloat');
    expect(edit).toMatch(/if \(\(v\.tipoContrato \|\| null\) !== prof\.tipo_contrato\)/);
    expect(edit).not.toMatch(/email:\s+email\.trim\(\) \|\| null/);
  });
});
