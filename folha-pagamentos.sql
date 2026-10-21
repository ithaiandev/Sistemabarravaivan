-- Executar no SQL Editor do Supabase após o upgrade.sql. Não apaga dados.
alter table public.funcionarios add column if not exists valor_diario numeric(14,2) not null default 0 check (valor_diario>=0);
create table if not exists public.pagamentos_funcionarios (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id),
 funcionario_id uuid not null,
 funcionario_nome text not null,
 tipo text not null check(tipo in ('diaria','mensal','extra')),
 valor numeric(14,2) not null check(valor>0),
 data date not null,
 observacao text not null default '' check(length(observacao)<=160),
 created_at timestamptz not null default now(),
 foreign key (funcionario_id) references public.funcionarios(id) on delete restrict
);
create index if not exists pagamentos_func_user_data_idx on public.pagamentos_funcionarios(user_id,data desc);
alter table public.pagamentos_funcionarios enable row level security;
drop policy if exists pagamentos_func_dono on public.pagamentos_funcionarios;
create policy pagamentos_func_dono on public.pagamentos_funcionarios for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
