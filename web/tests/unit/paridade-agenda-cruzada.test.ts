import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MSG_CONCLUIDO_COM_COMANDA, MSG_HORARIO_PASSADO, MSG_REABRIR, msgConflito,
} from '@shared/agenda';

// Teste cruzado da paridade da Agenda (web x app): para cada regra, as duas plataformas usam a
// mesma função de shared e nenhuma reimplementa por conta própria. Varredura de código.
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
/** Remove comentários para que a varredura só olhe código. */
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const PAGE = 'web/app/(app)/agenda/page.tsx';
const VISOES = 'web/app/(app)/agenda/visoes.ts';
const DETALHE_WEB = 'web/app/(app)/agenda/DetalheAtendimento.tsx';
const WEB = [PAGE, VISOES, DETALHE_WEB, 'web/app/(app)/agenda/MesView.tsx', 'web/app/(app)/agenda/BloqueiosDoDia.tsx'];

const AGENDA_EMP = 'mobile/app/(empresa)/agenda.tsx';
const AGENDA_PROF = 'mobile/app/(profissional)/agenda.tsx';
const NOVO_EMP = 'mobile/app/(empresa)/novo-agendamento.tsx';
const DET_EMP = 'mobile/app/(empresa)/agendamento/[id].tsx';
const DET_PROF = 'mobile/app/(profissional)/agendamento/[id].tsx';
const FAIXA = 'mobile/components/agenda/FaixaSemana.tsx';
const LINHAS = 'mobile/components/agenda/LinhasServicoEditor.tsx';
const BOTOES = 'mobile/components/atendimento/BotoesStatus.tsx';
const AVALIACAO = 'mobile/components/atendimento/AvaliacaoAtendimento.tsx';
const STATUS_LIB = 'mobile/lib/statusAtendimento.ts';
const APP = [
  AGENDA_EMP, NOVO_EMP, DET_EMP, AGENDA_PROF, 'mobile/app/(profissional)/novo-agendamento.tsx', DET_PROF,
  'mobile/components/agenda/AlternarVisao.tsx', FAIXA, LINHAS, 'mobile/components/agenda/SeletorHorario.tsx',
  'mobile/components/agenda/TimelineColunas.tsx', 'mobile/components/agenda/VisaoMes.tsx',
  AVALIACAO, BOTOES, 'mobile/hooks/useAgenda.ts', 'mobile/hooks/useProfissional.ts', STATUS_LIB,
];
const TODOS = [...WEB, ...APP];

/** O arquivo importa `nome` de algum módulo `@shared/*`. */
function importaDeShared(codigo: string, nome: string): boolean {
  const blocos = codigo.match(/import\s*(?:type\s*)?\{[^}]*\}\s*from\s*'@shared\/[^']*'/g) ?? [];
  return blocos.some(b => new RegExp(`\\b${nome}\\b`).test(b));
}

describe('paridade da agenda: mesma função de shared nas duas plataformas', () => {
  const REGRAS: { regra: string; nome: string; arquivos: string[] }[] = [
    { regra: 'janela do dia', nome: 'janelaDoDia', arquivos: [PAGE, AGENDA_EMP, AGENDA_PROF] },
    { regra: 'montar agendamento', nome: 'montarAgendamento', arquivos: [PAGE, NOVO_EMP] },
    { regra: 'linhas de edição', nome: 'linhasIniciaisEdicao', arquivos: [PAGE, NOVO_EMP] },
    { regra: 'valor digitado', nome: 'valorDigitadoValido', arquivos: [PAGE, NOVO_EMP, LINHAS] },
    { regra: 'horário passado', nome: 'instanteNoPassado', arquivos: [PAGE, NOVO_EMP] },
    { regra: 'instante em Brasília', nome: 'instanteBRT', arquivos: [PAGE, NOVO_EMP] },
    { regra: 'horários de 15 em 15', nome: 'horariosDoDia', arquivos: [PAGE, NOVO_EMP] },
    { regra: 'mensagem de conflito', nome: 'msgConflito', arquivos: [PAGE, NOVO_EMP] },
    { regra: 'mensagem de bloqueio', nome: 'msgBloqueio', arquivos: [PAGE, NOVO_EMP] },
    { regra: 'dias da semana', nome: 'diasDaSemana', arquivos: [VISOES, NOVO_EMP, FAIXA] },
    // A agenda da profissional é de uma pessoa só: sem colunas, sem filtro de profissional (por isso fora das regras abaixo).
    { regra: 'semana vizinha', nome: 'semanaVizinha', arquivos: [NOVO_EMP, FAIXA] },
    { regra: 'status permitidos', nome: 'statusPermitidos', arquivos: [PAGE, BOTOES] },
    { regra: 'confirmar mudança de status', nome: 'precisaConfirmarStatus', arquivos: [PAGE, DET_EMP, DET_PROF] },
    { regra: 'contatos da cliente', nome: 'contatosCliente', arquivos: [DETALHE_WEB, DET_EMP, DET_PROF] },
    { regra: 'resumo do dia', nome: 'resumoDoDia', arquivos: [PAGE, AGENDA_EMP] },
    { regra: 'colunas com extras', nome: 'colunasComExtras', arquivos: [PAGE, AGENDA_EMP] },
    { regra: 'bloqueios da profissional', nome: 'bloqueiosDaProfissional', arquivos: [PAGE, AGENDA_EMP] },
    { regra: 'filtro inicial', nome: 'filtroInicialAgenda', arquivos: [PAGE, AGENDA_EMP] },
    { regra: 'avaliação', nome: 'salvarAvaliacao', arquivos: [PAGE, AVALIACAO] },
    { regra: 'aviso de taxa ao excluir', nome: 'avisoTaxaPagaAoExcluir', arquivos: [PAGE, STATUS_LIB] },
  ];
  for (const r of REGRAS) {
    it(`${r.regra} (${r.nome}) vem de @shared/* no web e no app`, () => {
      for (const f of r.arquivos) {
        expect(importaDeShared(ler(f), r.nome), `${f} deve importar ${r.nome} de @shared/*`).toBe(true);
      }
    });
  }

  it('nenhuma plataforma reimplementa as funções de shared', () => {
    const funcoes = ['janelaDoDia', 'montarAgendamento', 'statusPermitidos', 'precisaConfirmarStatus', 'contatosCliente',
      'resumoDoDia', 'diasDaSemana', 'semanaVizinha', 'horariosDoDia', 'instanteBRT', 'colunasComExtras', 'bloqueiosDaProfissional', 'filtroInicialAgenda'];
    for (const f of TODOS) {
      const cod = semComentarios(ler(f));
      for (const fn of funcoes) {
        expect(cod, `${f} não deve declarar ${fn}`).not.toMatch(new RegExp(`(function\\s+${fn}\\b|const\\s+${fn}\\s*=)`));
      }
    }
  });
});

