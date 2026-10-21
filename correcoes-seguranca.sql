-- Executar DEPOIS dos outros upgrades. Preserva registros existentes.
-- Registra o modo de estoque no momento da venda para que mudanças posteriores
-- no cadastro não façam um cancelamento devolver estoque indevidamente.
alter table public.vendas add column if not exists estoque_baixado boolean;
-- Para vendas antigas, usa o modo atual do produto como melhor aproximação.
update public.vendas v set estoque_baixado = coalesce(p.controla_estoque,true)
from public.produtos p where p.id=v.produto_id and v.estoque_baixado is null;
create or replace function public.registrar_venda(p_produto uuid,p_quantidade numeric,p_pagamento text,p_data date)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare p public.produtos%rowtype; v_id uuid;
begin
 if auth.uid() is null then raise exception 'Não autenticado'; end if;
 if p_quantidade is null or p_quantidade<=0 or p_quantidade>100000 then raise exception 'Quantidade inválida'; end if;
 if p_pagamento is null or p_pagamento not in ('Pix','Dinheiro','Cartão','Outro') then raise exception 'Pagamento inválido'; end if;
 if p_data is null then raise exception 'Data obrigatória'; end if;
 select * into p from public.produtos where id=p_produto and user_id=auth.uid() and ativo=true and controla_estoque=true for update;
 if not found then raise exception 'Produto não encontrado ou sem controle de estoque'; end if;
 if p.estoque<p_quantidade then raise exception 'Estoque insuficiente'; end if;
 update public.produtos set estoque=estoque-p_quantidade where id=p.id and user_id=auth.uid();
 insert into public.vendas(user_id,produto_id,produto_nome,quantidade,preco_unitario,custo_unitario,pagamento,data,estoque_baixado)
 values(auth.uid(),p.id,p.nome,p_quantidade,p.preco,p.custo,p_pagamento,p_data,true) returning id into v_id;
 return v_id;
end $$;
create or replace function public.registrar_venda_sem_estoque(p_produto uuid,p_quantidade numeric,p_pagamento text,p_data date)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare p public.produtos%rowtype; v_id uuid;
begin
 if auth.uid() is null then raise exception 'Não autenticado'; end if;
 if p_quantidade is null or p_quantidade<=0 or p_quantidade>100000 then raise exception 'Quantidade inválida'; end if;
 if p_pagamento is null or p_pagamento not in ('Pix','Dinheiro','Cartão','Outro') then raise exception 'Pagamento inválido'; end if;
 if p_data is null then raise exception 'Data obrigatória'; end if;
 select * into p from public.produtos where id=p_produto and user_id=auth.uid() and ativo=true and controla_estoque=false;
 if not found then raise exception 'Produto não encontrado ou exige controle de estoque'; end if;
 insert into public.vendas(user_id,produto_id,produto_nome,quantidade,preco_unitario,custo_unitario,pagamento,data,estoque_baixado)
 values(auth.uid(),p.id,p.nome,p_quantidade,p.preco,p.custo,p_pagamento,p_data,false) returning id into v_id;
 return v_id;
end $$;
create or replace function public.cancelar_venda(p_venda uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v public.vendas%rowtype;
begin
 select * into v from public.vendas where id=p_venda and user_id=auth.uid() for update;
 if not found then raise exception 'Venda não encontrada'; end if;
 if v.estoque_baixado is true then
   update public.produtos set estoque=estoque+v.quantidade where id=v.produto_id and user_id=auth.uid();
 end if;
 delete from public.vendas where id=v.id and user_id=auth.uid();
end $$;
-- Bloqueia exclusão acidental de despesas de impostos pagos.
-- A FK movimento_id de impostos já impede a exclusão no banco.
