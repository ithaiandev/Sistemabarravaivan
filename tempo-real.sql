-- TEMPO REAL ENTRE APARELHOS
-- Faz o Supabase avisar o sistema na hora sempre que algo for incluído, alterado ou excluído,
-- para o celular e o computador mostrarem as mesmas informações sem precisar atualizar.
-- Execute uma vez no SQL Editor (depois de contagem-pratos.sql). Não altera nenhum dado.
-- Pode ser executado de novo sem problema. A segurança (RLS) continua valendo:
-- cada usuário só recebe avisos dos próprios registros.

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['produtos', 'vendas', 'movimentos', 'funcionarios', 'pagamentos_funcionarios',
                           'impostos', 'pratos_contagem', 'contagens_pratos'] loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t)
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Usada pelo sistema para mostrar "Ao vivo" só quando o tempo real estiver mesmo ligado.
create or replace function public.tempo_real_ativo()
returns boolean language sql stable security invoker set search_path = '' as $$
  select not exists (
    select 1 from pg_catalog.pg_tables t
     where t.schemaname = 'public'
       and t.tablename in ('produtos', 'vendas', 'movimentos', 'funcionarios', 'pagamentos_funcionarios',
                           'impostos', 'pratos_contagem', 'contagens_pratos')
       and not exists (select 1 from pg_catalog.pg_publication_tables p
                        where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = t.tablename)
  ) and exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime');
$$;
revoke all on function public.tempo_real_ativo() from public;
grant execute on function public.tempo_real_ativo() to authenticated;

-- Conferência: deve listar as 8 tabelas.
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1;
