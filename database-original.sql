-- Execute no SQL Editor do Supabase. Cada usuário vê apenas seus próprios dados.
create extension if not exists pgcrypto;
create table if not exists public.movimentos (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 descricao text not null check(length(descricao) between 1 and 160),
 tipo text not null check(tipo in ('entrada','saida')),
 categoria text not null, valor numeric(14,2) not null check(valor > 0),
 data date not null, created_at timestamptz not null default now()
);
create table if not exists public.funcionarios (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 nome text not null, cargo text not null, salario numeric(14,2) not null check(salario >= 0),
 admissao date not null, created_at timestamptz not null default now()
);
create index if not exists movimentos_user_data_idx on public.movimentos(user_id,data desc);
create index if not exists funcionarios_user_idx on public.funcionarios(user_id);
alter table public.movimentos enable row level security;
alter table public.funcionarios enable row level security;
drop policy if exists "movimentos_proprietario" on public.movimentos;
create policy "movimentos_proprietario" on public.movimentos for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists "funcionarios_proprietario" on public.funcionarios;
create policy "funcionarios_proprietario" on public.funcionarios for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
