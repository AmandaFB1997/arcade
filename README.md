# O Conclave — apps do cliente e da equipe

Site estático (HTML, CSS e JavaScript puros) ligado ao Supabase. Sem build, sem instalar nada.
Mesmo padrão do ERP da Gefoscal: subir os arquivos no GitHub e publicar no GitHub Pages.

## Estrutura

```
index.html              escolha: "Sou cliente" / "Sou da equipe"
cliente/index.html      app do CLIENTE (celular)
funcionario/index.html  app da EQUIPE (salão, cozinha, admin)
css/                    base.css (visual) · cliente.css · funcionario.css
js/config.js            ← COLE AQUI a URL e a chave anon do Supabase
js/nucleo.js            funções compartilhadas (formatação, avisos, janelas)
js/auth.js              login individual (e-mail + senha)
js/cliente/app.js       telas do cliente
js/funcionario/app.js   telas da equipe
js/dados/quiz.js        perguntas do quiz (PROVISÓRIAS — trocar pelas oficiais)
js/dados/adicionais.js  adicionais do hambúrguer personalizado
sql/01_banco_completo.sql   cria todo o banco (rodar uma vez)
sql/02_cardapio_inicial.sql cardápio provisório para testar
```

## Colocar no ar (ordem)

1. **Banco:** no SQL Editor do projeto Supabase, rode `sql/01_banco_completo.sql` inteiro.
   Depois rode `sql/02_cardapio_inicial.sql` (opcional, só para testar).
2. **Login:** em *Authentication → Providers → Email*, para o MVP desligue
   "Confirm email" (senão cada cliente precisa clicar no link do e-mail antes de entrar).
3. **Seu admin:** crie sua conta pelo app do cliente (ou em *Authentication → Users*) e rode,
   com o seu e-mail:
   ```sql
   insert into public.papeis_usuarios (usuario_id, papel)
   select id, 'admin' from auth.users where email = 'SEU_EMAIL_AQUI';
   ```
4. **Ligar o site ao banco:** em *Project Settings → API* copie a **Project URL** e a chave **anon public**
   e cole em `js/config.js`. (Nunca use a `service_role` aqui.)
5. **Publicar:** suba tudo para um repositório no GitHub (mantendo as pastas) e ative
   *Settings → Pages → Deploy from a branch → main / root*.
6. **Equipe:** entre em `…/funcionario/` com seu admin → aba **Admin → Equipe** para dar o papel
   `garcom` ou `cozinha` a quem já tem conta.

## Como cada papel usa

| Quem | App | O que faz |
|---|---|---|
| Cliente | `/cliente/` | cardápio, pedido, comanda ao vivo, quiz da facção, guerra, perfil, crianças |
| Garçom | `/funcionario/` | comandas abertas, recarga de saldo, Kids, fechar conta |
| Cozinha | `/funcionario/` | fila de pedidos com adicionais e observações do hambúrguer personalizado |
| Admin | `/funcionario/` | cardápio, regras (XP, adicional), níveis, equipe |

## O que ainda é provisório

- **Quiz:** 20 perguntas genéricas em `js/dados/quiz.js`. Troque pelas oficiais (3 respostas por pergunta, uma por facção).
- **Regra de XP e curva de níveis:** 1 XP por AC e 50.000 XP por nível. Editáveis em *Admin → Regras e níveis*.
- **Cardápio:** itens e preços de exemplo; edite em *Admin → Cardápio*.
- **Cores das facções:** em `css/base.css` (variáveis `--guilda`, `--frequencia`, `--esquadrao`).

## Segurança (resumo)

Preço, saldo, XP, nível e facção só mudam por funções do banco; o app apenas pede. O cliente só altera o próprio nome.
A chave `anon` pode ficar no código porque o banco protege tudo com RLS.
