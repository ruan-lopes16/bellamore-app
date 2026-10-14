// web/tests/unit/equipe-telas.test.ts
// Trava a tela Equipe do web (Task 3 da paridade de equipe): usa as funções de shared, manda empresaId
// e só os campos alterados no PATCH, e mostra os erros da API. A Task 4 acrescenta o bloco do app.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

describe('web', () => {
  const src = ler('web/app/(app)/equipe/page.tsx');

  it('carrega e grava pelas funções de shared', () => {
    expect(src).toContain('carregarEquipe(');
    expect(src).toContain('chaveMesBRT(new Date())');
    expect(src).toContain('alterarAtivo(');
    expect(src).toContain('alterarPapel(');
    expect(src).toContain('rotuloContrato');
    expect(src).toContain('MembroEquipe');
    expect(src).not.toContain(".from('empresa_membros').update(");
    expect(src).not.toMatch(/\balert\(/);
  });

  it('erro de carga vira banner com "Tentar de novo" e há contador de requisição', () => {
    expect(src).toContain('Tentar de novo');
    expect(src).toMatch(/reqRef/);
  });

  it('NovoProfModal manda tipo_contrato e comissão nos dois caminhos', () => {
    const ini = src.indexOf('function NovoProfModal(');
    const fim = src.indexOf('function camposAlterados(');
    const novo = src.slice(ini, fim);
    expect(novo).toContain('percentual_comissao');
    expect(novo).toContain('Tipo de contrato');
    // um único fetch com o mesmo corpo para convite e senha
    expect(novo.match(/tipo_contrato:/g)?.length).toBe(1);
    expect(novo).toContain("usarConvite ? '/api/convites' : '/api/profissionais'");
  });

  it('PATCH manda empresaId e só o que mudou', () => {
    const ini = src.indexOf('function camposAlterados(');
    const fim = src.indexOf('function ProfCard(');
    const edit = src.slice(ini, fim);
    expect(edit).toContain('empresaId');
    expect(edit).toContain("method:  'PATCH'");
    expect(edit).toContain('camposAlterados(prof, empresaId');
    expect(edit).toContain('Trocar o e-mail troca também o login dela no app.');
    // e-mail, comissão e contrato só entram no corpo se mudaram
    expect(edit).toMatch(/if \(v\.emailNovo !== v\.emailAntigo\)/);
    expect(edit).toMatch(/if \(normalizarComissao\(v\.comissao\.trim\(\)\) !== prof\.percentual_comissao\)/);
    expect(edit).not.toContain('parseFloat');
    expect(edit).toMatch(/if \(\(v\.tipoContrato \|\| null\) !== prof\.tipo_contrato\)/);
    expect(edit).not.toMatch(/email:\s+email\.trim\(\) \|\| null/);
  });
});

describe('app', () => {
  const equipe = ler('mobile/app/(empresa)/equipe.tsx');
  // Arquivo novo: lido com fallback para o teste falhar por asserção, não derrubar o arquivo inteiro.
  const editar = (() => { try { return ler('mobile/app/(empresa)/editar-profissional/[id].tsx'); } catch { return ''; } })();
  const convite = ler('mobile/app/(empresa)/convidar-profissional.tsx');
  const layout = ler('mobile/app/(empresa)/_layout.tsx');

  it('editar-profissional/[id] faz PATCH com Bearer e empresaId, só com o que mudou', () => {
    expect(editar).toContain("method: 'PATCH'");
    expect(editar).toContain('Authorization');
    expect(editar).toContain('Bearer ${session.access_token}');
    expect(editar).toContain('empresaId');
    expect(editar).toContain('camposAlterados(');
    expect(editar).toMatch(/if \(v\.emailNovo !== v\.emailAntigo\)/);
    expect(editar).toMatch(/normalizarComissao\(v\.comissao\.trim\(\)\) !== membro\.percentual_comissao/);
    expect(editar).toMatch(/\(v\.tipoContrato \|\| null\) !== membro\.tipo_contrato/);
    expect(editar).not.toContain('parseFloat');
    expect(editar).toContain('Trocar o e-mail troca também o login dela no app.');
    expect(editar).toContain('res.status === 409');
    expect(editar).toContain('maskPhone');
    expect(editar).toContain("pode('equipe.gerenciar')");
    expect(editar).toContain("queryKey: ['equipe']");
    expect(editar).toContain("queryKey: ['profissionais']");
    expect(editar).toMatch(/salvandoRef/);
  });

  it('a rota nova está registrada no layout', () => {
    expect(layout).toContain("'editar-profissional/[id]'");
  });

  it('equipe.tsx usa as funções de shared, paga do mês e mostra meses anteriores', () => {
    expect(equipe).toContain('carregarEquipe(');
    expect(equipe).toContain("queryKey: ['equipe', empresaId, mes]");
    expect(equipe).toContain('pagarComissoes(');
    expect(equipe).toContain('MENSAGEM_PAGAMENTO_PARCIAL');
    expect(equipe).toContain("pode('comissoes.pagar')");
    expect(equipe).toContain('alterarAtivo(');
    expect(equipe).toContain('alterarPapel(');
    expect(equipe).toContain('meses anteriores');
    expect(equipe).toContain('Tentar de novo');
    expect(equipe).toContain('rotuloContrato');
    expect(equipe).toContain('invalidarFinanceiro(qc)');
    expect(equipe).toContain('podeAtribuirRole');
    expect(equipe).toContain("pode('equipe.gerenciar')");
    // sem gravação direta da comissão: o modal (se existir) vai pela API
    expect(equipe).not.toContain('percentual_comissao: pct');
    expect(equipe).not.toMatch(/toLocaleString|Intl\./);
  });

  it('convite manda comissão e contrato só quando preenchidos', () => {
    expect(convite).toContain('tipo_contrato');
    expect(convite).toContain('percentual_comissao');
    expect(convite).toContain("comissao.trim() !== '' ? comissao.trim() : undefined");
    expect(convite).toContain('tipoContrato || undefined');
  });

  it('revisão: Equipe atualiza com o financeiro, espera permissões e a edição mostra o erro no topo', () => {
    expect(ler('shared/invalidacao-financeira.ts')).toContain("'equipe',");
    expect(equipe).toContain('staleTime: 0');
    expect(equipe).toContain('!permissoesCarregadas || !empresaAtiva || isLoading');
    expect(equipe).toMatch(/pagandoRef/);
    expect(equipe).toContain('rotuloMesAno(mesChave)');
    expect(equipe).not.toContain("format(new Date(), 'yyyy-MM')");
    expect(editar).toContain('scrollRef.current?.scrollTo({ y: 0');
    expect(editar).toContain('Sessão expirada. Entre de novo.');
    expect(editar).toContain('App sem URL da API configurada.');
    expect(editar).toContain("queryKey: ['equipe-membro']");
    const web = ler('web/app/(app)/equipe/page.tsx');
    expect(web).toContain('definicaoEquipe(mesChave)');
    expect(web).toContain('rotuloMesAno(mesChave)');
  });

  it('nenhum update direto em empresa_membros no app', () => {
    const arquivos = (readdirSync(join(root, 'mobile/app'), { recursive: true }) as string[])
      .filter(f => /\.tsx?$/.test(f)).map(f => join('mobile/app', f));
    expect(arquivos.length).toBeGreaterThan(20);
    for (const f of arquivos) {
      expect(ler(f).replace(/\s+/g, ''), f).not.toContain(".from('empresa_membros').update(");
    }
  });
});
