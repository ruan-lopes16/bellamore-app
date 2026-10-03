-- ============================================================
-- 083 — Permissões configuráveis por papel e por pessoa
-- ============================================================
-- Spec: docs/superpowers/specs/2026-10-02-permissoes-configuraveis-design.md
-- Estado de partida: pg_policies de produção lido em 2026-10-02
--   (docs/superpowers/notes/2026-10-02-pg-policies-producao.csv) + migrations 080, 081, 082.
-- ORDEM OBRIGATÓRIA no SQL Editor: 080 → 081 → 082 → 083 (esta recria policies criadas lá).
--
-- O que faz:
--  1. Catálogo em SQL (permissoes_chaves / permissao_padrao) — espelho de shared/permissoes.ts,
--     travado pelo teste web/tests/unit/permissoes-migration.test.ts.
--  2. Tabelas permissoes_papel, permissoes_membro, permissoes_historico (só SELECT via RLS;
--     escrita só pela função salvar_permissoes).
--  3. tem_permissao(empresa, chave): dona → exceção da pessoa → papel → padrão.
--  4. minhas_permissoes(empresa) e salvar_permissoes(empresa, mudancas).
--  5. Trigger: mudar o papel de alguém em empresa_membros continua só com a dona.
--  6. Policies dos itens "Banco" do catálogo trocam is_gestor_ou_owner por tem_permissao,
--     com o MESMO nome e o resto da condição idêntico. Sem linhas gravadas, tem_permissao
--     devolve os padrões = comportamento de antes, então nada muda no dia em que roda.
--
-- Rollback: recriar as policies listadas abaixo exatamente como estão no CSV de 2026-10-02
-- (mais 080/081/082), e então:
--   drop trigger if exists trg_membros_papel_so_dona on public.empresa_membros;
--   drop function if exists public.fn_membros_papel_so_dona();
--   drop function if exists public.salvar_permissoes(uuid, jsonb);
--   drop function if exists public.minhas_permissoes(uuid);
--   drop table if exists public.permissoes_historico, public.permissoes_membro, public.permissoes_papel;
--   drop function if exists public.tem_permissao(uuid, text);
--   drop function if exists public.permissao_padrao(text, text);
--   drop function if exists public.permissoes_chaves();
--   (clientes.criado_por pode ficar — é nullable e só é lida pela policy de SELECT)
--   O trigger de clientes.ativo volta ao corpo da 081 (is_gestor_ou_owner).
--
-- Notas: (1) remover uma chave do catálogo numa migration futura exige apagar as linhas dela
-- em permissoes_papel/permissoes_membro (o CHECK não revalida linhas antigas). (2) Clientes
-- cadastradas antes da 083 ficam com criado_por NULL: com "clientes.ver_todas" desligado, a
-- profissional só as vê se já tiver atendido.

-- ── 1. Catálogo ───────────────────────────────────────────────

create or replace function public.permissoes_chaves()
returns text[] language sql immutable as $$
  select array[ -- @chaves
    'agenda.ver_equipe', 'agenda.gerenciar_outras', 'agenda.excluir', 'agenda.aprovar_bloqueios',
    'clientes.ver_todas', 'clientes.cadastrar', 'clientes.editar', 'clientes.arquivar', 'clientes.excluir',
    'anamnese.ver', 'anamnese.editar',
    'comanda.fechar', 'comanda.desconto', 'comanda.editar_fechada',
    'vendas.acessar',
    'servicos.gerenciar', 'pacotes.gerenciar', 'pacotes.vender',
    'estoque.acessar',
    'financeiro.ver', 'despesas.gerenciar', 'taxas.marcar_pagas', 'financeiro.fechamentos',
    'equipe.gerenciar', 'comissoes.ver_todas', 'comissoes.pagar',
    'config.taxas'
  ]::text[];
$$;

create or replace function public.permissao_padrao(p_papel text, p_chave text)
returns boolean language sql immutable as $$
  select p_chave = any (public.permissoes_chaves()) and case p_papel
    when 'gestor' then not (p_chave = any (array[ -- @padrao-gestor-negado
      'clientes.excluir'
    ]::text[]))
    when 'profissional' then p_chave = any (array[ -- @padrao-profissional
      'clientes.ver_todas', 'clientes.cadastrar', 'clientes.editar', 'anamnese.ver', 'anamnese.editar',
      'comanda.fechar', 'comanda.desconto', 'comanda.editar_fechada', 'pacotes.vender'
    ]::text[])
    else false
  end;
