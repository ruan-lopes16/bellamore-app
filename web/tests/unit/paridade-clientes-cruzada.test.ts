/**
 * Paridade Clientes (web × app) — varredura cruzada (spec
 * docs/superpowers/specs/2026-10-22-paridade-clientes-design.md, Task 7).
 *
 * Trava as duas listas e os dois perfis na fonte única de shared:
 * - usam `@shared/clientes-segmentos` e `@shared/clientes-consultas` (o app pelo hook `useClientes.ts`);
 * - nenhuma regra local de VIP / Recorrente / Em risco / Sumida (números hardcoded);
 * - não sobra `.limit(5000)`, aba "Fotos" nem `useClientesStats`;
 * - os textos que a pessoa vê são os mesmos nas duas plataformas.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CARTOES_CLIENTES, FILTROS_CLIENTES, ROTULO_FILTRO, ROTULO_SEGMENTO, TAGS_LINHA,
  VIP_GASTO, VIP_ATENDIMENTOS, RECORRENTE_ATENDIMENTOS, DIAS_EM_RISCO, DIAS_SUMIDA, DIAS_RETORNO, DIAS_NUNCA_ATENDIDA,
  AVISO_CLIENTE_ARQUIVADA, kpisPerfilCliente,
} from '@shared/clientes-segmentos';

const root = join(__dirname, '..', '..', '..');
const ler = (f: string) => readFileSync(join(root, f), 'utf8');
/** Código sem comentários (o que vale é o que roda; comentário pode citar a regra antiga). */
const codigo = (f: string) => ler(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const WEB_LISTA = 'web/app/(app)/clientes/page.tsx';
const APP_LISTA = 'mobile/app/(empresa)/clientes.tsx';
const WEB_PERFIL = 'web/app/(app)/clientes/[id]/page.tsx';
const WEB_HISTORICO = 'web/app/(app)/clientes/[id]/HistoricoCliente.tsx';
const APP_PERFIL = 'mobile/app/(empresa)/cliente/[id].tsx';
const APP_HOOK = 'mobile/hooks/useClientes.ts';
const APP_EDITAR = 'mobile/app/(empresa)/cliente/[id]/editar.tsx';

const TELAS = [WEB_LISTA, APP_LISTA, WEB_PERFIL, WEB_HISTORICO, APP_PERFIL, APP_HOOK];
/** O que cada "lado" junta (o app consulta pelo hook). */
const LADOS = {
  'web lista': [WEB_LISTA],
  'app lista': [APP_LISTA, APP_HOOK],
  'web perfil': [WEB_PERFIL, WEB_HISTORICO],
  'app perfil': [APP_PERFIL, APP_HOOK],
} as const;
const lado = (nome: keyof typeof LADOS) => LADOS[nome].map(ler).join('\n');

describe('Paridade Clientes: listas e perfis usam a fonte única de shared', () => {
  for (const nome of Object.keys(LADOS) as (keyof typeof LADOS)[]) {
    it(`${nome} importa @shared/clientes-segmentos e @shared/clientes-consultas`, () => {
      const src = lado(nome);
      expect(src).toContain("from '@shared/clientes-segmentos'");
      expect(src).toContain("from '@shared/clientes-consultas'");
    });
  }

  it('as duas listas: base, agregado, contagem, filtro e tags pelas mesmas funções', () => {
    for (const src of [lado('web lista'), lado('app lista')]) {
      for (const f of ['carregarBaseClientes(', 'agregarClientes(', 'contarSegmentos(', 'filtrarClientes(', 'tagsDaLinha(', 'textoUltimaVisita(', 'textoListaVazia(']) {
        expect(src).toContain(f);
      }
      for (const c of ['FILTROS_CLIENTES', 'ROTULO_FILTRO', 'CARTOES_CLIENTES']) expect(src).toContain(c);
    }
  });

  it('os dois perfis: histórico, KPIs, tags, arquivar/reativar/excluir e contatos pelas mesmas funções', () => {
    for (const src of [lado('web perfil'), lado('app perfil')]) {
      for (const f of [
        'carregarHistoricoCliente(', 'kpisPerfilCliente(', 'tagsPerfilCliente(', 'textoItensVenda(', 'textoTaxaHistorico(',
        'arquivarCliente(', 'reativarCliente(', 'clienteTemHistorico(', 'excluirCliente(', 'opcoesRemoverCliente(',
        'podeArquivarCliente(pode)', 'contatosCliente(', 'restricoesAnamnese(',
      ]) expect(src).toContain(f);
      for (const c of ['AVISO_CLIENTE_ARQUIVADA', 'MSG_EXCLUSAO_COM_HISTORICO']) expect(src).toContain(c);
    }
  });
});

describe('Paridade Clientes: nenhuma regra local de segmento nas telas', () => {
  for (const f of TELAS) {
    it(`${f}: sem os limites de VIP/Recorrente/Em risco/Sumida hardcoded`, () => {
      const src = codigo(f);
      expect(src).not.toMatch(/\b2000\b/);                         // VIP: R$ 2.000
      expect(src).not.toMatch(/2\.000/);
      expect(src).not.toMatch(/>=?\s*8\b/);                        // VIP: ≥ 8 atendimentos
      expect(src).not.toMatch(/>=?\s*5\b/);                        // Recorrente: ≥ 5 atendimentos
      expect(src).not.toMatch(/[<>]=?\s*(30|45|60)\b/);            // retorno / em risco / sumida
      expect(src).not.toMatch(/\b(30|45|60)\s*[<>]=?/);
      expect(src).not.toMatch(/\b(subDays|addDays|differenceInDays|differenceInCalendarDays|diasEntre)\s*\([^)]*\b(30|45|60)\b/);
      expect(src).not.toMatch(/\b(30|45|60)\s*\*\s*(24|86_?400)/);  // 45 * 24 * 60 * 60 * 1000 …
      // a regra só existe nas constantes de shared, nunca redefinida na tela
      for (const k of ['VIP_GASTO', 'VIP_ATENDIMENTOS', 'RECORRENTE_ATENDIMENTOS', 'DIAS_EM_RISCO', 'DIAS_SUMIDA', 'DIAS_RETORNO', 'DIAS_NUNCA_ATENDIDA']) {
        expect(src).not.toMatch(new RegExp(`const\\s+${k}\\b`));
      }
      // e nada de decidir segmento por conta própria
      expect(src).not.toMatch(/totalGasto\s*>=?/);
      expect(src).not.toMatch(/atendimentos\s*>=?\s*\d/);
      expect(src).not.toMatch(/function\s+(calcularTags|segmentoDe|ehVip|ehSumida)\b/);
    });
  }

  it('as constantes moram em shared com os valores decididos pelo dono', () => {
    expect([VIP_GASTO, VIP_ATENDIMENTOS, RECORRENTE_ATENDIMENTOS, DIAS_EM_RISCO, DIAS_SUMIDA, DIAS_RETORNO, DIAS_NUNCA_ATENDIDA])
      .toEqual([2000, 8, 5, 45, 60, 30, 30]);
  });
});

describe('Paridade Clientes: o que não pode sobrar', () => {
  for (const f of TELAS) {
    it(`${f}: sem .limit(5000), aba Fotos nem useClientesStats`, () => {
      const src = codigo(f);
      expect(src).not.toMatch(/\.limit\(\s*5000\s*\)/);
      expect(src).not.toContain('useClientesStats');
      expect(src).not.toMatch(/'fotos'/i);
      expect(src).not.toMatch(/>\s*Fotos\s*</);
      expect(src).not.toContain('Adicionar foto');
    });
  }

  it('useClientesStats não existe mais em lugar nenhum do app', () => {
    for (const f of [APP_HOOK, APP_LISTA, APP_PERFIL, 'mobile/app/(empresa)/dashboard.tsx']) {
      expect(ler(f)).not.toContain('useClientesStats');
    }
  });

  it('o app não refaz a consulta da lista a cada tecla (busca fora da queryKey)', () => {
    expect(ler(APP_HOOK)).toContain("queryKey: ['clientes', empresaId]");
    expect(ler(APP_HOOK)).not.toMatch(/queryKey:\s*\[[^\]]*busca/);
  });
});

describe('Paridade Clientes: mesmos textos nas duas plataformas', () => {
  it('filtros e cartões: os rótulos vêm da mesma lista de shared nas duas listas', () => {
    expect(FILTROS_CLIENTES.map(f => ROTULO_FILTRO[f])).toEqual([
      'Todas', 'Novas', 'Aniversariantes', 'Retornos', 'VIP', 'Recorrentes', 'Em risco', 'Sumidas', 'Nunca atendidas', 'Arquivadas',
    ]);
    expect(CARTOES_CLIENTES.map(c => c.rotulo)).toEqual(['Total', 'Novas no mês', 'VIP', 'Em risco', 'Sumidas', 'Nunca atendidas']);
    expect(TAGS_LINHA.map(s => ROTULO_SEGMENTO[s])).toEqual(['VIP', 'Recorrente', 'Em risco', 'Sumida', 'Nova']);
    for (const src of [ler(WEB_LISTA), ler(APP_LISTA)]) {
      expect(src).toMatch(/FILTROS_CLIENTES\.map\(\s*\(?\s*\w+\s*\)?\s*=>\s*\(\{\s*key[^}]*ROTULO_FILTRO\[/);
      expect(src).toMatch(/CARTOES_CLIENTES\.map\(/);
    }
  });

  it('busca: o mesmo placeholder nas duas listas', () => {
    for (const src of [ler(WEB_LISTA), ler(APP_LISTA)]) expect(src).toContain('placeholder="Buscar por nome, telefone ou e-mail"');
  });

  it('perfil: os 4 KPIs com os mesmos rótulos (de shared) nas duas plataformas', () => {
    expect(kpisPerfilCliente(null, '2026-10-22').map(k => k.rotulo)).toEqual(['Atendimentos', 'Total gasto', 'Última visita', 'Serviço favorito']);
    expect(ler(WEB_PERFIL)).toContain('kpi.rotulo');
    expect(ler(APP_PERFIL)).toContain('k.rotulo');
    // nenhuma das duas reescreve o texto da última visita
    for (const src of [codigo(WEB_PERFIL), codigo(APP_PERFIL)]) {
      expect(src).not.toMatch(/function\s+(rotuloUltimaVisita|textoKpiUltimaVisita)\b/);
      expect(src).not.toMatch(/`há \$\{/);
    }
  });

  it('perfil: arquivada com o mesmo aviso (de shared) e o botão Reativar nas duas', () => {
    expect(AVISO_CLIENTE_ARQUIVADA).toBe('Cliente arquivada: fora da lista e dos segmentos. O histórico é mantido.');
    for (const src of [ler(WEB_PERFIL), ler(APP_PERFIL)]) {
      expect(src).toContain('{AVISO_CLIENTE_ARQUIVADA}');
      expect(src).toMatch(/>\s*\{?[^<]*Reativar/);
      expect(src).not.toContain('Cliente arquivada: fora');
    }
  });

  it('perfil: textos fixos do histórico, dos erros e da exclusão iguais nas duas', () => {
    const textos = [
      'Sessão de pacote', 'Serviço extra da comanda', 'Venda avulsa',
      'Não foi possível carregar o histórico', 'Não foi possível carregar a cliente.', 'Cliente não encontrada.',
      'Excluir permanentemente', 'Apaga para sempre — só é possível sem histórico',
      'Some das listas, mas o histórico é mantido', 'Remover cliente', 'Arquivar',
    ];
    for (const t of textos) {
      expect(lado('web perfil'), `web: ${t}`).toContain(t);
      expect(lado('app perfil'), `app: ${t}`).toContain(t);
    }
  });

  it('perfil: venda avulsa sem detalhe nas duas, com os itens visíveis na própria linha', () => {
    // web: a linha de venda é um <div> (não <button>) e mostra textoItensVenda
    const web = ler(WEB_HISTORICO);
    const blocoVendaWeb = web.slice(web.indexOf("item.tipo === 'venda'"), web.indexOf('textoTaxaHistorico(item.tipo'));
    expect(blocoVendaWeb).toContain('textoItensVenda(item.itens)');
    expect(blocoVendaWeb).not.toContain('<button');
    expect(blocoVendaWeb).not.toContain('onAbrirDetalhe');
    // app: o caso 'venda' não define destino (linha não clicável) e mostra textoItensVenda
    const app = ler(APP_PERFIL);
    const blocoVendaApp = app.slice(app.indexOf("case 'venda':"), app.indexOf("case 'taxa_reserva':"));
    expect(blocoVendaApp).toContain('textoItensVenda(item.itens)');
    expect(blocoVendaApp).not.toContain('destino');
  });

  it('perfil: erro de carga mostra "—" e aviso, nunca zero (KPIs sem agregado)', () => {
    for (const k of kpisPerfilCliente(null, '2026-10-22')) expect(k.valor).toBe('—');
    // web: sem agregado pronto durante a carga ou com erro
    expect(ler(WEB_PERFIL)).toMatch(/agregadoPronto\s*=\s*!loadingHist && !erroHist \? agregado : null/);
    // app: o hook devolve agregado nulo quando o histórico falha
    expect(ler(APP_HOOK)).toMatch(/agregado:\s*historicoRes\.ok \? historicoRes\.agregado : null/);
  });

  it('edição do app: telefone obrigatório com "*", como no web', () => {
    expect(ler(APP_EDITAR)).toContain('label="Telefone / WhatsApp *"');
  });
});
