import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mensagemErroBanco } from '@shared/erros';

const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('mensagemErroBanco', () => {
  it('traduz recusa de RLS (código 42501) para português com a ação', () => {
    expect(mensagemErroBanco({ code: '42501', message: 'new row violates row-level security policy for table "clientes"' }, 'cadastrar cliente'))
      .toBe('Você não tem permissão para cadastrar cliente. Fale com a dona ou a gestora.');
  });

  it('traduz recusa de RLS mesmo sem código (só pela mensagem)', () => {
    expect(mensagemErroBanco({ message: 'new row violates row-level security policy' }, 'editar cliente'))
      .toBe('Você não tem permissão para editar cliente. Fale com a dona ou a gestora.');
  });

  it('mantém a mensagem original para outros erros', () => {
    expect(mensagemErroBanco({ code: '23505', message: 'duplicate key' }, 'cadastrar cliente')).toBe('duplicate key');
  });

  it('sem erro nenhum devolve mensagem genérica', () => {
    expect(mensagemErroBanco(null, 'cadastrar cliente')).toBe('Não foi possível cadastrar cliente.');
  });
});

describe('migration 081 — profissional cadastra e edita cliente', () => {
  const sql = ler('supabase/migrations/081_clientes_profissional_cadastra_edita.sql');

  it('INSERT e UPDATE liberados para membro (minha_empresas), não só gestor', () => {
    expect(sql).toMatch(/drop policy if exists "clientes: gestor pode inserir"/);
    expect(sql).toMatch(/drop policy if exists "clientes: gestor pode atualizar"/);
    expect(sql).toMatch(/for insert\s+with check \(empresa_id in \(select minha_empresas\(\)\)\)/);
    expect(sql).toMatch(/for update\s+using \(empresa_id in \(select minha_empresas\(\)\)\)/);
  });

  it('não mexe na policy de DELETE (continua só da dona)', () => {
    expect(sql).not.toMatch(/drop policy[^;]*deletar/);
  });

  it('arquivar/reativar (coluna ativo) continua restrito a gestor/owner via trigger', () => {
    expect(sql).toMatch(/before update of ativo on public\.clientes/);
    expect(sql).toMatch(/new\.ativo is distinct from old\.ativo/);
    expect(sql).toMatch(/not is_gestor_ou_owner\(old\.empresa_id\)/);
    expect(sql).toMatch(/errcode = '42501'/);
  });
});

describe('telas de cliente usam mensagemErroBanco (sem erro técnico em inglês)', () => {
  const arquivos = [
    'web/app/(app)/clientes/page.tsx',
    'web/app/(app)/agenda/page.tsx',
    'web/app/(app)/clientes/[id]/page.tsx',
    'mobile/app/(empresa)/novo-cliente.tsx',
    'mobile/app/(empresa)/novo-agendamento.tsx',
    'mobile/app/(empresa)/cliente/[id]/editar.tsx',
    'mobile/app/(empresa)/cliente/[id].tsx',
  ];
  for (const arq of arquivos) {
    it(arq, () => {
      expect(ler(arq)).toContain('mensagemErroBanco(');
    });
  }

  it('web: arquivar cliente checa o erro (antes falhava em silêncio)', () => {
    const src = ler('web/app/(app)/clientes/[id]/page.tsx');
    expect(src).not.toMatch(/await supabase\.from\('clientes'\)\.update\(\{ ativo: false \}\)\.eq\('id', id\);/);
  });
});