$$;

-- ── 2. Tabelas ────────────────────────────────────────────────

create table if not exists public.permissoes_papel (
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  papel       text not null check (papel in ('gestor', 'profissional')),
  chave       text not null check (chave = any (public.permissoes_chaves())),
  permitido   boolean not null,
  alterado_por uuid,
  alterado_em timestamptz not null default now(),
  primary key (empresa_id, papel, chave)
);

create table if not exists public.permissoes_membro (
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  user_id     uuid not null,
  chave       text not null check (chave = any (public.permissoes_chaves())),
  permitido   boolean not null,
  alterado_por uuid,
  alterado_em timestamptz not null default now(),
  primary key (empresa_id, user_id, chave)
);

create table if not exists public.permissoes_historico (
  id           uuid primary key default uuid_generate_v4(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  alterado_por uuid,
  alvo_tipo    text not null check (alvo_tipo in ('papel', 'membro')),
  alvo         text not null,
  chave        text not null,
  de           boolean,
  para         boolean,
  criado_em    timestamptz not null default now()
);
create index if not exists idx_permissoes_historico_empresa
  on public.permissoes_historico (empresa_id, criado_em desc);

alter table public.permissoes_papel enable row level security;
alter table public.permissoes_membro enable row level security;
alter table public.permissoes_historico enable row level security;

drop policy if exists "permissoes_papel: membro ve" on public.permissoes_papel;
create policy "permissoes_papel: membro ve" on public.permissoes_papel for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "permissoes_membro: membro ve" on public.permissoes_membro;
create policy "permissoes_membro: membro ve" on public.permissoes_membro for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "permissoes_historico: membro ve" on public.permissoes_historico;
create policy "permissoes_historico: membro ve" on public.permissoes_historico for select
  using (empresa_id in (select minha_empresas()));

-- ── 3. tem_permissao ──────────────────────────────────────────

create or replace function public.tem_permissao(p_empresa uuid, p_chave text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_papel text;
  v_val   boolean;
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.empresas where id = p_empresa and owner_id = auth.uid()) then
    return true;
  end if;
  select role::text into v_papel from public.empresa_membros
    where empresa_id = p_empresa and user_id = auth.uid() and ativo = true
    limit 1;
  if v_papel is null then return false; end if;
  if v_papel = 'owner' then return true; end if;

  select permitido into v_val from public.permissoes_membro
    where empresa_id = p_empresa and user_id = auth.uid() and chave = p_chave;
  if found then return v_val; end if;

  select permitido into v_val from public.permissoes_papel
    where empresa_id = p_empresa and papel = v_papel and chave = p_chave;
  if found then return v_val; end if;

  return public.permissao_padrao(v_papel, p_chave);
end;
$$;

-- ── 4. minhas_permissoes / salvar_permissoes ──────────────────

create or replace function public.minhas_permissoes(p_empresa uuid)
returns table (chave text, permitido boolean)
language sql stable security definer set search_path = public
as $$
  select c, public.tem_permissao(p_empresa, c) from unnest(public.permissoes_chaves()) as c;
$$;
grant execute on function public.minhas_permissoes(uuid) to authenticated;

/*
 * p_mudancas: [{ "tipo": "papel"|"membro", "alvo": "<papel ou user_id>", "chave": "...",
 *                "permitido": true|false|null }]   (null só para membro = volta ao padrão)
 * Dona: tudo (menos a própria dona como alvo). Gestora: só papel 'profissional' e membros
 * 'profissional' que não sejam ela. Demais: recusa. Tudo numa transação, com histórico.
 */
create or replace function public.salvar_permissoes(p_empresa uuid, p_mudancas jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_owner        boolean;
  v_papel_editor text;
  m              jsonb;
  v_tipo         text;
  v_alvo         text;
  v_chave        text;
  v_para         boolean;
  v_de           boolean;
  v_alvo_user    uuid;
  v_alvo_papel   text;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida' using errcode = '42501';
  end if;
  v_owner := exists (select 1 from public.empresas where id = p_empresa and owner_id = auth.uid());
  select role::text into v_papel_editor from public.empresa_membros
    where empresa_id = p_empresa and user_id = auth.uid() and ativo = true limit 1;
  if v_papel_editor = 'owner' then v_owner := true; end if;
  if not v_owner and coalesce(v_papel_editor, '') <> 'gestor' then
    raise exception 'Só a dona ou a gestora pode alterar permissões' using errcode = '42501';
  end if;

  for m in select * from jsonb_array_elements(coalesce(p_mudancas, '[]'::jsonb)) loop
    v_tipo  := m->>'tipo';
    v_alvo  := m->>'alvo';
    v_chave := m->>'chave';
    v_para  := case when m->'permitido' is null or jsonb_typeof(m->'permitido') = 'null'
                    then null else (m->>'permitido')::boolean end;

    if v_chave is null or not (v_chave = any (public.permissoes_chaves())) then
      raise exception 'Permissão desconhecida: %', v_chave using errcode = '22023';
    end if;

    if v_tipo = 'papel' then
      if v_alvo is null or v_alvo not in ('gestor', 'profissional') then
        raise exception 'Papel inválido: %', v_alvo using errcode = '22023';
      end if;
      if not v_owner and v_alvo <> 'profissional' then
        raise exception 'A gestora só altera o papel Profissional' using errcode = '42501';
      end if;
      if v_para is null then
        raise exception 'Permissão do papel precisa ser ligada ou desligada' using errcode = '22023';
      end if;
      select permitido into v_de from public.permissoes_papel
        where empresa_id = p_empresa and papel = v_alvo and chave = v_chave;
      if not found then v_de := public.permissao_padrao(v_alvo, v_chave); end if;
      if v_de is distinct from v_para then
        insert into public.permissoes_papel (empresa_id, papel, chave, permitido, alterado_por, alterado_em)
          values (p_empresa, v_alvo, v_chave, v_para, auth.uid(), now())
          on conflict (empresa_id, papel, chave)
          do update set permitido = excluded.permitido, alterado_por = excluded.alterado_por, alterado_em = now();
        insert into public.permissoes_historico (empresa_id, alterado_por, alvo_tipo, alvo, chave, de, para)
          values (p_empresa, auth.uid(), 'papel', v_alvo, v_chave, v_de, v_para);
      end if;

    elsif v_tipo = 'membro' then
      v_alvo_user := v_alvo::uuid;
      select role::text into v_alvo_papel from public.empresa_membros
        where empresa_id = p_empresa and user_id = v_alvo_user limit 1;
      if v_alvo_papel is null
         or v_alvo_papel = 'owner'
         or exists (select 1 from public.empresas where id = p_empresa and owner_id = v_alvo_user) then
        raise exception 'Membro inválido para exceção' using errcode = '22023';
      end if;
      if not v_owner and (v_alvo_papel <> 'profissional' or v_alvo_user = auth.uid()) then
        raise exception 'A gestora só altera exceções de profissionais (e nunca as próprias)' using errcode = '42501';
      end if;
      select permitido into v_de from public.permissoes_membro
        where empresa_id = p_empresa and user_id = v_alvo_user and chave = v_chave;
      if not found then v_de := null; end if;
      if v_de is distinct from v_para then
        if v_para is null then
          delete from public.permissoes_membro
            where empresa_id = p_empresa and user_id = v_alvo_user and chave = v_chave;
        else
          insert into public.permissoes_membro (empresa_id, user_id, chave, permitido, alterado_por, alterado_em)
            values (p_empresa, v_alvo_user, v_chave, v_para, auth.uid(), now())
            on conflict (empresa_id, user_id, chave)
            do update set permitido = excluded.permitido, alterado_por = excluded.alterado_por, alterado_em = now();
        end if;
        insert into public.permissoes_historico (empresa_id, alterado_por, alvo_tipo, alvo, chave, de, para)
          values (p_empresa, auth.uid(), 'membro', v_alvo, v_chave, v_de, v_para);
      end if;

    else
      raise exception 'Tipo de mudança inválido: %', v_tipo using errcode = '22023';
    end if;
  end loop;
end;
$$;
grant execute on function public.salvar_permissoes(uuid, jsonb) to authenticated;

-- ── 5. Mudar papel de alguém: só a dona ───────────────────────
-- Rede de segurança: o trigger trg_bloquear_alteracao_role (043) já barra isso; este garante
-- a regra mesmo que a 043 seja alterada. "equipe.gerenciar" nunca permite promover alguém.

create or replace function public.fn_membros_papel_so_dona()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not exists (select 1 from public.empresas where id = old.empresa_id and owner_id = auth.uid()) then
    raise exception 'Só a dona pode mudar o papel de alguém' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_membros_papel_so_dona on public.empresa_membros;
create trigger trg_membros_papel_so_dona
  before update of role on public.empresa_membros
  for each row execute function public.fn_membros_papel_so_dona();

-- ── 6. Policies ───────────────────────────────────────────────

-- clientes (006 + 081)
alter table public.clientes add column if not exists criado_por uuid default auth.uid();
create index if not exists idx_agendamentos_cliente_profissional
  on public.agendamentos (cliente_id, profissional_id);

drop policy if exists "clientes: membro ve" on public.clientes;
create policy "clientes: membro ve" on public.clientes for select using (
  empresa_id in (select minha_empresas())
  and (
    tem_permissao(empresa_id, 'clientes.ver_todas')
    or criado_por = auth.uid()
    or exists (select 1 from public.agendamentos a
               where a.cliente_id = clientes.id and a.profissional_id = auth.uid())
  )
);
drop policy if exists "clientes: membro pode inserir" on public.clientes;
create policy "clientes: membro pode inserir" on public.clientes for insert
  with check (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'clientes.cadastrar'));
drop policy if exists "clientes: membro pode atualizar" on public.clientes;
create policy "clientes: membro pode atualizar" on public.clientes for update
  using (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'clientes.editar'))
  with check (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'clientes.editar'));
