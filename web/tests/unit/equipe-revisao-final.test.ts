// web/tests/unit/equipe-revisao-final.test.ts
// Trava as correções da revisão final da branch feat/paridade-equipe (.superpowers/sdd/final-review.md):
// I2 números das colegas só com as chaves, I3 profissional com equipe.gerenciar adiciona profissional,
// I4 desfazer do vínculo de pacote volta ao valor anterior, M1 escaparLike/500, M4 readicionar mantém números.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { numerosVisiveis } from '@shared/equipe';
import { definicaoEquipe } from '@shared/exportacao/equipe';
import { desfazerVinculoPacote, MENSAGEM_VINCULO_SEM_SESSAO } from '@shared/pacotes-consultas';
import { podeAtribuirRole } from '@/lib/permissions';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

describe('I2: numerosVisiveis', () => {
  const com = (...chaves: string[]) => (c: string) => chaves.includes(c);

  it('os números da própria pessoa sempre aparecem', () => {
    expect(numerosVisiveis('eu', 'eu', com())).toEqual({ producao: true, comissao: true });
  });

  it('colega: produção exige agenda.ver_equipe e comissão exige comissoes.ver_todas', () => {
    expect(numerosVisiveis('eu', 'ela', com())).toEqual({ producao: false, comissao: false });
    expect(numerosVisiveis('eu', 'ela', com('agenda.ver_equipe'))).toEqual({ producao: true, comissao: false });
    expect(numerosVisiveis('eu', 'ela', com('comissoes.ver_todas'))).toEqual({ producao: false, comissao: true });
    expect(numerosVisiveis('eu', 'ela', com('agenda.ver_equipe', 'comissoes.ver_todas'))).toEqual({ producao: true, comissao: true });
  });

  it('sem usuário logado ainda, nunca trata ninguém como "eu mesma"', () => {
    expect(numerosVisiveis(null, 'ela', com())).toEqual({ producao: false, comissao: false });
    expect(numerosVisiveis(undefined, '', com())).toEqual({ producao: false, comissao: false });
  });

  it('exportação mostra "—" quando o número não pode ser visto', () => {
    const def = definicaoEquipe('2026-10');
    const linha = { nome: 'Ana', telefone: null, percentual: 40, atendimentosMes: null, totalMes: null, ativo: true };
    const vals = def.colunas.map(c => c.valor(linha));
    expect(vals[3]).toBe('—');
    expect(vals[4]).toBe('—');
  });

  for (const [plataforma, arquivo] of [['web', 'web/app/(app)/equipe/page.tsx'], ['app', 'mobile/app/(empresa)/equipe.tsx']]) {
    it(`${plataforma}: a Equipe usa numerosVisiveis nos cards e na exportação`, () => {
      const src = ler(arquivo);
      expect(src.match(/numerosVisiveis\(/g)?.length).toBeGreaterThanOrEqual(2);
      expect(src).toMatch(/temPendente = visiveis\.comissao &&/);
      expect(src).toMatch(/visiveis\.producao \?/);
      expect(src).toMatch(/visiveis\.comissao && !temPendente/);
      expect(src).toMatch(/visiveis\.comissao && \w+\.comissao_pendente_anterior > 0/);
      expect(src).toContain('Comissão pendente: —');
      expect(src).toMatch(/atendimentosMes: v\.producao \?/);
      expect(src).toMatch(/totalMes: v\.producao \?/);
    });
  }
});

describe('I3: papel no cadastro e no convite', () => {
  it('só a dona cria gestora; papel Profissional passa para quem já tem equipe.gerenciar', () => {
    expect(podeAtribuirRole('owner', 'gestor')).toBe(true);
    expect(podeAtribuirRole('gestor', 'gestor')).toBe(false);
    expect(podeAtribuirRole('profissional', 'gestor')).toBe(false);
    expect(podeAtribuirRole('owner', 'profissional')).toBe(true);
    expect(podeAtribuirRole('gestor', 'profissional')).toBe(true);
    expect(podeAtribuirRole('profissional', 'profissional')).toBe(true);
  });

  for (const rota of ['web/app/api/profissionais/route.ts', 'web/app/api/convites/route.ts']) {
    it(`${rota}: confere equipe.gerenciar antes e usa isOwner para o papel`, () => {
      const src = ler(rota);
      const iPerm = src.indexOf("pode(permsReq, 'equipe.gerenciar')");
      const iPapel = src.indexOf("podeAtribuirRole(permsReq.isOwner ? 'owner' : ");
      expect(iPerm).toBeGreaterThan(-1);
      expect(iPapel).toBeGreaterThan(iPerm);
      expect(src).not.toContain("podeAtribuirRole(membroReq.role as 'owner' | 'gestor' | 'profissional'");
    });
  }

  it('o seletor de papel (web e app) só aparece para a dona', () => {
    const web = ler('web/app/(app)/equipe/page.tsx');
    expect(web).toContain('isOwner={isOwner}');
    expect(web).not.toContain('meuRole={meuRole}');
    expect(ler('mobile/app/(empresa)/convidar-profissional.tsx')).toContain("podeAtribuirRole(isOwner ? 'owner' : 'gestor', 'gestor')");
    // o mesmo comportamento no helper do app
    expect(ler('mobile/lib/permissions.ts')).toMatch(/if \(roleAlvo === 'gestor'\) return quemConvida === 'owner';\n\s*return true;/);
  });
});

describe('I4: desfazer do vínculo em Pacotes', () => {
  function dbFalso(resposta: { data: unknown; error: unknown } | Error) {
    const chamadas: { update?: unknown; eq: [string, unknown][] } = { eq: [] };
    const q = {
      update(v: unknown) { chamadas.update = v; return q; },
      eq(c: string, v: unknown) { chamadas.eq.push([c, v]); return q; },
      select() { return resposta instanceof Error ? Promise.reject(resposta) : Promise.resolve(resposta); },
    };
    return { db: { from: (t: string) => { expect(t).toBe('agendamentos'); return q; } }, chamadas };
  }

  it('volta ao pacote anterior e confere as linhas', async () => {
    const { db, chamadas } = dbFalso({ data: [{ id: 'ag1' }], error: null });
    expect(await desfazerVinculoPacote(db, 'emp', 'ag1', 'combo1')).toBeNull();
    expect(chamadas.update).toEqual({ pacote_cliente_id: 'combo1' });
    expect(chamadas.eq).toEqual([['id', 'ag1'], ['empresa_id', 'emp']]);
  });

  it('atendimento sem pacote antes volta para null', async () => {
    const { db, chamadas } = dbFalso({ data: [{ id: 'ag1' }], error: null });
    expect(await desfazerVinculoPacote(db, 'emp', 'ag1', null)).toBeNull();
    expect(chamadas.update).toEqual({ pacote_cliente_id: null });
  });

  it('erro, 0 linhas ou exceção avisam para conferir o atendimento', async () => {
    expect(await desfazerVinculoPacote(dbFalso({ data: null, error: { message: 'x' } }).db, 'e', 'a', null)).toBe(MENSAGEM_VINCULO_SEM_SESSAO);
    expect(await desfazerVinculoPacote(dbFalso({ data: [], error: null }).db, 'e', 'a', null)).toBe(MENSAGEM_VINCULO_SEM_SESSAO);
    expect(await desfazerVinculoPacote(dbFalso(new Error('rede')).db, 'e', 'a', null)).toBe(MENSAGEM_VINCULO_SEM_SESSAO);
    expect(MENSAGEM_VINCULO_SEM_SESSAO).toBe('O vínculo foi trocado, mas a sessão não foi lançada; confira o atendimento.');
  });

  for (const [plataforma, arquivo] of [['web', 'web/components/pacotes/GerenciarSessoes.tsx'], ['app', 'mobile/app/(empresa)/pacotes.tsx']]) {
    it(`${plataforma}: candidatos trazem pacote_cliente_id e o desfazer usa o valor anterior`, () => {
      const src = ler(arquivo);
      expect(src).toContain("select('id, data_hora_inicio, servico_id, pacote_cliente_id, servico:servicos(nome)')");
      expect(src).toMatch(/type AgConcluido = \{[\s\S]*?pacote_cliente_id: string \| null;/);
      expect(src).toContain('desfazerVinculoPacote(supabase, empresaId, ag.id, ag.pacote_cliente_id ?? null)');
      expect(src).toContain('setErro(falhaDesfazer ?? falhaSessao)'); // 093: erro já em português (erroEscritaPacoteUso)
      // o desfazer cego (grava null sem conferir) não existe mais
      expect(src).not.toContain(".update({ pacote_cliente_id: null }).eq('id', ag.id)");
    });
  }
});

describe('M1 e M4', () => {
  const rota = ler('web/app/api/profissionais/route.ts');

  it('escaparLike escapa também *', () => {
    expect(rota).toContain('s.replace(/[\\\\%_*]/g');
  });

  it('falha do getUserById volta 500', () => {
    expect(rota).toMatch(/Não foi possível conferir a conta desta pessoa\.' \}, \{ status: 500 \}/);
  });

  it('web: readicionar quem já estava na lista mantém faturado e pendentes', () => {
    const web = ler('web/app/(app)/equipe/page.tsx');
    const i = web.indexOf('function onProfSalva');
    const corpo = web.slice(i, web.indexOf('setModal(false)', i));
    expect(corpo).toContain('total_mes: existe.total_mes');
    expect(corpo).toContain('comissao_pendente: existe.comissao_pendente');
    expect(corpo).toContain('ids_pendentes_mes: existe.ids_pendentes_mes');
  });
});
