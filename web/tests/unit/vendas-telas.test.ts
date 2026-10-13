import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = join(process.cwd(), '..');
const app = readFileSync(join(raiz, 'mobile', 'app', '(empresa)', 'vendas.tsx'), 'utf8');
const web = readFileSync(join(raiz, 'web', 'app', '(app)', 'vendas', 'page.tsx'), 'utf8');

describe('tela de Vendas do app', () => {
  it('recarrega catálogo e histórico ao voltar para a tela (useFocusEffect)', () => {
    expect(app).toMatch(/import \{[^}]*useFocusEffect[^}]*\} from 'expo-router'/);
    expect(app.match(/useFocusEffect\(/g)?.length).toBe(2);
    // Os useEffect de carga antigos saem (senão carregaria duas vezes na abertura)
    expect(app).not.toContain('useEffect(() => { if (podeVendas) carregar(); }');
    expect(app).not.toContain("useEffect(() => { if (aba === 'historico' && podeVendas) carregarVendas(); }");
  });
  it('espera as permissões carregarem antes de mostrar "Sem permissão"', () => {
    expect(app).toMatch(/const \{ pode, permissoesCarregadas \} = usePermissoes\(\)/);
    const iCarregando = app.indexOf('if (!permissoesCarregadas)');
    const iSemPermissao = app.indexOf('if (!podeVendas)');
    expect(iCarregando).toBeGreaterThan(-1);
    expect(iCarregando).toBeLessThan(iSemPermissao);
  });
  it('clientes paginados com desempate por id', () => {
    expect(app).toContain('buscarTodasOuLancar');
    expect(app).toMatch(/from\('clientes'\)[\s\S]{0,200}\.order\('id'\)[\s\S]{0,40}\.range\(de, ate\)/);
  });
});

describe('tela de Vendas do web', () => {
  it('clientes paginados com desempate por id', () => {
    expect(web).toContain('buscarTodasOuLancar');
    expect(web).toMatch(/from\('clientes'\)[\s\S]{0,200}\.order\('id'\)[\s\S]{0,40}\.range\(de, ate\)/);
  });
  it('erro ao carregar produtos ou clientes aparece na tela (nunca lista vazia em silêncio)', () => {
    expect(web).toContain("setErroCarga(mensagemErroBanco(rProdutos.error, 'carregar os produtos'))");
    expect(web).toContain("'carregar as clientes'");
  });
  it('a falha de carga não usa o setErro da finalização', () => {
    const i = web.indexOf('const carregar = useCallback');
    const trecho = web.slice(i, web.indexOf('}, [', i));
    expect(trecho).not.toContain('setErro(');
  });
  it('app não troca config boa de cartões por configIndisponivel numa recarga com erro', () => {
    expect(app).toContain('configCarregadaRef');
  });
});
