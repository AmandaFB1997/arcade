-- =====================================================================
-- ATUALIZAR TUDO (03 + 04 + 05 + 06 + 07) — rode UMA vez no SQL Editor do projeto arcade, DEPOIS do 01.
-- Pode rodar de novo sem erro (não duplica nada). NÃO rode o 01 de novo.
-- =====================================================================

-- ######## 03_ajuste_moeda_1ac_1real.sql ########
-- Ajuste para o valor oficial da moeda: 1 AC = R$ 1,00 (antes 1.000 AC = R$ 1).
-- Rode UMA vez, SÓ se o banco já estava criado com a regra antiga. Em banco novo não precisa (01 e 02 já vêm certos).
update public.cardapio set preco_ac = preco_ac / 1000 where preco_ac >= 1000;
update public.configuracoes set valor = 5 where chave = 'adicional_ac' and valor >= 1000;
update public.niveis set xp_necessario = nivel * 100;


-- ######## 04_cadastro_pesquisa_jogador.sql ########
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


-- ######## 05_pix_whatsapp_investidores.sql ########
-- =====================================================================
-- 05 — Recarga por PIX (pacotes), login por WhatsApp (perfil sem e-mail) e investidores.
-- Rode UMA vez no SQL Editor do projeto arcade (depois do 01 e do 04).
-- =====================================================================

-- ---------- 1) Pacotes de recarga e pedidos de PIX ----------
create table if not exists public.pacotes_recarga (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  valor_reais numeric(10,2) not null check (valor_reais > 0),
  valor_ac bigint not null check (valor_ac > 0),
  destaque boolean not null default false,
  ativo boolean not null default true,
  ordem int not null default 0
);
-- PROVISÓRIOS (edite em Admin → Pacotes): quanto maior o pacote, maior o bônus.
insert into public.pacotes_recarga (nome, valor_reais, valor_ac, destaque, ordem)
select * from (values
  ('Iniciado',   30.00,  30, false, 1),
  ('Explorador', 50.00,  55, false, 2),
  ('Aventureiro',100.00, 115, true, 3),
  ('Lendário',   200.00, 240, false, 4)
) v(nome, valor_reais, valor_ac, destaque, ordem)
where not exists (select 1 from public.pacotes_recarga);

create table if not exists public.pedidos_recarga (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfis(id),
  pacote_id uuid references public.pacotes_recarga(id),
  valor_reais numeric(10,2) not null,
  valor_ac bigint not null,
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'expirado', 'cancelado')),
  id_externo text unique,                        -- id do pagamento no provedor de PIX
  pix_copia_cola text,
  pix_qr_base64 text,
  criado_em timestamptz not null default now(),
  expira_em timestamptz,
  pago_em timestamptz
);
create index if not exists pedidos_recarga_usuario on public.pedidos_recarga (usuario_id, criado_em desc);

alter table public.pacotes_recarga enable row level security;
alter table public.pedidos_recarga enable row level security;
drop policy if exists pacotes_leitura on public.pacotes_recarga;
create policy pacotes_leitura on public.pacotes_recarga for select to authenticated
  using (ativo or public.tem_papel('admin'));
drop policy if exists pacotes_admin on public.pacotes_recarga;
create policy pacotes_admin on public.pacotes_recarga for all to authenticated
  using (public.tem_papel('admin')) with check (public.tem_papel('admin'));
-- pedido: o cliente só LÊ os próprios; quem cria/confirma é o servidor (Edge Function)
drop policy if exists pedidos_leitura on public.pedidos_recarga;
create policy pedidos_leitura on public.pedidos_recarga for select to authenticated
  using (usuario_id = auth.uid() or public.eh_funcionario());

-- Confirma o pagamento e credita o saldo. Só o servidor (service_role) executa. Idempotente.
create or replace function public.confirmar_recarga_pix(_pedido uuid, _id_externo text, _valor_reais numeric)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.pedidos_recarga;
begin
  select * into r from public.pedidos_recarga where id = _pedido for update;
  if not found then raise exception 'pedido não encontrado'; end if;
  if r.status = 'pago' then return false; end if;                       -- já creditado
  if r.id_externo is not null and r.id_externo <> _id_externo then raise exception 'pagamento não é deste pedido'; end if;
  if _valor_reais < r.valor_reais then raise exception 'valor pago menor que o do pedido'; end if;
  update public.pedidos_recarga set status = 'pago', pago_em = now(), id_externo = _id_externo where id = _pedido;
  insert into public.livro_saldo (usuario_id, valor_ac, tipo) values (r.usuario_id, r.valor_ac, 'recarga_pix');
  return true;
