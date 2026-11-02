import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  MODOS_TEMA, CHAVE_TEMA_APP, lerModoTema, resolverEsquemaTema,
} from '@shared/tema';
import {
  SEGMENTOS_EMPRESA, MENSAGEM_EMAIL_CONFIRMACAO, validarTrocaEmail, enderecoDoViaCep, dadosDoCnpj,
  caminhoLogoEmpresa, validarArquivoLogo, montarPayloadEmpresa, salvarPreferenciaNotificacao,
} from '@shared/configuracoes-empresa';

// Task 7 da fase "Paridade Configurações, Notificações e Papéis": Configurações completas no app e
// modo escuro. Regras puras de shared + varredura dos fontes do app (lidos como texto).
const raiz = join(__dirname, '..', '..', '..');
const ler = (p: string) => (existsSync(join(raiz, p)) ? readFileSync(join(raiz, p), 'utf8') : '');

describe('tema (shared)', () => {
  it('três modos, com chave própria no AsyncStorage', () => {
    expect(MODOS_TEMA.map(m => m.valor)).toEqual(['claro', 'escuro', 'sistema']);
    expect(MODOS_TEMA.map(m => m.rotulo)).toEqual(['Claro', 'Escuro', 'Sistema']);
    expect(CHAVE_TEMA_APP).toBe('bm_tema');
  });
  it('lerModoTema aceita só os 3 valores; o resto vira "sistema"', () => {
    expect(lerModoTema('claro')).toBe('claro');
    expect(lerModoTema('escuro')).toBe('escuro');
    expect(lerModoTema('sistema')).toBe('sistema');
    expect(lerModoTema(null)).toBe('sistema');
    expect(lerModoTema('dark')).toBe('sistema');
  });
  it('resolverEsquemaTema segue o aparelho só no modo Sistema', () => {
    expect(resolverEsquemaTema('claro', 'dark')).toBe('claro');
    expect(resolverEsquemaTema('escuro', 'light')).toBe('escuro');
    expect(resolverEsquemaTema('sistema', 'dark')).toBe('escuro');
    expect(resolverEsquemaTema('sistema', 'light')).toBe('claro');
    expect(resolverEsquemaTema('sistema', null)).toBe('claro');
    expect(resolverEsquemaTema('sistema', undefined)).toBe('claro');
  });
});

