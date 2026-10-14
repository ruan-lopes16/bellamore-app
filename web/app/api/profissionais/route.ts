import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { podeAtribuirRole, pode } from '@/lib/permissions';
import { quemChama, traduzirErroEmailAuth } from '@/lib/auth/quem-chama';
import { carregarPermissoesDoMembro } from '@shared/permissoes-consultas';
import { podeGerenciarMembro } from '@shared/permissoes';
import { emailValido, montarPatchVinculo, vinculoParaGravar, type TipoContrato } from '@shared/equipe';

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY nao configurada.');
  }

  return createAdmin(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const ERRO_INTERNO = 'Erro interno. Tente de novo.';
const ERRO_SESSAO = 'Sessão expirada. Entre de novo.';
const ERRO_EMPRESA = 'Você não faz parte desta empresa.';
const ERRO_SEM_PERMISSAO = 'Você não tem permissão para gerenciar a equipe.';
const ERRO_GERENCIAR_MEMBRO = 'Você só pode editar profissionais da equipe (não a dona, outra gestora ou você mesma).';
const ERRO_TROCA_EMAIL_LOGIN = 'O e-mail de login desta pessoa só pode ser trocado pela dona, e só quando a conta dela não é usada em outra empresa.';

/** Escapa curingas do ILIKE (`\`, `%`, `_`) para comparar o e-mail sem diferenciar maiúsculas. */
function escaparLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Adiciona uma profissional com senha definida pela dona/gestora (web e app). Se o e-mail já tem conta,
 * só vincula à empresa (sem mexer na senha). Vínculo existente nunca tem comissão/contrato zerados:
 * só troca o que veio no corpo (`vinculoParaGravar`).
 */
export async function POST(req: NextRequest) {
  try {
    const { empresaId, nome, telefone, email, senha, percentual_comissao, tipo_contrato, role } = await req.json();

    if (!empresaId || !nome?.trim() || !email?.trim() || !senha) {
      return NextResponse.json({ error: 'Nome, e-mail, senha e empresa são obrigatórios.' }, { status: 400 });
    }
    if (String(senha).length < 6) {
      return NextResponse.json({ error: 'A senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
    }
    if (!emailValido(String(email))) {
      return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
    }
    // Valida comissão/contrato antes de criar qualquer conta.
    const validacao = vinculoParaGravar(null, { percentual_comissao, tipo_contrato });
    if ('erro' in validacao) return NextResponse.json({ error: validacao.erro }, { status: 400 });

    const adminClient = createAdminClient();
    const requesterId = await quemChama(req, adminClient);
    if (!requesterId) return NextResponse.json({ error: ERRO_SESSAO }, { status: 401 });

    const { data: membroReq } = await adminClient
      .from('empresa_membros')
      .select('empresa_id, role')
      .eq('user_id', requesterId)
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .maybeSingle();
    if (!membroReq) return NextResponse.json({ error: ERRO_EMPRESA }, { status: 403 });

    const permsReq = await carregarPermissoesDoMembro(adminClient, empresaId, requesterId);
    if (!permsReq || !pode(permsReq, 'equipe.gerenciar')) {
      return NextResponse.json({ error: ERRO_SEM_PERMISSAO }, { status: 403 });
    }

    const roleSolicitado: 'gestor' | 'profissional' = role === 'gestor' ? 'gestor' : 'profissional';
    if (!podeAtribuirRole(membroReq.role as 'owner' | 'gestor' | 'profissional', roleSolicitado)) {
      return NextResponse.json({ error: 'Você não pode atribuir esse papel.' }, { status: 403 });
    }

    const emailFinal = email.trim().toLowerCase();

    let userId: string | null = null;
    let status: 'adicionado' | 'criado';

    // 1. Tenta criar a conta de auth já com a senha definida
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email:         emailFinal,
      password:      senha,
      email_confirm: true,
      user_metadata: { nome: nome.trim() },
    });

    if (authError) {
      if (authError.message.toLowerCase().includes('already')) {
        // Já existe conta com esse e-mail — só vincula à empresa, não mexe na senha dela.
        const { data: existing } = await adminClient
          .from('users')
          .select('id')
          .eq('email', emailFinal)
          .maybeSingle();
        if (!existing) {
          return NextResponse.json({ error: 'Usuário já existe, mas não foi possível localizá-lo.' }, { status: 400 });
        }
        userId = existing.id;
        status = 'adicionado';
      } else {
        return NextResponse.json({ error: 'Não foi possível criar a conta de acesso. Confira o e-mail e a senha.' }, { status: 400 });
      }
    } else {
      userId = authData.user.id;
      status = 'criado';
    }

    // 2. Perfil em public.users só para conta criada agora. Conta que já existia ("adicionado") mantém
    //    nome e telefone como estão — o perfil é global e vale nas outras empresas da pessoa.
    if (status === 'criado') {
      await adminClient.from('users').upsert({
        id:       userId,
        nome:     nome.trim(),
        telefone: telefone?.trim() || null,
        email:    emailFinal,
      }, { onConflict: 'id' });
    }

    // 3. Vínculo com a empresa: preserva papel, comissão e contrato de quem já era da equipe.
    const { data: existente, error: errExistente } = await adminClient
      .from('empresa_membros')
      .select('id, role, percentual_comissao, tipo_contrato')
      .eq('empresa_id', empresaId)
      .eq('user_id', userId!)
      .maybeSingle();
    if (errExistente) {
      return NextResponse.json({ error: 'Não foi possível ler o vínculo atual. Tente de novo.' }, { status: 500 });
    }

    const atual = existente as { role: string; percentual_comissao: number; tipo_contrato: TipoContrato | null } | null;
    if (atual) {
      // Já é da equipe: mesma regra do PATCH (a gestora não mexe na dona, em outra gestora nem em si mesma,
      // e não reativa quem não pode gerenciar).
      const { data: emp, error: errEmp } = await adminClient.from('empresas').select('owner_id').eq('id', empresaId).maybeSingle();
      if (errEmp) return NextResponse.json({ error: ERRO_INTERNO }, { status: 500 });
      const roleAlvo = (emp as { owner_id?: string } | null)?.owner_id === userId ? 'owner' : atual.role;
      if (!podeGerenciarMembro({ isOwner: permsReq.isOwner, userId: requesterId }, true, { role: roleAlvo, userId: userId! })) {
        return NextResponse.json({ error: ERRO_GERENCIAR_MEMBRO }, { status: 403 });
      }
    }
    const v = vinculoParaGravar(atual, { percentual_comissao, tipo_contrato });
    if ('erro' in v) return NextResponse.json({ error: v.erro }, { status: 400 });

    const { data: membro, error: membroError } = await adminClient
      .from('empresa_membros')
      .upsert({
        empresa_id:          empresaId,
        user_id:             userId,
        role:                atual?.role ?? roleSolicitado,
        percentual_comissao: v.valores.percentual_comissao,
        tipo_contrato:       v.valores.tipo_contrato,
        ativo:               true,
      }, { onConflict: 'empresa_id,user_id' })
      .select('id, user_id, role, percentual_comissao, tipo_contrato, ativo, created_at, user:users(id, nome, telefone, email)')
      .single();

    if (membroError) {
      return NextResponse.json({ error: 'Não foi possível vincular a profissional à empresa.' }, { status: 400 });
    }

    return NextResponse.json({ status, membro });
  } catch {
    return NextResponse.json({ error: ERRO_INTERNO }, { status: 500 });
  }
}

/**
 * Edita uma pessoa da equipe (web e app via Bearer). Corpo:
 * `{ empresaId, userId, membroId, nome?, telefone?, email?, percentual_comissao?, tipo_contrato? }`.
 * Só mexe em vínculo e usuário da empresa informada. Trocar o e-mail troca também o login (Auth), e o
 * Auth é trocado antes de `users` — se `users` falhar depois, o e-mail antigo volta no Auth.
 */
export async function PATCH(req: NextRequest) {
  try {
    const corpo = await req.json();
    const { empresaId, userId, membroId, nome, telefone, email } = corpo as Record<string, unknown>;

    if (!empresaId || typeof empresaId !== 'string' || !userId || typeof userId !== 'string'
      || !membroId || typeof membroId !== 'string') {
      return NextResponse.json({ error: 'Empresa, pessoa e vínculo são obrigatórios.' }, { status: 400 });
    }
    // nome ausente ou null = não veio; só texto vazio é erro.
    if (nome !== undefined && nome !== null && (typeof nome !== 'string' || !nome.trim())) {
      return NextResponse.json({ error: 'O nome não pode ficar vazio.' }, { status: 400 });
    }
    if (telefone !== undefined && telefone !== null && typeof telefone !== 'string') {
      return NextResponse.json({ error: 'Telefone inválido.' }, { status: 400 });
    }
    // E-mail vazio/nulo = não troca (o login nunca fica sem e-mail).
    let emailNovo: string | null = null;
    if (email !== undefined && email !== null && email !== '') {
      if (typeof email !== 'string' || !emailValido(email)) {
        return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
      }
      emailNovo = email.trim().toLowerCase();
    }
    const vinculo = montarPatchVinculo(corpo);
    if ('erro' in vinculo) return NextResponse.json({ error: vinculo.erro }, { status: 400 });

    const adminClient = createAdminClient();
    const requesterId = await quemChama(req, adminClient);
    if (!requesterId) return NextResponse.json({ error: ERRO_SESSAO }, { status: 401 });

    // Quem chama: membro ativo da empresa informada ou a dona.
    const [rDona, rReq, rAlvo] = await Promise.all([
      adminClient.from('empresas').select('owner_id').eq('id', empresaId).maybeSingle(),
      adminClient.from('empresa_membros').select('id')
        .eq('empresa_id', empresaId).eq('user_id', requesterId).eq('ativo', true).maybeSingle(),
      adminClient.from('empresa_membros').select('id, role')
        .eq('empresa_id', empresaId).eq('user_id', userId).maybeSingle(),
    ]);
    if (rDona.error || rReq.error || rAlvo.error) {
      return NextResponse.json({ error: ERRO_INTERNO }, { status: 500 });
    }
    const ownerId = (rDona.data as { owner_id?: string } | null)?.owner_id;
    if (!ownerId) return NextResponse.json({ error: ERRO_EMPRESA }, { status: 403 });
    if (!rReq.data && ownerId !== requesterId) {
      return NextResponse.json({ error: ERRO_EMPRESA }, { status: 403 });
    }

    const permsReq = await carregarPermissoesDoMembro(adminClient, empresaId, requesterId);
    if (!permsReq || !pode(permsReq, 'equipe.gerenciar')) {
      return NextResponse.json({ error: ERRO_SEM_PERMISSAO }, { status: 403 });
    }

    // O alvo precisa ter vínculo nesta empresa, e membroId precisa ser exatamente esse vínculo.
    const alvo = rAlvo.data as { id: string; role: string } | null;
    if (!alvo || alvo.id !== membroId) {
      return NextResponse.json({ error: 'Esta pessoa não faz parte desta empresa.' }, { status: 403 });
    }

    // Mesma regra da policy de UPDATE de empresa_membros (083): quem não é a dona só mexe em
    // profissionais que não sejam ela mesma (nunca na dona, em outra gestora ou no próprio vínculo).
    const roleAlvo = ownerId === userId ? 'owner' : alvo.role;
    if (!podeGerenciarMembro({ isOwner: permsReq.isOwner, userId: requesterId }, true, { role: roleAlvo, userId })) {
      return NextResponse.json({ error: ERRO_GERENCIAR_MEMBRO }, { status: 403 });
    }

    // E-mail: compara com o login real (Auth), não com users.email (que pode estar divergente).
    let emailAntigoAuth: string | null = null;
    let emailMudou = false;
    if (emailNovo) {
      const { data: authAtual, error: errAuthAtual } = await adminClient.auth.admin.getUserById(userId);
      if (errAuthAtual || !authAtual?.user) {
        return NextResponse.json({ error: 'Não foi possível conferir a conta desta pessoa.' }, { status: 400 });
      }
      emailAntigoAuth = authAtual.user.email ?? null;
      emailMudou = emailNovo !== (emailAntigoAuth ?? '').trim().toLowerCase();
    }

    if (emailMudou) {
      // A conta do Auth é global: trocar o login de quem também está em outra empresa (ou é dona de
      // alguma) permitiria sequestrar essa conta. Só a dona troca, e só para contas usadas só aqui.
      if (!permsReq.isOwner) {
        return NextResponse.json({ error: ERRO_TROCA_EMAIL_LOGIN }, { status: 409 });
      }
      const [rOutras, rDonaDeAlguma] = await Promise.all([
        adminClient.from('empresa_membros').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).neq('empresa_id', empresaId),
        adminClient.from('empresas').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
      ]);
      if (rOutras.error || rDonaDeAlguma.error) return NextResponse.json({ error: ERRO_INTERNO }, { status: 500 });
      if ((rOutras.count ?? 0) > 0 || (rDonaDeAlguma.count ?? 0) > 0) {
        return NextResponse.json({ error: ERRO_TROCA_EMAIL_LOGIN }, { status: 409 });
      }

      const { data: outro, error: errOutro } = await adminClient
        .from('users').select('id').ilike('email', escaparLike(emailNovo!)).neq('id', userId).limit(1);
      if (errOutro) return NextResponse.json({ error: ERRO_INTERNO }, { status: 500 });
      if ((outro ?? []).length > 0) {
        return NextResponse.json({ error: 'Este e-mail já é usado por outra conta.' }, { status: 409 });
      }
    }

    // ── Daqui para baixo, escritas (todas as conferências já passaram) ──

    // 1. Auth (e-mail de login), só se mudou.
    let trocouEmail = false;
    if (emailMudou) {
      const { error: errAuth } = await adminClient.auth.admin.updateUserById(userId, { email: emailNovo!, email_confirm: true });
      if (errAuth) {
        const t = traduzirErroEmailAuth(errAuth.message);
        return NextResponse.json({ error: t.error }, { status: t.status });
      }
      trocouEmail = true;
    }

    // 2. Perfil em public.users (só o que veio).
    const dadosUsuario: Record<string, string | null> = {};
    if (typeof nome === 'string') dadosUsuario.nome = nome.trim();
    if (telefone !== undefined) dadosUsuario.telefone = typeof telefone === 'string' ? telefone.trim() || null : null;
    // users.email acompanha o Auth: grava quando o login foi trocado agora, ou quando o e-mail pedido já é
    // o login (alinha contas que ficaram divergentes antes). Nunca grava um e-mail diferente do login.
    if (emailNovo && (trocouEmail || !emailMudou)) dadosUsuario.email = emailNovo;

    if (Object.keys(dadosUsuario).length > 0) {
      const { error } = await adminClient.from('users').update(dadosUsuario).eq('id', userId);
      if (error) {
        let desfeito = !trocouEmail;
        if (trocouEmail && emailAntigoAuth) {
          // Desfaz a troca do login para Auth e users não ficarem divergentes.
          const { error: errVolta } = await adminClient.auth.admin.updateUserById(userId, { email: emailAntigoAuth, email_confirm: true });
          desfeito = !errVolta;
        }
        return NextResponse.json({
          error: desfeito
            ? 'Não foi possível salvar os dados da pessoa. Nada foi alterado.'
            : 'Não foi possível salvar os dados da pessoa, e o e-mail de login já tinha sido trocado. Confira o e-mail e tente de novo.',
        }, { status: 400 });
      }
    }

    if (typeof nome === 'string') {
      await adminClient.auth.admin.updateUserById(userId, { user_metadata: { nome: nome.trim() } });
    }

    // 3. Vínculo (comissão/contrato), só os campos que vieram.
    if (Object.keys(vinculo.patch).length > 0) {
      const { error: errMembro } = await adminClient
        .from('empresa_membros')
        .update(vinculo.patch)
        .eq('id', membroId)
        .eq('user_id', userId)
        // Só o vínculo da pessoa conferida acima, na empresa onde a permissão foi conferida.
        .eq('empresa_id', empresaId);
      if (errMembro) {
        const salvos = [
          dadosUsuario.nome !== undefined || dadosUsuario.telefone !== undefined ? 'Nome e contato' : null,
          trocouEmail ? 'e-mail de login' : null,
        ].filter(Boolean).join(' e ');
        return NextResponse.json({
          error: salvos
            ? `${salvos} salvos, mas a comissão/contrato não foi salva. Tente de novo.`
            : 'A comissão/contrato não foi salva. Nada foi alterado. Tente de novo.',
        }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: ERRO_INTERNO }, { status: 500 });
  }
}
