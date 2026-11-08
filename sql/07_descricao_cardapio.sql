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
