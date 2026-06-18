create table public.web_push_subscriptions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.users(id) on delete cascade,
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz default now(),
  unique(user_id, endpoint)
);

alter table public.web_push_subscriptions enable row level security;

create policy "user manages own push subscriptions"
  on public.web_push_subscriptions for all
  using (auth.uid() = user_id);
