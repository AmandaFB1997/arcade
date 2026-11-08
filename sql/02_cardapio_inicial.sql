-- CARDÁPIO INICIAL PROVISÓRIO — só para testar as telas.
-- Troque pelos itens e preços reais pelo app do funcionário (aba Admin → Cardápio).
-- Preços em AC (1 AC = R$ 1,00).
insert into public.cardapio (nome, categoria, faccao, preco_ac) values
  ('Hambúrguer da Casa',            'comida',       'guilda',     48),
  ('Hambúrguer Personalizado',      'personalizado', null,        52),
  ('Batata Crinkle',                'comida',       'frequencia', 22),
  ('Nachos para Dividir',           'comida',       'esquadrao',  35),
  ('Costela no Pão',                'comida',       'guilda',     58),
  ('Mini Combo Kids',               'kids',         null,         32),
  ('Caipirinha',                    'bebida',       'frequencia', 26),
  ('Mocktail da Casa',              'bebida',       'frequencia', 22),
  ('Refrigerante',                  'bebida',       null,          9),
  ('Cerveja Artesanal',             'bebida',       'esquadrao',  24),
  ('Hora de Mesa (1h)',             'jogo',         null,         15),
  ('Aluguel de Jogo de Tabuleiro',  'jogo',         'guilda',     20),
  ('Passe Kids (1h)',               'kids',         null,         25);