drop policy if exists "clientes: owner pode deletar" on public.clientes;
drop policy if exists "clientes: excluir" on public.clientes;
create policy "clientes: excluir" on public.clientes for delete
  using (tem_permissao(empresa_id, 'clientes.excluir'));

create or replace function public.fn_clientes_ativo_so_gestor()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.ativo is distinct from old.ativo
     and auth.uid() is not null
     and not tem_permissao(old.empresa_id, 'clientes.arquivar') then
    raise exception 'Sem permissão para arquivar ou reativar cliente' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- agendamentos (042 + 066 + 082)
drop policy if exists "agendamentos: ver" on public.agendamentos;
create policy "agendamentos: ver" on public.agendamentos for select using (
  profissional_id = auth.uid()
  or cliente_id = auth.uid()
  or (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'agenda.ver_equipe'))
);
drop policy if exists "agendamentos: equipe insere" on public.agendamentos;
create policy "agendamentos: equipe insere" on public.agendamentos for insert with check (
  empresa_id in (select minha_empresas())
  and (tem_permissao(empresa_id, 'agenda.gerenciar_outras') or profissional_id = auth.uid())
);
drop policy if exists "agendamentos: equipe atualiza" on public.agendamentos;
create policy "agendamentos: equipe atualiza" on public.agendamentos for update
  using (
    empresa_id in (select minha_empresas())
    and (tem_permissao(empresa_id, 'agenda.gerenciar_outras') or profissional_id = auth.uid())
  )
  with check (
    empresa_id in (select minha_empresas())
    and (tem_permissao(empresa_id, 'agenda.gerenciar_outras') or profissional_id = auth.uid())
  );
