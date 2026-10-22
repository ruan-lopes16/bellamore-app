import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (f: string) => readFileSync(join(root, f), 'utf8');
const PAGINA = 'web/app/(app)/clientes/[id]/page.tsx';
const HISTORICO = 'web/app/(app)/clientes/[id]/HistoricoCliente.tsx';

describe('Clientes web: perfil pela fonte única de shared', () => {
  it('o histórico mora num componente próprio', () => {
    expect(existsSync(join(root, HISTORICO))).toBe(true);
    expect(ler(PAGINA)).toContain("from './HistoricoCliente'");
    expect(ler(PAGINA)).toContain('<HistoricoCliente');
  });

  it('KPIs e histórico vêm de carregarHistoricoCliente, sem consulta local', () => {
    const p = ler(PAGINA);
    expect(p).toContain('carregarHistoricoCliente(');
    expect(p).toContain('@shared/clientes-consultas');
    // as consultas antigas do perfil não podem sobreviver (regra local de visitas/gasto/favorito)
    expect(p).not.toMatch(/from\('comanda_itens'\)/);
    expect(p).not.toMatch(/from\('taxas_reserva'\)\s*\.select/);
    expect(p).not.toMatch(/from\('taxas_cancelamento'\)/);
    expect(p).not.toMatch(/from\('vendas'\)\s*\.select\(`/);
    expect(p).not.toContain('svcCount');
    expect(p).not.toContain('valorCobradoAtendimento');
  });

  it('4 KPIs com os rótulos únicos, a partir do agregado', () => {
    const p = ler(PAGINA);
    for (const r of ["'Atendimentos'", "'Total gasto'", "'Última visita'", "'Serviço favorito'"]) expect(p).toContain(r);
    expect(p).toContain('agregado.atendimentos');
    expect(p).toContain('agregado.totalGasto');
    expect(p).toContain('agregado.ultimaVisita');
    expect(p).toContain('agregado.servicoFavorito');
  });

  it('erro de carga mostra "—" e aviso, nunca zero', () => {
    const p = ler(PAGINA);
    expect(p).toMatch(/erroHist/);
    expect(p).toContain('role="alert"');
  });

  it('tags do cabeçalho pelos segmentos de shared', () => {
    const p = ler(PAGINA);
    expect(p).toContain('tagsDaLinha(');
    expect(p).toContain('@shared/clientes-segmentos');
  });

  it('histórico único: atendimento, extra, venda com itens e taxas com método', () => {
    const h = ler(HISTORICO);
    expect(h).toContain('ItemHistorico');
    for (const t of ["'atendimento'", "'extra'", "'venda'", "'taxa_reserva'", "'taxa_cancelamento'"]) expect(h).toContain(t);
    expect(h).toContain('PAGAMENTO_METODO_LABEL');
    expect(h).toContain('Sessão de pacote');
    expect(h).toContain('<Secret>');
    // venda mostra os itens
    expect(h).toMatch(/\.itens\.map/);
    // atendimento e extra abrem o detalhe da comanda que já existe
    expect(h).toContain('onAbrirDetalhe(');
    expect(ler(PAGINA)).toContain('setDetalheAberto(');
    expect(ler(PAGINA)).toContain('function DetalheAtendimentoModal(');
  });

  it('arquivar e reativar por shared, com permissão', () => {
    const p = ler(PAGINA);
    expect(p).toContain('arquivarCliente(');
    expect(p).toContain('reativarCliente(');
    expect(p).toContain('Reativar');
    expect(p).toContain('podeArquivarCliente(pode)');
    expect(p).not.toMatch(/update\(\{ ativo: false \}\)/);
  });

  it('contatos por contatosCliente (tel: só com dígitos)', () => {
    const p = ler(PAGINA);
    expect(p).toContain('contatosCliente(');
    expect(p).not.toMatch(/href=\{`tel:\$\{cliente\.telefone\}`\}/);
    expect(p).not.toContain('toWhatsApp(cliente.telefone)');
  });

  it('o card de anamnese com restrições continua', () => {
    const p = ler(PAGINA);
    expect(p).toContain('restricoesAnamnese(anamnese)');
  });
});
