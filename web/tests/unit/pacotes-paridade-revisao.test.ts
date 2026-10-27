import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  validarPacote, subtotalVendaPacote, ratearValorPago, rotuloStatusVendido, estaACobrar, textoExcluirVendido,
} from '@shared/pacotes';
import { motivoBloqueioVendaPacote, MSG_AGUARDE_CARTOES } from '@shared/pacotes-venda';
import { sincronizarServicosPacote } from '@shared/pacotes-consultas';
import { acoesPacoteVendido, atendimentosVinculaveis, type PodeFn } from '@shared/permissoes';

// Revisão das Tasks 5 e 6 (Paridade Serviços e Pacotes): as regras que web e app tinham em cópias
// diferentes passam a morar em shared, e as duas plataformas as usam.
const raiz = join(process.cwd(), '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8').replace(/\r\n/g, '\n');

describe('validarPacote (regra única do cadastro)', () => {
  const base = { nome: 'Pacote X', precoTxt: '300,00', validadeTxt: '90', semValidade: false, qtdServicos: 1, composicaoTravada: false };
  it('aceita e devolve os valores prontos', () => {
    expect(validarPacote(base)).toEqual({ erro: null, preco: 300, validadeDias: 90 });
    expect(validarPacote({ ...base, semValidade: true, validadeTxt: '' })).toEqual({ erro: null, preco: 300, validadeDias: null });
    expect(validarPacote({ ...base, precoTxt: '1.234,56' }).preco).toBe(1234.56);
  });
  it('preço > 0 obrigatório (vazio, zero ou texto)', () => {
    for (const precoTxt of ['', '0', '0,00', 'abc']) expect(validarPacote({ ...base, precoTxt }).erro).toBe('Informe um preço maior que zero.');
  });
  it('nome, validade e serviços', () => {
    expect(validarPacote({ ...base, nome: ' a ' }).erro).toMatch(/nome do pacote/);
    expect(validarPacote({ ...base, validadeTxt: '0' }).erro).toMatch(/Sem validade/);
    expect(validarPacote({ ...base, qtdServicos: 0 }).erro).toMatch(/pelo menos um serviço/);
    expect(validarPacote({ ...base, qtdServicos: 0, composicaoTravada: true }).erro).toBeNull();
  });
});

describe('valores da venda (iguais à vender_pacote)', () => {
  it('subtotal = unitário arredondado em centavos × quantidade', () => {
    expect(subtotalVendaPacote(33.335, 3)).toBe(100.02);
    expect(subtotalVendaPacote(100, 0)).toBe(0);
  });
  it('rateio do contrato: o resto do líquido vai nas primeiras unidades', () => {
    expect(ratearValorPago(100, 3, 0.01)).toEqual([100, 100, 99.99]);
    expect(ratearValorPago(100, 3, 100)).toEqual([66.67, 66.67, 66.66]);
  });
});

describe('motivoBloqueioVendaPacote', () => {
  const ok = { podeFechar: true, motivo: null };
  const d = { temPacote: true, temCliente: true, quantidade: 1, valorTxt: '100', valorUnit: 100, erroDesconto: null, cobranca: 'agora' as const, resumo: ok, configPronta: true };
  it('libera a venda certa', () => expect(motivoBloqueioVendaPacote(d)).toBeNull());
  it('campo de valor apagado nunca vira R$ 0', () => {
    expect(motivoBloqueioVendaPacote({ ...d, valorTxt: '', valorUnit: 0 })).toBe('Valor do pacote inválido.');
    expect(motivoBloqueioVendaPacote({ ...d, valorTxt: '0', valorUnit: 0 })).toBeNull();
  });
  it('"Cobrar agora" espera as taxas dos cartões e o total coberto; "na comanda" não', () => {
    expect(motivoBloqueioVendaPacote({ ...d, configPronta: false })).toBe(MSG_AGUARDE_CARTOES);
    expect(motivoBloqueioVendaPacote({ ...d, resumo: { podeFechar: false, motivo: 'Ainda faltam R$ 1,00 para cobrir o total' } })).toMatch(/Ainda faltam/);
    expect(motivoBloqueioVendaPacote({ ...d, cobranca: 'comanda', configPronta: false, resumo: { podeFechar: false, motivo: 'x' } })).toBeNull();
  });
  it('quantidade, cliente e pacote', () => {
    expect(motivoBloqueioVendaPacote({ ...d, quantidade: 101 })).toMatch(/de 1 a 100/);
    expect(motivoBloqueioVendaPacote({ ...d, temCliente: false })).toMatch(/cliente cadastrada/);
    expect(motivoBloqueioVendaPacote({ ...d, temPacote: false })).toBe('Escolha o pacote.');
  });
});

describe('sincronizarServicosPacote: nova tentativa depois de falha', () => {
  it('upsert falhou → nada foi apagado; a nova tentativa grava sem acusar "sem permissão"', async () => {
    let falhar = true;
    const apagados: string[][] = [];
    const db = {
      from() {
        let op = '';
        let ids: string[] = [];
        const b: Record<string, unknown> = new Proxy({}, {
          get(_a, prop) {
            if (prop === 'then') return (res: (v: unknown) => unknown) => {
              if (op === 'upsert') return res(falhar ? { data: null, error: { code: '08000', message: 'rede' } } : { data: [{}], error: null });
              apagados.push(ids);
              return res({ data: ids.map(i => ({ servico_id: i })), error: null });
            };
            return (...args: unknown[]) => {
              if (prop === 'upsert' || prop === 'delete') op = String(prop);
              if (prop === 'in') ids = args[1] as string[];
              return b;
            };
          },
        });
        return b;
      },
    };
    expect(await sincronizarServicosPacote(db, 'p', ['a', 'b'], [{ servico_id: 'b', quantidade: 1 }])).not.toBeNull();
    expect(apagados).toEqual([]);
    falhar = false;
    expect(await sincronizarServicosPacote(db, 'p', ['a', 'b'], [{ servico_id: 'b', quantidade: 1 }])).toBeNull();
    expect(apagados).toEqual([['a']]);
  });
});

