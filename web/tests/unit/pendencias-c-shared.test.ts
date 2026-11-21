import { describe, expect, it } from 'vitest';
import { podeExcluirPacoteVendido, resumoSaldoPacote } from '@shared/pacotes';
import { agregarClientes, filtrarClientes, segmentosDaCliente, type AtendimentoBase, type ClienteBase } from '@shared/clientes-segmentos';

describe('B11 podeExcluirPacoteVendido', () => {
  it('pacotes.vender, gestora e dona podem; profissional sem a chave não', () => {
    expect(podeExcluirPacoteVendido(true, 'profissional')).toBe(true);
    expect(podeExcluirPacoteVendido(false, 'gestor')).toBe(true);
    expect(podeExcluirPacoteVendido(false, 'owner')).toBe(true);
    expect(podeExcluirPacoteVendido(false, 'profissional')).toBe(false);
    expect(podeExcluirPacoteVendido(false, null)).toBe(false);
  });
});

describe('C9 resumoSaldoPacote', () => {
  it('tudo ilimitado', () => {
    expect(resumoSaldoPacote([{ servico_id: 'a', quantidade: null }], 3))
      .toEqual({ texto: 'Ilimitado', ilimitado: true, restantes: null });
  });
  it('tudo limitado', () => {
    expect(resumoSaldoPacote([{ servico_id: 'a', quantidade: 4 }, { servico_id: 'b', quantidade: 2 }], 1))
      .toEqual({ texto: '5 de 6 restantes', ilimitado: false, restantes: 5 });
  });
  it('misto: conta os limitados e avisa do ilimitado', () => {
    expect(resumoSaldoPacote([{ servico_id: 'a', quantidade: 4 }, { servico_id: 'b', quantidade: null }], 1).texto)
      .toBe('3 de 4 restantes + ilimitado em 1 serviço');
    expect(resumoSaldoPacote([{ servico_id: 'a', quantidade: 2 }, { servico_id: 'b', quantidade: null }, { servico_id: 'c', quantidade: null }], 9))
      .toEqual({ texto: '0 de 2 restantes + ilimitado em 2 serviços', ilimitado: false, restantes: 0 });
  });
});

describe('C7 atendimento futuro nunca é última visita', () => {
  const HOJE = '2026-10-22';
  const c: ClienteBase = { id: 'c1', nome: 'Ana', telefone: null, email: null, data_nascimento: null, ativo: true, created_at: '2026-01-01T12:00:00Z' };
  const futuro: AtendimentoBase = { cliente_id: 'c1', data_hora_inicio: '2026-10-30T15:00:00Z', valor: 100, pacote_cliente_id: null, servico_id: 's1' };
  const ag = agregarClientes([futuro], [], []);
  it('fora de Retornos e dos segmentos de tempo', () => {
    expect(filtrarClientes([c], ag, 'retornos', '', HOJE)).toEqual([]);
    const s = segmentosDaCliente(c, ag.get('c1'), HOJE);
    expect(s.has('recorrente') || s.has('em_risco') || s.has('sumida')).toBe(false);
  });
  it('visita de hoje continua em Retornos', () => {
    const hoje = agregarClientes([{ ...futuro, data_hora_inicio: '2026-10-22T15:00:00Z' }], [], []);
    expect(filtrarClientes([c], hoje, 'retornos', '', HOJE).map(x => x.id)).toEqual(['c1']);
  });
});
