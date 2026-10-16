import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(process.cwd(), '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8').replace(/\r\n/g, '\n');

describe('app', () => {
  const helper = ler('mobile/lib/taxaCancelamento.ts');
  const novo = ler('mobile/app/(empresa)/novo-agendamento.tsx');
  const detalheEmp = ler('mobile/app/(empresa)/agendamento/[id].tsx');
  const detalheProf = ler('mobile/app/(profissional)/agendamento/[id].tsx');
  const fin = ler('mobile/app/(empresa)/financeiro.tsx');

  it('helper pergunta com Cobrar / Não cobrar / Voltar e usa as regras de shared', () => {
    expect(helper).toContain("from '@shared/taxas-atendimento'");
    expect(helper).toContain('perguntaTaxaCancelamento(');
    expect(helper).toContain('colunaCobrarTaxaExiste(');
    expect(helper).toContain('carregarConfigTaxas(');
    expect(helper).toContain('Cobrar taxa de cancelamento de ${formatarMoeda(');
    expect(helper).toContain("text: 'Cobrar'");
    expect(helper).toContain("text: 'Não cobrar'");
    expect(helper).toContain("text: 'Voltar'");
    expect(helper).toContain('cobrar_taxa_cancelamento: true');
    expect(helper).toContain('cobrar_taxa_cancelamento: false');
  });

  it('todo UPDATE de status do app envia cobrar_taxa_cancelamento pelo helper', () => {
    for (const fonte of [detalheEmp, detalheProf]) {
      expect(fonte).toContain('escolherCobrancaCancelamento(');
      expect(fonte).toMatch(/\.update\(\{ status: novoStatus, \.\.\.extra \}\)/);
      expect(fonte).not.toMatch(/\.update\(\{ status: novoStatus \}\)/);
    }
  });

  it('novo agendamento: switch de taxa de reserva por atendimento', () => {
    expect(novo).toContain('Cobrar taxa de reserva neste atendimento');
    expect(novo).toContain('<Switch');
    expect(novo).toContain('valorTaxaReservaSugerida(');
    expect(novo).toContain('cobrar: cobrarTaxaReserva');
    expect(novo).toMatch(/useState\(true\)/);
  });

  it('financeiro: Dispensar taxa de cancelamento pendente com permissão e conferência', () => {
    expect(fin).toContain('Dispensar');
    expect(fin).toContain('async function dispensarTaxaCancelamento');
    const trecho = fin.slice(fin.indexOf('async function dispensarTaxaCancelamento'));
    const corpo = trecho.slice(0, trecho.indexOf('\n  }\n'));
    expect(corpo).toContain("cobrar_taxa_cancelamento: false");
    expect(corpo).toContain(".eq('empresa_id'");
    expect(corpo).toContain(".select('id')");
    expect(corpo).toContain('data.length === 0');
    expect(corpo).toContain('invalidarFinanceiro(qc)');
    expect(fin).toMatch(/podeMarcar[\s\S]{0,400}Dispensar|Dispensar[\s\S]{0,400}podeMarcar/);
  });
});

describe('web', () => {
  const agenda = ler('web/app/(app)/agenda/page.tsx');
  const perfil = ler('web/app/(app)/clientes/[id]/page.tsx');
  const fin = ler('web/app/(app)/financeiro/page.tsx');
  const modal = ler('web/components/PerguntaTaxaCancelamentoModal.tsx');

  it('as 2 telas de criar têm o switch da reserva, ligado por padrão, que desliga a taxa', () => {
    for (const fonte of [agenda, perfil]) {
      expect(fonte).toContain('Cobrar taxa de reserva neste atendimento');
      expect(fonte).toMatch(/const \[aplicarTaxaReserva, setAplicarTaxaReserva\] = useState\(true\)/);
      expect(fonte).toContain('if (aplicarTaxaReserva) {');
      expect(fonte).toContain('cobrar: aplicarTaxaReserva');
      expect(fonte).not.toContain('Aplicar taxa de reserva');
    }
  });

  it('o único UPDATE de status para cancelado/faltou da Agenda passa pela pergunta e envia a coluna', () => {
    expect(agenda).toContain("from '@shared/taxas-atendimento'");
    expect(agenda).toContain('colunaCobrarTaxaExiste(supabase)');
    expect(agenda).toContain('carregarConfigTaxas(supabase, empresaId)');
    expect(agenda).toContain('perguntaTaxaCancelamento(');
    // Sem a 091 não pergunta; com ela, sem pergunta envia true.
    expect(agenda).toContain('await aplicarStatus(id, status, true)');
    expect(agenda).toMatch(/\.update\(cobrarTaxaCancelamento === undefined \? \{ status \} : \{ status, cobrar_taxa_cancelamento: cobrarTaxaCancelamento \}\)/);
    // Nenhum outro update de status no arquivo.
    expect(agenda.match(/\.update\(\{ status/g) ?? []).toHaveLength(0);
    expect(agenda).toContain('<PerguntaTaxaCancelamentoModal');
  });

  it('nenhum outro ponto do web muda o status para cancelado/faltou', () => {
    for (const fonte of [perfil, fin]) {
      expect(fonte).not.toMatch(/status:\s*'(cancelado|faltou)'/);
    }
  });

  it('o modal tem os textos exatos e botões Cobrar / Não cobrar', () => {
    expect(modal).toContain('Cobrar taxa de cancelamento de {formatarMoeda(valor)}?');
    expect(modal).toContain('Não cobrar');
    expect(modal).toContain("'Cobrar'");
    expect(modal).toContain("from '@shared/moeda'");
  });

  it('Financeiro: Dispensar nas taxas pendentes, só com taxas.marcar_pagas, conferindo linhas', () => {
    expect(fin).toContain('Dispensar');
    const i = fin.indexOf('async function dispensarTaxaCancelamento');
    expect(i).toBeGreaterThan(-1);
    const corpo = fin.slice(i, fin.indexOf('\n  }\n', i));
    expect(corpo).toContain("cobrar_taxa_cancelamento: false");
    expect(corpo).toContain(".from('agendamentos')");
    expect(corpo).toContain(".eq('id', taxa.agendamento_id)");
    expect(corpo).toContain(".eq('empresa_id', empresaId)");
    expect(corpo).toContain(".select('id')");
    expect(corpo).toContain('data.length === 0');
    expect(fin).toMatch(/podeMarcarTaxas[\s\S]{0,600}Dispensar/);
  });

  it('o web nunca importa mobile/', () => {
    for (const fonte of [agenda, perfil, fin, modal]) expect(fonte).not.toMatch(/from ['"][^'"]*mobile\//);
  });
});
