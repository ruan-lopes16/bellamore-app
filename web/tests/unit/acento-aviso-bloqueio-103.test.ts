/**
 * 103: notificar_bloqueio() é a da 069 com uma única troca ("aprovacao" → "aprovação").
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const mig = (n: string) => readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', n), 'utf8').replace(/\r\n/g, '\n');
const corpo = (s: string) => {
  const i = s.indexOf('create or replace function public.notificar_bloqueio()');
  const f = s.indexOf('for each row execute function public.notificar_bloqueio();');
  return s.slice(i, f);
};

describe('103 — acento no aviso de bloqueio pendente', () => {
  const v069 = corpo(mig('069_agenda_bloqueios_notificacoes_trigger.sql'));
  const v103 = corpo(mig('103_acento_aviso_bloqueio.sql'));

  it('corpo idêntico ao da 069, exceto o título', () => {
    expect(v103).toBe(v069.replace("'Bloqueio aguardando aprovacao'", "'Bloqueio aguardando aprovação'"));
  });

  it('corrige os avisos que já estão no sino', () => {
    expect(mig('103_acento_aviso_bloqueio.sql')).toMatch(
      /update public\.notificacoes\s+set titulo = 'Bloqueio aguardando aprovação'\s+where titulo = 'Bloqueio aguardando aprovacao'/,
    );
  });
});
