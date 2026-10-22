import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Revisão das Tasks 3/4: as duas listas usam os mesmos filtros, cartões, tags e textos de shared.
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');
const telas = {
  web: ler('web/app/(app)/clientes/page.tsx'),
  app: ler('mobile/app/(empresa)/clientes.tsx'),
};

describe('Clientes: lista igual no web e no app', () => {
  for (const [nome, src] of Object.entries(telas)) {
    it(`${nome}: filtros, cartões, tags e textos vêm de shared`, () => {
      for (const f of ['FILTROS_CLIENTES', 'CARTOES_CLIENTES', 'tagsDaLinha', 'textoUltimaVisita', 'textoListaVazia']) {
        expect(src).toContain(f);
      }
      // sem lista local de filtros nem de tags
      expect(src).not.toMatch(/\[\s*'todas',\s*'novas',/);
      expect(src).not.toMatch(/ORDEM_SEGMENTOS|ORDEM_TAGS/);
      expect(src).not.toMatch(/label:\s*'Nunca atendidas'/);
    });
  }

  it('app: contagem da lista em "—" enquanto carrega ou com erro (nunca 0)', () => {
    expect(telas.app).toMatch(/isError \|\| !base \? '—'/);
  });
});

describe('novo-agendamento do app: só clientes ativas', () => {
  it("usa o filtro 'todas' (exclui arquivadas) sobre a base única", () => {
    const src = ler('mobile/app/(empresa)/novo-agendamento.tsx');
    expect(src).toMatch(/filtrarClientes\([\s\S]{0,200}'todas'/);
  });
  it('a base única lê de public.clientes, nunca de users/empresa_membros', () => {
    const src = ler('shared/clientes-consultas.ts');
    expect(src).toContain("db.from('clientes')");
    expect(src).not.toContain("from('users')");
  });
});
