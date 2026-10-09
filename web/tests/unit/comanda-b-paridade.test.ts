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

// ── Correções da revisão final de branch (Comanda B)
const cron = readFileSync(join(raiz, 'web/app/api/cron/resumo-diario/route.ts'), 'utf8');
/** Corpo de `async function <nome>` até o fechamento no nível de 2 espaços. */
const corpoDe = (src: string, nome: string) =>
  src.match(new RegExp('async function ' + nome + '\\([\\s\\S]*?\\n {2}\\}\\r?\\n'))?.[0] ?? '';

describe('Comanda B — cron do resumo diário', () => {
  it('comissão do dia por created_at, sem embed !inner de agendamentos (entra o extra)', () => {
    expect(cron).not.toMatch(/agendamentos!inner/);
    expect(cron).toMatch(/from\('comissoes'\)\.select\('valor_comissao, profissional_id'\)/);
    expect(cron).toContain(".gte('created_at', inicioHoje).lte('created_at', fimHoje)");
    expect(cron).toContain("from '@shared/periodos'");
  });
});

describe('Comanda B — web: carga do dia sem corrida', () => {
  it('contador conferido depois de cada await e lista limpa na troca de dia', () => {
    expect(web).toContain('const req = ++reqDiaRef.current');
    expect((web.match(/if \(req !== reqDiaRef\.current\) return;/g) ?? []).length).toBeGreaterThanOrEqual(3);
    const efeito = web.slice(web.indexOf('// ── Carregar dados do dia selecionado'), web.indexOf('async function recarregarTaxasReserva'));
    expect(efeito).toContain('setAgDia([])');
    expect(efeito).toContain('setSoExtrasDia([])');
    expect(efeito).toContain('setLoading(true)');
  });
});

describe('Comanda B — taxas de reserva não lidas bloqueiam o fechamento (web e app)', () => {
  for (const [nome, src] of [['web', web], ['app', app]] as const) {
    it(nome, () => {
      expect(src).toContain('setErroTaxasReserva(mensagemErroBanco(rTaxasReserva.error');
      expect(src).toMatch(/const bloqueioTaxaReserva = erroTaxasReserva && agendamentoIdsNaComanda\.length > 0/);
      expect(corpoDe(src, 'fecharComanda')).toContain('if (bloqueioTaxaReserva)');
      expect(corpoDe(src, 'editarComanda')).toContain('if (bloqueioTaxaReserva)');
      expect(src).toContain('recarregarTaxasReserva');
      expect(src).toContain('Tentar de novo');
    });
  }
  it('botão desabilitado', () => {
    expect(web).toMatch(/disabled=\{fechando \|\| cargaFalhou \|\| !!bloqueioTaxaReserva/);
    expect(app).toMatch(/\|\| !!bloqueioTaxaReserva/);
  });
});

describe('Comanda B — edição: itens antes da comanda, pagamentos por último, falha trava (web e app)', () => {
  for (const [nome, src] of [['web', web], ['app', app]] as const) {
    it(nome, () => {
      const corpo = corpoDe(src, 'editarComanda');
      const iItens = corpo.indexOf("from('comanda_itens')");
      const iComanda = corpo.indexOf("from('comandas')");
      const iValores = corpo.indexOf('persistirValoresAgendamento(');
      const iPag = corpo.indexOf("from('pagamentos')");
      expect(iItens).toBeGreaterThan(0);
      expect(iItens).toBeLessThan(iComanda);
      expect(iComanda).toBeLessThan(iValores);
      expect(iValores).toBeLessThan(iPag);
      expect(corpo).toContain('setCargaFalhou(true)');
      // Nenhuma saída de erro sem travar o Salvar
      expect(corpo).not.toMatch(/setFechando\(false\); return;/);
    });
  }
});

describe('Comanda B — leitura de comissões pagas falha = carga falha (web e app)', () => {
  for (const [nome, src] of [['web', web], ['app', app]] as const) {
    it(nome, () => {
      const corpo = corpoDe(src, 'abrirComandaFechada');
      expect(corpo).toMatch(/try \{\s*pagas = await carregarComissoesPagasDosItens/);
      expect(corpo).toMatch(/catch \(e\) \{[\s\S]*?setCargaFalhou\(true\)/);
    });
  }
});

describe('Comanda B — web: "Profissional (opcional)" vira null, não \'\'', () => {
  it('atualizarProfissional usa profId || undefined, como o app', () => {
    expect(web).toContain('profissional_id: profId || undefined');
    expect(app).toContain('profissional_id: profId || undefined');
  });
});
