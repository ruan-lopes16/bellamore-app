import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cursorHistoricoEquipe, linhasAposCursorHistorico, carregarHistoricoEquipe, TAMANHO_PAGINA_HISTORICO_EQUIPE } from '@shared/convites-consultas';

const raiz = resolve(__dirname, '../../..');
const ler = (p: string) => readFileSync(resolve(raiz, p), 'utf8');
const L = (id: string, criado_em: string) => ({ id, criado_em, acao: 'desativado', alvo_user_id: null, feito_por: null, detalhe: null });

describe('cursor do histórico da Equipe', () => {
  it('cursor vem da última linha mostrada e conta quantas foram vistas', () => {
    expect(cursorHistoricoEquipe([])).toBeNull();
    expect(cursorHistoricoEquipe([L('b', '2026-10-02T10:00:00Z'), L('a', '2026-10-01T10:00:00Z')]))
      .toEqual({ criado_em: '2026-10-01T10:00:00Z', id: 'a', vistos: 2 });
  });

  it('descarta o que já foi mostrado (criado_em desc, id desc), inclusive empate de horário', () => {
    const cursor = { criado_em: '2026-10-01T10:00:00Z', id: 'm' };
    const r = linhasAposCursorHistorico([
      L('z', '2026-10-01T10:00:00Z'), L('m', '2026-10-01T10:00:00Z'), L('c', '2026-10-01T10:00:00Z'),
      L('x', '2026-09-30T10:00:00Z'),
    ], cursor);
    expect(r.map(l => l.id)).toEqual(['c', 'x']);
    expect(linhasAposCursorHistorico([L('a', '2026-01-01')], null)).toHaveLength(1);
  });

  it('evento novo no topo não repete itens na próxima página', async () => {
    const vistas = [L('3', '2026-10-03T00:00:00Z'), L('2', '2026-10-02T00:00:00Z')];
    // Chegou o evento 4: lido por posição (offset 2), voltam 2 e 3... e depois o 1.
    const rpcData = [L('3', '2026-10-03T00:00:00Z'), L('2', '2026-10-02T00:00:00Z'), L('1', '2026-10-01T00:00:00Z')];
    const db = { rpc: async () => ({ data: rpcData, error: null }) } as never;
    const r = await carregarHistoricoEquipe(db, 'e1', cursorHistoricoEquipe(vistas));
    expect(r.linhas.map(l => l.id)).toEqual(['1']);
    expect(r.temMais).toBe(false);
    expect(TAMANHO_PAGINA_HISTORICO_EQUIPE).toBeGreaterThan(0);
  });
});

describe('varredura: paginação e rascunho de permissões', () => {
  it('agenda web, insumos web e app paginam com desempate por id', () => {
    for (const p of ['web/app/(app)/agenda/page.tsx', 'web/app/(app)/servicos/page.tsx', 'mobile/components/servicos/servicos-gravacao.ts']) {
      const s = ler(p);
      expect(s, p).toContain('buscarTodasPaginas');
      expect(s, p).toContain(".order('id').range(");
    }
  });
  it('Equipe web e app usam o cursor', () => {
    expect(ler('web/app/(app)/equipe/page.tsx')).toContain('cursorHistoricoEquipe(');
    expect(ler('mobile/components/EquipeConvites.tsx')).toContain('cursorHistoricoEquipe(');
  });
  it('painéis pedem confirmação antes de descartar rascunho', () => {
    expect(ler('web/components/permissoes/PermissoesPanel.tsx')).toContain('Descartar as alterações não salvas?');
    const app = ler('mobile/components/PermissoesPanel.tsx');
    expect(app).toContain('Descartar as alterações não salvas?');
    expect(app).toContain('Escolha uma pessoa para ver e ajustar as permissões dela');
  });
});
