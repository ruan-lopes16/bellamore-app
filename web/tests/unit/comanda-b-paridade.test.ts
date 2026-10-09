import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(process.cwd(), '..');
const web = readFileSync(join(raiz, 'web/app/(app)/comanda/page.tsx'), 'utf8');

describe('Comanda B — web', () => {
  it('usa as regras de shared', () => {
    expect(web).toContain("from '@shared/comanda-recibo'");
    expect(web).toContain('cartoesComandaDoDia(');
    expect(web).toContain('diffItensComanda(');
    expect(web).toContain('carregarBacklogComandas(');
    expect(web).toContain('carregarComandasSoExtrasDoDia(');
    expect(web).toContain('carregarComissoesPagasDosItens(');
    expect(web).not.toMatch(/function gerarTextoRecibo/);
  });
  it('não apaga mais todos os itens da comanda na edição', () => {
    expect(web).not.toMatch(/from\('comanda_itens'\)\.delete\(\)\.eq\('comanda_id'/);
  });
  it('abre a comanda do cartão, não a primeira da cliente', () => {
    expect(web).not.toMatch(/agendamentos\.find\(a => a\.comanda_id\)\?\.comanda_id/);
  });
  it('trava profissional e remoção de extra com comissão paga', () => {
    expect(web).toContain('comissao_paga');
    expect(web).toContain('Comissão já paga');
  });
});

describe('Comanda B — web: abertura de comanda fechada', () => {
  it('zera os originais e ignora respostas de aberturas antigas', () => {
    const corpo = web.match(/async function abrirComandaFechada[\s\S]*?\n {2}\}\r?\n/)?.[0] ?? '';
    expect(corpo).toContain('setItensOriginais([])');
    expect(corpo).toContain('aberturaRef.current');
    expect(web).toContain('cargaFalhou');
  });
});

const app = readFileSync(join(raiz, 'mobile/app/(empresa)/nova-comanda.tsx'), 'utf8');
describe('Comanda B — app: dias', () => {
  it('navega por dia/semana/mês e mostra backlog de shared', () => {
    expect(app).toContain('carregarBacklogComandas(');
    expect(app).toMatch(/startOfWeek\([^)]*weekStartsOn: 0/);
    expect(app).toContain('startOfDay(dataComanda)');
    expect(app).not.toMatch(/const hoje = new Date\(\);\s*await Promise\.all/);
  });
});

describe('Comanda B — app: dias sem corrida', () => {
  it('ignora respostas antigas do carregarDia e mostra erro da consulta', () => {
    expect(app).toContain('reqDiaRef');
    expect(app).toContain('req !== reqDiaRef.current');
    expect(app).toContain('erroDia');
  });
});

describe('Comanda B — app: itens e recibo', () => {
  it('profissional no extra, valor por parseValorBR, recibo de shared', () => {
    expect(app).toContain("from '@shared/comanda-recibo'");
    expect(app).toContain('linkWhatsAppRecibo(');
    expect(app).toContain('Linking.openURL(');
    expect(app).toContain('function atualizarProfissional(');
    expect(app).toMatch(/function atualizarValor\([^)]*\)[^{]*\{[^}]*parseValorBR\(/);
    expect(app).not.toMatch(/item\.tipo !== 'agendamento' && \(\s*<TouchableOpacity onPress=\{\(\) => removerItem/);
  });
});

describe('Comanda B — app: editar comanda fechada', () => {
  it('cartões por comanda, edição por diff, permissão de editar fechada', () => {
    expect(app).toContain('cartoesComandaDoDia(');
    expect(app).toContain('carregarComandasSoExtrasDoDia(');
    expect(app).toContain('diffItensComanda(');
    expect(app).toContain('carregarComissoesPagasDosItens(');
    expect(app).toContain("pode('comanda.editar_fechada')");
    expect(app).toMatch(/async function editarComanda\(/);
    expect(app).toMatch(/taxaGravada/);
  });
  it('abertura com contador, carga falha bloqueia salvar, sem apagar todos os itens', () => {
    expect(app).toContain('aberturaRef');
    expect(app).toContain('cargaFalhou');
    expect(app).not.toMatch(/from\('comanda_itens'\)\.delete\(\)\.eq\('comanda_id'/);
    expect(app).toContain('Comissão já paga');
  });
});
