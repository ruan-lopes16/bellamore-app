import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('mobile grava cliente em public.clientes no formato do web', () => {
  for (const arq of ['mobile/app/(empresa)/novo-cliente.tsx', 'mobile/app/(empresa)/novo-agendamento.tsx']) {
    it(`${arq}: insert em clientes, sem users/empresa_membros/randomUUID`, () => {
      const src = ler(arq);
      expect(src).toContain(".from('clientes').insert(");
      expect(src).not.toContain('crypto.randomUUID');
      expect(src).not.toMatch(/from\('users'\)\s*\.insert/);
      expect(src).toContain('maskPhone');
    });
  }
  it('novo-cliente usa aniversário dia/mês, endereço JSON e grava observacoes', () => {
    const src = ler('mobile/app/(empresa)/novo-cliente.tsx');
    expect(src).toContain('montarAniversario(');
    expect(src).toContain('serializarEndereco(');
    expect(src).toMatch(/observacoes:\s*obs/);
  });
  it('editar grava em clientes com .select e invalida a key certa', () => {
    const src = ler('mobile/app/(empresa)/cliente/[id]/editar.tsx');
    expect(src).toContain(".from('clientes').update(");
    expect(src).toContain(".select('id')");
    expect(src).not.toContain("['cliente-detalhe', undefined");
  });
  it('perfil usa idade/aniversário/endereço/WhatsApp do shared', () => {
    const src = ler('mobile/app/(empresa)/cliente/[id].tsx');
    for (const f of ['idadeCliente(', 'formatarAniversario(', 'parseEndereco(', 'toWhatsApp(']) expect(src).toContain(f);
  });
  it('após cadastrar, vai para a anamnese (igual ao web)', () => {
    expect(ler('mobile/app/(empresa)/novo-cliente.tsx')).toMatch(/cliente\/\$\{[^}]+\}\/anamnese/);
  });
});
