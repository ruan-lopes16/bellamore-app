-- Adiciona campo de segmento/nicho do negócio
alter table public.empresas
  add column if not exists segmento text default 'Estúdio';
