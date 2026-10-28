import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { permissaoDaRota, pode, type PermissoesUsuario } from '@shared/permissoes';

const appDir = join(__dirname, '..', '..', 'app', '(app)');

describe('permissaoDaRota — o mesmo mapa dos layouts do web (exigirAcesso)', () => {
  // Varre os layouts reais: se alguém mudar a guarda de uma rota no web, este teste cobra o shared.
  const pastas = readdirSync(appDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  for (const pasta of pastas) {
    const arq = join(appDir, pasta, 'layout.tsx');
    const src = existsSync(arq) ? readFileSync(arq, 'utf8') : '';
    const m = src.match(/exigirAcesso\(\s*permissoes\s*,\s*'([a-z_.]+)'\s*\)/);
    const esperado = m ? m[1] : null;
    it(`/${pasta} → ${esperado ?? 'liberada'}`, () => {
      expect(permissaoDaRota(`/${pasta}`)).toBe(esperado);
      expect(permissaoDaRota(`/${pasta}/qualquer/coisa?x=1`)).toBe(esperado);
    });
  }

  it('o mapa tem as 5 guardas do web', () => {
    expect(permissaoDaRota('/equipe')).toBe('equipe.gerenciar');
    expect(permissaoDaRota('/estoque')).toBe('estoque.acessar');
    expect(permissaoDaRota('/financeiro')).toBe('financeiro.ver');
    expect(permissaoDaRota('/relatorios')).toBe('financeiro.ver');
    expect(permissaoDaRota('/vendas')).toBe('vendas.acessar');
  });
});

describe('permissaoDaRota — rotas do app', () => {
  it.each([
    ['/(empresa)/equipe', 'equipe.gerenciar'],
    ['/(empresa)/convidar-profissional', 'equipe.gerenciar'],
    ['/(empresa)/editar-profissional/abc', 'equipe.gerenciar'],
    ['/(empresa)/estoque', 'estoque.acessar'],
    ['/(empresa)/novo-produto', 'estoque.acessar'],
    ['/(empresa)/editar-produto/abc', 'estoque.acessar'],
    ['/(empresa)/financeiro', 'financeiro.ver'],
    ['/(empresa)/nova-despesa', 'financeiro.ver'],
    ['/(empresa)/nova-retirada', 'dona'],
    ['/(empresa)/relatorios', 'financeiro.ver'],
    ['/(empresa)/vendas', 'vendas.acessar'],
    ['/(empresa)/novo-servico', 'servicos.gerenciar'],
    ['/(empresa)/editar-servico/abc', 'servicos.gerenciar'],
    ['/(empresa)/novo-pacote', 'pacotes.gerenciar'],
    ['/(empresa)/editar-pacote/abc', 'pacotes.gerenciar'],
    ['/(empresa)/novo-cliente', 'clientes.cadastrar'],
    ['/(empresa)/cliente/abc/editar', 'clientes.editar'],
    // segmentos do expo-router (useSegments) também servem
    ['(empresa)/estoque', 'estoque.acessar'],
    ['estoque', 'estoque.acessar'],
  ])('%s → %s', (rota, chave) => expect(permissaoDaRota(rota)).toBe(chave));

  it.each([
    '/(empresa)/dashboard', '/(empresa)/agenda', '/(empresa)/clientes', '/(empresa)/cliente/abc',
    '/(empresa)/cliente/abc/anamnese', '/(empresa)/comissoes', '/(empresa)/configuracoes', '/(empresa)/mais',
    '/(empresa)/notificacoes', '/(empresa)/nova-comanda', '/(empresa)/servicos', '/(empresa)/pacotes',
    '/(empresa)/agendamento/abc', '/(empresa)/novo-agendamento', '/', '',
  ])('%s → liberada', (rota) => expect(permissaoDaRota(rota)).toBeNull());

  it('o array de segmentos do expo-router', () => {
    expect(permissaoDaRota(['(empresa)', 'editar-produto', '[id]'])).toBe('estoque.acessar');
    expect(permissaoDaRota(['(empresa)', 'cliente', '[id]', 'editar'])).toBe('clientes.editar');
  });
});

describe('pode com permissões ausentes (RPC falhou)', () => {
  it('null nunca libera nada, nem a chave mais básica', () => {
    expect(pode(null, 'agenda.excluir')).toBe(false);
    expect(pode(null, 'dona')).toBe(false);
  });
  it('dona continua podendo tudo', () => {
    const dona: PermissoesUsuario = { isOwner: true, papel: null, chaves: [] };
    expect(pode(dona, 'dona')).toBe(true);
  });
});
