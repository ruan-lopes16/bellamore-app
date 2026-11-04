import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { TITULO_ERRO_VINCULOS } from '@shared/destino-sessao';

// Task 7 da fase "Pendências de dinheiro e falhas silenciosas": varredura cruzada web × app.
// As duas plataformas têm de usar as mesmas regras (pacote que cobre o atendimento, venda de pacotes
// inteira, "Fat. hoje" com desconto) e o mesmo aviso de erro de vínculos.
const raiz = join(__dirname, '..', '..', '..');
const ler = (p: string) => {
  const f = join(raiz, p);
  if (!existsSync(f)) throw new Error(`arquivo não encontrado: ${p}`);
  return readFileSync(f, 'utf8');
};

/** Todos os .ts/.tsx de uma pasta (sem node_modules). */
function fontes(dir: string): string[] {
  const out: string[] = [];
  const abs = join(raiz, dir);
  if (!existsSync(abs)) return out;
  for (const nome of readdirSync(abs)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const p = join(abs, nome);
    if (statSync(p).isDirectory()) out.push(...fontes(relative(raiz, p)));
    else if (/\.(ts|tsx)$/.test(nome) && !/\.d\.ts$/.test(nome)) out.push(relative(raiz, p).replace(/\\/g, '/'));
  }
  return out;
}

const WEB_AGENDA = 'web/app/(app)/agenda/page.tsx';
const WEB_COMANDA = 'web/app/(app)/comanda/page.tsx';
const WEB_PACOTES = 'web/app/(app)/pacotes/page.tsx';
const WEB_DASH_PROF = 'web/app/(app)/dashboard/DashboardProfissionalView.tsx';
const APP_NOVO_AGENDAMENTO = 'mobile/app/(empresa)/novo-agendamento.tsx';
const APP_COMANDA = 'mobile/app/(empresa)/nova-comanda.tsx';
const APP_PACOTES = 'mobile/app/(empresa)/pacotes.tsx';
const APP_PROF_HOOK = 'mobile/hooks/useProfissional.ts';

describe('Pacote que cobre o atendimento: mesma regra e mesmo aviso nas duas plataformas', () => {
  const WEB = [WEB_AGENDA, WEB_COMANDA];
  const APP = [APP_NOVO_AGENDAMENTO, APP_COMANDA];
  for (const arq of [...WEB, ...APP]) {
    it(`${arq} usa pacotesDoAtendimento e AVISO_PACOTE_PARCIAL`, () => {
      const t = ler(arq);
      expect(t).toContain('pacotesDoAtendimento');
      expect(t).toContain('AVISO_PACOTE_PARCIAL');
    });
  }
});

describe('Comanda: mesma leitura dos serviços do atendimento e mesmo bloqueio de pacote parcial', () => {
  for (const arq of [WEB_COMANDA, APP_COMANDA]) {
    it(`${arq} usa servicoIdsDoAtendimento, vinculosPacoteSemCobertura e MOTIVO_FECHAR_PACOTE_PARCIAL`, () => {
      const t = ler(arq);
      expect(t).toContain('servicoIdsDoAtendimento(');
      expect(t).toContain('vinculosPacoteSemCobertura(');
      expect(t).toContain('MOTIVO_FECHAR_PACOTE_PARCIAL');
      // A oferta não pode mais filtrar fora as linhas sem servico_id (elas tornam o atendimento não coberto).
      expect(t).not.toMatch(/agendamento_id === agendamentoId && i\.servico_id\)/);
    });
  }
});

describe('Agenda: pacote já vinculado que deixou de cobrir bloqueia salvar nas duas plataformas', () => {
  for (const arq of [WEB_AGENDA, APP_NOVO_AGENDAMENTO]) {
    it(`${arq} usa pacoteCobreAtendimento e MOTIVO_SALVAR_PACOTE_PARCIAL, com um aviso só`, () => {
      const t = ler(arq);
      expect(t).toContain('pacoteCobreAtendimento(');
      expect(t).toContain('MOTIVO_SALVAR_PACOTE_PARCIAL');
      expect(t).toContain('avisoPacoteExibido');
      expect(t.split('{AVISO_PACOTE_PARCIAL}').length - 1).toBe(0);
    });
  }
});

describe('Venda de pacotes inteira: nunca oferecida para pacote cobrado na comanda', () => {
  for (const arq of [WEB_PACOTES, APP_PACOTES]) {
    it(`${arq} só oferece "Excluir a venda inteira" sem comanda_id`, () => {
      const linha = ler(arq).split('\n').find(l => /const vendaInteira =/.test(l)) ?? '';
      expect(linha).toMatch(/> 1/);
      expect(linha).toMatch(/venda_id/);
      expect(linha).toMatch(/!\w+(\.\w+)?\.comanda_id|!confirmExcluirVenda\.comanda_id|!v\.comanda_id/);
    });
  }
});

describe('Venda de pacotes inteira: mesma função e mesma mensagem nas duas plataformas', () => {
  for (const arq of [WEB_PACOTES, APP_PACOTES]) {
    it(`${arq} usa excluirVendaPacotes e MSG_VENDA_VARIOS_PACOTES`, () => {
      const t = ler(arq);
      expect(t).toContain('excluirVendaPacotes');
      expect(t).toContain('MSG_VENDA_VARIOS_PACOTES');
    });
  }
});

describe('"Fat. hoje" da profissional: os dois leem desconto_rateado', () => {
  for (const arq of [WEB_DASH_PROF, APP_PROF_HOOK]) {
    it(`${arq} lê desconto_rateado`, () => {
      expect(ler(arq)).toContain('desconto_rateado');
    });
  }
});

describe('Exportar: nenhum ExportButton do web fica sem disabled', () => {
  const arquivos = fontes('web/app');
  const ocorrencias: { arq: string; trecho: string }[] = [];
  for (const arq of arquivos) {
    const t = ler(arq);
    const re = /<ExportButton\b([\s\S]*?)\/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) ocorrencias.push({ arq, trecho: m[1] });
  }

  it('existe ao menos um ExportButton na varredura', () => {
    expect(ocorrencias.length).toBeGreaterThan(0);
  });

  it('todo <ExportButton> tem a prop disabled=', () => {
    const sem = ocorrencias.filter((o) => !/\bdisabled=/.test(o.trecho)).map((o) => o.arq);
    expect(sem).toEqual([]);
  });
});

describe('Erro ao carregar empresas: o mesmo título nas duas plataformas', () => {
  it('o título é o texto combinado', () => {
    expect(TITULO_ERRO_VINCULOS).toBe('Não foi possível carregar suas empresas');
  });

  it('web (ErroVinculos) e app (ErroPermissoes) usam a constante', () => {
    expect(ler('web/components/ErroVinculos.tsx')).toContain('TITULO_ERRO_VINCULOS');
    expect(ler('mobile/components/ErroPermissoes.tsx')).toContain('TITULO_ERRO_VINCULOS');
  });
});
