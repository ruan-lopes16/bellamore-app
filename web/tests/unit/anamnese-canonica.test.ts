import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ANAMNESE_VAZIA, normalizarAnamnese, restricoesAnamnese, anamnesePreenchida,
  PERGUNTAS_SIM_NAO, PERGUNTAS_OPCOES,
} from '@shared/anamnese';

describe('normalizarAnamnese', () => {
  it('lixo/vazio vira ficha vazia', () => {
    expect(normalizarAnamnese(null)).toEqual(ANAMNESE_VAZIA);
    expect(normalizarAnamnese('texto')).toEqual(ANAMNESE_VAZIA);
  });

  it('formato do web (produção, 9 fichas) é preservado', () => {
    const web = {
      alergias: { resposta: 'sim', detalhe: 'látex' }, problemas_saude: { resposta: 'nao', detalhe: '' },
      medicamentos: { resposta: '', detalhe: '' }, gravida_amamentando: { resposta: 'sim', detalhe: '' },
      info_adicionais: 'obs', declaracao_aceita: true, salvo_em: '2026-08-01T10:00:00.000Z',
    };
    const a = normalizarAnamnese(web);
    expect(a.alergias).toEqual({ resposta: 'sim', detalhe: 'látex' });
    expect(a.problemas_saude.resposta).toBe('nao');
    expect(a.gestante).toBe('gestante');           // gravida_amamentando=sim → gestante
    expect(a.info_adicionais).toBe('obs');
    expect(a.declaracao_aceita).toBe(true);
    expect(a.salvo_em).toBe('2026-08-01T10:00:00.000Z');
  });

  it('formato antigo do mobile (strings livres) é convertido', () => {
    const a = normalizarAnamnese({
      alergia: 'Dipirona', medicamentos: 'Não', gestante: 'Lactante',
      tipo_pele: 'Oleosa', sensibilidade: 'Alta', autoimune: '', observacoes: 'x',
    });
    expect(a.alergias).toEqual({ resposta: 'sim', detalhe: 'Dipirona' });
    expect(a.medicamentos).toEqual({ resposta: 'nao', detalhe: '' });
    expect(a.gestante).toBe('lactante');
    expect(a.tipo_pele).toBe('oleosa');
    expect(a.sensibilidade_olhos).toBe('alta');
    expect(a.autoimune.resposta).toBe('');
    expect(a.info_adicionais).toBe('x');
    expect(a.declaracao_aceita).toBe(false);
  });

  it('formato canônico é idempotente', () => {
    const a = normalizarAnamnese({ ...ANAMNESE_VAZIA, tipo_pele: 'seca', alergias: { resposta: 'sim', detalhe: 'y' } });
    expect(normalizarAnamnese(a)).toEqual(a);
  });
});

describe('restricoesAnamnese', () => {
  it('lista sim-com-detalhe, gestação/lactação e sensibilidade alta', () => {
    const r = restricoesAnamnese({
      ...ANAMNESE_VAZIA,
      alergias: { resposta: 'sim', detalhe: 'látex' },
      medicamentos: { resposta: 'nao', detalhe: '' },
      gestante: 'lactante', sensibilidade_olhos: 'alta',
    });
    expect(r).toEqual(['Alergia: látex', 'Lactante', 'Sensibilidade nos olhos: alta']);
  });
  it('ficha vazia não tem restrição e não está preenchida', () => {
    expect(restricoesAnamnese(ANAMNESE_VAZIA)).toEqual([]);
    expect(anamnesePreenchida(ANAMNESE_VAZIA)).toBe(false);
    expect(anamnesePreenchida({ ...ANAMNESE_VAZIA, salvo_em: '2026-01-01T00:00:00Z' })).toBe(true);
  });
});

it('perguntas cobrem a união dos campos de web e mobile', () => {
  expect(PERGUNTAS_SIM_NAO.map(p => p.key)).toEqual(
    ['alergias', 'problemas_saude', 'medicamentos', 'autoimune', 'procedimento_anterior']);
  expect(PERGUNTAS_OPCOES.map(p => p.key)).toEqual(['gestante', 'tipo_pele', 'sensibilidade_olhos']);
});

describe('migration 080', () => {
  const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', '080_anamnese_fichas_fonte_unica.sql'), 'utf8');
  it('cria policies de SELECT/INSERT/UPDATE idempotentes para membros da empresa', () => {
    for (const nome of ['anamnese: ver', 'anamnese: inserir', 'anamnese: atualizar']) {
      expect(sql).toContain(`drop policy if exists "${nome}"`);
      expect(sql).toContain(`create policy "${nome}"`);
    }
    expect(sql).toMatch(/empresa_id in \(select minha_empresas\(\)\)/);
    expect(sql).not.toMatch(/cliente_id\s*=\s*auth\.uid\(\)/);
  });
  it('migra fichas de clientes.observacoes com on conflict e limpa só as migradas', () => {
    expect(sql).toMatch(/insert into public\.anamnese_fichas/i);
    expect(sql).toMatch(/on conflict \(empresa_id, cliente_id\) do nothing/i);
    expect(sql).toMatch(/update public\.clientes\s+set observacoes = null/i);
  });
  it('so limpa observacoes quando a copia realmente aconteceu e tolera linhas invalidas', () => {
    expect(sql).toContain('exception when others');
    expect(sql).toContain('returning id into');
    const iRet = sql.indexOf('returning id into');
    const iUpd = sql.indexOf('update public.clientes set observacoes = null');
    expect(iUpd).toBeGreaterThan(iRet);
  });
  it('recarrega o schema do PostgREST', () => {
    expect(sql.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
