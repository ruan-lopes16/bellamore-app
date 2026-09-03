import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');

// ── A. Agenda ────────────────────────────────────────────────

describe('A1 — SearchSelect empilha label e sub', () => {
  const src = read('components/SearchSelect.tsx');
  it('novo layout empilhado quando há sub selecionado', () => {
    expect(src).toContain('data-testid="select-valor-empilhado"');
  });
  it('o campo cresce de altura (min-h em vez de h fixo)', () => {
    expect(src).toContain('w-full min-h-10 rounded-xl');
  });
});

describe('A2 — rótulo do pacote encurtado', () => {
  it('web: sem parênteses explicativos no rótulo de pacote', () => {
    const src = read('app/(app)/agenda/page.tsx');
    expect(src).not.toContain('preenche os serviços e vende na hora');
    expect(src).not.toContain('consome 1 sessão ao concluir');
  });
});

describe('A3 — modal de agendamento sem scroll horizontal', () => {
  const src = read('app/(app)/agenda/page.tsx');
  it('grid de duração/valor tem min-w-0 nas células', () => {
    expect(src).toContain('grid grid-cols-2 gap-2 min-w-0');
  });
  it('inputClass permite encolher (min-w-0)', () => {
    expect(src).toMatch(/const inputClass = "[^"]*min-w-0[^"]*"/);
  });
});

describe('A4 — modal Detalhes com status inline', () => {
  const src = read('app/(app)/agenda/page.tsx');
  it('AgCard aceita a prop statusInline', () => {
    expect(src).toContain('statusInline');
  });
  it('o modal mobile de Detalhes passa statusInline', () => {
    expect(src).toMatch(/AgCard ag=\{agSel\} empresaId=\{empresaId\} statusInline/);
  });
});

describe('A5 web — timeline mostra horário e todos os serviços', () => {
  const src = read('app/(app)/agenda/page.tsx');
  it('bloco da timeline concatena agendamento_servicos via helper', () => {
    expect(src).toContain('nomesServicosDoAg(ag)');
  });
  it('horário do bloco não depende mais de h >= 54', () => {
    expect(src).not.toContain('{h >= 54 && (');
  });
});

describe('A5 mobile — card da timeline concatena serviços', () => {
  const src = read('../mobile/app/(empresa)/agenda.tsx');
  it('usa helper nomesServicos(ag) em vez de ag.servico?.nome isolado', () => {
    expect(src).toContain('nomesServicos(ag)');
  });
});

// ── B. Financeiro ────────────────────────────────────────────

describe('B1 — skeleton de Financeiro espelha o layout real', () => {
  const sk = read('app/(app)/financeiro/loading.tsx');
  it('usa a mesma grade de KPIs da tela real (grid-cols-2 lg:grid-cols-3)', () => {
    expect(sk).toContain('grid grid-cols-2 lg:grid-cols-3');
    expect(sk).not.toContain('sm:grid-cols-3');
  });
});

describe('B2 — grid único de KPIs no Financeiro', () => {
  const src = read('app/(app)/financeiro/page.tsx');
  it('há um único array de KPIs (kpisFinanceiro)', () => {
    expect(src).toContain('const kpisFinanceiro = [');
  });
  it('o último card ocupa a linha inteira no mobile quando a contagem é ímpar', () => {
    expect(src).toContain('col-span-2 lg:col-span-1');
  });
});

describe('B1/B2 mobile — KPIs de Financeiro (no-op: layout já correto)', () => {
  // O mobile usa uma fileira única de 3 KPIs (flex:1 cada), não um grid de 2
  // colunas — logo não há célula órfã. E não existe skeleton para desalinhar.
  const src = read('../mobile/app/(empresa)/financeiro.tsx');
  it('a fileira de Resumo continua sendo 3 KPIs em flex-row', () => {
    expect(src).toMatch(/label: 'Receita'[\s\S]{0,400}label: 'Gastos'[\s\S]{0,400}label: 'Lucro'/);
    expect(src).toContain("flexDirection: 'row', gap: 8");
  });
});

