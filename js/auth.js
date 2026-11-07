// Login individual (e-mail + senha) pelo Supabase Auth
import { sb, esc, erroAmigavel, toast, comTrava } from './nucleo.js';

export async function sessaoAtual() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function sair() {
  await sb.auth.signOut();
  location.reload();
}

// Desenha a tela de login. opcoes: { titulo, subtitulo, permiteCadastro, aoEntrar }
export function montarLogin(raiz, opcoes) {
  let modo = 'entrar';
  const desenhar = () => {
    const cad = modo === 'cadastrar';
    raiz.innerHTML = `
      <div class="login">
        <div class="logo-grande">⚔️</div>
        <h1>${esc(opcoes.titulo)}</h1>
        <p class="sub">${esc(opcoes.subtitulo || '')}</p>
        <form id="form-login" class="cartao">
          ${cad ? '<label>Seu nome<input name="nome" required maxlength="40" autocomplete="name"></label>' : ''}
          <label>E-mail<input name="email" type="email" required autocomplete="email"></label>
          <label>Senha<input name="senha" type="password" required minlength="6" autocomplete="${cad ? 'new-password' : 'current-password'}"></label>
          <button class="botao primario" type="submit">${cad ? 'Criar minha conta' : 'Entrar'}</button>
          ${opcoes.permiteCadastro
            ? `<button class="botao link" type="button" id="alternar">${cad ? 'Já tenho conta' : 'Primeiro acesso? Criar conta'}</button>`
            : '<p class="sub">Acesso só para equipe. Peça seu cadastro ao administrador.</p>'}
        </form>
      </div>`;
    raiz.querySelector('#alternar')?.addEventListener('click', () => { modo = cad ? 'entrar' : 'cadastrar'; desenhar(); });
    raiz.querySelector('#form-login').addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target));
      const btn = ev.target.querySelector('button[type=submit]');
      await comTrava(btn, async () => {
        if (cad) {
          const { data, error } = await sb.auth.signUp({
            email: f.email.trim(), password: f.senha,
            options: { data: { nome_exibicao: f.nome.trim() } },
          });
          if (error) throw error;
          if (!data.session) { toast('Conta criada! Confirme o e-mail pelo link que enviamos e depois entre.'); modo = 'entrar'; desenhar(); return; }
        } else {
          const { error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.senha });
          if (error) throw error;
        }
        opcoes.aoEntrar();
      });
    });
  };
  desenhar();
}
