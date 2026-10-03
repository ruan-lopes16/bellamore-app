// web/tests/unit/permissoes-revisao-final.test.ts
// Trava as correções da revisão final da branch feat/permissoes-configuraveis (I1–I5, M3):
// o botão some/trava exatamente quando o banco recusaria, nas duas plataformas.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { podeConcederChave, podeGerenciarMembro } from '@shared/permissoes';
import { podeMexerNoAgendamento } from '@shared/agendamentos';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('podeConcederChave — gestora não concede o que não tem (I3)', () => {
  it('dona concede qualquer chave', () => {
    expect(podeConcederChave({ isOwner: true }, [], 'financeiro.ver')).toBe(true);
  });
  it('gestora só concede chaves que ela mesma tem', () => {
    const g = { isOwner: false };
    expect(podeConcederChave(g, ['agenda.excluir'], 'agenda.excluir')).toBe(true);
    expect(podeConcederChave(g, ['agenda.excluir'], 'financeiro.ver')).toBe(false);
    expect(podeConcederChave(g, [], 'clientes.excluir')).toBe(false);
  });
});

describe('podeGerenciarMembro — equipe.gerenciar só sobre profissionais (I5)', () => {
  const dona = { isOwner: true, userId: 'd' };
  const gestora = { isOwner: false, userId: 'g' };
  it('dona gerencia qualquer vínculo', () => {
    expect(podeGerenciarMembro(dona, true, { role: 'gestor', userId: 'g' })).toBe(true);
    expect(podeGerenciarMembro(dona, false, { role: 'profissional', userId: 'p' })).toBe(true);
  });
  it('sem equipe.gerenciar ninguém além da dona gerencia', () => {
    expect(podeGerenciarMembro(gestora, false, { role: 'profissional', userId: 'p' })).toBe(false);
  });
  it('com a chave: só profissionais que não sejam a própria pessoa', () => {
    expect(podeGerenciarMembro(gestora, true, { role: 'profissional', userId: 'p' })).toBe(true);
    expect(podeGerenciarMembro(gestora, true, { role: 'owner', userId: 'd' })).toBe(false);
    expect(podeGerenciarMembro(gestora, true, { role: 'gestor', userId: 'g2' })).toBe(false);
    expect(podeGerenciarMembro(gestora, true, { role: 'profissional', userId: 'g' })).toBe(false);
  });
});

describe('podeMexerNoAgendamento — espelha a policy "agendamentos: equipe atualiza" (I1)', () => {
  it('a própria agenda é sempre liberada', () => {
    expect(podeMexerNoAgendamento('eu', 'eu', false)).toBe(true);
  });
  it('agenda de outra profissional exige agenda.gerenciar_outras', () => {
    expect(podeMexerNoAgendamento('outra', 'eu', false)).toBe(false);
    expect(podeMexerNoAgendamento('outra', 'eu', true)).toBe(true);
  });
  it('sem profissional definido: só com a chave', () => {
    expect(podeMexerNoAgendamento(null, 'eu', false)).toBe(false);
    expect(podeMexerNoAgendamento(undefined, 'eu', true)).toBe(true);
  });
  it('meuUserId ainda vazio nunca libera por igualdade', () => {
    expect(podeMexerNoAgendamento('', '', false)).toBe(false);
  });
});

describe('I1 — agenda e comanda escondem ações em atendimento de outra profissional', () => {
  const agenda = ler('web/app/(app)/agenda/page.tsx');
  it('web agenda usa podeMexerNoAgendamento e avisa ao clicar na coluna de outra', () => {
    expect(agenda).toContain('podeMexerNoAgendamento(');
    expect(agenda).toContain('somenteLeitura');
    expect(agenda).toMatch(/Você só pode agendar na sua própria agenda/);
  });
  it('web mudarStatus confere linhas afetadas e reverte', () => {
    const corpo = agenda.slice(agenda.indexOf('async function mudarStatus'), agenda.indexOf('async function deletarBloqueio'));
    expect(corpo).toMatch(/\.update\(\{ status \}\)[\s\S]*\.select\('id'\)/);
    expect(corpo).toMatch(/rows\.length === 0/);
    expect(corpo).toContain("mensagemErroBanco(");
  });
  it('web modal de edição só mexe em agendamento_servicos depois do UPDATE devolver linha', () => {
    const corpo = agenda.slice(agenda.indexOf('if (agEditar) {', agenda.indexOf('async function executarSalvar')));
    const iUpdate = corpo.indexOf(".select('id')");
    const iDelete = corpo.indexOf("from('agendamento_servicos').delete()");
    expect(iUpdate).toBeGreaterThan(-1);
    expect(iDelete).toBeGreaterThan(iUpdate);
    expect(corpo.slice(0, iDelete)).toMatch(/atualizados\.length === 0/);
  });
  it('web comanda trava o card de atendimento de outra profissional', () => {
    const src = ler('web/app/(app)/comanda/page.tsx');
    expect(src).toContain('podeMexerNoAgendamento(');
    expect(src).toContain("pode('agenda.gerenciar_outras')");
  });
  it('app: detalhe do agendamento esconde status e confere linhas afetadas', () => {
    const src = ler('mobile/app/(empresa)/agendamento/[id].tsx');
    expect(src).toContain('podeMexerNoAgendamento(');
    expect(src).toContain("pode('agenda.gerenciar_outras')");
    const corpo = src.slice(src.indexOf('async function atualizarStatus'), src.indexOf('function confirmarCancelamento'));
    expect(corpo).toContain(".select('id')");
    expect(corpo).toMatch(/length === 0/);
  });
  it('app: comanda trava o card de atendimento de outra profissional', () => {
    const src = ler('mobile/app/(empresa)/nova-comanda.tsx');
    expect(src).toContain('podeMexerNoAgendamento(');
    expect(src).toContain("pode('agenda.gerenciar_outras')");
  });
});

