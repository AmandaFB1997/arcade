// Núcleo compartilhado pelos dois apps (cliente e funcionário)
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configurado = !SUPABASE_URL.startsWith('COLE_') && !SUPABASE_ANON_KEY.startsWith('COLE_');
export const sb = configurado && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 1.000 AC = R$ 1,00
export const fmtNum = n => Number(n || 0).toLocaleString('pt-BR');
export const fmtReais = ac => (Number(ac || 0) / 1000).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtAC = ac => `${fmtNum(ac)} AC`;
export const fmtAcReais = ac => `${fmtAC(ac)} <small>(${fmtReais(ac)})</small>`;

export function tempoDecorrido(desdeISO) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(desdeISO).getTime()) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

export const NOME_FACCAO = { guilda: 'Guilda', frequencia: 'Frequência', esquadrao: 'Esquadrão' };

export function erroAmigavel(e) {
  const m = (e && (e.message || e.error_description)) || String(e || 'Erro desconhecido');
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/User already registered/i.test(m)) return 'Esse e-mail já tem cadastro. Entre com a senha.';
  if (/Password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/Email not confirmed/i.test(m)) return 'Confirme o e-mail pelo link que enviamos e entre de novo.';
  if (/sem permiss/i.test(m)) return 'Você não tem permissão para isso.';
  return m;
}

export function toast(msg, tipo = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), tipo === 'erro' ? 6000 : 3000);
}

export function abrirModal(html) {
  $('#modal')?.remove();                       // sempre um modal novo: evita ouvintes de modais antigos
  const m = document.createElement('div'); m.id = 'modal'; document.body.appendChild(m);
  m.innerHTML = `<div class="modal-fundo" data-fechar></div><div class="modal-caixa" role="dialog">${html}</div>`;
  m.classList.add('aberto');
  m.querySelectorAll('[data-fechar]').forEach(el => el.addEventListener('click', fecharModal));
  return m;
}
export function fecharModal() {
  $('#modal')?.remove();
}

// Divide "a|b|c" só no primeiro "|" (nomes podem ter qualquer caractere)
export function partir(s) {
  const i = String(s).indexOf('|');
  return i < 0 ? [String(s), ''] : [String(s).slice(0, i), String(s).slice(i + 1)];
}

export function avisoSemConfig(raiz) {
  raiz.innerHTML = `
    <div class="cartao aviso">
      <h2>Falta ligar ao banco</h2>
      <p>Abra o arquivo <code>js/config.js</code> e cole a <strong>URL</strong> e a chave <strong>anon</strong> do seu projeto Supabase
      (Project Settings → API). Depois suba o arquivo de novo.</p>
    </div>`;
}

// Executa uma ação com botão travado (evita clique duplo em ação de dinheiro)
export async function comTrava(botao, fn) {
  if (botao) botao.disabled = true;
  try { return await fn(); }
  catch (e) { toast(erroAmigavel(e), 'erro'); }
  finally { if (botao) botao.disabled = false; }
}

// Busca "em qualquer parte do texto" (padrão das buscas do sistema)
export const contem = (texto, termo) =>
  String(texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .includes(String(termo ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