// ── C. Relatórios ────────────────────────────────────────────

describe('C1 — ChartBar com altura resolvível', () => {
  const src = read('app/(app)/relatorios/page.tsx');
  it('ChartBar raiz estica na altura do container (self-stretch)', () => {
    expect(src).toMatch(/function ChartBar[\s\S]{0,260}self-stretch/);
  });
  it('container das barras usa items-stretch, não items-end', () => {
    expect(src).toContain('flex items-stretch gap-2');
  });
});

describe('C2/C3 — comissão neutra + sem Funil', () => {
  const src = read('app/(app)/relatorios/page.tsx');
  it('comissão do profissional não usa mais text-pink-500', () => {
    expect(src).not.toContain('text-pink-500');
  });
  it('o card "Funil de atendimentos" foi removido', () => {
    expect(src).not.toContain('Funil de atendimentos');
  });
});

describe('C1/C2/C3 mobile — Relatórios (no-op: padrões inexistentes no Expo)', () => {
  // O relatorios.tsx do Expo é um design mais simples: ProfissionalRow não
  // mostra comissão (logo não há cor de alerta a trocar), não existe card
  // "Funil de atendimentos", e não há gráfico de barras verticais de evolução
  // (ServicoRow usa barra horizontal por %, que funciona). Nada a mudar.
  const src = read('../mobile/app/(empresa)/relatorios.tsx');
  it('não tem card Funil de atendimentos', () => {
    expect(src).not.toContain('Funil de atendimentos');
  });
  it('ProfissionalRow não renderiza linha de comissão', () => {
    expect(src).not.toMatch(/Comiss[ãa]o:\s*\{/);
  });
});

// ── D. Menu inferior ─────────────────────────────────────────

describe('D — menu inferior troca Financeiro por Comanda', () => {
  const src = read('components/Sidebar.tsx');
  it('MOBILE_NAV tem /comanda e não tem /financeiro', () => {
    const bloco = src.split('const MOBILE_NAV')[1].split('];')[0];
    expect(bloco).toContain("href: '/comanda'");
    expect(bloco).not.toContain("href: '/financeiro'");
  });
  it('MAIS_NAV tem /financeiro e não tem /comanda', () => {
    const bloco = src.split('const MAIS_NAV')[1].split('];')[0];
    expect(bloco).toContain("href: '/financeiro'");
    expect(bloco).not.toContain("href: '/comanda'");
  });
});

// ── E. Lembretes / Notificações ──────────────────────────────

describe('E2 — rota de lembretes usa as funções puras', () => {
  const src = read('app/api/cron/lembretes/route.ts');
  it('importa de @shared/lembretes', () => {
    expect(src).toContain("from '@shared/lembretes'");
  });
  it('marca as colunas de rastreio após enviar', () => {
    expect(src).toContain('lembrete_30min_em');
    expect(src).toContain('lembrete_vespera_em');
  });
  it('grava linha em notificacoes tipo agendamento', () => {
    expect(src).toContain("from('notificacoes')");
    expect(src).toContain("tipo: 'agendamento'");
  });
});

describe('E5 — alertas de agendamento colapsados', () => {
  const src = read('app/(app)/notificacoes/page.tsx');
  it('separa os alertas de agendamento num array próprio', () => {
    expect(src).toContain('const listaAg: Alerta[] = [];');
    expect(src).toContain('setAlertasAg(listaAg)');
  });
  it('tem estado de expandir e uma linha-resumo com contagem + próximo', () => {
    expect(src).toContain('agsExpandido');
    expect(src).toContain("'atendimento' : 'atendimentos'");
    expect(src).toContain('próximo {alertasAg[0].titulo}');
  });
});

describe('E6 mobile — lembrete local', () => {
  const src = read('../mobile/lib/notifications.ts');
  it('exporta agendarLembretesLocais e usa scheduleNotificationAsync', () => {
    expect(src).toContain('export async function agendarLembretesLocais');
    expect(src).toContain('scheduleNotificationAsync');
    expect(src).toContain('cancelAllScheduledNotificationsAsync');
  });
});