end $$;
revoke all on function public.confirmar_recarga_pix(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.confirmar_recarga_pix(uuid, text, numeric) to service_role;

do $$ begin
  alter publication supabase_realtime add table public.pedidos_recarga;
exception when duplicate_object then null; end $$;

-- ---------- 2) Perfil também para login por WhatsApp (sem e-mail) ----------
create or replace function public.criar_perfil_novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome_exibicao)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'nome_exibicao', ''),
                   nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                   nullif(new.phone, ''), 'Jogador'));
  return new;
end $$;

-- ---------- 3) Investidores (Covil do Dragão) ----------
create table if not exists public.cotas_investidor (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfis(id) on delete cascade,
  descricao text not null,
  valor_aportado numeric(12,2) not null default 0,
  participacao_percentual numeric(6,3) not null default 0,
  bonus_xp_percentual numeric(6,2) not null default 0 check (bonus_xp_percentual >= 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create table if not exists public.rendimentos_investidor (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfis(id) on delete cascade,
  competencia date not null,                      -- sempre o dia 1 do mês
  valor_ac bigint not null check (valor_ac > 0),
  observacao text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  unique (usuario_id, competencia)
);
alter table public.cotas_investidor enable row level security;
alter table public.rendimentos_investidor enable row level security;
drop policy if exists cotas_leitura on public.cotas_investidor;
create policy cotas_leitura on public.cotas_investidor for select to authenticated
  using (usuario_id = auth.uid() or public.tem_papel('admin'));
drop policy if exists rendimentos_leitura on public.rendimentos_investidor;
create policy rendimentos_leitura on public.rendimentos_investidor for select to authenticated
  using (usuario_id = auth.uid() or public.tem_papel('admin'));

create or replace function public.cadastrar_cota(_email text, _descricao text, _valor_aportado numeric,
                                                 _participacao numeric, _bonus_xp numeric)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.tem_papel('admin') then raise exception 'sem permissão'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(_email));
  if uid is null then raise exception 'Não há login com esse e-mail. A pessoa precisa criar a conta antes.'; end if;
  insert into public.cotas_investidor (usuario_id, descricao, valor_aportado, participacao_percentual, bonus_xp_percentual)
  values (uid, btrim(_descricao), coalesce(_valor_aportado, 0), coalesce(_participacao, 0), coalesce(_bonus_xp, 0));
end $$;

create or replace function public.encerrar_cota(_cota uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tem_papel('admin') then raise exception 'sem permissão'; end if;
  update public.cotas_investidor set ativo = false where id = _cota;
end $$;

-- Rendimento do mês cai no saldo do investidor em AC (tipo 'rendimento'). Um por mês por investidor.
create or replace function public.pagar_rendimento(_usuario uuid, _competencia date, _valor_ac bigint, _observacao text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tem_papel('admin') then raise exception 'sem permissão'; end if;
  if _valor_ac is null or _valor_ac <= 0 then raise exception 'valor inválido'; end if;
  if not exists (select 1 from public.cotas_investidor where usuario_id = _usuario and ativo) then
    raise exception 'esta pessoa não tem cota ativa';
  end if;
  insert into public.rendimentos_investidor (usuario_id, competencia, valor_ac, observacao, criado_por)
  values (_usuario, date_trunc('month', _competencia)::date, _valor_ac, _observacao, auth.uid());   -- repetir o mês dá erro de duplicidade
  insert into public.livro_saldo (usuario_id, valor_ac, tipo, criado_por) values (_usuario, _valor_ac, 'rendimento', auth.uid());
end $$;

create or replace function public.listar_investidores()
returns table (cota_id uuid, usuario_id uuid, nome text, email text, descricao text, valor_aportado numeric,
               participacao_percentual numeric, bonus_xp_percentual numeric, ativo boolean, total_rendimentos bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tem_papel('admin') then raise exception 'sem permissão'; end if;
  return query
    select c.id, c.usuario_id, p.nome_exibicao, coalesce(u.email, u.phone)::text, c.descricao, c.valor_aportado,
           c.participacao_percentual, c.bonus_xp_percentual, c.ativo,
           coalesce((select sum(r.valor_ac) from public.rendimentos_investidor r where r.usuario_id = c.usuario_id), 0)::bigint
      from public.cotas_investidor c
      join public.perfis p on p.id = c.usuario_id join auth.users u on u.id = c.usuario_id
     order by c.ativo desc, c.criado_em desc;
end $$;

revoke all on function public.cadastrar_cota(text, text, numeric, numeric, numeric), public.encerrar_cota(uuid),
  public.pagar_rendimento(uuid, date, bigint, text), public.listar_investidores() from public, anon;
grant execute on function public.cadastrar_cota(text, text, numeric, numeric, numeric), public.encerrar_cota(uuid),
  public.pagar_rendimento(uuid, date, bigint, text), public.listar_investidores() to authenticated;

-- ---------- 4) Fechar comanda com o "buff" de XP do investidor ----------
create or replace function public.fechar_comanda(_comanda uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.comandas; p public.perfis; total bigint; taxa numeric; bonus numeric; ganho bigint; novo_xp bigint;
begin
  if not public.tem_papel('garcom') then raise exception 'sem permissão'; end if;
  select * into c from public.comandas where id = _comanda for update;
  if not found or c.status <> 'aberta' then raise exception 'comanda inválida'; end if;
  select coalesce(sum(preco_ac * quantidade), 0) into total from public.itens_comanda where comanda_id = _comanda;
  select * into p from public.perfis where id = c.usuario_id for update;

  if total > 0 then
    insert into public.livro_saldo (usuario_id, valor_ac, tipo, comanda_id, criado_por)
    values (c.usuario_id, -total, 'consumo', _comanda, auth.uid());
  end if;

  select valor into taxa from public.configuracoes where chave = 'xp_por_ac';
  select coalesce(sum(bonus_xp_percentual), 0) into bonus from public.cotas_investidor where usuario_id = c.usuario_id and ativo;
  ganho := floor(total * coalesce(taxa, 0) * (1 + bonus / 100.0));
  if ganho > 0 then
    insert into public.eventos_xp (usuario_id, quantidade, origem, comanda_id) values (c.usuario_id, ganho, 'consumo', _comanda);
    if p.faccao is null then
      update public.perfis set xp_bloqueado = xp_bloqueado + ganho where id = p.id;
    else
      novo_xp := p.xp + ganho;
      update public.perfis
         set xp = novo_xp, nivel = (select max(nivel) from public.niveis where xp_necessario <= novo_xp)
       where id = p.id;
      update public.placar_guerra set pontos = pontos + ganho where faccao = p.faccao;
    end if;
  end if;

  update public.comandas set status = 'fechada', total_ac = total, fechada_em = now() where id = _comanda;
end $$;

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

-- ===== 07: descrição do cardápio =====
-- 07: descrição/ingredientes de cada item do cardápio (aparece quando o cliente toca no item)
alter table public.cardapio add column if not exists descricao text;

-- textos INICIAIS de exemplo: só entram onde a descrição está vazia. Edite no Admin > Cardápio.
update public.cardapio c set descricao = v.d
from (values
  ('Hambúrguer da Casa', 'Pão brioche, blend bovino 160 g, queijo cheddar, alface, tomate e molho da casa.'),
  ('Hambúrguer Personalizado', 'Pão brioche e blend bovino 160 g. Você escolhe os extras: bacon, cheddar, ovo, cebola caramelizada, jalapeño, cogumelos, molho da casa ou queijo brie.'),
  ('Batata Crinkle', 'Batata ondulada crocante, temperada com sal e ervas. Acompanha molho.'),
  ('Nachos para Dividir', 'Nachos com queijo derretido, carne, pimenta jalapeño, tomate e creme azedo. Dá para 2 a 3 pessoas.'),
  ('Costela no Pão', 'Costela bovina desfiada e assada por horas, no pão, com queijo e molho barbecue.'),
  ('Mini Combo Kids', 'Mini hambúrguer, batatinha e suco.'),
  ('Caipirinha', 'Cachaça, limão, açúcar e gelo.'),
  ('Mocktail da Casa', 'Drink sem álcool: frutas da estação, hortelã, limão e água com gás.'),
  ('Refrigerante', 'Lata 350 ml, gelada.'),
  ('Cerveja Artesanal', 'Cerveja artesanal gelada. Pergunte à equipe qual rótulo está na casa.'),
  ('Hora de Mesa (1h)', 'Uma hora de mesa reservada para jogar com a sua equipe. Você escolhe o jogo de tabuleiro do catálogo.'),
  ('Aluguel de Jogo de Tabuleiro', 'Empréstimo de um jogo do catálogo para usar na sua mesa durante a visita.'),
  ('Passe Kids (1h)', 'Uma hora no espaço kids, com monitor.')
) v(n, d)
where c.nome = v.n and (c.descricao is null or c.descricao = '');
