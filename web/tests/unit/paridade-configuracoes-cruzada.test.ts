import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { SENHA_MINIMA } from '@shared/senha';
import { MENSAGEM_EMAIL_CONFIRMACAO } from '@shared/configuracoes-empresa';
import { TEXTOS_NOTIFICACOES } from '@shared/notificacoes';

// Task 8 da fase "Paridade Configurações, Notificações e Papéis": varredura cruzada web × app.
// Configurações e Notificações têm de usar as mesmas regras e os mesmos textos nas duas plataformas.
const raiz = join(__dirname, '..', '..', '..');
const ler = (p: string) => {
  const f = join(raiz, p);
  if (!existsSync(f)) throw new Error(`arquivo não encontrado: ${p}`);
  return readFileSync(f, 'utf8');
};

/** Todos os .ts/.tsx de uma pasta (sem node_modules). */
function fontes(dir: string): string[] {
  const out: string[] = [];
  const abs = join(raiz, dir);
  if (!existsSync(abs)) return out;
  for (const nome of readdirSync(abs)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const p = join(abs, nome);
    if (statSync(p).isDirectory()) out.push(...fontes(relative(raiz, p)));
    else if (/\.(ts|tsx)$/.test(nome) && !/\.d\.ts$/.test(nome)) out.push(relative(raiz, p).replace(/\\/g, '/'));
  }
  return out;
}

const WEB_CONFIG = 'web/app/(app)/configuracoes/page.tsx';
const APP_CONFIG_EMPRESA = 'mobile/app/(empresa)/configuracoes.tsx';
const APP_CONFIG_PROF = 'mobile/app/(profissional)/configuracoes.tsx';
const APP_CARD_NOTIF = 'mobile/components/configuracoes/CardNotificacoesCelular.tsx';
const APP_TROCAR_EMAIL = 'mobile/components/configuracoes/TrocarEmail.tsx';
const WEB_NOTIF = 'web/app/(app)/notificacoes/page.tsx';
const APP_NOTIF = 'mobile/components/TelaNotificacoes.tsx';
const APP_NOTIF_HOOK = 'mobile/hooks/useNotificacoes.ts';

const web = ler(WEB_CONFIG);
// O app divide a tela em componentes; o conjunto (empresa + componentes) é o que a pessoa vê.
const app = [APP_CONFIG_EMPRESA, APP_CARD_NOTIF, APP_TROCAR_EMAIL].map(ler).join('\n');

describe('Configurações: textos exatos nas duas plataformas', () => {
  const TEXTOS = [
    'Resumo do dia',
    '1x por dia, às 07:00',
    'Lembrete de atendimento',
    '30 min antes de cada atendimento',
    'Minha agenda abre em',
    'Minha agenda',
    'Todas as profissionais',
    'Ativar notificações',
    'CNPJ inválido. Verifique os dígitos.',
    'Nova senha',
    'Confirmar nova senha',
    'A nova senha deve ser diferente da atual.',
    'Taxa de cancelamento',
    'Taxa de reserva',
  ];
  for (const t of TEXTOS) {
    it(`"${t}"`, () => {
      expect(web).toContain(t);
      expect(app).toContain(t);
    });
  }

  it('aviso da troca de e-mail: a constante de shared, com o texto da spec, nas duas', () => {
    expect(MENSAGEM_EMAIL_CONFIRMACAO).toBe('Enviamos um link de confirmação para o novo e-mail.');
    expect(web).toContain('{MENSAGEM_EMAIL_CONFIRMACAO}');
    expect(ler(APP_TROCAR_EMAIL)).toContain('texto: MENSAGEM_EMAIL_CONFIRMACAO');
    // ninguém reescreve o texto à mão (que acabaria divergindo)
    expect(web).not.toContain('Link enviado para');
    expect(web).not.toContain("'Enviamos um link de confirmação para o novo e-mail.'");
    expect(app).not.toContain("'Enviamos um link de confirmação para o novo e-mail.'");
  });

  it('a profissional também tem e-mail, notificações e confirmação de senha', () => {
    const prof = ler(APP_CONFIG_PROF);
    for (const t of ['<TrocarEmail />', '<CardNotificacoesCelular />', 'label="Nova senha"', 'label="Confirmar nova senha"']) {
      expect(prof).toContain(t);
    }
  });
});

