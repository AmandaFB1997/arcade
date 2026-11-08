// Login individual (e-mail + senha) pelo Supabase Auth
import { sb, esc, erroAmigavel, toast, comTrava, abrirModal, fecharModal } from './nucleo.js';

// ---------- Recuperação de senha (o link do e-mail volta para esta página) ----------
let recuperando = /type=recovery/.test(location.hash);
try { sb?.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') recuperando = true; }); } catch { /* sem banco configurado */ }
export const emRecuperacao = () => recuperando;

export function telaNovaSenha(raiz) {
  raiz.innerHTML = `
    <div class="login">
      <div class="logo-grande"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 8l4 2.3v4.4L12 17l-4-2.3v-4.4z"/></svg></div>
      <h1>Criar nova senha</h1>
      <p class="sub">Escolha uma senha nova para a sua conta.</p>
      <form id="form-nova" class="cartao">
        <label>Nova senha<input name="senha" type="password" required minlength="8" autocomplete="new-password"></label>
        <p class="sub dica-senha">Mínimo 8 caracteres, com maiúscula, minúscula, número e símbolo (* ! @ #). Sem sequências como 123 ou abc.</p>
        <button class="botao primario" type="submit">Salvar e entrar</button>
      </form>
    </div>`;
  raiz.querySelector('#form-nova').addEventListener('submit', ev => {
    ev.preventDefault();
    comTrava(ev.target.querySelector('button[type=submit]'), async () => {
      const { data: { user } } = await sb.auth.getUser();
      const senha = new FormData(ev.target).get('senha');
      const faltas = validarSenha(senha, user?.email || '');
      if (faltas.length) throw new Error('Senha fraca. Falta: ' + faltas.join('; ') + '.');
      const { error } = await sb.auth.updateUser({ password: senha });
      if (error) throw error;
      toast('Senha salva!'); recuperando = false;
      setTimeout(() => location.replace(location.pathname), 700);
    });
  });
}

function pedirRecuperacao(emailInicial = '') {
  const m = abrirModal(`<h2>Esqueci minha senha</h2>
    <p class="sub">Digite o seu e-mail e enviamos um link para você criar uma senha nova.</p>
    <form id="f-esqueci"><label>E-mail<input name="email" type="email" required value="${esc(emailInicial)}" autocomplete="email"></label>
      <button class="botao primario" type="submit">Enviar o link</button>
      <button class="botao" type="button" data-fechar style="width:100%;margin-top:8px">Cancelar</button></form>`);
  m.querySelector('#f-esqueci').addEventListener('submit', ev => {
    ev.preventDefault();
    comTrava(ev.target.querySelector('button[type=submit]'), async () => {
      const email = new FormData(ev.target).get('email').trim();
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) throw error;
      fecharModal(); toast('Se esse e-mail tiver conta, o link já foi enviado. Veja também o spam.');
    });
  });
}


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

// Telefone brasileiro -> +55DDDNÚMERO (aceita "(63) 99999-0000", "63999990000", "+5563999990000")
export function normalizarTelefone(txt) {
  let d = String(txt || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return '+55' + d;
  return null;
}

// Tela de entrada por WhatsApp: pede o número, manda um código de 6 dígitos no WhatsApp e confere.
function montarLoginWhatsApp(raiz, opcoes, voltarParaEmail) {
  let telefone = null;
  const desenhar = () => {
    raiz.innerHTML = `
      <div class="login">
        <div class="logo-grande"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 8l4 2.3v4.4L12 17l-4-2.3v-4.4z"/></svg></div>
        <h1>${esc(opcoes.titulo)}</h1>
        <p class="sub">${esc(opcoes.subtitulo || '')}</p>
        <form id="form-wpp" class="cartao">
          ${telefone
            ? `<label>Código de 6 dígitos<input name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required autofocus></label>
               <p class="sub dica-senha">Enviamos para o WhatsApp ${esc(telefone)}. Pode levar alguns segundos.</p>
               <button class="botao primario" type="submit">Entrar</button>
               <button class="botao link" type="button" id="trocar">Usar outro número</button>`
            : `<label>Seu WhatsApp (com DDD)<input name="telefone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(63) 99999-0000" required></label>
               <button class="botao primario" type="submit">Receber código no WhatsApp</button>`}
          <button class="botao link" type="button" id="usar-email">Prefiro entrar com e-mail e senha</button>
        </form>
        ${extraLinks()}
      </div>`;
    raiz.querySelector('#usar-email').addEventListener('click', voltarParaEmail);
    raiz.querySelector('#trocar')?.addEventListener('click', () => { telefone = null; desenhar(); });
    raiz.querySelector('#form-wpp').addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target));
      await comTrava(ev.target.querySelector('button[type=submit]'), async () => {
        if (!telefone) {
          const t = normalizarTelefone(f.telefone);
          if (!t) throw new Error('Digite o número com DDD. Ex.: (63) 99999-0000');
          const { error } = await sb.auth.signInWithOtp({ phone: t });
          if (error) throw error;
          telefone = t; desenhar();
        } else {
          const { error } = await sb.auth.verifyOtp({ phone: telefone, token: String(f.codigo).trim(), type: 'sms' });
          if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'Código errado ou vencido. Peça um novo.' : error.message);
          opcoes.aoEntrar();
        }
      });
    });
  };
  desenhar();
}

function extraLinks() {
  return `<p class="sub" style="text-align:center;margin-top:14px">${
    location.pathname.includes('/funcionario')
      ? 'Não é da equipe? <a href="../cliente/">Entrar como cliente</a>'
      : 'É da equipe? <a href="../funcionario/"><strong>Entrar como funcionário</strong></a>'}</p>`;
}

// Desenha a tela de login. opcoes: { titulo, subtitulo, permiteCadastro, permiteWhatsApp, aoEntrar }
export function montarLogin(raiz, opcoes) {
  if (opcoes.permiteWhatsApp) {
    let porEmail = false;
    const abrir = () => porEmail ? montarLoginEmail(raiz, opcoes, () => { porEmail = false; abrir(); })
                                 : montarLoginWhatsApp(raiz, opcoes, () => { porEmail = true; abrir(); });
    return abrir();
  }
  return montarLoginEmail(raiz, opcoes);
}

function montarLoginEmail(raiz, opcoes, voltarParaWhatsApp) {
  let modo = 'entrar';
  const desenhar = () => {
    const cad = modo === 'cadastrar';
    raiz.innerHTML = `
      <div class="login">
        <div class="logo-grande"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 8l4 2.3v4.4L12 17l-4-2.3v-4.4z"/></svg></div>
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
        ${cad ? '' : '<p style="text-align:center;margin:10px 0 0"><button class="botao link" type="button" id="esqueci">Esqueci minha senha</button></p>'}
        ${voltarParaWhatsApp ? '<p style="text-align:center;margin:10px 0 0"><button class="botao link" type="button" id="usar-wpp">Entrar com WhatsApp</button></p>' : ''}
        ${extraLinks()}
      </div>`;
    raiz.querySelector('#usar-wpp')?.addEventListener('click', voltarParaWhatsApp);
    raiz.querySelector('#esqueci')?.addEventListener('click', () => pedirRecuperacao(raiz.querySelector('[name=email]')?.value || ''));
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
