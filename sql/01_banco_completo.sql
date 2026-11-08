-- =====================================================================
-- O CONCLAVE / ARCADE — banco completo (Supabase)  ·  v3 (tudo em português)
-- Rodar UMA vez, inteiro, no SQL Editor de um projeto novo.
--
-- Dois apps, UM banco, mesmo login (Supabase Auth):
--   • App do CLIENTE      → usuário sem papel em papeis_usuarios
--   • App do FUNCIONÁRIO  → usuário com papel 'garcom', 'cozinha' ou 'admin'
-- Cada pessoa tem login individual (e-mail + senha). Criança NÃO tem login:
-- fica na tabela "criancas", ligada ao responsável.
-- =====================================================================

-- ---------- Tipos ----------
create type public.faccao as enum ('guilda', 'frequencia', 'esquadrao');
create type public.papel_app as enum ('admin', 'garcom', 'cozinha');
create type public.status_comanda as enum ('aberta', 'fechada', 'cancelada');
create type public.status_item as enum ('pendente', 'preparando', 'pronto', 'entregue');

-- ---------- Configurações editáveis (regras num lugar só) ----------
create table public.configuracoes (
  chave text primary key,
  valor numeric not null,
  observacao text
);
insert into public.configuracoes (chave, valor, observacao) values
  ('xp_por_ac', 1, 'XP ganho por 1 AC gasto. REGRA AINDA NÃO DEFINIDA PELOS SÓCIOS: ajustar aqui.'),
  ('adicional_ac', 5, 'Preço de cada adicional do hambúrguer personalizado (AC).');

create table public.niveis (
  nivel int primary key check (nivel between 0 and 20),
  xp_necessario bigint not null
);
-- PLACEHOLDER linear (100 XP por nível). Troque pela curva oficial quando decidirem.
insert into public.niveis (nivel, xp_necessario)
select n, n * 100 from generate_series(0, 20) n;

-- ---------- Perfis (1 por login) ----------
create table public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome_exibicao text not null,
  faccao public.faccao,                              -- null = Iniciado (XP preso no Cofre)
  xp bigint not null default 0 check (xp >= 0),
  xp_bloqueado bigint not null default 0 check (xp_bloqueado >= 0),
  nivel int not null default 0 check (nivel between 0 and 20),
  saldo_ac bigint not null default 0,                -- pode ficar negativo; converte em R$ no fechamento
  criado_em timestamptz not null default now()
);

create table public.papeis_usuarios (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  papel public.papel_app not null,
  primary key (usuario_id, papel)
);

-- Crianças: sem login, sem CPF, sem e-mail, sem XP/caixa de recompensa.
create table public.criancas (
  id uuid primary key default gen_random_uuid(),
  responsavel_id uuid not null references public.perfis(id) on delete cascade,
  nome text not null,
  criado_em timestamptz not null default now()
);

-- Ao criar o login, cria o perfil automaticamente. NUNCA concede papel.
create or replace function public.criar_perfil_novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome_exibicao)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'nome_exibicao', ''), split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();

create or replace function public.tem_papel(_papel public.papel_app)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.papeis_usuarios
                 where usuario_id = auth.uid() and papel in (_papel, 'admin'));
$$;

create or replace function public.eh_funcionario()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.papeis_usuarios where usuario_id = auth.uid());
$$;

-- ---------- Cardápio ----------
create table public.cardapio (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null,                           -- comida | bebida | jogo | experiencia | kids
  faccao public.faccao,
  preco_ac bigint not null check (preco_ac >= 0),    -- 1 AC = R$ 1
  ativo boolean not null default true
);

-- ---------- Comandas (antes de itens e sessões Kids) ----------
create table public.comandas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfis(id),
  mesa text not null,
  status public.status_comanda not null default 'aberta',
  total_ac bigint,                                   -- preenchido no fechamento
  aberta_em timestamptz not null default now(),
  fechada_em timestamptz
);
-- uma comanda aberta por cliente
create unique index uma_comanda_aberta_por_cliente on public.comandas (usuario_id) where status = 'aberta';

