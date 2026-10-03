import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const app = join(__dirname, '..', '..', 'app', '(app)');
const ler = (p: string) => readFileSync(join(app, p), 'utf8');

// 'financeiro.fechamentos' não entra aqui: o web não tem mais tela de importar
// fechamento mensal (removida na Fase 2A); a chave é imposta só pela RLS (migration 083).
const esperado: [string, string[]][] = [
  ['agenda/page.tsx', ['agenda.ver_equipe', 'agenda.gerenciar_outras', 'agenda.excluir', 'agenda.aprovar_bloqueios', 'clientes.cadastrar', 'pacotes.vender']],
  ['clientes/page.tsx', ['clientes.cadastrar']],
  ['clientes/[id]/page.tsx', ['clientes.editar', 'clientes.arquivar', 'clientes.excluir', 'anamnese.ver', 'anamnese.editar', 'agenda.gerenciar_outras']],
  ['comanda/page.tsx', ['comanda.desconto', 'comanda.editar_fechada', 'comanda.fechar']],
  ['pacotes/page.tsx', ['pacotes.gerenciar', 'pacotes.vender']],
  ['financeiro/page.tsx', ['despesas.gerenciar', 'taxas.marcar_pagas', 'dona']],
  ['configuracoes/page.tsx', ['config.taxas', 'dona']],
];

describe('botões do web consultam a chave certa', () => {
  for (const [arq, chaves] of esperado) {
    for (const c of chaves) it(`${arq} usa ${c}`, () => expect(ler(arq)).toContain(`pode('${c}')`));
  }
  it('agenda não decide mais pelo papel', () => {
    const src = ler('agenda/page.tsx');
    expect(src).not.toMatch(/meuRole === 'owner' \|\| meuRole === 'gestor'/);
    expect(src).not.toMatch(/membro\.role === 'owner' \|\| membro\.role === 'gestor'/);
    expect(src).not.toMatch(/meuRole/);
  });
  it('financeiro e configurações não consultam mais o dono pelo banco', () => {
    expect(ler('financeiro/page.tsx')).not.toMatch(/setIsOwner/);
    expect(ler('configuracoes/page.tsx')).not.toMatch(/setIsOwner|setPodeEditarTaxa/);
  });
});
