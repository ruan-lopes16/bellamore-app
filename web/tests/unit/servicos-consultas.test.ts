import { describe, it, expect } from 'vitest';
import {
  MSG_SERVICO_USADO, excluirServicoConferido, diffInsumos, sincronizarInsumos,
  mapearInsumosCarregados, quantidadeInsumo,
} from '@shared/servicos-consultas';

/** Banco falso que registra cada chamada e responde conforme `opts`. */
function dbFake(opts: {
  rpcErro?: { code?: string; message?: string } | null;
  usos?: Record<string, number>;
  usoErro?: string;
  apagados?: number;
  upsertErro?: { code?: string; message?: string } | null;
  upsertLinhas?: number;
  deleteErro?: { code?: string; message?: string } | null;
}) {
  const chamadas: string[] = [];
  const db = {
    chamadas,
    rpc: async () => ({ error: opts.rpcErro ?? null }),
    from: (t: string) => ({
      select: () => ({
        eq: async () => {
          chamadas.push('count:' + t);
          return t === opts.usoErro
            ? { count: null, error: { code: 'XX000', message: 'falha' } }
            : { count: opts.usos?.[t] ?? 0, error: null };
        },
      }),
      upsert: (linhas: unknown[], o: { onConflict: string }) => ({
        select: async () => {
          chamadas.push(`upsert:${t}:${o.onConflict}:${linhas.length}`);
          if (opts.upsertErro) return { data: null, error: opts.upsertErro };
          return { data: Array.from({ length: opts.upsertLinhas ?? linhas.length }, () => ({})), error: null };
        },
      }),
      delete: () => ({
        eq: (_c: string, _v: string) => ({
          in: (_c2: string, ids: string[]) => ({
            select: async () => {
              chamadas.push(`delete:${t}:${ids.join(',')}`);
              return { data: ids.map(() => ({})), error: opts.deleteErro ?? null };
            },
          }),
          eq: () => ({
            select: async () => {
              chamadas.push('delete:' + t);
              return { data: Array.from({ length: opts.apagados ?? 1 }, () => ({ id: 'x' })), error: null };
            },
          }),
        }),
      }),
    }),
  };
  return db;
}

describe('excluirServicoConferido (regra única web e app)', () => {
  it('usa a função da 096 quando existe', async () => {
    const db = dbFake({});
    await expect(excluirServicoConferido(db, 'e', 's')).resolves.toBeUndefined();
    expect(db.chamadas).toEqual([]);
  });
  it('mostra a mensagem do banco quando o serviço foi usado', async () => {
    const db = dbFake({ rpcErro: { code: 'P0001', message: MSG_SERVICO_USADO } });
    await expect(excluirServicoConferido(db, 'e', 's')).rejects.toThrow(MSG_SERVICO_USADO);
  });
  it('sem a 096, confere as 5 tabelas da função e recusa serviço usado sem apagar', async () => {
    const db = dbFake({ rpcErro: { code: 'PGRST202' }, usos: { pacote_uso: 1 } });
    await expect(excluirServicoConferido(db, 'e', 's')).rejects.toThrow(MSG_SERVICO_USADO);
    expect(db.chamadas).not.toContain('delete:servicos');
    for (const t of ['agendamentos', 'agendamento_servicos', 'comanda_itens', 'pacote_servicos', 'pacote_uso']) {
      expect(db.chamadas).toContain('count:' + t);
    }
  });
  it('sem a 096, erro ao conferir o uso nunca apaga', async () => {
    const db = dbFake({ rpcErro: { code: 'PGRST202' }, usoErro: 'comanda_itens' });
    await expect(excluirServicoConferido(db, 'e', 's')).rejects.toThrow(/conferir o uso do serviço/);
    expect(db.chamadas).not.toContain('delete:servicos');
  });
  it('sem a 096, apaga serviço nunca usado e avisa se não apagou nada', async () => {
    const ok = dbFake({ rpcErro: { code: 'PGRST202' } });
    await expect(excluirServicoConferido(ok, 'e', 's')).resolves.toBeUndefined();
    expect(ok.chamadas).toContain('delete:servicos');
    const sem = dbFake({ rpcErro: { code: 'PGRST202' }, apagados: 0 });
    await expect(excluirServicoConferido(sem, 'e', 's')).rejects.toThrow('Você não tem permissão para excluir serviços.');
  });
});

describe('insumos por diferença', () => {
  const item = (produto_id: string, quantidade: string) => ({ produto_id, nome: produto_id, unidade: 'un', quantidade });

  it('quantidade aceita vírgula e ponto', () => {
    expect(quantidadeInsumo('1,5')).toBe(1.5);
    expect(quantidadeInsumo('2')).toBe(2);
    expect(Number.isNaN(quantidadeInsumo('x'))).toBe(true);
  });

  it('diff: grava os de quantidade > 0 e remove só o que saiu (ou ficou com quantidade inválida)', () => {
    const d = diffInsumos(['a', 'b', 'c'], [item('a', '2'), item('c', '0'), item('d', '1,5')]);
    expect(d.gravar).toEqual([{ produto_id: 'a', quantidade: 2 }, { produto_id: 'd', quantidade: 1.5 }]);
    expect(d.remover.sort()).toEqual(['b', 'c']);
  });

  it('grava antes de remover: se a gravação falha, a receita antiga fica intacta', async () => {
    const db = dbFake({ upsertErro: { code: 'XX000', message: 'falha' } });
    const r = await sincronizarInsumos(db, 's', ['a', 'b'], [item('a', '3')]);
    expect(r).toMatch(/salvar os insumos do serviço/);
    expect(db.chamadas.some(c => c.startsWith('delete'))).toBe(false);
  });

  it('upsert pela chave única e delete só dos removidos', async () => {
    const db = dbFake({});
    const r = await sincronizarInsumos(db, 's', ['a', 'b'], [item('a', '3'), item('n', '1')]);
    expect(r).toBeNull();
    expect(db.chamadas).toEqual(['upsert:servico_produtos:servico_id,produto_id:2', 'delete:servico_produtos:b']);
  });

  it('sem nada a gravar nem a remover, não chama o banco', async () => {
    const db = dbFake({});
    expect(await sincronizarInsumos(db, 's', [], [])).toBeNull();
    expect(db.chamadas).toEqual([]);
  });

  it('upsert sem linhas devolvidas = sem permissão (RLS recusa em silêncio)', async () => {
    const db = dbFake({ upsertLinhas: 0 });
    const r = await sincronizarInsumos(db, 's', [], [item('a', '1')]);
    expect(r).toMatch(/permissão/);
  });

  it('erro ao remover é avisado', async () => {
    const db = dbFake({ deleteErro: { code: 'XX000', message: 'falha' } });
    const r = await sincronizarInsumos(db, 's', ['a'], []);
    expect(r).toMatch(/salvar os insumos do serviço/);
  });

  it('mapeia as linhas carregadas, mesmo sem o produto no embed', () => {
    expect(mapearInsumosCarregados([
      { produto_id: 'a', quantidade: 2, produto: { nome: 'Cera', unidade: 'g' } },
      { produto_id: 'b', quantidade: 1, produto: [{ nome: 'Luva', unidade: 'par' }] },
      { produto_id: 'c', quantidade: 1.5, produto: null },
    ])).toEqual([
      { produto_id: 'a', nome: 'Cera', unidade: 'g', quantidade: '2' },
      { produto_id: 'b', nome: 'Luva', unidade: 'par', quantidade: '1' },
      { produto_id: 'c', nome: 'Produto', unidade: '', quantidade: '1.5' },
    ]);
  });
});