describe('configurações da empresa (shared)', () => {
  it('segmentos iguais ao web', () => {
    expect(SEGMENTOS_EMPRESA).toEqual(['Estúdio', 'Clínica', 'Salão', 'Barbearia', 'Spa', 'Ateliê', 'Outro']);
  });

  it('troca de e-mail: mensagem exata e validação', () => {
    expect(MENSAGEM_EMAIL_CONFIRMACAO).toBe('Enviamos um link de confirmação para o novo e-mail.');
    expect(validarTrocaEmail('x', 'x', 'a@b.com')).toBe('E-mail inválido.');
    expect(validarTrocaEmail('n@b.com', 'm@b.com', 'a@b.com')).toBe('Os e-mails não coincidem.');
    expect(validarTrocaEmail('a@b.com', 'a@b.com', 'a@b.com')).toBe('O novo e-mail deve ser diferente do atual.');
    expect(validarTrocaEmail(' A@B.com ', 'a@b.com', 'a@b.com')).toBe('O novo e-mail deve ser diferente do atual.');
    expect(validarTrocaEmail('n@b.com', 'n@b.com', 'a@b.com')).toBeNull();
  });

  it('ViaCEP preenche rua/bairro/cidade/UF e limpa o número; erro devolve null', () => {
    expect(enderecoDoViaCep({ logradouro: 'Rua A', bairro: 'Centro', localidade: 'Recife', uf: 'PE' }))
      .toEqual({ rua: 'Rua A', bairro: 'Centro', cidade: 'Recife', uf: 'PE', numero: '' });
    expect(enderecoDoViaCep({ erro: true })).toBeNull();
    expect(enderecoDoViaCep(null)).toBeNull();
  });

  it('BrasilAPI: nome e telefone só preenchem vazios; endereço com CEP mascarado', () => {
    const d = dadosDoCnpj({
      nome_fantasia: 'Studio X', razao_social: 'X LTDA', ddd_telefone_1: '8133334444',
      cep: '50000000', logradouro: 'Av B', numero: '10', bairro: 'Boa Vista', municipio: 'Recife', uf: 'PE',
    }, { nome: '', telefone: '' });
    expect(d.nome).toBe('Studio X');
    expect(d.telefone).toBe('(81) 3333-4444');
    expect(d.endereco).toEqual({ cep: '50000-000', rua: 'Av B', numero: '10', bairro: 'Boa Vista', cidade: 'Recife', uf: 'PE' });
    const d2 = dadosDoCnpj({ razao_social: 'X LTDA', ddd_telefone_1: '8133334444' }, { nome: 'Meu', telefone: '(81) 9' });
    expect(d2.nome).toBeUndefined();
    expect(d2.telefone).toBeUndefined();
    expect(d2.endereco).toBeUndefined();
  });

  it('logo: mesmo caminho do web e mesmos limites', () => {
    expect(caminhoLogoEmpresa('e1', 'PNG', 123)).toBe('empresa_e1_123.png');
    expect(validarArquivoLogo('image/png', 1000)).toBeNull();
    expect(validarArquivoLogo('image/gif', 1000)).toBe('Formato inválido. Use JPEG, PNG ou WEBP.');
    expect(validarArquivoLogo('image/jpeg', 3 * 1024 * 1024)).toBe('Arquivo muito grande. Máximo 2 MB.');
  });

  it('payload: dona manda dados + taxas; só config.taxas manda só taxa_*', () => {
    const dados = { nome: 'A' };
    const taxas = { taxa_reserva_ativa: true };
    expect(montarPayloadEmpresa({ ehDona: true, podeTaxas: true, dados, taxas })).toEqual({ nome: 'A', taxa_reserva_ativa: true });
    expect(montarPayloadEmpresa({ ehDona: false, podeTaxas: true, dados, taxas })).toEqual({ taxa_reserva_ativa: true });
    expect(montarPayloadEmpresa({ ehDona: true, podeTaxas: false, dados, taxas })).toEqual({ nome: 'A' });
    expect(montarPayloadEmpresa({ ehDona: false, podeTaxas: false, dados, taxas })).toEqual({});
  });
});

describe('salvarPreferenciaNotificacao (shared)', () => {
  function db(resp: { data: unknown; error: unknown }) {
    const chamadas: unknown[][] = [];
    const b: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ['from', 'update', 'eq', 'select']) b[m] = (...a: unknown[]) => { chamadas.push([m, ...a]); return b; };
    (b as unknown as { then: unknown }).then = (ok: (v: unknown) => unknown) => ok(resp);
    return { db: b as never, chamadas };
  }
  it('grava só a coluna pedida e confere as linhas', async () => {
    const { db: d, chamadas } = db({ data: [{ id: 'u' }], error: null });
    await salvarPreferenciaNotificacao(d, 'u', 'notif_resumo_diario', false);
    expect(chamadas).toContainEqual(['from', 'users']);
    expect(chamadas).toContainEqual(['update', { notif_resumo_diario: false }]);
    expect(chamadas).toContainEqual(['eq', 'id', 'u']);
    expect(chamadas).toContainEqual(['select', 'id']);
  });
  it('0 linhas ou erro lança em português', async () => {
    await expect(salvarPreferenciaNotificacao(db({ data: [], error: null }).db, 'u', 'notif_lembrete_atendimento', true))
      .rejects.toThrow(/preferência/);
    await expect(salvarPreferenciaNotificacao(db({ data: null, error: { message: 'x' } }).db, 'u', 'notif_lembrete_atendimento', true))
      .rejects.toThrow();
  });
});

