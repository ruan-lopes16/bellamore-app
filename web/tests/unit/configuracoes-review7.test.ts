import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fundoCategoriaNoTema } from '@shared/tema';
import { validarSenhaOpcionalComConfirmacao } from '@shared/senha';
import { temAlteracoes, MENSAGEM_ALTERACOES_NAO_SALVAS } from '@shared/configuracoes-empresa';

// Correções da revisão da Task 7 (Configurações do app + modo escuro).
const raiz = join(__dirname, '..', '..', '..');
const ler = (p: string) => (existsSync(join(raiz, p)) ? readFileSync(join(raiz, p), 'utf8') : '');

describe('modo escuro: cartões com fundo de categoria', () => {
  it('no claro mantém o fundo pastel; no escuro usa a cor da categoria translúcida', () => {
    expect(fundoCategoriaNoTema('#4F46E5', '#EEF2FF', false)).toBe('#EEF2FF');
    expect(fundoCategoriaNoTema('#4F46E5', '#EEF2FF', true)).toBe('#4F46E526');
  });
  it('cor fora do formato #RRGGBB no escuro devolve null (quem chama usa a superfície do tema)', () => {
    expect(fundoCategoriaNoTema('rgb(1,2,3)', '#EEF2FF', true)).toBeNull();
    expect(fundoCategoriaNoTema('', '#EEF2FF', true)).toBeNull();
  });

  for (const p of ['mobile/app/(empresa)/agenda.tsx', 'mobile/app/(profissional)/agenda.tsx']) {
    it(`${p}: cartão do agendamento não usa o pastel claro com o texto do tema`, () => {
      const src = ler(p);
      expect(src).toContain('fundoCategoriaNoTema(');
      expect(src).not.toMatch(/backgroundColor: 'rgba\(255,255,255,0\.7/);
      expect(src).not.toContain("'#FDF0F5'");
    });
  }

  it('PagamentosEditor: cartão do pagamento (fundo claro) usa a paleta clara por dentro', () => {
    const src = ler('mobile/components/comanda/PagamentosEditor.tsx');
    expect(src).toContain('PALETA_CLARA');
    // valor digitado: nunca a cor de texto do tema sobre o fundo claro do método
    expect(src).toMatch(/fontSize: 14, color: CL\.text, textAlign: 'right'/);
  });

  it('menu Mais: ícone de Configurações sem fundo claro fixo', () => {
    expect(ler('mobile/app/(empresa)/mais.tsx')).not.toContain('"#F3F4F6"');
  });

  it('VisaoMes: erro na cor do tema', () => {
    expect(ler('mobile/components/agenda/VisaoMes.tsx')).not.toContain("'#C0392B'");
  });
});

describe('senha opcional com confirmação (app)', () => {
  it('vazia nas duas = não trocar', () => {
    expect(validarSenhaOpcionalComConfirmacao('', '')).toBeNull();
  });
  it('curta, diferente ou só a confirmação preenchida = erro', () => {
    expect(validarSenhaOpcionalComConfirmacao('123', '123')).toBe('A senha deve ter pelo menos 8 caracteres.');
    expect(validarSenhaOpcionalComConfirmacao('12345678', '12345679')).toBe('As senhas não coincidem.');
    expect(validarSenhaOpcionalComConfirmacao('', '12345678')).toBe('A senha deve ter pelo menos 8 caracteres.');
    expect(validarSenhaOpcionalComConfirmacao('12345678', '12345678')).toBeNull();
  });
  for (const p of ['mobile/app/(empresa)/configuracoes.tsx', 'mobile/app/(profissional)/configuracoes.tsx']) {
    it(`${p}: pede a confirmação da senha nova`, () => {
      const src = ler(p);
      expect(src).toContain('validarSenhaOpcionalComConfirmacao(novaSenha, confirmaSenha)');
      expect(src).toContain('label="Confirmar nova senha"');
    });
  }
});

describe('Configurações da empresa (app): trocar de aba com alterações não salvas', () => {
  it('temAlteracoes compara o conteúdo', () => {
    expect(temAlteracoes({ a: 1, b: { c: 'x' } }, { a: 1, b: { c: 'x' } })).toBe(false);
    expect(temAlteracoes({ a: 1 }, { a: 2 })).toBe(true);
  });
  it('mensagem fixa', () => {
    expect(MENSAGEM_ALTERACOES_NAO_SALVAS).toBe('Você tem alterações não salvas nesta aba. Salve antes de trocar ou descarte as alterações.');
  });
  it('a tela avisa antes de trocar e oferece descartar', () => {
    const src = ler('mobile/app/(empresa)/configuracoes.tsx');
    expect(src).toContain('MENSAGEM_ALTERACOES_NAO_SALVAS');
    expect(src).toContain('onChange={trocarAba}');
    expect(src).toContain("'Descartar'");
  });
});

describe('expo-image-picker: só a galeria', () => {
  it('sem permissão de câmera e microfone (nada de texto padrão em inglês no iOS nem RECORD_AUDIO no Android)', () => {
    const app = JSON.parse(ler('mobile/app.json'));
    const plugin = app.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-image-picker');
    expect(plugin[1]).toEqual({
      photosPermission: 'O app usa suas fotos para trocar a logo da empresa.',
      cameraPermission: false,
      microphonePermission: false,
    });
  });
});

describe('web: troca de e-mail e preferências pelas regras de shared', () => {
  const src = ler('web/app/(app)/configuracoes/page.tsx');
  it('validação e mensagem exatas de shared', () => {
    expect(src).toContain('validarTrocaEmail(');
    expect(src).toContain('MENSAGEM_EMAIL_CONFIRMACAO');
  });
  it('preferência de notificação gravada com o resultado conferido', () => {
    expect(src).toContain('salvarPreferenciaNotificacao(');
  });
});
