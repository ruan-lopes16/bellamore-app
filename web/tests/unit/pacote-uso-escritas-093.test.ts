// web/tests/unit/pacote-uso-escritas-093.test.ts
// Ajuste da 093 (a): pacote_uso deixou de aceitar escrita de qualquer membro. A RLS recusa UPDATE e
// DELETE com 0 linhas e sucesso; as telas Pacotes (web e app) passam a conferir as linhas afetadas.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { erroEscritaPacoteUso } from '@shared/pacotes-consultas';

const raiz = resolve(__dirname, '../../..');
const ler = (p: string) => readFileSync(resolve(raiz, p), 'utf8');

describe('erroEscritaPacoteUso', () => {
  it('linha afetada → sem erro', () => {
    expect(erroEscritaPacoteUso({ data: [{ id: 'u1' }], error: null }, 'excluir a sessão')).toBeNull();
  });
  it('0 linhas (RLS) → mensagem de permissão em português', () => {
    expect(erroEscritaPacoteUso({ data: [], error: null }, 'excluir a sessão'))
      .toBe('Você não tem permissão para excluir a sessão. Fale com a dona ou a gestora.');
    expect(erroEscritaPacoteUso({ data: null, error: null }, 'editar a sessão'))
      .toBe('Você não tem permissão para editar a sessão. Fale com a dona ou a gestora.');
  });
  it('erro de RLS no INSERT → mesma mensagem, nunca o texto técnico', () => {
    const r = erroEscritaPacoteUso(
      { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "pacote_uso"' } },
      'lançar a sessão',
    );
    expect(r).toBe('Você não tem permissão para lançar a sessão. Fale com a dona ou a gestora.');
  });
});

describe('telas Pacotes (web e app): toda escrita em pacote_uso confere as linhas', () => {
  for (const arq of ['web/app/(app)/pacotes/page.tsx', 'mobile/app/(empresa)/pacotes.tsx']) {
    const s = ler(arq);
    it(`${arq}: insert, update e delete com .select('id')`, () => {
      const escritas = s.match(/from\('pacote_uso'\)\.(insert|update|delete)\([\s\S]*?;/g) ?? [];
      expect(escritas).toHaveLength(4); // avulsa, vínculo, edição, exclusão
      for (const e of escritas) expect(e).toMatch(/\.select\('id'\)/);
    });
    it(`${arq}: usa erroEscritaPacoteUso`, () => {
      expect((s.match(/erroEscritaPacoteUso\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
    });
  }
});