create table public.itens_comanda (
  id uuid primary key default gen_random_uuid(),
  comanda_id uuid not null references public.comandas(id) on delete cascade,
  item_cardapio_id uuid not null references public.cardapio(id),
  quantidade int not null default 1 check (quantidade > 0),
  preco_ac bigint not null check (preco_ac >= 0),    -- preço calculado no servidor
  detalhes_personalizados jsonb,                     -- hambúrguer personalizado: a cozinha lê daqui
  status public.status_item not null default 'pendente',
  criado_em timestamptz not null default now()
);

create table public.sessoes_kids (
  id uuid primary key default gen_random_uuid(),
  comanda_id uuid not null references public.comandas(id) on delete cascade,
  crianca_id uuid not null references public.criancas(id),
  iniciada_em timestamptz not null default now(),
  encerrada_em timestamptz
);

-- ---------- Livro de saldo, XP, quiz, guerra ----------
create table public.livro_saldo (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfis(id),
  valor_ac bigint not null,
  tipo text not null,                                -- recarga | consumo | estorno | bonus
  comanda_id uuid references public.comandas(id),
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

create table public.eventos_xp (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfis(id),
  quantidade bigint not null,
  origem text not null,                              -- consumo | partida | bonus | horario_morto
  comanda_id uuid references public.comandas(id),
  criado_em timestamptz not null default now()
);

-- Quiz e Guerra em tabelas SEPARADAS (o bug antigo era um campo "scores" para os dois)
create table public.respostas_quiz (
  usuario_id uuid not null references public.perfis(id) on delete cascade,
  pergunta_id int not null,
  resposta text not null,
  respondida_em timestamptz not null default now(),
  primary key (usuario_id, pergunta_id)
);

create table public.placar_guerra (
  faccao public.faccao primary key,
  pontos bigint not null default 0
);
insert into public.placar_guerra (faccao) values ('guilda'), ('frequencia'), ('esquadrao');

-- o saldo acompanha o livro automaticamente
create or replace function public.aplicar_livro_saldo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.perfis set saldo_ac = saldo_ac + new.valor_ac where id = new.usuario_id;
  return new;
end $$;
create trigger livro_atualiza_saldo after insert on public.livro_saldo
  for each row execute function public.aplicar_livro_saldo();

-- ---------- Índices ----------
create index on public.itens_comanda (comanda_id);
create index on public.itens_comanda (status);
create index on public.livro_saldo (usuario_id, criado_em desc);
create index on public.eventos_xp (usuario_id, criado_em desc);
create index on public.criancas (responsavel_id);

-- ---------- Segurança (RLS) ----------
alter table public.configuracoes enable row level security;
alter table public.niveis enable row level security;
alter table public.perfis enable row level security;
alter table public.papeis_usuarios enable row level security;
alter table public.criancas enable row level security;
alter table public.cardapio enable row level security;
alter table public.comandas enable row level security;
alter table public.itens_comanda enable row level security;
alter table public.sessoes_kids enable row level security;
alter table public.livro_saldo enable row level security;
alter table public.eventos_xp enable row level security;
alter table public.respostas_quiz enable row level security;
alter table public.placar_guerra enable row level security;

create policy configuracoes_leitura on public.configuracoes for select to authenticated using (true);
create policy configuracoes_admin on public.configuracoes for all to authenticated
  using (public.tem_papel('admin')) with check (public.tem_papel('admin'));
create policy niveis_leitura on public.niveis for select to authenticated using (true);
create policy niveis_admin on public.niveis for all to authenticated
  using (public.tem_papel('admin')) with check (public.tem_papel('admin'));

create policy perfis_leitura on public.perfis for select to authenticated
  using (id = auth.uid() or public.eh_funcionario());
create policy perfis_alterar_proprio on public.perfis for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- o cliente só pode alterar o próprio NOME; XP, saldo, nível e facção ficam bloqueados:
revoke update on public.perfis from authenticated, anon;
grant update (nome_exibicao) on public.perfis to authenticated;

create policy papeis_leitura on public.papeis_usuarios for select to authenticated
  using (usuario_id = auth.uid() or public.tem_papel('admin'));
create policy papeis_admin on public.papeis_usuarios for all to authenticated
  using (public.tem_papel('admin')) with check (public.tem_papel('admin'));

create policy criancas_responsavel on public.criancas for all to authenticated
  using (responsavel_id = auth.uid()) with check (responsavel_id = auth.uid());
create policy criancas_funcionario on public.criancas for select to authenticated using (public.eh_funcionario());

create policy cardapio_leitura on public.cardapio for select to authenticated
  using (ativo or public.eh_funcionario());
create policy cardapio_admin on public.cardapio for all to authenticated
  using (public.tem_papel('admin')) with check (public.tem_papel('admin'));

create policy comandas_leitura on public.comandas for select to authenticated
  using (usuario_id = auth.uid() or public.eh_funcionario());
-- abrir/fechar comanda só pelas funções abaixo (sem policy de insert/update direto)

create policy itens_leitura on public.itens_comanda for select to authenticated
  using (public.eh_funcionario()
         or exists (select 1 from public.comandas c where c.id = comanda_id and c.usuario_id = auth.uid()));
create policy itens_atualizar_status on public.itens_comanda for update to authenticated
  using (public.tem_papel('cozinha') or public.tem_papel('garcom'))
  with check (public.tem_papel('cozinha') or public.tem_papel('garcom'));

create policy kids_garcom on public.sessoes_kids for all to authenticated
  using (public.tem_papel('garcom')) with check (public.tem_papel('garcom'));
create policy kids_responsavel_leitura on public.sessoes_kids for select to authenticated
  using (exists (select 1 from public.comandas c where c.id = comanda_id and c.usuario_id = auth.uid()));

create policy livro_leitura on public.livro_saldo for select to authenticated
  using (usuario_id = auth.uid() or public.tem_papel('admin'));
create policy xp_leitura on public.eventos_xp for select to authenticated
  using (usuario_id = auth.uid() or public.tem_papel('admin'));

create policy quiz_leitura on public.respostas_quiz for select to authenticated using (usuario_id = auth.uid());
create policy quiz_gravar on public.respostas_quiz for insert to authenticated with check (usuario_id = auth.uid());

create policy guerra_leitura on public.placar_guerra for select to authenticated using (true);

-- ---------- Funções (toda regra de dinheiro/XP roda no servidor) ----------

-- CLIENTE: abre a própria comanda
create or replace function public.abrir_comanda(_mesa text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select id into cid from public.comandas where usuario_id = auth.uid() and status = 'aberta';
  if cid is not null then return cid; end if;
  insert into public.comandas (usuario_id, mesa) values (auth.uid(), _mesa) returning id into cid;
  return cid;
end $$;

-- CLIENTE: adiciona item (o preço vem do cardápio, nunca do app).
-- Hambúrguer personalizado: _detalhes = {"adicionais": ["bacon", "cheddar"], ...}
create or replace function public.adicionar_item(_comanda uuid, _item_cardapio uuid, _quantidade int default 1, _detalhes jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m public.cardapio; extra bigint := 0; iid uuid; adicional bigint;
begin
  if not exists (select 1 from public.comandas where id = _comanda and usuario_id = auth.uid() and status = 'aberta') then
    raise exception 'comanda inválida ou fechada';
  end if;
  select * into m from public.cardapio where id = _item_cardapio and ativo;
  if not found then raise exception 'item indisponível'; end if;
  if _detalhes is not null and jsonb_typeof(_detalhes->'adicionais') = 'array' then
    select valor into adicional from public.configuracoes where chave = 'adicional_ac';
    extra := jsonb_array_length(_detalhes->'adicionais') * coalesce(adicional, 0);
  end if;
  insert into public.itens_comanda (comanda_id, item_cardapio_id, quantidade, preco_ac, detalhes_personalizados)
  values (_comanda, _item_cardapio, greatest(_quantidade, 1), m.preco_ac + extra, _detalhes)
  returning id into iid;
  return iid;
end $$;

-- CLIENTE: define a facção UMA vez, depois do quiz (20 respostas). Libera o XP do Cofre.
create or replace function public.definir_faccao(_faccao public.faccao)
returns void language plpgsql security definer set search_path = public as $$
declare p public.perfis;
begin
  select * into p from public.perfis where id = auth.uid() for update;
  if p.faccao is not null then raise exception 'facção já definida (calibração imutável)'; end if;
  if (select count(*) from public.respostas_quiz where usuario_id = auth.uid()) < 20 then
    raise exception 'quiz incompleto';
  end if;
  update public.perfis
     set faccao = _faccao,
         xp = xp + xp_bloqueado,
         xp_bloqueado = 0,
         nivel = (select max(nivel) from public.niveis where xp_necessario <= p.xp + p.xp_bloqueado)
   where id = auth.uid();
  update public.placar_guerra set pontos = pontos + p.xp_bloqueado where faccao = _faccao;
end $$;

-- FUNCIONÁRIO (garçom): recarga de saldo
create or replace function public.recarga_saldo(_usuario uuid, _valor_ac bigint, _tipo text default 'recarga')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tem_papel('garcom') then raise exception 'sem permissão'; end if;
  insert into public.livro_saldo (usuario_id, valor_ac, tipo, criado_por)
  values (_usuario, _valor_ac, _tipo, auth.uid());
end $$;

-- FUNCIONÁRIO (garçom): fecha a comanda, debita o saldo e dá XP
create or replace function public.fechar_comanda(_comanda uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.comandas; p public.perfis; total bigint; taxa numeric; ganho bigint; novo_xp bigint;
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
  ganho := floor(total * coalesce(taxa, 0));
  if ganho > 0 then
    insert into public.eventos_xp (usuario_id, quantidade, origem, comanda_id) values (c.usuario_id, ganho, 'consumo', _comanda);
    if p.faccao is null then
      update public.perfis set xp_bloqueado = xp_bloqueado + ganho where id = p.id;     -- Cofre
    else
      novo_xp := p.xp + ganho;
      update public.perfis
         set xp = novo_xp,
             nivel = (select max(nivel) from public.niveis where xp_necessario <= novo_xp)
       where id = p.id;
      update public.placar_guerra set pontos = pontos + ganho where faccao = p.faccao;
    end if;
  end if;

  update public.comandas set status = 'fechada', total_ac = total, fechada_em = now() where id = _comanda;
end $$;

-- ADMIN: dá papel de funcionário a um login que já existe
create or replace function public.conceder_papel(_email text, _papel public.papel_app)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.tem_papel('admin') then raise exception 'sem permissão'; end if;
  select id into uid from auth.users where lower(email) = lower(_email);
  if uid is null then raise exception 'usuário não encontrado'; end if;
  insert into public.papeis_usuarios (usuario_id, papel) values (uid, _papel) on conflict do nothing;
end $$;

-- Só usuários logados executam; anônimo não.
revoke all on function public.abrir_comanda(text), public.adicionar_item(uuid, uuid, int, jsonb),
  public.definir_faccao(public.faccao), public.recarga_saldo(uuid, bigint, text),
  public.fechar_comanda(uuid), public.conceder_papel(text, public.papel_app) from public, anon;
grant execute on function public.abrir_comanda(text), public.adicionar_item(uuid, uuid, int, jsonb),
  public.definir_faccao(public.faccao), public.recarga_saldo(uuid, bigint, text),
  public.fechar_comanda(uuid), public.conceder_papel(text, public.papel_app) to authenticated;

-- Tempo real: o app do funcionário e a cozinha veem pedidos chegando na hora
alter publication supabase_realtime add table public.comandas, public.itens_comanda;

-- =====================================================================
-- PRIMEIRO ADMIN (faça DEPOIS de criar seu login em Authentication → Users):
--   insert into public.papeis_usuarios (usuario_id, papel)
--   select id, 'admin' from auth.users where email = 'SEU_EMAIL_AQUI';
-- Depois, você dá papel aos funcionários com:
--   select public.conceder_papel('garcom@exemplo.com', 'garcom');
-- =====================================================================
