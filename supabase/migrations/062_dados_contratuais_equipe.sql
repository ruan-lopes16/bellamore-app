-- ============================================================
-- DADOS CONTRATUAIS DA EQUIPE
-- Tipo de contrato (CLT/PJ/Autônomo), CPF ou CNPJ conforme o tipo,
-- data de admissão, e documento assinado em arquivo (contrato/CNPJ),
-- guardados por membro da empresa (profissional ou gestora).
-- ============================================================

alter table public.empresa_membros
  add column if not exists tipo_contrato text
    check (tipo_contrato in ('clt', 'pj', 'autonomo')),
  add column if not exists documento              text,        -- CPF (CLT/autônomo) ou CNPJ (PJ), já mascarado
  add column if not exists data_admissao           date,
  add column if not exists contrato_arquivo_path   text;        -- caminho no bucket privado abaixo, não URL pública

-- Escrita continua só pela API /api/profissionais (client admin, já checa
-- gestor/owner manualmente) — mesmo padrão já usado por percentual_comissao,
-- então nenhuma policy nova de UPDATE é necessária em empresa_membros aqui.

-- ============================================================
-- STORAGE — bucket privado para o contrato assinado / documento do CNPJ
-- Diferente do bucket "logos" (público), este guarda dado sensível
-- (CPF/CNPJ, contrato assinado) e não pode ter leitura pública.
-- Caminho de cada arquivo: {empresa_id}/{membro_id}/contrato.<ext>
-- ============================================================

insert into storage.buckets (id, name, public)
values ('contratos-equipe', 'contratos-equipe', false)
on conflict (id) do nothing;

-- storage.foldername(name) retorna os segmentos de pasta do caminho do
-- arquivo como array — o primeiro segmento é o empresa_id, o que permite
-- reaproveitar a mesma função is_gestor_ou_owner() já usada nas outras
-- tabelas (migration 003) sem duplicar a checagem de papel/empresa.
create policy "contratos-equipe: gestor/owner vê"
  on storage.objects for select
  using (bucket_id = 'contratos-equipe' and is_gestor_ou_owner(((storage.foldername(name))[1])::uuid));

create policy "contratos-equipe: gestor/owner envia"
  on storage.objects for insert
  with check (bucket_id = 'contratos-equipe' and is_gestor_ou_owner(((storage.foldername(name))[1])::uuid));

create policy "contratos-equipe: gestor/owner atualiza"
  on storage.objects for update
  using  (bucket_id = 'contratos-equipe' and is_gestor_ou_owner(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'contratos-equipe' and is_gestor_ou_owner(((storage.foldername(name))[1])::uuid));

create policy "contratos-equipe: gestor/owner deleta"
  on storage.objects for delete
  using (bucket_id = 'contratos-equipe' and is_gestor_ou_owner(((storage.foldername(name))[1])::uuid));
