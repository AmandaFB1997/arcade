-- =====================================================================
-- 06) HORA DE MESA: catálogo de jogos, mesa separada pela equipe, placar,
--     equipe (bônus de XP) e avaliação da experiência (nota, texto e áudio).
-- Seguro para rodar mais de uma vez.
-- =====================================================================

-- ---------- Catálogo de jogos de tabuleiro (a equipe edita no Admin) ----------
create table if not exists public.jogos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  jogadores_min int not null default 2 check (jogadores_min >= 1),
  jogadores_max int not null default 4 check (jogadores_max >= jogadores_min),
  duracao_min int,
  descricao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- exemplos para começar (só entram se o catálogo estiver vazio; edite ou apague no Admin)
insert into public.jogos (nome, jogadores_min, jogadores_max, duracao_min)
select * from (values
  ('Catan', 3, 4, 90), ('Carcassonne', 2, 5, 45), ('Uno', 2, 10, 20),
  ('Dixit', 3, 6, 30), ('Código Secreto', 4, 8, 20), ('Ticket to Ride', 2, 5, 60)
) v(nome, jogadores_min, jogadores_max, duracao_min)
where not exists (select 1 from public.jogos);

-- ---------- Sessão de mesa ----------
create table if not exists public.sessoes_mesa (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfis(id),
  comanda_id uuid references public.comandas(id) on delete set null,
  item_id uuid references public.itens_comanda(id) on delete set null,
  jogo_id uuid references public.jogos(id) on delete set null,
  jogo_livre text,                                   -- "ainda não sei" ou jogo que não está no catálogo
  jogadores int not null default 2 check (jogadores between 1 and 20),
  status text not null default 'solicitada'
    check (status in ('solicitada', 'separando', 'pronta', 'jogando', 'encerrada', 'cancelada')),
  mesa_jogo text,                                    -- ex.: "Mesa 5" (a equipe informa quando separa)
  criada_em timestamptz not null default now(),
  pronta_em timestamptz,
  iniciada_em timestamptz,
  encerrada_em timestamptz,
  nota int check (nota between 1 and 5),
  comentario text,
  audio_path text,
  xp_equipe bigint not null default 0
);
create index if not exists sessoes_mesa_usuario_idx on public.sessoes_mesa (usuario_id, criada_em desc);
create index if not exists sessoes_mesa_status_idx on public.sessoes_mesa (status);

create table if not exists public.placar_mesa (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references public.sessoes_mesa(id) on delete cascade,
  jogador text not null check (char_length(jogador) between 1 and 30),
  usuario_id uuid references public.perfis(id) on delete set null,   -- preenchido quando é um jogador cadastrado
  anfitriao boolean not null default false,
  pontos int not null default 0 check (pontos between -9999 and 9999),
  ordem int not null default 0
);
create index if not exists placar_mesa_sessao_idx on public.placar_mesa (sessao_id);

-- ---------- Regras de bônus da equipe (ajustáveis no Admin → Regras) ----------
insert into public.configuracoes (chave, valor, observacao) values
  ('xp_equipe_por_pessoa', 10, 'Hora de Mesa: XP extra do anfitrião por pessoa que ele leva na equipe.'),
  ('xp_equipe_max', 50, 'Hora de Mesa: teto do bônus de XP do anfitrião por partida.'),
  ('xp_equipe_membro', 5, 'Hora de Mesa: XP de cada jogador cadastrado que participou da equipe.'),
  ('xp_equipe_min_minutos', 10, 'Hora de Mesa: tempo mínimo de partida para valer o bônus de equipe.')
on conflict (chave) do nothing;

-- ---------- Segurança (RLS) ----------
alter table public.jogos enable row level security;
alter table public.sessoes_mesa enable row level security;
alter table public.placar_mesa enable row level security;

drop policy if exists jogos_leitura on public.jogos;
create policy jogos_leitura on public.jogos for select to authenticated using (true);
drop policy if exists jogos_admin on public.jogos;
create policy jogos_admin on public.jogos for all to authenticated
  using (public.tem_papel('admin')) with check (public.tem_papel('admin'));

