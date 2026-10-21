-- REFORÇO DE SEGURANÇA v2
-- Execute DEPOIS de todos os outros scripts. Não apaga nem altera registros existentes.
-- Pode ser executado de novo sem problema.
-- As novas regras valem para gravações futuras ("not valid" não reavalia o histórico).

do $$
begin
  -- 1. Pagamento de funcionário só pode apontar para funcionário do mesmo dono.
  if not exists (select 1 from pg_constraint where conname = 'funcionarios_id_user_unq') then
    alter table public.funcionarios add constraint funcionarios_id_user_unq unique (id, user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pagamentos_func_mesmo_dono_fk') then
    alter table public.pagamentos_funcionarios add constraint pagamentos_func_mesmo_dono_fk
      foreign key (funcionario_id, user_id) references public.funcionarios (id, user_id) on delete restrict not valid;
  end if;

  -- 2. Imposto pago só pode apontar para despesa do mesmo dono.
  if not exists (select 1 from pg_constraint where conname = 'movimentos_id_user_unq') then
    alter table public.movimentos add constraint movimentos_id_user_unq unique (id, user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'impostos_mov_mesmo_dono_fk') then
    alter table public.impostos add constraint impostos_mov_mesmo_dono_fk
      foreign key (movimento_id, user_id) references public.movimentos (id, user_id) not valid;
  end if;

  -- 3. Imposto marcado como pago precisa ter data de pagamento.
  if not exists (select 1 from pg_constraint where conname = 'impostos_pago_coerente') then
    alter table public.impostos add constraint impostos_pago_coerente
      check (not pago or data_pagamento is not null) not valid;
  end if;

  -- 4. Limites de tamanho de texto (evita registros gigantes por engano ou abuso).
  if not exists (select 1 from pg_constraint where conname = 'movimentos_categoria_tam') then
    alter table public.movimentos add constraint movimentos_categoria_tam check (length(categoria) between 1 and 60) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'produtos_categoria_tam') then
    alter table public.produtos add constraint produtos_categoria_tam check (length(categoria) between 1 and 60) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'funcionarios_textos_tam') then
    alter table public.funcionarios add constraint funcionarios_textos_tam check (length(nome) between 1 and 160 and length(cargo) between 1 and 100) not valid;
  end if;

  -- 5. Valores máximos razoáveis (evita erro de digitação como 1500000 no lugar de 150,00).
  if not exists (select 1 from pg_constraint where conname = 'movimentos_valor_max') then
    alter table public.movimentos add constraint movimentos_valor_max check (valor <= 10000000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'produtos_valores_max') then
    alter table public.produtos add constraint produtos_valores_max check (custo <= 1000000 and preco <= 1000000) not valid;
  end if;
end $$;

-- 6. Reposição de estoque só para produtos que controlam estoque.
create or replace function public.adicionar_estoque(p_produto uuid, p_quantidade numeric)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if p_quantidade is null or p_quantidade <= 0 or p_quantidade > 100000 then raise exception 'Quantidade inválida'; end if;
  update public.produtos set estoque = estoque + p_quantidade
   where id = p_produto and user_id = auth.uid() and controla_estoque = true;
  if not found then raise exception 'Produto não encontrado ou sem controle de estoque'; end if;
end $$;
revoke all on function public.adicionar_estoque(uuid, numeric) from public;
grant execute on function public.adicionar_estoque(uuid, numeric) to authenticated;

-- 7. Pagamento de imposto não aceita data no futuro.
create or replace function public.pagar_imposto(p_imposto uuid, p_data date)
returns void language plpgsql security invoker set search_path = '' as $$
declare i public.impostos%rowtype; m uuid;
begin
  if auth.uid() is null or p_data is null then raise exception 'Sessão ou data inválida'; end if;
  if p_data > current_date + 1 then raise exception 'Data de pagamento no futuro'; end if;
  select * into i from public.impostos where id = p_imposto and user_id = auth.uid() for update;
  if not found then raise exception 'Imposto não encontrado'; end if;
  if i.pago then raise exception 'Imposto já pago'; end if;
  insert into public.movimentos (user_id, descricao, categoria, tipo, valor, data)
  values (auth.uid(), 'Imposto: ' || i.descricao, 'Impostos', 'saida', i.valor, p_data) returning id into m;
  update public.impostos set pago = true, data_pagamento = p_data, movimento_id = m where id = i.id and user_id = auth.uid();
end $$;
revoke all on function public.pagar_imposto(uuid, date) from public;
grant execute on function public.pagar_imposto(uuid, date) to authenticated;

-- 8. Visitantes sem login não têm nenhum acesso direto às tabelas.
revoke all on public.produtos, public.vendas, public.movimentos, public.funcionarios,
              public.pagamentos_funcionarios, public.impostos from anon;