drop policy if exists "agendamentos: gestor ou owner exclui" on public.agendamentos;
create policy "agendamentos: gestor ou owner exclui" on public.agendamentos for delete
  using (tem_permissao(empresa_id, 'agenda.excluir'));

-- agenda_bloqueios (068, conforme produção)
drop policy if exists "bloqueios: aprovar" on public.agenda_bloqueios;
create policy "bloqueios: aprovar" on public.agenda_bloqueios for update
  using (tem_permissao(empresa_id, 'agenda.aprovar_bloqueios'))
  with check (tem_permissao(empresa_id, 'agenda.aprovar_bloqueios'));
drop policy if exists "bloqueios: criar" on public.agenda_bloqueios;
create policy "bloqueios: criar" on public.agenda_bloqueios for insert with check (
  empresa_id in (select minha_empresas())
  and (
    tem_permissao(empresa_id, 'agenda.aprovar_bloqueios')
    or (escopo = 'profissional' and profissional_id = auth.uid() and criado_por = auth.uid()
        and situacao = 'pendente' and motivo is not null)
  )
);
drop policy if exists "bloqueios: excluir" on public.agenda_bloqueios;
create policy "bloqueios: excluir" on public.agenda_bloqueios for delete using (
  tem_permissao(empresa_id, 'agenda.aprovar_bloqueios')
  or (criado_por = auth.uid() and situacao = 'pendente')
);
drop policy if exists "bloqueios: ver" on public.agenda_bloqueios;
create policy "bloqueios: ver" on public.agenda_bloqueios for select using (
  empresa_id in (select minha_empresas())
  and (situacao = 'aprovado' or criado_por = auth.uid() or tem_permissao(empresa_id, 'agenda.aprovar_bloqueios'))
);