describe('Configurações: as duas plataformas usam as funções de shared', () => {
  const COMUNS = [
    'SEGMENTOS_EMPRESA',
    'enderecoDoViaCep(',
    'dadosDoCnpj(',
    'caminhoLogoEmpresa(',
    'validarArquivoLogo(',
    'montarPayloadEmpresa(',
    'salvarPreferenciaNotificacao(',
    'salvarPreferenciaAgenda(',
    'lerEnderecoEmpresa(',
    'serializarEnderecoEmpresa(',
    'validaCNPJ(',
    'maskMoeda',
    'parseMoeda(',
  ];
  for (const f of COMUNS) {
    it(f, () => {
      expect(web).toContain(f);
      expect(app).toContain(f);
    });
  }
  it('validarTrocaEmail: web na página, app no componente de troca de e-mail', () => {
    expect(web).toContain('validarTrocaEmail(');
    expect(ler(APP_TROCAR_EMAIL)).toContain('validarTrocaEmail(');
  });
  it('máscaras de telefone e CNPJ de shared (sem cópia local)', () => {
    expect(web).toMatch(/import \{[^}]*maskPhone[^}]*\} from '@\/lib\/masks';/);
    expect(web).toMatch(/import \{[^}]*maskCNPJ[^}]*\} from '@\/lib\/masks';/);
    expect(ler('web/lib/masks.ts')).toContain("from '@shared/mascaras'");
    expect(ler(APP_CONFIG_EMPRESA)).toMatch(/import \{[^}]*maskCNPJ[^}]*maskPhone[^}]*\} from '@shared\/mascaras';/);
    for (const src of [web, app]) {
      expect(src).not.toMatch(/function mask(Phone|Cnpj|CNPJ)\(/);
    }
  });
  it('sem lista de segmentos própria nem regex de e-mail própria', () => {
    for (const src of [web, app]) {
      expect(src).not.toContain("'Estúdio', 'Clínica'");
      expect(src).not.toMatch(/emailRegex|\[\^\\s@\]\+@/);
    }
  });
  it('preferência de notificação nunca é gravada por um update solto (sem conferir as linhas)', () => {
    for (const src of [web, app]) {
      expect(src).not.toMatch(/update\(\{\s*\[campo\]: valor\s*\}\)/);
    }
  });
});

