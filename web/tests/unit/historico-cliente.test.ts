import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

describe('historico da cliente no web', () => {
  const arquivo = 'app/(app)/clientes/[id]/page.tsx';

  // Paridade Clientes (Task 5): histórico e KPIs saem de carregarHistoricoCliente (shared),
  // que busca agendamento_servicos e descreve os serviços com descreverServicos.
  it('busca agendamento_servicos na fonte única do perfil', () => {
    expect(read(arquivo)).toContain('carregarHistoricoCliente(');
    expect(read('../shared/clientes-consultas.ts')).toMatch(/agendamento_servicos\(ordem, ?servico:servicos\(nome\)\)/);
  });

  it('usa descreverServicos em vez do servico legado na lista', () => {
    expect(read('../shared/clientes-consultas.ts')).toContain('descreverServicos(a)');
    // O acesso direto ao servico legado na renderizacao da lista nao pode voltar
    expect(read('app/(app)/clientes/[id]/HistoricoCliente.tsx')).not.toContain('servico as any');
  });

  it('servico favorito vem do agregado de shared, sem contagem local', () => {
    const src = read(arquivo);
    expect(src).not.toContain('svcCount');
    expect(src).toContain('kpisPerfilCliente(');
    expect(read('../shared/clientes-segmentos.ts')).toContain('a?.servicoFavorito?.nome');
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
    // A consulta saiu para shared (Task 10 da Agenda: perfil e agenda usam a mesma).
    expect(read(arquivo)).toContain('carregarDetalheAtendimento(');
    expect(read('../shared/atendimento-detalhe-consultas.ts')).toContain('.maybeSingle()');
  });

  it('trata as tres situacoes possiveis do detalhe', () => {
    // O bloco saiu para components/ConteudoComanda.tsx (o mesmo do detalhe da Agenda).
    expect(read(arquivo)).toContain('<ConteudoComanda');
    const src = read('components/ConteudoComanda.tsx');
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

  it('inclui os servicos lancados direto na comanda (fonte unica de shared)', () => {
    expect(leMobile(hook)).toContain('carregarHistoricoCliente(');
    const src = leMobile('shared/clientes-consultas.ts');
    expect(src).toContain("from('comanda_itens')");
    expect(src).toContain("eq('comanda.clientes_id'");
  });

  it('calcula total gasto e visitas sobre a lista completa', () => {
    const src = leMobile(hook);
    // A agregacao antiga somava so `agendamentos`, ja truncado em 20
    expect(src).not.toContain('const concluidos = agendamentos.filter');
    expect(src).toContain('carregarHistoricoCliente(');
  });

  it('web e mobile usam o mesmo paginador', () => {
    // o app pagina pela fonte unica de shared (buscarTodasOuLancar, por @shared/paginacao)
    expect(leMobile('shared/clientes-consultas.ts')).toContain('buscarTodasOuLancar');
    // o web pagina pela consulta única de shared (que usa o paginador comum)
    expect(read('app/(app)/clientes/[id]/page.tsx')).toContain("from '@shared/clientes-consultas'");
    // a copia local do web nao pode sobreviver
    expect(read('app/(app)/clientes/[id]/page.tsx')).not.toContain('async function buscarTodasPaginas');
  });
});

describe('lista do historico no mobile', () => {
  const tela = 'mobile/app/(empresa)/cliente/[id].tsx';

  it('mostra todos os servicos do atendimento', () => {
    const src = leMobile(tela);
    // descreverServicos roda na fonte unica de shared; a tela mostra item.servicos
    expect(leMobile('shared/clientes-consultas.ts')).toContain('descreverServicos(a)');
    expect(src).toContain('item.servicos');
    expect(src).not.toContain("{ag.servico?.nome ?? 'Serviço'}");
  });

  it('roteia o extra de comanda por comanda, nao por agendamento', () => {
    // Passar um id de comanda_itens para /agendamento/[id] abriria tela quebrada
    const src = leMobile(tela);
    expect(src).toContain('tipo=comanda');
    expect(src).toContain('item.comandaId');
  });
});

describe('detalhe do atendimento no mobile', () => {
  const tela = 'mobile/app/(empresa)/agendamento/[id].tsx';

  it('monta o detalhe com a funcao compartilhada', () => {
    const src = leMobile(tela);
    expect(src).toContain('montarDetalheAtendimento');
    expect(src).toContain('.maybeSingle()');
  });

  it('aceita o modo comanda vindo da lista', () => {
    expect(leMobile(tela)).toContain("tipo === 'comanda'");
  });

  it('trata as tres situacoes possiveis', () => {
    const src = leMobile(tela);
    expect(src).toContain("'bloqueado_por_rls'");
    expect(src).toContain("'sem_comanda'");
    expect(src).toContain('Detalhes financeiros disponíveis apenas para quem atendeu');
  });
});