describe('I2 — salvar empresa / estoque não fingem sucesso', () => {
  it('web Configurações: não-dona manda só taxa_* e confere linhas afetadas', () => {
    const src = ler('web/app/(app)/configuracoes/page.tsx');
    const corpo = src.slice(src.indexOf('async function salvarEmpresa'), src.indexOf('async function salvarPerfil'));
    expect(corpo).toMatch(/isOwner \? \{/);
    expect(corpo).toContain(".select('id')");
    expect(corpo).toMatch(/length === 0/);
  });
  it('app Configurações confere linhas afetadas do UPDATE de empresas', () => {
    const src = ler('mobile/app/(empresa)/configuracoes.tsx');
    expect(src).toMatch(/from\('empresas'\)\.update\(payloadEmpresa\)\.eq\('id', empresaAtiva\.id\)\.select\('id'\)/);
  });
  it('web Estoque: excluir/desativar produto confere linhas afetadas', () => {
    const src = ler('web/app/(app)/estoque/page.tsx');
    const corpo = src.slice(src.indexOf('async function excluir()'));
    expect(corpo.slice(0, 1500)).toMatch(/update\(\{ ativo: false \}\)[\s\S]*\.select\('id'\)/);
  });
  it('catálogo explica que os números de toda a equipe pedem outras chaves', () => {
    const src = ler('shared/permissoes.ts');
    const linha = src.split('\n').find(l => l.includes("chave: 'financeiro.ver'"))!;
    expect(linha).toMatch(/Ver agenda de toda a equipe/);
    expect(linha).toMatch(/Ver comissões de todas/);
  });
});

describe('I3 — painéis só deixam conceder o que a gestora tem', () => {
  for (const arq of ['web/components/permissoes/PermissoesPanel.tsx', 'mobile/components/PermissoesPanel.tsx']) {
    it(arq, () => expect(ler(arq)).toContain('podeConcederChave('));
  }
});

describe('I4 — Pagar dos Relatórios do web consulta comissoes.pagar', () => {
  it('botão e função', () => {
    const src = ler('web/app/(app)/relatorios/page.tsx');
    expect(src).toContain("pode('comissoes.pagar')");
    const corpo = src.slice(src.indexOf('async function marcarComoPago'));
    expect(corpo.slice(0, 400)).toMatch(/podePagarComissoes/);
  });
});

describe('I5 — equipe.gerenciar não alcança dona, gestoras nem o próprio vínculo', () => {
  it('web Equipe, app Equipe e API usam podeGerenciarMembro', () => {
    expect(ler('web/app/(app)/equipe/page.tsx')).toContain('podeGerenciarMembro(');
    expect(ler('mobile/app/(empresa)/equipe.tsx')).toContain('podeGerenciarMembro(');
    expect(ler('web/app/api/profissionais/route.ts')).toContain('podeGerenciarMembro(');
  });
  it('API confere que membroId é do mesmo usuário', () => {
    expect(ler('web/app/api/profissionais/route.ts')).toMatch(/\.eq\('id', membroId\)\s*\.eq\('user_id', userId\)/);
  });
  it('catálogo diz que equipe.gerenciar inclui alterar a comissão', () => {
    const linha = ler('shared/permissoes.ts').split('\n').find(l => l.includes("chave: 'equipe.gerenciar'"))!;
    expect(linha).toMatch(/comissão/);
  });
});

describe('M3 — selo de exceções no web só para dona/gestora (igual ao app)', () => {
  it('web Equipe usa veSeloExcecoes', () => {
    const src = ler('web/app/(app)/equipe/page.tsx');
    expect(src).toMatch(/const veSeloExcecoes = isOwner \|\| papel === 'gestor'/);
    expect(src).toContain('veSeloExcecoes ?');
  });
});
