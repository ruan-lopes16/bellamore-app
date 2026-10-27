import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// As gravações (exclusão conferida, insumos por diferença) estão em shared/servicos-consultas.ts,
// testadas em servicos-consultas.test.ts. Aqui: a tela do web usa a regra única.
const pagina = readFileSync(resolve(__dirname, '../../app/(app)/servicos/page.tsx'), 'utf8');

describe('tela de Serviços (web)', () => {
  it('usa as regras compartilhadas', () => {
    expect(pagina).toContain('validarServico');
    expect(pagina).toContain('DURACOES_PADRAO');
    expect(pagina).toContain('lerPrecoServico(');
    expect(pagina).toContain("from '@shared/servicos-consultas'");
    expect(pagina).toContain('excluirServicoConferido(supabase');
    expect(pagina).toContain('sincronizarInsumos(supabase');
    expect(pagina).toContain('mapearInsumosCarregados(');
    expect(pagina).not.toContain("supabase.from('servicos').delete()");
    expect(pagina).not.toContain("from('servico_produtos').delete()");
    expect(existsSync(resolve(__dirname, '../../lib/servicos-web.ts'))).toBe(false);
  });
  it('mesmo texto do app no atalho de duração livre', () => {
    expect(pagina).toContain('Personalizada');
    expect(pagina).not.toMatch(/>\s*Personalizado\s*</);
  });
  it('exclusão recusada por uso oferece Desativar', () => {
    expect(pagina).toContain('MSG_SERVICO_USADO');
    expect(pagina).toMatch(/usadoServico[\s\S]{0,1500}Desativar/);
  });
  it('confere o erro das cargas (serviços, categorias, produtos, insumos) e nunca mostra zeros com erro', () => {
    expect(pagina).toMatch(/errServs/);
    expect(pagina).toMatch(/errCats/);
    expect(pagina).toMatch(/errProds/);
    expect(pagina).toMatch(/errInsCarga/);
    expect(pagina).toMatch(/erroCarga \?/);
  });
  it('erros de gravação passam por mensagemErroBanco (nunca o texto cru)', () => {
    expect(pagina).not.toMatch(/setErro\(error\.message\)/);
    expect(pagina).toContain("mensagemErroBanco(error ?? { code: '42501' }, 'salvar o serviço')");
  });
});
