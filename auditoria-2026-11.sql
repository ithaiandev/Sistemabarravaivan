-- AUDITORIA 2026-11: fecha o acesso de visitantes sem login às funções do banco.
-- Execute uma vez no SQL Editor do Supabase. Não apaga nem altera nenhum registro.
-- Pode ser executado de novo sem problema.
--
-- Motivo: o Supabase dá permissão de executar funções novas ao papel "anon" (visitante).
-- O "revoke ... from public" dos scripts anteriores não retira essa permissão.
-- Hoje todas as funções recusam visitantes por dentro ("Não autenticado"), então não há
-- vazamento; isto só fecha a porta por fora também.

do $$
declare f text;
begin
  foreach f in array array[
    'public.registrar_venda(uuid,numeric,text,date)',
    'public.registrar_venda_sem_estoque(uuid,numeric,text,date)',
    'public.cancelar_venda(uuid)',
    'public.adicionar_estoque(uuid,numeric)',
    'public.pagar_imposto(uuid,date)',
    'public.tempo_real_ativo()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from anon', f);
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

-- Funções criadas no futuro também não ficam abertas para visitantes.
alter default privileges in schema public revoke execute on functions from anon;

-- Conferência: a coluna "visitante_pode" deve vir "false" em todas as linhas.
select p.proname as funcao, has_function_privilege('anon', p.oid, 'execute') as visitante_pode
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
 where s.nspname = 'public'
   and p.proname in ('registrar_venda', 'registrar_venda_sem_estoque', 'cancelar_venda', 'adicionar_estoque', 'pagar_imposto', 'tempo_real_ativo')
 order by 1;