-- anamnese_fichas (080)
drop policy if exists "anamnese: ver" on public.anamnese_fichas;
create policy "anamnese: ver" on public.anamnese_fichas for select
  using (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'anamnese.ver'));
drop policy if exists "anamnese: inserir" on public.anamnese_fichas;
create policy "anamnese: inserir" on public.anamnese_fichas for insert with check (
  empresa_id in (select minha_empresas())
  and tem_permissao(empresa_id, 'anamnese.editar')
  and cliente_id in (select id from public.clientes where empresa_id in (select minha_empresas()))
);
drop policy if exists "anamnese: atualizar" on public.anamnese_fichas;
create policy "anamnese: atualizar" on public.anamnese_fichas for update
  using (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'anamnese.editar'))
  with check (
    empresa_id in (select minha_empresas())
    and tem_permissao(empresa_id, 'anamnese.editar')
    and cliente_id in (select id from public.clientes where empresa_id in (select minha_empresas()))
  );

-- comandas (073): fechar = criar a comanda
drop policy if exists "comandas: membro insere" on public.comandas;
create policy "comandas: membro insere" on public.comandas for insert
  with check (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'comanda.fechar'));

-- servicos + categorias (078, 063)
drop policy if exists "servicos: gestor gerencia" on public.servicos;
create policy "servicos: gestor gerencia" on public.servicos for all
  using (tem_permissao(empresa_id, 'servicos.gerenciar'))
  with check (tem_permissao(empresa_id, 'servicos.gerenciar'));
drop policy if exists "categorias_servico: gestor insere" on public.categorias_servico;
create policy "categorias_servico: gestor insere" on public.categorias_servico for insert
  with check (tem_permissao(empresa_id, 'servicos.gerenciar'));
drop policy if exists "categorias_servico: gestor atualiza" on public.categorias_servico;
create policy "categorias_servico: gestor atualiza" on public.categorias_servico for update
  using (tem_permissao(empresa_id, 'servicos.gerenciar'))
  with check (tem_permissao(empresa_id, 'servicos.gerenciar'));
drop policy if exists "categorias_servico: gestor deleta" on public.categorias_servico;
create policy "categorias_servico: gestor deleta" on public.categorias_servico for delete
  using (tem_permissao(empresa_id, 'servicos.gerenciar'));

-- pacotes (078)
drop policy if exists "pacotes: gestor gerencia" on public.pacotes;
create policy "pacotes: gestor gerencia" on public.pacotes for all
  using (tem_permissao(empresa_id, 'pacotes.gerenciar'))
  with check (tem_permissao(empresa_id, 'pacotes.gerenciar'));
drop policy if exists "pacote_servicos: gestor gerencia" on public.pacote_servicos;
create policy "pacote_servicos: gestor gerencia" on public.pacote_servicos for all
  using (exists (select 1 from public.pacotes p
                 where p.id = pacote_servicos.pacote_id and tem_permissao(p.empresa_id, 'pacotes.gerenciar')))
  with check (exists (select 1 from public.pacotes p
                      where p.id = pacote_servicos.pacote_id and tem_permissao(p.empresa_id, 'pacotes.gerenciar')));

-- pacote_clientes: era "membro gerencia" FOR ALL; só a venda (INSERT) passa a depender da chave
drop policy if exists "pacote_clientes: membro gerencia" on public.pacote_clientes;
drop policy if exists "pacote_clientes: membro ve" on public.pacote_clientes;
create policy "pacote_clientes: membro ve" on public.pacote_clientes for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "pacote_clientes: vender" on public.pacote_clientes;
create policy "pacote_clientes: vender" on public.pacote_clientes for insert
  with check (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'pacotes.vender'));
drop policy if exists "pacote_clientes: membro atualiza" on public.pacote_clientes;
create policy "pacote_clientes: membro atualiza" on public.pacote_clientes for update
  using (empresa_id in (select minha_empresas()))
  with check (empresa_id in (select minha_empresas()));
drop policy if exists "pacote_clientes: membro exclui" on public.pacote_clientes;
create policy "pacote_clientes: membro exclui" on public.pacote_clientes for delete
  using (empresa_id in (select minha_empresas()));

-- despesas (042 + 003). DELETE continua só da dona (fora do catálogo).
drop policy if exists "despesas: gestor ou owner ve" on public.despesas;
create policy "despesas: gestor ou owner ve" on public.despesas for select
  using (tem_permissao(empresa_id, 'financeiro.ver'));