describe('permissões do pacote vendido (iguais à RLS da 093)', () => {
  const com = (...chaves: string[]): PodeFn => (a) => chaves.includes(a);
  it('vender libera excluir, combo e sessão avulsa; sessões sempre abrem', () => {
    expect(acoesPacoteVendido(com('pacotes.vender'))).toEqual({ excluir: true, marcarCombo: true, gerenciarSessoes: true, lancarAvulsa: true, vincularDeOutras: false });
    expect(acoesPacoteVendido(com())).toEqual({ excluir: false, marcarCombo: false, gerenciarSessoes: true, lancarAvulsa: false, vincularDeOutras: false });
    expect(acoesPacoteVendido(com('agenda.gerenciar_outras')).vincularDeOutras).toBe(true);
  });
  it('sem gerenciar_outras só os próprios atendimentos são vinculáveis', () => {
    const ags = [{ id: '1', profissional_id: 'eu' }, { id: '2', profissional_id: 'outra' }, { id: '3', profissional_id: null }];
    expect(atendimentosVinculaveis(ags, 'eu', false).map(a => a.id)).toEqual(['1']);
    expect(atendimentosVinculaveis(ags, null, false)).toEqual([]);
    expect(atendimentosVinculaveis(ags, 'eu', true)).toHaveLength(3);
  });
});

describe('textos únicos de Vendidos', () => {
  it('status com "A cobrar" e confirmação de exclusão', () => {
    expect(rotuloStatusVendido({ statusExibido: 'ativo', cobranca: 'pendente' })).toBe('Ativo · A cobrar');
    expect(rotuloStatusVendido({ statusExibido: 'cancelado', cobranca: 'pendente' })).toBe('Cancelado');
    expect(estaACobrar({ statusExibido: 'cancelado', cobranca: 'pendente' })).toBe(false);
    expect(textoExcluirVendido({ pacote: 'P', cliente: 'Ana', aCobrar: true })).toMatch(/não entrará mais na comanda/);
  });
});

describe('web e app usam as mesmas regras de shared', () => {
  const telas = {
    webPagina: ler('web/app/(app)/pacotes/page.tsx'),
    webModal: ler('web/components/pacotes/VenderPacoteModal.tsx'),
    webForm: ler('web/components/pacotes/PacoteForm.tsx'),
    webSessoes: ler('web/components/pacotes/GerenciarSessoes.tsx'),
    appTela: ler('mobile/app/(empresa)/pacotes.tsx'),
    appSheet: ler('mobile/components/pacotes/VenderPacoteSheet.tsx'),
    appForm: ler('mobile/components/pacotes/PacoteForm.tsx'),
  };
  const tudo = Object.values(telas).join('\n');

  it('regra local do web removida (web/lib/pacotes-web.ts)', () => {
    expect(tudo).not.toContain('@/lib/pacotes-web');
    expect(() => ler('web/lib/pacotes-web.ts')).toThrow();
  });
  it('cadastro: validarPacote e sincronizarServicosPacote nas duas', () => {
    for (const f of [telas.webForm, telas.appForm]) {
      expect(f).toContain('validarPacote(');
      expect(f).toContain('sincronizarServicosPacote(supabase');
      expect(f).not.toMatch(/function validarPacote/);
      expect(f).not.toMatch(/from\('pacote_servicos'\)/);
    }
  });
  it('venda: detecção da 096, bloqueio, subtotal, chave e caminho antigo de shared nas duas', () => {
    for (const f of [telas.webModal, telas.appSheet]) {
      expect(f).toMatch(/import \{[^}]*\btem096\b[^}]*\} from '@shared\/pacotes-consultas'/);
      expect(f).toContain('096(supabase)');
      expect(f).toContain('motivoBloqueioVendaPacote(');
      expect(f).toContain('subtotalVendaPacote(');
      expect(f).toContain('chaveVendaPacote(');
      expect(f).toContain('venderPacoteSem096(supabase');
      expect(f).toContain('TEXTO_COBRANCA');
      expect(f).toContain('MSG_COMANDA_INDISPONIVEL');
      expect(f).not.toMatch(/from\('pacote_clientes'\)/);
      expect(f).not.toContain('ratearDescontoCentavos');
    }
  });
  it('vendido: ações por acoesPacoteVendido; exclusão sem a 096 indisponível nas duas', () => {
    for (const f of [telas.webPagina, telas.appTela]) {
      expect(f).toContain('acoesPacoteVendido(pode)');
      expect(f).toContain('MSG_EXCLUSAO_SEM_096');
      expect(f).toContain('textoExcluirVendido(');
      expect(f).toContain('TITULO_EXCLUIR_VENDIDO');
      expect(f).toContain('marcarComboUtilizado(supabase');
      expect(f).toContain('filtrarVendidos(');
      expect(f).toContain('rotuloStatusVendido(');
      expect(f).not.toMatch(/from\('pacote_clientes'\)\s*\.delete\(\)/);
    }
  });
  it('sessões: avulsa só com pacotes.vender; vínculo filtrado por atendimentosVinculaveis', () => {
    expect(telas.webSessoes).toContain('atendimentosVinculaveis(');
    expect(telas.appTela).toContain('atendimentosVinculaveis(');
    expect(telas.webSessoes).toContain('profissional_id');
    expect(telas.appTela).toMatch(/select\('id, data_hora_inicio, servico_id, pacote_cliente_id, profissional_id/);
  });
});
