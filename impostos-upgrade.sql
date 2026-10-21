-- Execute após upgrade.sql, folha-pagamentos.sql e cardapio-upgrade.sql.
create table if not exists public.impostos (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id),
 descricao text not null check(length(trim(descricao)) between 1 and 160),
 competencia text not null check(competencia ~ '^[0-9]{4}-[0-9]{2}$'),
 vencimento date not null,
 valor numeric(14,2) not null check(valor>0),
 pago boolean not null default false,
 data_pagamento date,
 movimento_id uuid references public.movimentos(id),
 created_at timestamptz not null default now()
);
create index if not exists impostos_user_vencimento on public.impostos(user_id,vencimento);
alter table public.impostos enable row level security;
drop policy if exists impostos_dono on public.impostos;
create policy impostos_dono on public.impostos for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
-- Pagamento e despesa em uma única transação, com bloqueio para evitar duplicidade.
create or replace function public.pagar_imposto(p_imposto uuid,p_data date)
returns void language plpgsql security invoker set search_path = '' as $$
declare i public.impostos%rowtype; m uuid;
begin
 if auth.uid() is null or p_data is null then raise exception 'Sessão ou data inválida'; end if;
 select * into i from public.impostos where id=p_imposto and user_id=auth.uid() for update;
 if not found then raise exception 'Imposto não encontrado'; end if;
 if i.pago then raise exception 'Imposto já pago'; end if;
 insert into public.movimentos(user_id,descricao,categoria,tipo,valor,data)
 values(auth.uid(),'Imposto: '||i.descricao,'Impostos','saida',i.valor,p_data) returning id into m;
 update public.impostos set pago=true,data_pagamento=p_data,movimento_id=m where id=i.id and user_id=auth.uid();
end $$;
revoke all on function public.pagar_imposto(uuid,date) from public;
grant execute on function public.pagar_imposto(uuid,date) to authenticated;
