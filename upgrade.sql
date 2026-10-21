-- Execute uma vez no SQL Editor. Preserva movimentos e funcionarios existentes.
create table if not exists public.produtos (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 nome text not null check(length(trim(nome)) between 1 and 160), categoria text not null default 'Outros',
 custo numeric(14,2) not null check(custo>=0), preco numeric(14,2) not null check(preco>=0),
 estoque numeric(14,3) not null default 0 check(estoque>=0), ativo boolean not null default true,
 created_at timestamptz not null default now(), unique(id,user_id)
);
create table if not exists public.vendas (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 data date not null default current_date, pagamento text not null check(pagamento in ('Pix','Dinheiro','Cartão','Outro')),
 quantidade numeric(14,3) not null check(quantidade>0), produto_id uuid not null,
 produto_nome text not null, preco_unitario numeric(14,2) not null check(preco_unitario>=0),
 custo_unitario numeric(14,2) not null check(custo_unitario>=0),
 total numeric(14,2) generated always as (round(quantidade*preco_unitario,2)) stored,
 custo_total numeric(14,2) generated always as (round(quantidade*custo_unitario,2)) stored,
 created_at timestamptz not null default now(),
 foreign key (produto_id,user_id) references public.produtos(id,user_id)
);
create index if not exists produtos_user_nome_idx on public.produtos(user_id,nome);
create index if not exists vendas_user_data_idx on public.vendas(user_id,data desc);
alter table public.produtos enable row level security;
alter table public.vendas enable row level security;
drop policy if exists produtos_dono on public.produtos;
create policy produtos_dono on public.produtos for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists vendas_dono on public.vendas;
create policy vendas_dono on public.vendas for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
-- Transação atômica: registra venda e baixa estoque, evitando estoque negativo concorrente.
create or replace function public.registrar_venda(p_produto uuid,p_quantidade numeric,p_pagamento text,p_data date)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare p public.produtos%rowtype; v_id uuid;
begin
 if auth.uid() is null then raise exception 'Não autenticado'; end if;
 if p_quantidade is null or p_quantidade<=0 or p_quantidade>100000 then raise exception 'Quantidade inválida'; end if;
 if p_pagamento not in ('Pix','Dinheiro','Cartão','Outro') then raise exception 'Pagamento inválido'; end if;
 if p_data is null then raise exception 'Data obrigatória'; end if;
 select * into p from public.produtos where id=p_produto and user_id=auth.uid() and ativo=true for update;
 if not found then raise exception 'Produto não encontrado ou inativo'; end if;
 if p.estoque<p_quantidade then raise exception 'Estoque insuficiente'; end if;
 update public.produtos set estoque=estoque-p_quantidade where id=p.id and user_id=auth.uid();
 insert into public.vendas(user_id,produto_id,produto_nome,quantidade,preco_unitario,custo_unitario,pagamento,data)
 values(auth.uid(),p.id,p.nome,p_quantidade,p.preco,p.custo,p_pagamento,p_data) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.registrar_venda(uuid,numeric,text,date) from public;
grant execute on function public.registrar_venda(uuid,numeric,text,date) to authenticated;
-- Cancelamento restaura estoque na mesma transação.
create or replace function public.cancelar_venda(p_venda uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v public.vendas%rowtype;
begin
 select * into v from public.vendas where id=p_venda and user_id=auth.uid() for update;
 if not found then raise exception 'Venda não encontrada'; end if;
 update public.produtos set estoque=estoque+v.quantidade where id=v.produto_id and user_id=auth.uid();
 delete from public.vendas where id=v.id and user_id=auth.uid();
end $$;
revoke all on function public.cancelar_venda(uuid) from public;
grant execute on function public.cancelar_venda(uuid) to authenticated;
-- Reposição atômica de estoque para evitar perda de atualização simultânea.
create or replace function public.adicionar_estoque(p_produto uuid,p_quantidade numeric)
returns void language plpgsql security invoker set search_path = '' as $$
begin
 if auth.uid() is null or p_quantidade is null or p_quantidade<=0 or p_quantidade>100000 then raise exception 'Quantidade inválida'; end if;
 update public.produtos set estoque=estoque+p_quantidade where id=p_produto and user_id=auth.uid();
 if not found then raise exception 'Produto não encontrado'; end if;
end $$;
revoke all on function public.adicionar_estoque(uuid,numeric) from public;
grant execute on function public.adicionar_estoque(uuid,numeric) to authenticated;
