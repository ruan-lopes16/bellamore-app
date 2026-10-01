import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Decisão do dono (2026-10-01): o "Agenda hoje" dos dashboards não conta
// agendamentos cancelados — mesma regra no web e no app.
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('"Agenda hoje" exclui cancelados nas duas plataformas', () => {
  const casos: [string, string][] = [
    ['web/app/(app)/dashboard/page.tsx', 'limHoje.startIso'],
    ['web/app/(app)/dashboard/DashboardProfissionalView.tsx', "from('agendamentos')"],
    ['mobile/hooks/useDashboard.ts', "from('agendamentos')"],
    ['mobile/hooks/useProfissional.ts', "from('agendamentos')"],
  ];
  for (const [arq, ancora] of casos) {
    it(arq, () => {
      const src = ler(arq);
      const i = src.indexOf(ancora);
      expect(i).toBeGreaterThan(-1);
      expect(src.slice(i, i + 600)).toContain(".neq('status', 'cancelado')");
    });
  }
});
