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
create policy pacotes_leitura on public.pacotes_recarga for select to authenticated
  using (ativo or public.tem_papel('admin'));
create policy pacotes_admin on public.pacotes_recarga for all to authenticated
  using (public.tem_papel('admin')) with check (public.tem_papel('admin'));
-- pedido: o cliente só LÊ os próprios; quem cria/confirma é o servidor (Edge Function)
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

alter publication supabase_realtime add table public.pedidos_recarga;

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
create policy cotas_leitura on public.cotas_investidor for select to authenticated
  using (usuario_id = auth.uid() or public.tem_papel('admin'));
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