// ── Varredura do app ──────────────────────────────────────────

describe('app: Configurações da empresa', () => {
  const cfg = ler('mobile/app/(empresa)/configuracoes.tsx');
  it('logo no bucket logos pelo caminho de shared', () => {
    expect(cfg).toContain("storage.from('logos')");
    expect(cfg).toContain('caminhoLogoEmpresa(');
    expect(cfg).toContain('validarArquivoLogo(');
    expect(cfg).toContain("from 'expo-image-picker'");
  });
  it('CNPJ com máscara, validação e BrasilAPI; CEP com ViaCEP', () => {
    for (const s of ['maskCNPJ(', 'validaCNPJ(', 'brasilapi.com.br/api/cnpj/v1/', 'dadosDoCnpj(', 'maskCEP(', 'viacep.com.br/ws/', 'enderecoDoViaCep(', 'maskPhone(']) {
      expect(cfg, s).toContain(s);
    }
  });
  it('endereço em campos por shared/endereco (nunca o JSON cru num campo só)', () => {
    expect(cfg).toContain('lerEnderecoEmpresa(');
    expect(cfg).toContain('serializarEnderecoEmpresa(');
    expect(cfg).not.toContain("useState(empresaAtiva?.endereco ?? '')");
    expect(cfg).not.toMatch(/endereco:\s*endereco\.trim\(\)/);
    for (const r of ["'Rua'", "'Número'", "'Complemento'", "'Bairro'", "'Cidade'", "'UF'", "'CEP'"]) expect(cfg, r).toContain(r);
  });
  it('segmento e meta mensal', () => {
    expect(cfg).toContain('SEGMENTOS_EMPRESA');
    expect(cfg).toContain('meta_mensal');
    expect(cfg).toContain('segmento');
  });
  it('dados da empresa só a dona; taxas por config.taxas, payload por shared', () => {
    expect(cfg).toContain("pode('dona')");
    expect(cfg).toContain("pode('config.taxas')");
    expect(cfg).toContain('montarPayloadEmpresa(');
    expect(cfg).toMatch(/\{ehDona && \(/);
  });
});

describe('app: perfil, e-mail, senha e notificações (empresa e profissional)', () => {
  for (const p of ['mobile/app/(empresa)/configuracoes.tsx', 'mobile/app/(profissional)/configuracoes.tsx']) {
    const s = ler(p);
    it(`${p}: trocar e-mail (componente único)`, () => {
      expect(s).toContain('<TrocarEmail');
    });
    it(`${p}: card "Notificações no celular" com Ativar e status`, () => {
      expect(s).toContain('<CardNotificacoesCelular');
    });
    it(`${p}: preferências fora do Salvar (o card grava na hora)`, () => {
      const i = s.indexOf('async function salvar(');
      expect(i).toBeGreaterThan(-1);
      const corpo = s.slice(i, s.indexOf('\n  }', i));
      expect(corpo).not.toContain('notif_resumo_diario');
      expect(corpo).not.toContain('notif_lembrete_atendimento');
    });
    it(`${p}: modo escuro com Claro/Escuro/Sistema`, () => {
      expect(s).toContain('<SeletorModoTema');
    });
  }
  it('trocar e-mail: updateUser({ email }) com a validação e a mensagem de shared', () => {
    const c = ler('mobile/components/configuracoes/TrocarEmail.tsx');
    for (const f of ['updateUser({ email', 'MENSAGEM_EMAIL_CONFIRMACAO', 'validarTrocaEmail(']) expect(c, f).toContain(f);
  });
  it('card de notificações usa ativarNotificacoes, status da permissão, erro de registro e grava as preferências na hora', () => {
    const c = ler('mobile/components/configuracoes/CardNotificacoesCelular.tsx');
    for (const f of ['ativarNotificacoes(', 'statusPermissaoNotificacoes(', 'erroRegistroPush(', 'Ativar notificações', 'Tentar de novo', 'Linking.openSettings(', 'salvarPreferenciaNotificacao(supabase']) {
      expect(c, f).toContain(f);
    }
  });
  it('seletor de empresa saiu do Início da profissional e foi para os Ajustes dela', () => {
    expect(ler('mobile/app/(profissional)/inicio.tsx')).not.toContain('<SeletorEmpresa');
    expect(ler('mobile/app/(profissional)/configuracoes.tsx')).toContain('<SeletorEmpresa');
  });
});

describe('app: criar empresa grava o endereço pelo formato de shared', () => {
  it('serializarEnderecoEmpresa', () => {
    const s = ler('mobile/app/criar-empresa.tsx');
    expect(s).toContain('serializarEnderecoEmpresa(');
  });
});

describe('app: modo escuro', () => {
  const tema = ler('mobile/lib/tema.tsx');
  it('provider com preferência em AsyncStorage e paletas clara e escura com as mesmas chaves', () => {
    for (const f of ['CHAVE_TEMA_APP', 'AsyncStorage.getItem(', 'AsyncStorage.setItem(', 'useColorScheme(', 'resolverEsquemaTema(', 'PALETA_CLARA', 'PALETA_ESCURA', 'export function useTema(', 'export function TemaProvider(', 'export function comTemaDoUsuario<', 'export function TemaClaroFixo(']) {
      expect(tema, f).toContain(f);
    }
  });
  it('a raiz usa o provider; app.json segue o aparelho', () => {
    expect(ler('mobile/app/_layout.tsx')).toContain('<TemaProvider>');
    expect(JSON.parse(ler('mobile/app.json')).expo.userInterfaceStyle).toBe('automatic');
  });
  const MIGRADAS = [
    'mobile/app/(empresa)/dashboard.tsx', 'mobile/app/(empresa)/agenda.tsx', 'mobile/app/(empresa)/nova-comanda.tsx',
    'mobile/app/(empresa)/clientes.tsx', 'mobile/app/(empresa)/configuracoes.tsx', 'mobile/app/(empresa)/mais.tsx',
    'mobile/app/(profissional)/inicio.tsx', 'mobile/app/(profissional)/agenda.tsx', 'mobile/app/(profissional)/comissoes.tsx',
    'mobile/app/(profissional)/configuracoes.tsx',
  ];
  it.each(MIGRADAS)('%s usa o tema do usuário e não tem paleta própria', (p) => {
    const s = ler(p);
    expect(s).toContain('comTemaDoUsuario(');
    expect(s).toContain('useTema()');
    expect(s).not.toMatch(/^const C = \{/m);
  });
  it('abas das duas áreas seguem o tema', () => {
    for (const p of ['mobile/app/(empresa)/_layout.tsx', 'mobile/app/(profissional)/_layout.tsx']) {
      expect(ler(p), p).toContain('usePreferenciaTema()');
    }
  });
  it('componentes das telas migradas (agenda, seletor de empresa) também seguem o tema', () => {
    for (const p of ['mobile/components/agenda/FaixaSemana.tsx', 'mobile/components/agenda/VisaoMes.tsx', 'mobile/components/agenda/AlternarVisao.tsx', 'mobile/components/agenda/TimelineColunas.tsx', 'mobile/components/SeletorEmpresa.tsx']) {
      const s = ler(p);
      expect(s, p).toContain('useTema()');
      expect(s, p).not.toMatch(/^const C = \{/m);
    }
  });
  it('telas não migradas continuam com a paleta clara fixa (padrão do contexto é claro)', () => {
    expect(tema).toMatch(/createContext<EsquemaTema>\('claro'\)/);
    expect(ler('mobile/app/(empresa)/estoque.tsx')).toMatch(/^const C = \{/m);
  });
});
