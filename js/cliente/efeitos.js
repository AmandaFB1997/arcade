// Efeitos visuais e de interação do app do cliente (sem dependências)
const reduz = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function vibrar(padrao = 18) { try { navigator.vibrate?.(padrao); } catch {} }

// Números que "sobem" até o valor final: <span data-conta="120">
export function animarNumeros(raiz = document) {
  raiz.querySelectorAll('[data-conta]').forEach(el => {
    const fim = Number(el.dataset.conta); if (!Number.isFinite(fim)) return;
    if (reduz() || fim === 0) { el.textContent = fim.toLocaleString('pt-BR'); return; }
    const t0 = performance.now(), dur = 900;
    const passo = t => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(fim * e).toLocaleString('pt-BR');
      if (k < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  });
}

// Anel de progresso: <circle data-anel="73"> (0 a 100) enche com animação
export function animarAneis(raiz = document) {
  raiz.querySelectorAll('[data-anel]').forEach(c => {
    const pct = Math.max(0, Math.min(100, Number(c.dataset.anel) || 0));
    const r = Number(c.getAttribute('r')), perim = 2 * Math.PI * r;
    c.style.strokeDasharray = `${perim}`;
    c.style.strokeDashoffset = `${perim}`;
    requestAnimationFrame(() => requestAnimationFrame(() => { c.style.strokeDashoffset = `${perim * (1 - pct / 100)}`; }));
  });
}

// Entrada em cascata dos blocos da tela
export function entrada(raiz) {
  [...raiz.children].forEach((el, i) => { el.style.setProperty('--i', Math.min(i, 10)); el.classList.add('entra'); });
}

// Cartões que inclinam seguindo o dedo/mouse (classe .inclina)
export function ligarInclinacao() {
  let alvo = null;
  const sai = () => { if (alvo) { alvo.style.transform = ''; alvo = null; } };
  document.addEventListener('pointermove', e => {
    if (reduz() || e.pointerType === 'touch' && !e.pressure) return;
    const el = e.target.closest?.('.inclina');
    if (!el) return sai();
    if (alvo && alvo !== el) sai();
    alvo = el;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    el.style.transform = `perspective(700px) rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg) translateZ(0)`;
    el.style.setProperty('--lx', `${(x + .5) * 100}%`); el.style.setProperty('--ly', `${(y + .5) * 100}%`);
  });
  document.addEventListener('pointerleave', sai, true);
  document.addEventListener('pointerup', () => setTimeout(sai, 120));
}

// Onda ao tocar em botões
export function ligarOnda() {
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest?.('.botao, .atalhos button, .nav-baixo button, .tile');
    if (!b || reduz()) return;
    const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 1.4;
    const o = document.createElement('span'); o.className = 'onda';
    o.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    b.classList.add('com-onda'); b.appendChild(o); setTimeout(() => o.remove(), 650);
  });
}

// Confirmação grande no centro da tela: "o que você fez aparece pra você"
let tFeedback = null;
export function feedback({ icone = '✓', titulo, sub = '', tipo = 'ok', ms = 1700, acao = null }) {
  document.getElementById('feedback')?.remove(); clearTimeout(tFeedback);
  const el = document.createElement('div'); el.id = 'feedback'; el.className = `feedback ${tipo}`;
  const confete = tipo === 'ok' ? Array.from({ length: 14 }, (_, i) =>
    `<i style="--a:${i * 25.7}deg;--d:${50 + (i % 4) * 14}px;--c:${i % 3}"></i>`).join('') : '';
  el.innerHTML = `<div class="feedback-caixa"><div class="feedback-anel"><span>${icone}</span>${confete}</div>
    <strong>${titulo}</strong>${sub ? `<small>${sub}</small>` : ''}
    ${acao ? `<button class="botao primario feedback-acao" type="button">${acao.texto}</button>` : ''}</div>`;
  el.addEventListener('click', e => {
    if (acao && e.target.closest('.feedback-acao')) { el.remove(); acao.fn(); return; }
    if (!acao || !e.target.closest('.feedback-caixa')) el.remove();
  });
  document.body.appendChild(el); vibrar(tipo === 'ok' ? [14, 40, 14] : 30);
  if (!acao) tFeedback = setTimeout(() => { el.classList.add('saindo'); setTimeout(() => el.remove(), 300); }, ms);
}

// Voa um "+1" do botão até o ícone da comanda
export function voarParaComanda(origem) {
  const alvo = document.querySelector('#cnt-comanda')?.parentElement; if (!origem || !alvo || reduz()) return;
  const a = origem.getBoundingClientRect(), b = alvo.getBoundingClientRect();
  const p = document.createElement('div'); p.className = 'voador'; p.textContent = '+1';
  p.style.cssText = `left:${a.left + a.width / 2}px;top:${a.top + a.height / 2}px`;
  document.body.appendChild(p);
  requestAnimationFrame(() => { p.style.transform = `translate(${b.left + b.width / 2 - a.left - a.width / 2}px, ${b.top + b.height / 2 - a.top - a.height / 2}px) scale(.4)`; p.style.opacity = '.2'; });
  setTimeout(() => p.remove(), 750);
  alvo.classList.add('pulsa'); setTimeout(() => alvo.classList.remove('pulsa'), 600);
}
