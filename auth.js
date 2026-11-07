// Login individual (e-mail + senha) pelo Supabase Auth
import { sb, esc, erroAmigavel, toast, comTrava } from './nucleo.js';


// ---------- Regras de senha e limite de tentativas ----------
const SEQ = 'abcdefghijklmnopqrstuvwxyz0123456789qwertyuiopasdfghjklzxcvbnm';
function temSequencia(s) {
  const t = s.toLowerCase();
  for (let i = 0; i + 2 < t.length; i++) {
    const a = t.charCodeAt(i), b = t.charCodeAt(i + 1), c = t.charCodeAt(i + 2);
    if ((b - a === 1 && c - b === 1) || (a - b === 1 && b - c === 1)) return true; // abc, 123, cba, 321
    if (a === b && b === c) return true;                                           // aaa, 111
    const tri = t.slice(i, i + 3), rev = [...tri].reverse().join('');
    if (SEQ.includes(tri) || SEQ.includes(rev)) return true;                       // qwe, asd, zxc
  }
  return false;
}
export function validarSenha(senha, email = '') {
  const erros = [];
  if (senha.length < 8) erros.push('pelo menos 8 caracteres');
  if (!/[a-z]/.test(senha)) erros.push('uma letra minúscula');
  if (!/[A-Z]/.test(senha)) erros.push('uma letra maiúscula');
  if (!/[0-9]/.test(senha)) erros.push('um número');
  if (!/[^A-Za-z0-9]/.test(senha)) erros.push('um símbolo (como * ! @ #)');
  if (temSequencia(senha)) erros.push('sem sequências (123, abc, qwe, aaa)');
  const usuario = email.split('@')[0].toLowerCase();
  if (usuario.length >= 4 && senha.toLowerCase().includes(usuario)) erros.push('sem partes do seu e-mail');
  return erros;
}

const MAX_TENTATIVAS = 5, JANELA_MS = 15 * 60 * 1000;
const chaveTent = email => 'tent:' + email.toLowerCase();
function lerTent(email) {
  try {
    const v = JSON.parse(localStorage.getItem(chaveTent(email)) || '{}');
    return { n: v.n || 0, ate: v.ate || 0 };
  } catch { return { n: 0, ate: 0 }; }
}
function gravarTent(email, v) { try { localStorage.setItem(chaveTent(email), JSON.stringify(v)); } catch {} }
function minutosBloqueio(email) {
  const t = lerTent(email);
  if (t.ate > Date.now()) return Math.ceil((t.ate - Date.now()) / 60000);
  if (t.ate && t.ate <= Date.now()) gravarTent(email, { n: 0, ate: 0 });
  return 0;
}
function falhou(email) {
  const t = lerTent(email); t.n += 1;
  if (t.n >= MAX_TENTATIVAS) t.ate = Date.now() + JANELA_MS;
  gravarTent(email, t);
}
function acertou(email) { try { localStorage.removeItem(chaveTent(email)); } catch {} }

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
          <label>Senha<input name="senha" type="password" required minlength="${cad ? 8 : 1}" autocomplete="${cad ? 'new-password' : 'current-password'}"></label>
          ${cad ? '<p class="sub dica-senha">Mínimo 8 caracteres, com maiúscula, minúscula, número e símbolo (* ! @ #). Sem sequências como 123 ou abc.</p>' : ''}
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
        const email = f.email.trim();
        if (cad) {
          const faltas = validarSenha(f.senha, email);
          if (faltas.length) throw new Error('Senha fraca. Falta: ' + faltas.join('; ') + '.');
          const { data, error } = await sb.auth.signUp({
            email, password: f.senha,
            options: { data: { nome_exibicao: f.nome.trim() } },
          });
          if (error) throw error;
          if (!data.session) { toast('Conta criada! Confirme o e-mail pelo link que enviamos e depois entre.'); modo = 'entrar'; desenhar(); return; }
        } else {
          const min = minutosBloqueio(email);
          if (min) throw new Error(`Muitas tentativas erradas. Tente de novo em ${min} min.`);
          const { error } = await sb.auth.signInWithPassword({ email, password: f.senha });
          if (error) {
            if (/Invalid login credentials/i.test(error.message)) {
              falhou(email);
              const rest = MAX_TENTATIVAS - lerTent(email).n;
              throw new Error(rest > 0 ? `E-mail ou senha incorretos. Restam ${rest} tentativa(s).` : `Muitas tentativas erradas. Tente de novo em ${Math.ceil(JANELA_MS / 60000)} min.`);
            }
            throw error;
          }
          acertou(email);
        }
        opcoes.aoEntrar();
      });
    });
  };
  desenhar();
}
