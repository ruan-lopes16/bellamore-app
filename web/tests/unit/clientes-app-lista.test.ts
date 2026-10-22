import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const tela = readFileSync(join(root, 'mobile/app/(empresa)/clientes.tsx'), 'utf8');
const hook = readFileSync(join(root, 'mobile/hooks/useClientes.ts'), 'utf8');
const novoAg = readFileSync(join(root, 'mobile/app/(empresa)/novo-agendamento.tsx'), 'utf8');

describe('Clientes app: lista com segmentos únicos', () => {
  it('useClientes carrega a base uma vez por carregarBaseClientes, sem busca no queryKey', () => {
    expect(hook).toContain('@shared/clientes-consultas');
    expect(hook).toContain('carregarBaseClientes');
    expect(hook).toContain('agregarClientes');
    expect(hook).not.toMatch(/useClientesStats/);
    expect(hook).not.toMatch(/queryKey: \['clientes', empresaId, filtro, busca\]/);
    expect(hook).not.toMatch(/subDays/);
  });

  it('a tela usa as funções de shared em vez de regra local', () => {
    expect(tela).toContain('@shared/clientes-segmentos');
    for (const f of ['contarSegmentos', 'filtrarClientes', 'segmentosDaCliente', 'ROTULO_FILTRO', 'ROTULO_SEGMENTO']) {
      expect(tela).toContain(f);
    }
    expect(tela).not.toMatch(/useClientesStats/);
    expect(tela).not.toMatch(/'aniversarios'|'sumidas'/);
  });

  it('cartões clicáveis, busca e filtros', () => {
    for (const t of ['Total', 'Novas no mês', 'VIP', 'Em risco', 'Sumidas', 'Nunca atendidas']) expect(tela).toContain(t);
    expect(tela).toContain('Buscar por nome, telefone ou e-mail');
    expect(tela).toMatch(/<Pressable[\s\S]{0,200}setFiltro\(/);
    for (const f of ['aniversariantes', 'retornos', 'arquivadas', 'novas']) expect(tela).toContain(f);
  });

  it('linha mostra tags, total gasto escondível e última visita; erro vira aviso', () => {
    expect(tela).toMatch(/<SecretText[\s\S]{0,300}totalGasto/);
    expect(tela).toContain('ultimaVisita');
    expect(tela).toMatch(/isError/);
    expect(tela).toContain('Não foi possível carregar');
  });

  it('banner de aniversariantes é o filtro do mês', () => {
    expect(tela).toContain('aniversariantesDoMes');
    expect(tela).toMatch(/setFiltro\('aniversariantes'\)/);
  });

  it('novo-agendamento continua buscando cliente, agora no cliente', () => {
    expect(novoAg).not.toMatch(/useClientes\('todas'/);
    expect(novoAg).toContain('filtrarClientes');
  });
});
