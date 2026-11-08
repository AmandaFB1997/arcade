-- Cadastro do jogador (primeiro acesso) + pesquisa para a administração.
-- Rode UMA vez no SQL Editor do projeto arcade (depois do 01).

alter table public.perfis
  add column if not exists data_nascimento date,
  add column if not exists tempo_jogando text,
  add column if not exists motivacao_continuar text,
  add column if not exists cadastro_completo_em timestamptz;

-- O cliente grava as respostas por esta função (a coluna continua protegida contra update direto).
create or replace function public.salvar_cadastro_jogador(
  _data_nascimento date, _tempo_jogando text, _motivacao_continuar text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sem permissão'; end if;
  if _data_nascimento is null or _data_nascimento > current_date or _data_nascimento < date '1900-01-01' then
    raise exception 'Data de nascimento inválida.';
  end if;
  update public.perfis
     set data_nascimento      = _data_nascimento,
         tempo_jogando        = nullif(left(btrim(coalesce(_tempo_jogando, '')), 120), ''),
         motivacao_continuar  = nullif(left(btrim(coalesce(_motivacao_continuar, '')), 300), ''),
         cadastro_completo_em = now()
   where id = auth.uid();
end $$;
revoke all on function public.salvar_cadastro_jogador(date, text, text) from public, anon;
grant execute on function public.salvar_cadastro_jogador(date, text, text) to authenticated;

-- Só o admin lê a pesquisa (inclui o e-mail do login).
create or replace function public.listar_pesquisa_jogadores()
returns table (nome text, email text, faccao public.faccao, idade int,
               tempo_jogando text, motivacao_continuar text, respondido_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tem_papel('admin') then raise exception 'sem permissão'; end if;
  return query
    select p.nome_exibicao, u.email::text, p.faccao,
           case when p.data_nascimento is null then null
                else date_part('year', age(current_date, p.data_nascimento))::int end,
           p.tempo_jogando, p.motivacao_continuar, p.cadastro_completo_em
      from public.perfis p join auth.users u on u.id = p.id
     where p.cadastro_completo_em is not null
     order by p.cadastro_completo_em desc;
end $$;
revoke all on function public.listar_pesquisa_jogadores() from public, anon;
grant execute on function public.listar_pesquisa_jogadores() to authenticated;
