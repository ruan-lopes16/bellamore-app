import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TODAS, filtroInicialAgenda } from '@shared/agenda-grade';
import { MENSAGEM_SEM_094, salvarPreferenciaAgenda } from '@shared/agenda-consultas';

const raiz = resolve(__dirname, '../../..');
const ler = (p: string) => readFileSync(resolve(raiz, p), 'utf8');

describe('filtroInicialAgenda', () => {
  it('abre em Todas só com preferência "todas" E agenda.ver_equipe', () => {
    expect(filtroInicialAgenda('todas', true, 'u1')).toBe(TODAS);
    expect(filtroInicialAgenda('todas', false, 'u1')).toBe('u1');
    expect(filtroInicialAgenda('propria', true, 'u1')).toBe('u1');
    expect(filtroInicialAgenda('propria', false, 'u1')).toBe('u1');
  });
});

describe('salvarPreferenciaAgenda: erros em português', () => {
  const dbCom = (error: { code?: string; message?: string }) =>
    ({ rpc: () => Promise.resolve({ data: null, error }) }) as never;

  it('sem a 094 avisa da migration', async () => {
    await expect(salvarPreferenciaAgenda(dbCom({ code: 'PGRST202', message: 'x' }), 'e', 'todas')).rejects.toThrow(MENSAGEM_SEM_094);
    expect(MENSAGEM_SEM_094).toBe('Atualização do banco pendente: peça para rodar a migration 094.');
  });

  it('dona sem vínculo recebe a mensagem da função', async () => {
    await expect(salvarPreferenciaAgenda(
      dbCom({ code: '42501', message: 'Seu vínculo com esta empresa não foi encontrado.' }), 'e', 'propria',
    )).rejects.toThrow('Seu vínculo com esta empresa não foi encontrado.');
  });
});

describe('telas usam a preferência', () => {
  const web = ler('web/app/(app)/agenda/page.tsx');
  const app = ler('mobile/app/(empresa)/agenda.tsx');

  it('agenda web aplica o valor inicial pelo helper, depois de carregar', () => {
    expect(web).toContain('carregarPreferenciaAgenda');
    expect(web).toContain('filtroInicialAgenda');
  });

  it('agenda do app aplica o valor inicial pelo helper e espera permissões e preferência', () => {
    expect(app).toContain('usePreferenciaAgenda');
    expect(app).toContain('filtroInicialAgenda');
    expect(app).toContain('permissoesCarregadas');
  });

  it('configurações mostram o campo só com agenda.ver_equipe, nas duas plataformas', () => {
    for (const p of ['web/app/(app)/configuracoes/page.tsx', 'mobile/app/(empresa)/configuracoes.tsx']) {
      const src = ler(p);
      expect(src, p).toContain('Minha agenda abre em');
      expect(src, p).toContain("pode('agenda.ver_equipe')");
      expect(src, p).toContain('salvarPreferenciaAgenda');
    }
  });

  it('a área da profissional do app não usa a preferência', () => {
    expect(ler('mobile/app/(profissional)/agenda.tsx')).not.toContain('PreferenciaAgenda');
  });
});
