import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Task 4 da paridade da Agenda: a tela de agendar do app cria E edita, igual ao modal do web.
const raiz = join(process.cwd(), '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8').replace(/\r\n/g, '\n');

const TELA = 'mobile/app/(empresa)/novo-agendamento.tsx';
const DIR_COMP = 'mobile/components/agenda';

/** Tela + componentes de `mobile/components/agenda/` (a tela pode ter sido quebrada em partes). */
function fonteCompleta(): string {
  const partes = [ler(TELA)];
  const dir = join(raiz, DIR_COMP);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) if (f.endsWith('.tsx') || f.endsWith('.ts')) partes.push(ler(`${DIR_COMP}/${f}`));
  }
  return partes.join('\n');
}

describe('app: agendar e editar (novo-agendamento)', () => {
  const tela = ler(TELA);
  const tudo = fonteCompleta();

  it('usa as regras de shared/agenda e shared/bloqueios', () => {
    expect(tudo).toContain("from '@shared/agenda'");
    for (const fn of [
      'montarAgendamento(', 'horariosDoDia(', 'janelaDoDia(', 'conflitosDeHorario(',
      'instanteNoPassado(', 'linhasIniciaisEdicao(', 'msgConflito(', 'MSG_HORARIO_PASSADO',
    ]) expect(tudo).toContain(fn);
    expect(tudo).toContain('bloqueioEmConflito(');
    expect(tudo).toContain('Horário bloqueado na agenda (');
  });

  it('aceita ?id= (edição), ?data=, ?hora= e ?profissional=', () => {
    expect(tela).toMatch(/useLocalSearchParams<\{[^}]*\bid\?: string/);
    expect(tela).toMatch(/useLocalSearchParams<\{[^}]*\bdata\?: string/);
    expect(tela).toMatch(/useLocalSearchParams<\{[^}]*\bhora\?: string/);
    expect(tela).toMatch(/useLocalSearchParams<\{[^}]*\bprofissional\?: string/);
  });

  it('grava agendamento_servicos no formato do web e confere cada erro', () => {
    expect(tela).toContain(".from('agendamento_servicos').insert(");
    expect(tela).toContain(".from('agendamento_servicos').delete().eq('agendamento_id'");
    for (const campo of ['agendamento_id:', 'servico_id:', 'valor:', 'duracao_minutos:', 'ordem:', 'empresa_id:']) {
      expect(tela).toContain(campo);
    }
    expect(tela).toContain('errDelLinhas');
    expect(tela).toContain('errLinhas');
    // Edição: UPDATE com .select para detectar 0 linhas (RLS recusou em silêncio).
    expect(tela).toMatch(/\.from\('agendamentos'\)\.update\([\s\S]{0,600}\.select\('id'\)/);
  });

  it('cortesia 0 respeitada: não sobra "|| servico.preco" nem parseFloat do valor', () => {
    expect(tudo).not.toMatch(/\|\|\s*servico\w*!?\.preco/);
    expect(tudo).not.toMatch(/parseFloat\(valor/);
    // valor digitado inválido não vira 0 calado
    expect(tudo).toContain('valorDigitadoValido(');
  });

  it('sem HORARIOS fixo e sem dias passados desabilitados', () => {
    expect(tudo).not.toMatch(/const HORARIOS\s*=/);
    expect(tudo).not.toContain('disabled={isPast}');
    expect(tudo).toContain('Outro horário');
  });

  it('taxa de reserva sugerida sobre o total', () => {
    expect(tela).toMatch(/valorTaxaReservaSugerida\([\s\S]{0,120}valorTotal/);
  });

  it('remove o ramo morto de "Conflito" no tratamento de erro', () => {
    expect(tela).not.toContain("error.message.includes('Conflito')");
  });

  it('nenhum return null antes do último hook e nenhum setState dentro de useMemo', () => {
    const corpo = tela.slice(tela.indexOf('export default function'));
    const linhas = corpo.split('\n');
    const ehHook = (l: string) => /^ {2}(const .*= |)use[A-Z]\w*\(/.test(l);
    const ehReturnCedo = (l: string) => /^ {2}(if \(.*\) )?return (null|\()/.test(l);
    let ultimoHook = -1;
    linhas.forEach((l, i) => { if (ehHook(l)) ultimoHook = i; });
    const primeiroReturn = linhas.findIndex(ehReturnCedo);
    expect(ultimoHook).toBeGreaterThan(0);
    expect(primeiroReturn).toBeGreaterThan(ultimoHook);
    expect(tudo).not.toMatch(/useMemo\(\(\) => \{[^}]*set[A-Z]\w*\(/);
  });

  it('salvar bloqueado sem nenhuma linha de serviço', () => {
    expect(tela).toMatch(/const podeSalvar = [\s\S]{0,300}linhasPreenchidas\.length > 0/);
  });
});

describe('app: useProfissionais lista todos os membros ativos', () => {
  const hook = ler('mobile/hooks/useAgenda.ts');
  const trecho = hook.slice(hook.indexOf('export function useProfissionais'), hook.indexOf('export function useDiasComAgendamento'));
  it("sem .eq('role','profissional')", () => {
    expect(trecho).not.toMatch(/eq\('role',\s*'profissional'\)/);
    expect(trecho).toMatch(/\.in\('role', \['owner', 'gestor', 'profissional'\]\)/);
    expect(trecho).toContain(".eq('ativo', true)");
  });
});