drop policy if exists sessoes_mesa_ver on public.sessoes_mesa;
create policy sessoes_mesa_ver on public.sessoes_mesa for select to authenticated
  using (usuario_id = auth.uid() or public.eh_funcionario());
drop policy if exists sessoes_mesa_admin_apagar on public.sessoes_mesa;
create policy sessoes_mesa_admin_apagar on public.sessoes_mesa for delete to authenticated
  using (public.tem_papel('admin'));

drop policy if exists placar_mesa_ver on public.placar_mesa;
create policy placar_mesa_ver on public.placar_mesa for select to authenticated
  using (exists (select 1 from public.sessoes_mesa s
                 where s.id = sessao_id and (s.usuario_id = auth.uid() or public.eh_funcionario())));
-- escrita só pelas funções abaixo (não há policy de insert/update para o cliente)

do $$ begin alter publication supabase_realtime add table public.sessoes_mesa;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.placar_mesa;
exception when duplicate_object then null; end $$;

-- ---------- XP (mesma regra do fechamento da comanda: sem casa, vai para o Cofre) ----------
create or replace function public.conceder_xp(_usuario uuid, _qtd bigint, _origem text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.perfis; novo bigint;
begin
  if coalesce(_qtd, 0) <= 0 then return; end if;
  select * into p from public.perfis where id = _usuario for update;
  if not found then return; end if;
  insert into public.eventos_xp (usuario_id, quantidade, origem) values (_usuario, _qtd, _origem);
  if p.faccao is null then
    update public.perfis set xp_bloqueado = xp_bloqueado + _qtd where id = p.id;
  else
    novo := p.xp + _qtd;
    update public.perfis set xp = novo, nivel = (select max(nivel) from public.niveis where xp_necessario <= novo) where id = p.id;
    update public.placar_guerra set pontos = pontos + _qtd where faccao = p.faccao;
  end if;
end $$;
revoke all on function public.conceder_xp(uuid, bigint, text) from public, anon, authenticated;

-- ---------- CLIENTE: pede a mesa (o item da comanda já foi criado) ----------
create or replace function public.mesa_solicitar(_item uuid, _jogo uuid, _jogo_livre text, _jogadores int)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; sid uuid; jg text;
begin
  select c.id into cid from public.itens_comanda i join public.comandas c on c.id = i.comanda_id
   where i.id = _item and c.usuario_id = auth.uid() and c.status = 'aberta';
  if not found then raise exception 'item ou comanda inválidos'; end if;
  if exists (select 1 from public.sessoes_mesa where usuario_id = auth.uid() and status in ('solicitada', 'separando', 'pronta', 'jogando')) then
    raise exception 'você já tem uma mesa em andamento';
  end if;
  if _jogo is not null and not exists (select 1 from public.jogos where id = _jogo and ativo) then
    raise exception 'jogo indisponível';
  end if;
  jg := nullif(left(trim(coalesce(_jogo_livre, '')), 60), '');
  insert into public.sessoes_mesa (usuario_id, comanda_id, item_id, jogo_id, jogo_livre, jogadores)
  values (auth.uid(), cid, _item, _jogo, jg, greatest(1, least(coalesce(_jogadores, 2), 20)))
  returning id into sid;
  insert into public.placar_mesa (sessao_id, jogador, usuario_id, anfitriao, ordem)
  select sid, left(coalesce(nome_exibicao, 'Você'), 30), id, true, 0 from public.perfis where id = auth.uid();
  return sid;
end $$;

-- CLIENTE: desiste enquanto a equipe ainda não começou a separar
create or replace function public.mesa_cancelar(_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.sessoes_mesa;
begin
  select * into s from public.sessoes_mesa where id = _id and usuario_id = auth.uid() for update;
  if not found or s.status <> 'solicitada' then raise exception 'não dá mais para cancelar'; end if;
  update public.sessoes_mesa set status = 'cancelada', encerrada_em = now() where id = _id;
  delete from public.itens_comanda where id = s.item_id and status = 'pendente';
end $$;

-- EQUIPE: avança a mesa (separando → pronta → jogando) e acompanha o status do item na comanda
create or replace function public.mesa_avancar(_id uuid, _status text, _mesa text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.sessoes_mesa;
begin
  if not public.eh_funcionario() then raise exception 'sem permissão'; end if;
  if _status not in ('separando', 'pronta', 'jogando', 'cancelada') then raise exception 'status inválido'; end if;
  select * into s from public.sessoes_mesa where id = _id for update;
  if not found or s.status in ('encerrada', 'cancelada') then raise exception 'mesa inválida'; end if;
  if _status = 'pronta' and nullif(trim(coalesce(_mesa, '')), '') is null then raise exception 'informe a mesa'; end if;
  update public.sessoes_mesa
     set status = _status,
         mesa_jogo = coalesce(nullif(left(trim(coalesce(_mesa, '')), 30), ''), mesa_jogo),
         pronta_em = case when _status = 'pronta' then now() else pronta_em end,
         iniciada_em = case when _status = 'jogando' and iniciada_em is null then now() else iniciada_em end,
         encerrada_em = case when _status = 'cancelada' then now() else encerrada_em end
   where id = _id;
  update public.itens_comanda set status = case _status when 'separando' then 'preparando'::public.status_item
                                                         when 'pronta' then 'pronto'::public.status_item
                                                         when 'jogando' then 'entregue'::public.status_item
                                                         else status end
   where id = s.item_id and _status <> 'cancelada';
end $$;

-- CLIENTE: chegou na mesa, começa a partida
create or replace function public.mesa_iniciar(_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.sessoes_mesa;
begin
  select * into s from public.sessoes_mesa where id = _id and usuario_id = auth.uid() for update;
  if not found or s.status <> 'pronta' then raise exception 'a mesa ainda não está pronta'; end if;
  update public.sessoes_mesa set status = 'jogando', iniciada_em = now() where id = _id;
  update public.itens_comanda set status = 'entregue' where id = s.item_id;
end $$;

-- CLIENTE: salva a equipe e o placar. _placar = [{jogador, pontos, usuario_id|null}, ...]; o 1º é sempre o anfitrião
create or replace function public.mesa_salvar_placar(_id uuid, _placar jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare s public.sessoes_mesa; e jsonb; n int := 0; nome text; uid uuid; pts int; host public.perfis;
begin
  select * into s from public.sessoes_mesa where id = _id and usuario_id = auth.uid() for update;
  if not found or s.status not in ('pronta', 'jogando') then raise exception 'partida não está em andamento'; end if;
  if jsonb_typeof(_placar) <> 'array' or jsonb_array_length(_placar) > 20 then raise exception 'placar inválido'; end if;
  select * into host from public.perfis where id = auth.uid();
  delete from public.placar_mesa where sessao_id = _id;
  insert into public.placar_mesa (sessao_id, jogador, usuario_id, anfitriao, pontos, ordem)
  values (_id, left(coalesce(host.nome_exibicao, 'Você'), 30), auth.uid(), true,
          greatest(-9999, least(9999, coalesce(((_placar -> 0) ->> 'pontos')::int, 0))), 0);
  n := 1;
  for e in select v from jsonb_array_elements(_placar) with ordinality t(v, i) where i > 1 order by i loop
    nome := left(trim(coalesce(e ->> 'jogador', '')), 30);
    if nome = '' then continue; end if;
    uid := null;
    if nullif(e ->> 'usuario_id', '') is not null then
      uid := (e ->> 'usuario_id')::uuid;
      if uid = auth.uid() or not exists (select 1 from public.perfis where id = uid)
         or exists (select 1 from public.placar_mesa where sessao_id = _id and usuario_id = uid) then uid := null; end if;
    end if;
    pts := greatest(-9999, least(9999, coalesce((e ->> 'pontos')::int, 0)));
    insert into public.placar_mesa (sessao_id, jogador, usuario_id, anfitriao, pontos, ordem) values (_id, nome, uid, false, pts, n);
    n := n + 1;
  end loop;
  update public.sessoes_mesa set jogadores = greatest(1, least(n, 20)) where id = _id;
end $$;

-- CLIENTE: encerra, avalia e recebe o bônus de equipe
create or replace function public.mesa_encerrar(_id uuid, _nota int, _comentario text, _audio text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessoes_mesa; pessoas int; por numeric; teto numeric; membro numeric; minutos numeric; bonus bigint := 0; m record;
begin
  select * into s from public.sessoes_mesa where id = _id and usuario_id = auth.uid() for update;
  if not found or s.status <> 'jogando' then raise exception 'partida não está em andamento'; end if;
  if _nota is not null and (_nota < 1 or _nota > 5) then raise exception 'nota inválida'; end if;
  if nullif(_audio, '') is not null and left(_audio, 37) <> auth.uid()::text || '/' then raise exception 'áudio inválido'; end if;

  select count(*) into pessoas from public.placar_mesa where sessao_id = _id and not anfitriao;
  select valor into por from public.configuracoes where chave = 'xp_equipe_por_pessoa';
  select valor into teto from public.configuracoes where chave = 'xp_equipe_max';
  select valor into membro from public.configuracoes where chave = 'xp_equipe_membro';
  select valor into minutos from public.configuracoes where chave = 'xp_equipe_min_minutos';

  if extract(epoch from (now() - coalesce(s.iniciada_em, now()))) / 60 >= coalesce(minutos, 0) then
    bonus := least(floor(coalesce(por, 0) * pessoas), floor(coalesce(teto, 0)))::bigint;
    perform public.conceder_xp(auth.uid(), bonus, 'bonus');
    for m in select usuario_id from public.placar_mesa where sessao_id = _id and not anfitriao and usuario_id is not null loop
      perform public.conceder_xp(m.usuario_id, floor(coalesce(membro, 0))::bigint, 'partida');
    end loop;
  end if;

  update public.sessoes_mesa
     set status = 'encerrada', encerrada_em = now(), nota = _nota,
         comentario = nullif(left(trim(coalesce(_comentario, '')), 1000), ''),
         audio_path = nullif(_audio, ''), xp_equipe = bonus
   where id = _id;
  return jsonb_build_object('xp_equipe', bonus, 'pessoas', pessoas);
end $$;

-- CLIENTE: procura jogadores cadastrados pelo nome para montar a equipe (só nome público, no máximo 8)
create or replace function public.buscar_jogadores(_q text)
returns table (id uuid, nome_exibicao text) language sql stable security definer set search_path = public as $$
  select p.id, p.nome_exibicao from public.perfis p
   where auth.uid() is not null and char_length(trim(coalesce(_q, ''))) >= 3
     and p.id <> auth.uid() and p.nome_exibicao ilike '%' || trim(_q) || '%'
   order by p.nome_exibicao limit 8;
$$;

revoke all on function public.mesa_solicitar(uuid, uuid, text, int), public.mesa_cancelar(uuid),
  public.mesa_avancar(uuid, text, text), public.mesa_iniciar(uuid), public.mesa_salvar_placar(uuid, jsonb),
  public.mesa_encerrar(uuid, int, text, text), public.buscar_jogadores(text) from public, anon;
grant execute on function public.mesa_solicitar(uuid, uuid, text, int), public.mesa_cancelar(uuid),
  public.mesa_avancar(uuid, text, text), public.mesa_iniciar(uuid), public.mesa_salvar_placar(uuid, jsonb),
  public.mesa_encerrar(uuid, int, text, text), public.buscar_jogadores(text) to authenticated;

-- ---------- Áudios das experiências (só existe no Supabase; ignorado onde não há "storage") ----------
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('experiencias', 'experiencias', false, 5242880)
    on conflict (id) do nothing;
    drop policy if exists experiencias_enviar on storage.objects;
    create policy experiencias_enviar on storage.objects for insert to authenticated
      with check (bucket_id = 'experiencias' and (storage.foldername(name))[1] = auth.uid()::text);
    drop policy if exists experiencias_ouvir on storage.objects;
    create policy experiencias_ouvir on storage.objects for select to authenticated
      using (bucket_id = 'experiencias' and ((storage.foldername(name))[1] = auth.uid()::text or public.eh_funcionario()));
  end if;
end $$;
