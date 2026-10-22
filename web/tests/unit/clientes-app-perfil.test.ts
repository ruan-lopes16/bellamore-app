import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (f: string) => readFileSync(join(root, f), 'utf8');
const TELA = 'mobile/app/(empresa)/cliente/[id].tsx';
const EDITAR = 'mobile/app/(empresa)/cliente/[id]/editar.tsx';
const HOOK = 'mobile/hooks/useClientes.ts';

describe('Clientes app: perfil pela fonte única de shared', () => {
  it('useClienteDetalhe usa carregarHistoricoCliente, sem regra local de visitas/gasto/tags', () => {
    const h = ler(HOOK);
    expect(h).toContain('carregarHistoricoCliente(');
    expect(h).toContain('erroHistorico');
    expect(h).not.toContain('calcularTags');
    expect(h).not.toContain('ClienteTag');
    expect(h).not.toContain('linhasDeVisita');
    expect(h).not.toMatch(/from\('comanda_itens'\)/);
    expect(h).not.toMatch(/from\('taxas_reserva'\)/);
    expect(h).not.toMatch(/from\('taxas_cancelamento'\)/);
    expect(h).not.toMatch(/from\('agendamentos'\)/);
  });

  it('4 KPIs com os rótulos únicos, a partir do agregado', () => {
    const t = ler(TELA);
    // rótulos e valores moram em shared (kpisPerfilCliente), os mesmos do web
    expect(t).toContain('kpisPerfilCliente(agregado');
    expect(t).toContain('k.rotulo');
    expect(t).toContain('k.valor');
    expect(t).not.toContain("'Visitas'");
    expect(t).not.toContain('total_visitas');
  });

  it('erro de carga do histórico mostra "—" e aviso, nunca zero nem lista vazia', () => {
    const t = ler(TELA);
    expect(t).toContain('erroHistorico');
    expect(t).toContain('Não foi possível carregar o histórico');
  });

  it('tags do cabeçalho pelos segmentos de shared', () => {
    const t = ler(TELA);
    expect(t).toContain('tagsPerfilCliente(');
    expect(t).toContain('@shared/clientes-segmentos');
    expect(t).not.toContain('TAG_CONFIG');
  });

  it('histórico único: atendimento, extra, venda com itens e taxas com método', () => {
    const t = ler(TELA);
    expect(t).toContain('ItemHistorico');
    for (const tp of ["'atendimento'", "'extra'", "'venda'", "'taxa_reserva'", "'taxa_cancelamento'"]) expect(t).toContain(tp);
    // forma de pagamento das taxas pelo texto único de shared (PAGAMENTO_METODO_LABEL lá dentro)
    expect(t).toContain('textoTaxaHistorico(item.tipo, item.status, item.metodo)');
    expect(t).toContain('Sessão de pacote');
    expect(t).toContain('textoItensVenda(item.itens)');
    expect(t).toMatch(/<SecretText/);
    // atendimento abre o detalhe; extra abre a comanda (modo comanda da tela de detalhe)
    expect(t).toMatch(/agendamento\/\$\{item\.id\}/);
    expect(t).toMatch(/agendamento\/\$\{item\.comandaId\}\?tipo=comanda/);
    // seções separadas de taxas e o flag antigo de extra não sobrevivem
    expect(t).not.toContain('TAXAS DE CANCELAMENTO');
    expect(t).not.toContain('eExtraDeComanda');
  });

  it('arquivar e reativar por shared, com a mesma permissão, invalidando lista e detalhe', () => {
    const t = ler(TELA);
    expect(t).toContain('arquivarCliente(');
    expect(t).toContain('reativarCliente(');
    expect(t).toContain('Reativar');
    expect(t).toContain('podeArquivarCliente(pode)');
    expect(t).not.toMatch(/update\(\{ ativo: false \}\)/);
    expect(t).toContain("queryKey: ['clientes']");
    expect(t).toContain("queryKey: ['cliente-detalhe']");
  });

  it('contatos por contatosCliente (tel: só com dígitos)', () => {
    const t = ler(TELA);
    expect(t).toContain('contatosCliente(');
    expect(t).not.toContain('tel:${cliente.telefone}');
    expect(t).not.toContain('toWhatsApp(cliente.telefone');
  });

  it('a aba Fotos sai', () => {
    const t = ler(TELA);
    expect(t).not.toMatch(/'fotos'/);
    expect(t).not.toContain('Adicionar foto');
    expect(t).not.toContain('Camera');
  });

  it('na edição, o rótulo do telefone ganha "*"', () => {
    expect(ler(EDITAR)).toContain('label="Telefone / WhatsApp *"');
  });
});

describe('Clientes app: perfil igual ao web (revisão das Tasks 5/6)', () => {
  it('KPIs, tags e aviso de arquivada pelos textos únicos de shared', () => {
    const t = ler(TELA);
    expect(t).toContain('kpisPerfilCliente(');
    expect(t).toContain('tagsPerfilCliente(');
    expect(t).toContain('AVISO_CLIENTE_ARQUIVADA');
    expect(t).not.toContain('function textoKpiUltimaVisita');
    expect(t).not.toContain('Cliente arquivada: fora');
  });

  it('histórico: venda e taxas pelos textos únicos', () => {
    const t = ler(TELA);
    expect(t).toContain('textoItensVenda(');
    expect(t).toContain('textoTaxaHistorico(');
    expect(t).not.toContain('function textoTaxa(');
  });

  it('remover/excluir pela mesma regra de shared (arquivada reativa pelo aviso, não pelo menu)', () => {
    const t = ler(TELA);
    expect(t).toContain('opcoesRemoverCliente(');
    expect(t).toContain('clienteTemHistorico(');
    expect(t).toContain('excluirCliente(');
    expect(t).toContain('MSG_EXCLUSAO_COM_HISTORICO');
    expect(t).not.toMatch(/from\('clientes'\)\.delete\(\)/);
    expect(t).not.toContain('async function temHistorico');
    expect(t).not.toContain('arquivada ? reativar : arquivar');
  });

  it('Ligar e Mensagem só aparecem com telefone', () => {
    expect(ler(TELA)).toMatch(/contatos\s*\?\s*\[/);
  });
});
