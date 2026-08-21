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
    expect(src).toContain("import { descreverServicos } from '@shared/atendimento-detalhe';");
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
