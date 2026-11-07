-- CARDÁPIO INICIAL PROVISÓRIO — só para testar as telas.
-- Troque pelos itens e preços reais pelo app do funcionário (aba Admin → Cardápio).
-- Preços em AC (1.000 AC = R$ 1,00).
insert into public.cardapio (nome, categoria, faccao, preco_ac) values
  ('Hambúrguer da Casa',            'comida',       'guilda',     48000),
  ('Hambúrguer Personalizado',      'personalizado', null,        52000),
  ('Batata Crinkle',                'comida',       'frequencia', 22000),
  ('Nachos para Dividir',           'comida',       'esquadrao',  35000),
  ('Costela no Pão',                'comida',       'guilda',     58000),
  ('Mini Combo Kids',               'kids',         null,         32000),
  ('Caipirinha',                    'bebida',       'frequencia', 26000),
  ('Mocktail da Casa',              'bebida',       'frequencia', 22000),
  ('Refrigerante',                  'bebida',       null,          9000),
  ('Cerveja Artesanal',             'bebida',       'esquadrao',  24000),
  ('Hora de Mesa (1h)',             'jogo',         null,         15000),
  ('Aluguel de Jogo de Tabuleiro',  'jogo',         'guilda',     20000),
  ('Passe Kids (1h)',               'kids',         null,         25000);
