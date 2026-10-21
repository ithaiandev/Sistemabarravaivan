-- CONTAGEM DE PRATOS (sem valores)
-- Execute uma vez no SQL Editor do Supabase. Só cria tabelas novas; não altera dados existentes.
-- Pode ser executado de novo sem problema.

create table if not exists public.pratos_contagem (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 120),
  categoria text not null default 'Pratos' check (length(trim(categoria)) between 1 and 60),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
-- Impede dois pratos com o mesmo nome para o mesmo dono (ignora maiúsculas e espaços).
create unique index if not exists pratos_contagem_nome_unq on public.pratos_contagem (user_id, lower(trim(nome)));

create table if not exists public.contagens_pratos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  prato_id uuid not null,
  prato_nome text not null check (length(prato_nome) between 1 and 120),
  quantidade integer not null check (quantidade between 1 and 10000),
  data date not null default current_date,
  created_at timestamptz not null default now(),
  -- O prato precisa ser do mesmo dono da contagem.
  foreign key (prato_id, user_id) references public.pratos_contagem (id, user_id) on delete restrict
);
create index if not exists contagens_pratos_user_data_idx on public.contagens_pratos (user_id, data desc);
create index if not exists contagens_pratos_prato_idx on public.contagens_pratos (prato_id);

alter table public.pratos_contagem enable row level security;
alter table public.contagens_pratos enable row level security;

drop policy if exists pratos_contagem_dono on public.pratos_contagem;
create policy pratos_contagem_dono on public.pratos_contagem for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists contagens_pratos_dono on public.contagens_pratos;
create policy contagens_pratos_dono on public.contagens_pratos for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Visitantes sem login não têm nenhum acesso.
revoke all on public.pratos_contagem from anon;
revoke all on public.contagens_pratos from anon;
