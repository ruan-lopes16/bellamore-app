/**
 * Residuais finais: renovação do aparelho ao voltar ao app (item 6) e histórico da Equipe por
 * cursor no banco (104, item 3).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { deveRenovarDispositivo, HORAS_RENOVAR_DISPOSITIVO } from '@shared/push-dispositivos';

const root = join(__dirname, '..', '..', '..');
const ler = (f: string) => readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n');

describe('renovação do aparelho ao voltar ao app', () => {
  const H = 60 * 60 * 1000;
  it('renova na 1ª vez e depois de 24 h; não antes', () => {
    expect(deveRenovarDispositivo(null, 1000)).toBe(true);
    expect(deveRenovarDispositivo(0, (HORAS_RENOVAR_DISPOSITIVO - 1) * H)).toBe(false);
    expect(deveRenovarDispositivo(0, HORAS_RENOVAR_DISPOSITIVO * H)).toBe(true);
  });
  it('o app renova ao voltar ao primeiro plano (AppState active)', () => {
    const s = ler('mobile/app/_layout.tsx');
    expect(s).toContain('deveRenovarDispositivo(ultimoRegistroPushRef.current, Date.now())');
    expect(s).toMatch(/AppState\.addEventListener\('change'[\s\S]*?registrar\(\)/);
  });
});

describe('104 — histórico da Equipe por cursor', () => {
  const corpo = (s: string, nome: string) => {
    const i = s.indexOf(`create or replace function public.${nome}(`);
    return s.slice(i, s.indexOf('$$;', i) + 3);
  };
  const v092 = corpo(ler('supabase/migrations/092_convites_e_historico_equipe.sql'), 'listar_historico_equipe');
  const v104 = corpo(ler('supabase/migrations/104_historico_equipe_cursor.sql'), 'listar_historico_equipe_cursor');

  it('mesmo corpo da 092, com o cursor no lugar do offset', () => {
    const esperado = v092
      .replace('listar_historico_equipe(p_empresa uuid, p_limite integer, p_offset integer)',
        'listar_historico_equipe_cursor(p_empresa uuid, p_limite integer, p_antes_em timestamptz, p_antes_id uuid)')
      .replace('     where h.empresa_id = p_empresa\n',
        '     where h.empresa_id = p_empresa\n'
        + '       -- 104: só o que vem depois do último item já mostrado (ordem criado_em desc, id desc).\n'
        + '       and (p_antes_em is null or (h.criado_em, h.id) < (p_antes_em, p_antes_id))\n')
      .replace('\n     offset greatest(coalesce(p_offset, 0), 0);', ';');
    expect(v104).toBe(esperado);
  });

  it('só authenticated executa', () => {
    const s = ler('supabase/migrations/104_historico_equipe_cursor.sql');
    expect(s).toContain('from public, anon;');
    expect(s).toContain('to authenticated;');
  });
});