describe('paridade da agenda: regras de tela', () => {
  it('nenhum weekStartsOn: 1 nos arquivos de agenda nem nos hooks (semana começa no domingo)', () => {
    for (const f of TODOS) expect(semComentarios(ler(f)), f).not.toMatch(/weekStartsOn\s*:\s*1/);
  });

  it('nenhuma lista fixa HORAS/HORARIOS (horários vêm de horariosDoDia / janela do dia)', () => {
    for (const f of TODOS) expect(semComentarios(ler(f)), f).not.toMatch(/\b(HORAS|HORARIOS)\b/);
  });

  it('nenhum TL_H_START = 7 fixo (janela vem de janelaDoDia)', () => {
    for (const f of TODOS) expect(semComentarios(ler(f)), f).not.toMatch(/TL_H_START\s*=\s*7/);
  });

  it('nenhum "|| servico.preco" (valor digitado 0 é válido e não cai no preço do serviço)', () => {
    for (const f of TODOS) expect(semComentarios(ler(f)), f).not.toMatch(/\|\|\s*(servico|s|srv)\.preco/);
  });

  it('avaliacoes nunca recebe profissional_id (a FK é de empresa_membros)', () => {
    for (const f of [...TODOS, 'shared/agenda-consultas.ts']) {
      const cod = semComentarios(ler(f));
      for (const m of cod.matchAll(/from\('avaliacoes'\)/g)) {
        const i = m.index ?? 0;
        expect(cod.slice(i, i + 400), f).not.toMatch(/profissional_id/);
      }
    }
    expect(semComentarios(ler('shared/agenda-consultas.ts'))).toContain("from('avaliacoes')");
  });
});

describe('paridade da agenda: textos exatos', () => {
  it('as constantes de shared têm o texto exato combinado', () => {
    expect(MSG_HORARIO_PASSADO).toBe('Esse horário já passou. Registrar mesmo assim?');
    expect(MSG_CONCLUIDO_COM_COMANDA).toBe('Já fechado na comanda. Para mudar, edite a comanda.');
    expect(MSG_REABRIR).toBe('Reabrir este atendimento?');
    expect(msgConflito('Ana', '09:30')).toBe('Já existe atendimento de Ana às 09:30. Agendar mesmo assim?');
  });

  it('web e app usam as constantes, sem repetir o texto cru', () => {
    const textos = ['Esse horário já passou', 'Já fechado na comanda', 'Reabrir este atendimento', 'Já existe atendimento de'];
    for (const f of TODOS) {
      const cod = semComentarios(ler(f));
      for (const t of textos) expect(cod, `${f} não deve repetir "${t}"`).not.toContain(t);
    }
    for (const f of [PAGE, NOVO_EMP]) {
      const cod = ler(f);
      expect(cod, f).toContain('MSG_HORARIO_PASSADO');
      expect(cod, f).toContain('msgConflito');
      expect(cod, f).toContain('MSG_CONCLUIDO_COM_COMANDA');
    }
    // reabrir: o web pela constante, o app pela função que a devolve
    expect(ler(PAGE)).toContain('MSG_REABRIR');
    for (const f of [DET_EMP, DET_PROF]) expect(ler(f), f).toContain('precisaConfirmarStatus');
  });

  it('"Minha agenda abre em" com "Minha agenda" e "Todas as profissionais" nas duas Configurações', () => {
    for (const f of ['web/app/(app)/configuracoes/page.tsx', 'mobile/app/(empresa)/configuracoes.tsx']) {
      const cod = ler(f);
      expect(cod, f).toContain('Minha agenda abre em');
      expect(cod, f).toContain("'Minha agenda'");
      expect(cod, f).toContain("'Todas as profissionais'");
    }
  });

  it('filtro "Todas as profissionais" presente na agenda do web', () => {
    expect(ler(PAGE)).toContain("label: 'Todas as profissionais'");
  });
});