describe('web: nenhuma consulta de empresa com .limit(1)', () => {
  it('o .limit(1) nunca escolhe empresa nem vínculo (a empresa vem da empresa ativa)', () => {
    const arquivos = [...fontes('web/app'), ...fontes('web/components'), ...fontes('web/lib')];
    expect(arquivos.length).toBeGreaterThan(50);
    const ofensores: string[] = [];
    for (const p of arquivos) {
      const src = ler(p);
      let i = src.indexOf('.limit(1)');
      while (i >= 0) {
        const antes = src.slice(Math.max(0, i - 600), i);
        const froms = [...antes.matchAll(/from\(\s*['"]([a-z_]+)['"]\s*\)/g)];
        const tabela = froms.length ? froms[froms.length - 1][1] : '';
        if (tabela === 'empresa_membros' || tabela === 'empresas') ofensores.push(`${p}: ${tabela}`);
        i = src.indexOf('.limit(1)', i + 1);
      }
    }
    expect(ofensores).toEqual([]);
  });
});

describe('app: nenhum pedido automático de permissão de push', () => {
  const arquivos = ['mobile/app', 'mobile/components', 'mobile/hooks', 'mobile/stores', 'mobile/lib'].flatMap(fontes);

  it('requestPermissionsAsync só existe em lib/notifications e só quando pedirPermissao', () => {
    expect(arquivos.length).toBeGreaterThan(30);
    const comPedido = arquivos.filter(p => ler(p).includes('requestPermissionsAsync'));
    expect(comPedido).toEqual(['mobile/lib/notifications.ts']);
    const lib = ler('mobile/lib/notifications.ts');
    expect(lib.match(/requestPermissionsAsync/g)).toHaveLength(1);
    expect(lib).toMatch(/if \(statusAtual !== 'granted' && opts\.pedirPermissao\) \{\s*const \{ status \} = await Notifications\.requestPermissionsAsync\(\);/);
  });

  it('pedirPermissao: true só dentro de ativarNotificacoes', () => {
    const lib = ler('mobile/lib/notifications.ts');
    expect(lib.match(/pedirPermissao: true/g)).toHaveLength(1);
    expect(lib).toMatch(/export async function ativarNotificacoes\([^)]*\)[^{]*\{\s*return sincronizarPushDispositivo\(\{ userId, empresaId, pedirPermissao: true \}\);/);
    for (const p of arquivos.filter(a => a !== 'mobile/lib/notifications.ts')) {
      expect(ler(p), p).not.toContain('pedirPermissao: true');
    }
  });

  it('ativarNotificacoes só é chamado pelo botão do card de Configurações', () => {
    const chamadores = arquivos.filter(p => p !== 'mobile/lib/notifications.ts' && /ativarNotificacoes\(/.test(ler(p)));
    expect(chamadores).toEqual([APP_CARD_NOTIF]);
    expect(ler(APP_CARD_NOTIF)).toContain("botao('Ativar notificações', () => void ativar())");
  });
});

describe('Notificações: mesmas seções e regras nas duas plataformas', () => {
  const webN = ler(WEB_NOTIF);
  const appN = ler(APP_NOTIF);
  const appHook = ler(APP_NOTIF_HOOK);

  it('textos da tela vêm de TEXTOS_NOTIFICACOES nas duas', () => {
    expect(TEXTOS_NOTIFICACOES.secaoAlertas).toBe('Alertas');
    expect(TEXTOS_NOTIFICACOES.secaoAvisos).toBe('Avisos');
    expect(TEXTOS_NOTIFICACOES.filtroNaoLidas).toBe('Não lidas');
    for (const src of [webN, appN]) {
      expect(src).toContain('TEXTOS_NOTIFICACOES as T');
      for (const chave of ['T.secaoAlertas', 'T.secaoAvisos', 'T.filtroTodas', 'T.filtroNaoLidas', 'T.marcarTodas']) {
        expect(src).toContain(chave);
      }
    }
  });

  it('as seções aparecem na mesma ordem: Alertas antes de Avisos', () => {
    for (const src of [webN, appN]) {
      expect(src.indexOf('T.secaoAlertas')).toBeLessThan(src.indexOf('T.secaoAvisos'));
    }
  });

  it('mesmas funções de shared (o app pelo hook)', () => {
    for (const f of ['alertasCalculados(', 'carregarDadosAlertas(', 'carregarAvisos(', 'contarAvisosNaoLidos(', 'marcarLidas(', 'marcarTodasLidas(']) {
      expect(webN).toContain(f);
      expect(appHook).toContain(f);
    }
    for (const f of ['rotaDoAviso(', 'rotaDoDestino(', 'separarAlertas', 'resumoAgendamentosHoje', 'TIPOS_NOTIFICACAO', 'VISUAL_ALERTA', 'rotuloDataHoraBRT(']) {
      expect(webN).toContain(f);
      expect(appN).toContain(f);
    }
  });

  it('as duas áreas do app usam a mesma tela', () => {
    expect(ler('mobile/app/(empresa)/notificacoes.tsx')).toContain('<TelaNotificacoes area="empresa" />');
    expect(ler('mobile/app/(profissional)/notificacoes.tsx')).toContain('<TelaNotificacoes area="profissional" />');
  });

  it('o sino sai da mesma regra de shared (badgesDoMenu, travada igual a contagemSino) nas duas plataformas', () => {
    expect(ler('web/lib/sino.ts')).toContain("export { badgesDoMenu, type BadgesMenu } from '@shared/notificacoes';");
    expect(ler('web/components/Sidebar.tsx')).toContain('badgesDoMenu(contagens, permissoes, naoLidas)');
    expect(appHook).toContain('return badgesDoMenu(');
    expect(appHook).toContain('carregarContagensSino');
    expect(ler('mobile/app/(empresa)/dashboard.tsx')).toContain('useSino()');
    expect(ler('mobile/app/(profissional)/inicio.tsx')).toContain('useSino()');
  });

  it('nenhuma tela lê a tabela notificacoes direto (só pelas consultas de shared)', () => {
    expect(webN).not.toContain("from('notificacoes')");
    expect(appN).not.toContain("from('notificacoes')");
    expect(appHook).not.toContain("from('notificacoes')");
  });
});

describe('senha mínima vinda de shared', () => {
  it('mínimo único de 8', () => {
    expect(SENHA_MINIMA).toBe(8);
    expect(ler('web/lib/senha.ts')).toContain("from '@shared/senha'");
  });

  for (const p of [WEB_CONFIG, 'web/app/convite/aceitar/page.tsx', 'web/app/redefinir-senha/page.tsx']) {
    it(`${p}: validarNovaSenha e SENHA_MINIMA, sem número fixo`, () => {
      const src = ler(p);
      expect(src).toContain('validarNovaSenha(');
      expect(src).toContain('SENHA_MINIMA');
      expect(src).not.toMatch(/length\s*<\s*\d/);
      expect(src).not.toMatch(/(mínimo|pelo menos) \d+ caracteres/);
      expect(src).not.toMatch(/minLength=\{\d/);
    });
  }

  for (const p of [APP_CONFIG_EMPRESA, APP_CONFIG_PROF]) {
    it(`${p}: regra de shared (com confirmação), sem número fixo`, () => {
      const src = ler(p);
      expect(src).toMatch(/import \{ validarSenhaOpcionalComConfirmacao \} from '@shared\/senha';/);
      expect(src).toContain('validarSenhaOpcionalComConfirmacao(novaSenha, confirmaSenha)');
      expect(src).not.toMatch(/length\s*<\s*\d/);
      expect(src).not.toMatch(/(mínimo|pelo menos) \d+ caracteres/);
    });
  }
});

describe('endereço da empresa vindo de shared', () => {
  it('Configurações: lê e grava pelas duas funções nas duas plataformas, sem parse próprio', () => {
    for (const src of [web, ler(APP_CONFIG_EMPRESA)]) {
      expect(src).toMatch(/import \{[^}]*lerEnderecoEmpresa[^}]*serializarEnderecoEmpresa[^}]*\} from '@shared\/endereco';/);
      expect(src).toMatch(/endereco:\s+serializarEnderecoEmpresa\(/);
      expect(src).not.toMatch(/split\(\s*['"],['"]\s*\)/);
      expect(src).not.toMatch(/JSON\.parse\([^)]*endereco/);
    }
  });

  it('criar empresa grava no formato de shared nas duas plataformas', () => {
    for (const p of ['web/app/criar-empresa/CriarEmpresaForm.tsx', 'mobile/app/criar-empresa.tsx']) {
      const src = ler(p);
      expect(src, p).toContain("from '@shared/endereco'");
      expect(src, p).toMatch(/p_endereco:\s+serializarEnderecoEmpresa\(\{ rua: endereco \}\)/);
    }
  });
});