drop policy if exists "despesas: gestor pode inserir" on public.despesas;
create policy "despesas: gestor pode inserir" on public.despesas for insert
  with check (tem_permissao(empresa_id, 'despesas.gerenciar'));
drop policy if exists "despesas: gestor pode atualizar" on public.despesas;
create policy "despesas: gestor pode atualizar" on public.despesas for update
  using (tem_permissao(empresa_id, 'despesas.gerenciar'))
  with check (tem_permissao(empresa_id, 'despesas.gerenciar'));

-- taxas_reserva (054 + 058). SELECT também para quem gerencia agenda de outras: a comanda
-- lê as taxas pagas para descontar (bug de 2026-08-12 — sem leitura o desconto zera calado).
drop policy if exists "taxas_reserva: profissional ou gestor ve" on public.taxas_reserva;
create policy "taxas_reserva: profissional ou gestor ve" on public.taxas_reserva for select using (
  tem_permissao(empresa_id, 'financeiro.ver')
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras')
  or exists (select 1 from public.agendamentos a
             where a.id = taxas_reserva.agendamento_id and a.profissional_id = auth.uid())
);
drop policy if exists "taxas_reserva: gestor ou owner atualiza" on public.taxas_reserva;
create policy "taxas_reserva: gestor ou owner atualiza" on public.taxas_reserva for update
  using (tem_permissao(empresa_id, 'taxas.marcar_pagas'))
  with check (tem_permissao(empresa_id, 'taxas.marcar_pagas'));

-- taxas_cancelamento (047)
drop policy if exists "taxas_cancelamento: gestor ou owner ve" on public.taxas_cancelamento;
create policy "taxas_cancelamento: gestor ou owner ve" on public.taxas_cancelamento for select
  using (tem_permissao(empresa_id, 'financeiro.ver'));
drop policy if exists "taxas_cancelamento: gestor ou owner atualiza" on public.taxas_cancelamento;
create policy "taxas_cancelamento: gestor ou owner atualiza" on public.taxas_cancelamento for update
  using (tem_permissao(empresa_id, 'taxas.marcar_pagas'))
  with check (tem_permissao(empresa_id, 'taxas.marcar_pagas'));

-- financeiro_ajustes_mensais (040). DELETE continua só da dona.
drop policy if exists "financeiro_ajustes_mensais: gestor pode inserir" on public.financeiro_ajustes_mensais;
create policy "financeiro_ajustes_mensais: gestor pode inserir" on public.financeiro_ajustes_mensais for insert
  with check (tem_permissao(empresa_id, 'financeiro.fechamentos'));
drop policy if exists "financeiro_ajustes_mensais: gestor pode atualizar" on public.financeiro_ajustes_mensais;
create policy "financeiro_ajustes_mensais: gestor pode atualizar" on public.financeiro_ajustes_mensais for update
  using (tem_permissao(empresa_id, 'financeiro.fechamentos'))
  with check (tem_permissao(empresa_id, 'financeiro.fechamentos'));

-- empresa_membros (043, conforme produção)
drop policy if exists "membros: gestor ou owner atualiza" on public.empresa_membros;
create policy "membros: gestor ou owner atualiza" on public.empresa_membros for update
  using (tem_permissao(empresa_id, 'equipe.gerenciar'))
  with check (tem_permissao(empresa_id, 'equipe.gerenciar'));
drop policy if exists "membros: gestor ou owner convida" on public.empresa_membros;
create policy "membros: gestor ou owner convida" on public.empresa_membros for insert with check (
  role = any (array['gestor'::perfil_role, 'profissional'::perfil_role])
  and tem_permissao(empresa_id, 'equipe.gerenciar')
  and (role = 'profissional'::perfil_role
       or exists (select 1 from public.empresas
                  where empresas.id = empresa_membros.empresa_id and empresas.owner_id = auth.uid()))
);

-- comissoes (042)
drop policy if exists "comissoes: ver" on public.comissoes;
create policy "comissoes: ver" on public.comissoes for select
  using (profissional_id = auth.uid() or tem_permissao(empresa_id, 'comissoes.ver_todas'));
drop policy if exists "comissoes: gestor ou owner atualiza" on public.comissoes;
create policy "comissoes: gestor ou owner atualiza" on public.comissoes for update
  using (tem_permissao(empresa_id, 'comissoes.pagar'))
  with check (tem_permissao(empresa_id, 'comissoes.pagar'));

notify pgrst, 'reload schema';
