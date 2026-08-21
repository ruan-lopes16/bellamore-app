import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

describe('historico da cliente no web', () => {
  const arquivo = 'app/(app)/clientes/[id]/page.tsx';

  it('busca agendamento_servicos nas duas consultas do perfil', () => {
    const src = read(arquivo);
    // Uma para o histórico, outra para as estatísticas — as duas precisam,
    // senão o serviço favorito continua contando só o serviço legado.
    const ocorrencias = src.match(/agendamento_servicos\(ordem, ?servico:servicos\(nome\)\)/g) ?? [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2);
  });

  it('usa descreverServicos em vez do servico legado na lista', () => {
    const src = read(arquivo);
    // Sem fixar o formato do import: a Task 4 agrupou os simbolos do modulo
    // numa importacao multilinha, e isso nao muda o que este teste garante.
    expect(src).toMatch(/import \{[\s\S]{0,200}descreverServicos[\s\S]{0,200}\} from '@shared\/atendimento-detalhe';/);
    expect(src).toContain('descreverServicos(ag)');
    // O acesso direto ao servico legado na renderizacao da lista nao pode voltar
    expect(src).not.toContain("{(ag.servico as any)?.nome ?? '—'}");
  });

  it('conta cada servico do agendamento no servico favorito', () => {
    const src = read(arquivo);
    // A agregacao antiga somava so a.servico?.nome — um servico por atendimento.
    expect(src).not.toContain('if (a.servico?.nome) svcCount[a.servico.nome]');
    expect(src).toContain('nomesDeServicos');
  });
});

describe('modal de detalhe do atendimento no web', () => {
  const arquivo = 'app/(app)/clientes/[id]/page.tsx';

  it('existe e usa a trava de scroll dos demais modais', () => {
    const src = read(arquivo);
    expect(src).toContain('function DetalheAtendimentoModal(');
    // 3 chamadas: NovoAgModal, modalRemover e o modal novo
    expect((src.match(/useScrollLock\(/g) ?? []).length).toBe(3);
  });

  it('consulta a comanda com maybeSingle para distinguir RLS de erro', () => {
    // .single() devolveria erro quando o RLS filtra a linha; .maybeSingle()
    // devolve null, que e o que montarDetalheAtendimento espera.
    expect(read(arquivo)).toContain('.maybeSingle()');
  });

  it('trata as tres situacoes possiveis do detalhe', () => {
    const src = read(arquivo);
    expect(src).toContain("'bloqueado_por_rls'");
    expect(src).toContain("'sem_comanda'");
    expect(src).toContain('Detalhes financeiros disponíveis apenas para quem atendeu');
  });

  it('torna a linha do historico clicavel', () => {
    expect(read(arquivo)).toContain('setDetalheAberto(');
  });
});

const leMobile = (f: string) => readFileSync(resolve(__dirname, '../../..', f), 'utf8');

describe('historico da cliente no mobile', () => {
  const hook = 'mobile/hooks/useClientes.ts';

  it('nao trunca o historico em 20', () => {
    expect(leMobile(hook)).not.toContain('.limit(20)');
  });

  it('inclui os servicos lancados direto na comanda', () => {
    const src = leMobile(hook);
    expect(src).toContain("from('comanda_itens')");
    expect(src).toContain("eq('comanda.clientes_id'");
  });

  it('calcula total gasto e visitas sobre a lista completa', () => {
    const src = leMobile(hook);
    // A agregacao antiga somava so `agendamentos`, ja truncado em 20
    expect(src).not.toContain('const concluidos = agendamentos.filter');
    expect(src).toContain('linhasDeVisita');
  });

  it('web e mobile usam o mesmo paginador', () => {
    expect(leMobile(hook)).toContain("from '@shared/paginacao'");
    expect(read('app/(app)/clientes/[id]/page.tsx')).toContain("from '@shared/paginacao'");
    // a copia local do web nao pode sobreviver
    expect(read('app/(app)/clientes/[id]/page.tsx')).not.toContain('async function buscarTodasPaginas');
  });
});

describe('lista do historico no mobile', () => {
  const tela = 'mobile/app/(empresa)/cliente/[id].tsx';

  it('mostra todos os servicos do atendimento', () => {
    const src = leMobile(tela);
    expect(src).toContain("from '@shared/atendimento-detalhe'");
    expect(src).toContain('descreverServicos(ag)');
    expect(src).not.toContain("{ag.servico?.nome ?? 'Serviço'}");
  });

  it('roteia o extra de comanda por comanda, nao por agendamento', () => {
    // Passar um id de comanda_itens para /agendamento/[id] abriria tela quebrada
    const src = leMobile(tela);
    expect(src).toContain('tipo=comanda');
    expect(src).toContain('eExtraDeComanda');
  });
});
