-- Execute APÓS upgrade.sql e folha-pagamentos.sql. Preserva os registros.
alter table public.produtos add column if not exists controla_estoque boolean not null default true;
-- Pratos e porções podem ser anotados sem controlar estoque.
create or replace function public.registrar_venda_sem_estoque(p_produto uuid,p_quantidade numeric,p_pagamento text,p_data date)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare p public.produtos%rowtype; v_id uuid;
begin
 if auth.uid() is null then raise exception 'Não autenticado'; end if;
 if p_quantidade is null or p_quantidade<=0 or p_quantidade>100000 then raise exception 'Quantidade inválida'; end if;
 if p_pagamento not in ('Pix','Dinheiro','Cartão','Outro') then raise exception 'Pagamento inválido'; end if;
 if p_data is null then raise exception 'Data obrigatória'; end if;
 select * into p from public.produtos where id=p_produto and user_id=auth.uid() and ativo=true and controla_estoque=false;
 if not found then raise exception 'Produto não encontrado ou exige controle de estoque'; end if;
 insert into public.vendas(user_id,produto_id,produto_nome,quantidade,preco_unitario,custo_unitario,pagamento,data)
 values(auth.uid(),p.id,p.nome,p_quantidade,p.preco,p.custo,p_pagamento,p_data) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.registrar_venda_sem_estoque(uuid,numeric,text,date) from public;
grant execute on function public.registrar_venda_sem_estoque(uuid,numeric,text,date) to authenticated;
-- Corrige cancelamento de vendas que não controlam estoque.
create or replace function public.cancelar_venda(p_venda uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v public.vendas%rowtype; controla boolean;
begin
 select * into v from public.vendas where id=p_venda and user_id=auth.uid() for update;
 if not found then raise exception 'Venda não encontrada'; end if;
 select controla_estoque into controla from public.produtos where id=v.produto_id and user_id=auth.uid();
 if controla is true then
   update public.produtos set estoque=estoque+v.quantidade where id=v.produto_id and user_id=auth.uid();
 end if;
 delete from public.vendas where id=v.id and user_id=auth.uid();
end $$;
revoke all on function public.cancelar_venda(uuid) from public;
grant execute on function public.cancelar_venda(uuid) to authenticated;
