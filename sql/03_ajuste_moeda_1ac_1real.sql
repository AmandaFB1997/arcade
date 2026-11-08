-- Ajuste para o valor oficial da moeda: 1 AC = R$ 1,00 (antes 1.000 AC = R$ 1).
-- Rode UMA vez, SÓ se o banco já estava criado com a regra antiga. Em banco novo não precisa (01 e 02 já vêm certos).
update public.cardapio set preco_ac = preco_ac / 1000 where preco_ac >= 1000;
update public.configuracoes set valor = 5 where chave = 'adicional_ac' and valor >= 1000;
update public.niveis set xp_necessario = nivel * 100;
