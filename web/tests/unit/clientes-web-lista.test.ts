import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const pagina = readFileSync(join(root, 'web/app/(app)/clientes/page.tsx'), 'utf8');

describe('Clientes web: lista com segmentos únicos', () => {
  it('usa as funções de shared em vez de regra local', () => {
    expect(pagina).toContain('@shared/clientes-segmentos');
    expect(pagina).toContain('@shared/clientes-consultas');
    for (const f of ['contarSegmentos', 'filtrarClientes', 'tagsDaLinha', 'agregarClientes', 'carregarBaseClientes', 'ROTULO_FILTRO', 'ROTULO_SEGMENTO']) {
      expect(pagina).toContain(f);
    }
    expect(pagina).not.toMatch(/limit\(5000\)/);
    expect(pagina).not.toMatch(/visitaMap|segmentoAtivo|loadingVisitas/);
    expect(pagina).not.toMatch(/key: 'segmentos'/);
  });

  it('cartões clicáveis, busca e filtros', () => {
    expect(pagina).toContain('CARTOES_CLIENTES'); // rótulos dos 6 cartões em shared (clientes-segmentos.test)
    expect(pagina).toContain('Buscar por nome, telefone ou e-mail');
    expect(pagina).toMatch(/setFiltro\(/);
    expect(pagina).toContain('FILTROS_CLIENTES'); // ordem e rótulos dos filtros em shared
  });

  it('linha mostra tags, total gasto escondível e última visita; erro vira aviso', () => {
    expect(pagina).toContain("from '@/components/privacy'");
    expect(pagina).toMatch(/<Secret>/);
    expect(pagina).toContain('ultimaVisita');
    expect(pagina).toContain('totalGasto');
    expect(pagina).toMatch(/erroCarga/);
    expect(pagina).toContain('role="alert"');
  });

  it('modal de cadastro grava o endereço serializado', () => {
    expect(pagina).toContain('serializarEndereco');
    for (const c of ['Logradouro', 'Número', 'Bairro', 'Complemento']) expect(pagina).toContain(c);
    expect(pagina).toMatch(/endereco:\s*serializarEndereco/);
  });

  it('mantém a permissão de cadastrar', () => {
    expect(pagina).toContain("pode('clientes.cadastrar')");
  });
});
