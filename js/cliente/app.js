// App do CLIENTE — O Conclave
import { sb, configurado, $, $$, esc, fmtNum, fmtAC, fmtAcReais, toast, abrirModal, fecharModal,
         avisoSemConfig, comTrava, erroAmigavel, NOME_FACCAO } from '../nucleo.js';
import { sessaoAtual, montarLogin, sair, validarSenha, emRecuperacao, telaNovaSenha } from '../auth.js';
import { PERGUNTAS } from '../dados/quiz.js';
import { ADICIONAIS } from '../dados/adicionais.js';
import { animarNumeros, animarAneis, entrada, ligarInclinacao, ligarOnda, feedback, voarParaComanda, vibrar } from './efeitos.js';

const raiz = document.getElementById('app');
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const ICONE = {
  inicio: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  cardapio: svg('<path d="M4 4v7a3 3 0 003 3v6"/><path d="M7 4v6"/><path d="M10 4v7a3 3 0 01-3 3"/><path d="M17 4c-2 1-3 3-3 6s1 4 3 4v6"/>'),
  comanda: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  guerra: svg('<path d="M14 4l6 6-9 9-6-6z"/><path d="M5 19l-2 2"/><path d="M4 4l6 6"/>'),
  perfil: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
};
// Sigilo de cada casa + o do Iniciado (silhueta)
const SIGILO = {
  guilda: svg('<path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/><circle cx="12" cy="12" r="2"/>'),
  frequencia: svg('<path d="M2 12h3l2-6 3 12 3-16 3 14 2-8 2 4h2"/>'),
  esquadrao: svg('<path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z"/><path d="M12 7v10M8 11h8"/>'),
  iniciado: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
};
const LOGO = svg('<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 8l4 2.3v4.4L12 17l-4-2.3v-4.4z"/>');
const TEXTO_CASA = {
  guilda: 'Estrategistas e contadores de histórias. Quem lê o manual até o fim e ainda inventa a regra da casa.',
  frequencia: 'Instinto, ritmo e presença. Você sente a mesa antes de ler o jogo.',
  esquadrao: 'Quem leva a turma junto. A vitória só vale quando é dividida.',
};
const TELAS = [
  ['inicio', 'Início'], ['cardapio', 'Cardápio'], ['comanda', 'Comanda'], ['guerra', 'Guerra'], ['perfil', 'Perfil'],
];
const dorme = ms => new Promise(r => setTimeout(r, ms));
const CATEGORIAS = { comida: 'Comida', bebida: 'Bebidas', jogo: 'Jogos', experiencia: 'Experiências', kids: 'Kids', personalizado: 'Monte o seu' };

const S = {
  user: null, perfil: null, niveis: [], cfg: {}, cardapio: [], comanda: null, itens: [],
  criancas: [], cotas: [], pedido: null, fotoUrl: null, perfilAba: 'resumo', jogos: [], mesa: null, tela: 'inicio', categoria: 'todos',
  quiz: { ordem: {}, empate: null, comecou: false },
};
let iniciado = false;

/* ---------- carga de dados ---------- */
const ok = r => { if (r.error) throw r.error; return r.data; };

async function carregar() {
  const [perfil, niveis, cfg, cardapio] = await Promise.all([
    sb.from('perfis').select('*').eq('id', S.user.id).maybeSingle().then(ok),
    sb.from('niveis').select('*').order('nivel').then(ok),
    sb.from('configuracoes').select('*').then(ok),
    sb.from('cardapio').select('*').eq('ativo', true).order('categoria').order('nome').then(ok),
  ]);
  if (!perfil) throw new Error('Seu perfil não foi criado. Peça ao administrador para conferir o banco.');
  S.perfil = perfil; S.niveis = niveis; S.cardapio = cardapio;
  S.cfg = Object.fromEntries(cfg.map(c => [c.chave, Number(c.valor)]));
  S.cotas = await sb.from('cotas_investidor').select('*').eq('usuario_id', S.user.id).eq('ativo', true)
    .then(r => r.error ? [] : r.data, () => []);
  await carregarComanda();
  await carregarJogos(); await carregarMesa();
  await carregarFoto();
}

async function recarregarPerfil() {
  S.perfil = ok(await sb.from('perfis').select('*').eq('id', S.user.id).single());
}

async function carregarComanda() {
  S.comanda = ok(await sb.from('comandas').select('*').eq('usuario_id', S.user.id).eq('status', 'aberta').maybeSingle());
  S.itens = S.comanda
    ? ok(await sb.from('itens_comanda').select('*, cardapio(nome)').eq('comanda_id', S.comanda.id).order('criado_em'))
    : [];
}

const totalComanda = () => S.itens.reduce((t, i) => t + i.preco_ac * i.quantidade, 0);

/* ---------- estrutura ---------- */
function desenhar() {
  document.body.dataset.faccao = S.perfil?.faccao || '';
  document.body.classList.toggle('modo-quiz', S.tela === 'quiz' && !S.perfil?.faccao);
  if (!$('#main')) {
    raiz.innerHTML = `
      <header class="topo linha"><span class="marca">${LOGO} O CONCLAVE</span><button class="saldo" id="saldo" data-ir="carteira" aria-label="Carregar moedas"></button></header>
      <main id="main"></main>
      <button class="pill-mesa" id="pill-mesa" data-ir="mesa" hidden></button>
      <nav class="nav-baixo">${TELAS.map(([id, nome]) =>
        `<button data-tela="${id}">${ICONE[id]}${nome}<b class="contador" id="cnt-${id}" hidden></b></button>`).join('')}</nav>`;
  }
  $('#saldo').textContent = fmtAC(S.perfil.saldo_ac);
  const pill = $('#pill-mesa');
  if (pill) {
    pill.hidden = !S.mesa || S.tela === 'mesa';
    if (S.mesa) pill.innerHTML = `<span>🎲</span> ${S.mesa.status === 'pronta' ? `<b>Sua mesa está pronta!</b> ${esc(S.mesa.mesa_jogo || '')}` : S.mesa.status === 'jogando' ? '<b>Partida em andamento</b>' : `<b>${esc(ROTULO_MESA[S.mesa.status])}</b>`}`;
    pill.classList.toggle('alerta', S.mesa?.status === 'pronta');
  }
  $$('.nav-baixo button').forEach(b => b.classList.toggle('ativo', b.dataset.tela === S.tela));
  const cnt = $('#cnt-comanda');
  cnt.hidden = S.itens.length === 0; cnt.textContent = S.itens.length;
  const vistas = { carteira: vCarteira, covil: vCovil, inicio: vInicio, cardapio: vCardapio, comanda: vComanda, guerra: vGuerra, perfil: vPerfil, quiz: vQuiz, mesa: vMesa };
  const tela = vistas[S.tela] || vInicio;
  Promise.resolve(tela()).then(html => { const m = $('#main'); if (m) { m.innerHTML = html; entrada(m); animarNumeros(m); animarAneis(m); } })
    .catch(e => { $('#main').innerHTML = `<div class="cartao aviso">${esc(erroAmigavel(e))}</div>`; });
}

function ir(tela) {
  S.tela = tela;
  const ir2 = () => { if (location.hash !== '#' + tela) location.hash = tela; else desenhar(); };
  if (['mesa', 'inicio'].includes(tela) && S.user) carregarMesa().catch(() => {}).then(ir2); else ir2();   // garante a mesa em dia
}

/* ---------- telas ---------- */
const ICONE_CAT = { comida: '🍔', bebida: '🍹', jogo: '🎲', kids: '🧸', personalizado: '✨', experiencia: '🎟️' };
const ROTULO_STATUS = { pendente: 'Pendente', preparando: 'Preparando', pronto: 'Pronto', entregue: 'Entregue' };
const ETAPAS = ['pendente', 'preparando', 'pronto', 'entregue'];
const CASAS = ['guilda', 'frequencia', 'esquadrao'];

function progressoNivel() {
  const p = S.perfil;
  const atual = S.niveis.find(n => n.nivel === p.nivel);
  const prox = S.niveis.find(n => n.nivel === p.nivel + 1);
  const base = atual?.xp_necessario ?? 0;
  const pct = prox ? Math.max(0, Math.min(100, ((p.xp - base) / (prox.xp_necessario - base)) * 100)) : 100;
  return { prox, pct, falta: prox ? Math.max(0, prox.xp_necessario - p.xp) : 0 };
}

const ORDEM_CAT = ['jogo', 'experiencia', 'bebida', 'personalizado', 'comida', 'kids'];
const ROTULO_SECAO = { jogo: 'Jogos e mesas', experiencia: 'Experiências', bebida: 'Bebidas', personalizado: 'Monte o seu', comida: 'Para comer', kids: 'Kids' };
const ARTE_JOGO = ['a', 'b', 'c', 'd'];
const ehJogo = i => i.categoria === 'jogo' || i.categoria === 'experiencia';
const ordemCat = (a, b) => (ORDEM_CAT.indexOf(a) + 100) % 100 - (ORDEM_CAT.indexOf(b) + 100) % 100;

function tileJogo(i, n = 0) {
  return `
    <article class="tile inclina arte-${ARTE_JOGO[n % ARTE_JOGO.length]}" data-busca="${esc((i.nome + ' jogo ' + (CATEGORIAS[i.categoria] || '')).toLowerCase())}">
      <div class="tile-brilho"></div>
      <div class="tile-icone">${ICONE_CAT[i.categoria] || '🎲'}</div>
      <h3>${esc(i.nome)}</h3>
      ${i.faccao && S.perfil?.faccao ? `<span class="chip ${i.faccao}">${NOME_FACCAO[i.faccao]}</span>` : ''}
      <div class="tile-rodape"><span class="preco">${fmtAC(i.preco_ac)}</span>
        <button class="botao pequeno primario" data-add="${i.id}">Jogar</button></div>
    </article>`;
}

function cartaoItem(i, compacto = false) {
  const pers = i.categoria === 'personalizado';
  return `
    <div class="cartao item inclina ${compacto ? 'compacto' : ''} ${i.descricao ? 'tem-desc' : ''}" ${i.descricao ? 'data-desc tabindex="0" role="button" aria-expanded="false"' : ''} data-busca="${esc((i.nome + ' ' + (CATEGORIAS[i.categoria] || i.categoria)).toLowerCase())}">
      <div class="item-icone">${ICONE_CAT[i.categoria] || '🍽️'}</div>
      <div class="item-corpo">
        <h3>${esc(i.nome)}</h3>
        ${i.faccao && S.perfil?.faccao ? `<span class="chip ${i.faccao}">${NOME_FACCAO[i.faccao]}</span> ` : ''}
        <div class="preco">${fmtAC(i.preco_ac)}${pers ? ' <small>+ adicionais</small>' : ''}</div>
        ${i.descricao ? '<small class="ver-mais">o que tem ▾</small>' : ''}
      </div>
      <button class="botao ${compacto ? 'pequeno' : ''}" data-add="${i.id}">${pers ? 'Montar' : 'Pedir'}</button>
      ${i.descricao ? `<div class="item-desc"><p>${esc(i.descricao)}</p></div>` : ''}
    </div>`;
}

async function vInicio() {
  const p = S.perfil;
  const { prox, pct, falta } = progressoNivel();
  const rank = p.faccao ? `${NOME_FACCAO[p.faccao]} · Nível ${p.nivel}` : 'Iniciado · Nível 0';
  const placar = await sb.from('placar_guerra').select('*').then(r => r.error ? [] : r.data, () => []);
  const maxPts = Math.max(1, ...placar.map(l => Number(l.pontos)));
  const jogos = S.cardapio.filter(ehJogo);
  const abertos = S.itens.filter(i => i.status !== 'entregue');
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  return `
    <section class="heroi grande">
      <div class="heroi-fundo"><i></i><i></i><i></i></div>
      <div class="heroi-topo">
        <div class="anel-avatar">
          <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" class="anel-base"/><circle cx="50" cy="50" r="46" class="anel-prog" data-anel="${p.faccao ? pct : 0}"/></svg>
          ${avatarHtml(p)}
        </div>
        <div>
          <div class="titulo-rank">${rank}</div>
          <h2>${saudacao}, ${esc(p.nome_exibicao.split(' ')[0])}</h2>
          <small class="sub">${p.faccao ? (prox ? `Faltam ${fmtNum(falta)} XP para o nível ${prox.nivel}` : 'Nível máximo') : 'Faça o teste e escolha a sua casa'}</small>
        </div>
      </div>
      <div class="heroi-saldo">
        <div><span class="rotulo">Seu saldo</span><p class="moedas"><span data-conta="${p.saldo_ac}">${fmtNum(p.saldo_ac)}</span> <small>AC</small></p></div>
        <button class="botao primario" data-ir="carteira">+ Carregar</button>
      </div>
      ${p.saldo_ac < 0 ? '<small>A diferença é cobrada em reais no fechamento.</small>' : ''}
    </section>

    ${S.mesa ? `<section class="cartao mesa-card inclina ${S.mesa.status === 'pronta' ? 'alerta' : ''}">
      <div class="linha"><div><small>SUA PARTIDA</small><h3 style="margin:2px 0">🎲 ${esc(nomeDoJogo(S.mesa))}</h3>
        <small>${S.mesa.status === 'pronta' ? `Mesa pronta! ${esc(S.mesa.mesa_jogo || '')}` : esc(ROTULO_MESA[S.mesa.status])}</small></div>
        <button class="botao primario" style="width:auto" data-ir="mesa">Abrir</button></div></section>` : ''}

    ${!p.faccao ? `
    <section class="cartao aviso cofre inclina">
      <div class="tranca">🔒</div>
      <h3>Cofre de Cristal</h3>
      <div class="xp-pend"><span data-conta="${p.xp_bloqueado}">${fmtNum(p.xp_bloqueado)}</span> XP trancados</div>
      <p class="sub" style="margin:6px 0 16px">Os deuses do Conclave ainda não conhecem a sua verdadeira natureza. Faça o Teste de Calibração e libere tudo.</p>
      <button class="botao primario" data-ir="quiz">Iniciar o teste</button>
    </section>` : ''}

    <section>
      <div class="linha secao-titulo"><h3>🎲 Jogue agora</h3><button class="botao pequeno" data-cat="jogo" data-ir="cardapio">Ver todos</button></div>
      ${jogos.length ? `<div class="carrossel">${jogos.map((j, n) => tileJogo(j, n)).join('')}</div>`
        : '<div class="cartao"><p class="sub" style="margin:0">Os jogos da casa aparecem aqui assim que forem cadastrados.</p></div>'}
    </section>

    <div class="atalhos">
      <button data-ir="cardapio">${ICONE.cardapio}<span>Pedir</span></button>
      <button data-ir="comanda">${ICONE.comanda}<span>Comanda</span></button>
      <button data-ir="carteira"><span class="ico-moeda">AC</span><span>Moedas</span></button>
      <button data-ir="guerra">${ICONE.guerra}<span>Guerra</span></button>
    </div>

    ${abertos.length ? `
    <section class="cartao">
      <div class="linha"><h3>Seus pedidos agora</h3><button class="botao pequeno" data-ir="comanda">Ver tudo</button></div>
      ${abertos.slice(0, 3).map(i => `<div class="linha mini-pedido"><span>${i.quantidade}× ${esc(i.cardapio?.nome || 'Item')}</span><span class="chip ${i.status}">${ROTULO_STATUS[i.status] || i.status}</span></div>`).join('')}
    </section>` : ''}

    ${placar.length ? `
    <section class="cartao">
      <div class="linha"><h3>Guerra das casas</h3><button class="botao pequeno" data-ir="guerra">Ver placar</button></div>
      ${CASAS.map(c => { const l = placar.find(x => x.faccao === c); const pts = Number(l?.pontos || 0);
        return `<div class="mini-guerra ${c}"><span>${NOME_FACCAO[c]}</span><div class="barra"><i style="width:${(pts / maxPts) * 100}%"></i></div><b>${fmtNum(pts)}</b></div>`; }).join('')}
    </section>` : ''}

    ${S.cotas.length ? `<section class="cartao dourado"><h3>🐉 Covil do Dragão</h3>
      <p class="sub" style="margin:4px 0 12px">Você é da Sociedade Secreta. Veja suas cotas e rendimentos.</p>
      <button class="botao" data-ir="covil">Abrir o Covil</button></section>` : ''}

    <section class="cartao inclina">
      <div class="linha"><h3>Sede ou fome?</h3><button class="botao pequeno" data-cat="bebida" data-ir="cardapio">Bebidas</button></div>
      <p class="sub" style="margin:6px 0 0">${S.comanda
        ? `Mesa <strong>${esc(S.comanda.mesa)}</strong> · ${S.itens.length} item(ns) · <span class="preco">${fmtAC(totalComanda())}</span>`
        : 'Peça sem sair do jogo: o garçom leva até a sua mesa.'}</p>
    </section>`;
}

function vCardapio() {
  const cats = [...new Set(S.cardapio.map(i => i.categoria))].sort(ordemCat);
  const lista = S.cardapio.filter(i => S.categoria === 'todos' || i.categoria === S.categoria);
  const grupos = cats.filter(c => lista.some(i => i.categoria === c));
  return `
    <div class="cardapio-topo">
      <h2>O que vamos jogar?</h2>
      <input class="busca" id="busca" type="search" placeholder="Buscar jogo, bebida ou prato" autocomplete="off">
    </div>
    <div class="categorias">${['todos', ...cats].map(c =>
      `<button class="botao pequeno ${c === S.categoria ? 'ativo' : ''}" data-cat="${esc(c)}">${c === 'todos' ? 'Tudo' : `${ICONE_CAT[c] || ''} ${esc(CATEGORIAS[c] || c)}`}</button>`).join('')}</div>
    ${grupos.length ? grupos.map(c => {
      const itens = lista.filter(i => i.categoria === c);
      return `<section class="secao-cardapio" data-secao>
        <h3 class="secao-nome">${ICONE_CAT[c] || ''} ${esc(ROTULO_SECAO[c] || c)}</h3>
        ${ehJogo(itens[0]) ? `<div class="grade-jogos">${itens.map((j, n) => tileJogo(j, n)).join('')}</div>` : itens.map(i => cartaoItem(i)).join('')}
      </section>`; }).join('') : '<p class="vazio">Cardápio vazio. Peça ao administrador para cadastrar os itens.</p>'}
    <p class="vazio" id="sem-resultado" hidden>Nada encontrado com essa busca.</p>`;
}

function vComanda() {
  if (!S.comanda) return '<p class="vazio">Sem comanda aberta.<br><button class="botao" data-ir="cardapio" style="margin-top:12px">Ir ao cardápio</button></p>';
  const total = totalComanda();
  const depois = S.perfil.saldo_ac - total;
  const taxa = S.cfg.xp_por_ac ?? 1, xpPrev = Math.floor(total * taxa);
  const grupos = [['pendente', '🕐 Na fila'], ['preparando', '👨‍🍳 Sendo preparados'], ['pronto', '🔔 Prontos, a caminho'], ['entregue', '✅ Entregues']];
  const feitos = S.itens.filter(i => i.status === 'entregue').length;
  const pctEntrega = S.itens.length ? Math.round((feitos / S.itens.length) * 100) : 0;
  const linha = i => `
    <div class="pedido ${i.status}">
      <div class="linha"><div><strong>${i.quantidade}× ${esc(i.cardapio?.nome || 'Item')}</strong>
        ${i.detalhes_personalizados?.adicionais?.length ? `<br><small>+ ${esc(i.detalhes_personalizados.adicionais.join(', '))}</small>` : ''}
        ${i.detalhes_personalizados?.observacao ? `<br><small>Obs: ${esc(i.detalhes_personalizados.observacao)}</small>` : ''}</div>
        <span class="preco">${fmtAC(i.preco_ac * i.quantidade)}</span></div>
      <div class="etapas">${ETAPAS.map((e, n) => `<i class="${n <= Math.max(0, ETAPAS.indexOf(i.status)) ? 'feita' : ''}"></i>`).join('')}</div>
    </div>`;
  return `
    <section class="cartao comanda-topo">
      <div class="linha"><div><small class="titulo-rank">Sua comanda</small><h2 style="margin:2px 0 0">Mesa ${esc(S.comanda.mesa)}</h2></div>
        <span class="preco total">${fmtAC(total)}</span></div>
      ${S.itens.length ? `<div class="barra" style="margin:12px 0 4px"><i style="width:${pctEntrega}%"></i></div>
        <small class="sub">${feitos} de ${S.itens.length} ${S.itens.length === 1 ? 'item entregue' : 'itens entregues'}</small>` : ''}
    </section>
    ${S.mesa ? `<button class="cartao comanda-mesa" data-ir="mesa"><span>🎲</span><div><b>${esc(nomeDoJogo(S.mesa))}</b><small>${esc(ROTULO_MESA[S.mesa.status])}${S.mesa.mesa_jogo ? ` · ${esc(S.mesa.mesa_jogo)}` : ''}</small></div><em>Abrir ›</em></button>` : ''}
    ${S.itens.length ? grupos.map(([st, nome]) => {
      const l = S.itens.filter(i => i.status === st); if (!l.length) return '';
      return `<section class="cartao grupo-pedido"><h3 class="grupo-nome">${nome} <b>${l.length}</b></h3>${l.map(linha).join('')}</section>`;
    }).join('') : '<section class="cartao"><p class="sub" style="margin:0">Ainda sem itens. <button class="botao pequeno" data-ir="cardapio">Pedir algo</button></p></section>'}
    <section class="cartao resumo">
      <div class="linha"><span>Saldo atual</span><span class="preco">${fmtAC(S.perfil.saldo_ac)}</span></div>
      <div class="linha"><span>Esta comanda</span><span class="preco">− ${fmtAC(total)}</span></div>
      <div class="linha forte"><span>Saldo depois</span><span class="preco ${depois < 0 ? 'negativo' : ''}">${fmtAC(depois)}</span></div>
      ${depois < 0 ? '<small>O que passar do saldo é cobrado em reais no fechamento. <a href="#carteira">Carregar moedas</a></small>' : ''}
    </section>
    ${xpPrev > 0 ? `<section class="cartao xp-prev"><span>✨</span><div><b>+${fmtNum(xpPrev)} XP</b><small>${S.perfil.faccao ? 'você ganha quando a conta for fechada' : 'vão para o seu Cofre até você escolher a casa'}</small></div></section>` : ''}
    <p class="sub">A conta é fechada na mesa pelo garçom.</p>`;
}

async function vGuerra() {
  const placar = ok(await sb.from('placar_guerra').select('*'));
  const ordenado = [...placar].sort((a, b) => b.pontos - a.pontos);
  const total = Math.max(1, ordenado.reduce((t, l) => t + Number(l.pontos), 0));
  const max = Math.max(1, ...placar.map(l => Number(l.pontos)));
  const minha = S.perfil.faccao;
  const lider = ordenado[0];
  const pos = minha ? ordenado.findIndex(l => l.faccao === minha) + 1 : 0;
  const dif = minha && lider && lider.faccao !== minha
    ? Number(lider.pontos) - Number(ordenado[pos - 1]?.pontos || 0) : 0;
  const medalha = ['🥇', '🥈', '🥉'];
  const taxa = S.cfg.xp_por_ac ?? 1;
  const minhaLinha = minha && placar.find(l => l.faccao === minha);
  const aporte = minhaLinha && Number(minhaLinha.pontos) > 0 ? Math.round((S.perfil.xp / Number(minhaLinha.pontos)) * 100) : 0;
  return `
    <h2>Guerra do Domínio</h2>
    <p class="sub">As três casas disputam quem junta mais pontos. Quem pede, joga e volta faz a sua casa subir.</p>
    ${minha ? `<section class="cartao destaque-guerra ${minha}">
      <strong>${pos === 1 ? 'Sua casa está na frente!' : `Sua casa está em ${pos}º lugar`}</strong>
      <small>${pos === 1 ? 'Peça, jogue e mantenha a liderança.' : `Faltam ${fmtNum(dif)} pontos para alcançar a ${pos === 2 ? 'líder' : 'casa à frente'}. Cada pedido conta.`}</small>
      <div class="aporte"><span>Sua contribuição</span><b>${fmtNum(S.perfil.xp)} XP</b>${aporte ? `<em>${aporte}% da casa</em>` : ''}</div>
    </section>` : '<section class="cartao aviso"><small>Faça o Teste de Calibração para escolher uma casa e entrar na guerra. Até lá, o XP que você ganha fica guardado no Cofre.</small></section>'}
    ${ordenado.map((l, n) => `
      <div class="cartao guerra-linha ${l.faccao} ${minha === l.faccao ? 'minha' : ''}">
        <div class="linha"><strong>${medalha[n] || ''} ${NOME_FACCAO[l.faccao]}${minha === l.faccao ? ' (a sua)' : ''}</strong>
          <span class="preco">${fmtNum(l.pontos)} <small>${Math.round((Number(l.pontos) / total) * 100)}%</small></span></div>
        <div class="barra"><i style="width:${(Number(l.pontos) / max) * 100}%"></i></div>
        <small class="sub">${esc(TEXTO_CASA[l.faccao] || '')}</small>
      </div>`).join('')}
    <section class="cartao como-funciona">
      <h3>Como funciona</h3>
      <ol>
        <li><b>Gaste e ganhe XP.</b> Cada 1 AC gasto na comanda rende ${fmtNum(taxa)} XP quando a conta é fechada.</li>
        <li><b>O XP vira ponto da sua casa.</b> Tudo o que você ganha soma no placar da casa que você escolheu no teste.</li>
        <li><b>Antes do teste, nada é perdido.</b> O XP fica trancado no Cofre. Ao escolher a casa, ele é liberado e já entra no placar.</li>
        <li><b>A casa não muda.</b> A escolha é definitiva, então escolha a que combina com o seu jeito de jogar.</li>
        <li><b>Traga gente.</b> Na Hora de Mesa, quem monta equipe maior ganha XP extra, e esse XP também vale para a casa.</li>
      </ol>
      <small class="sub">As regras e valores ainda podem mudar conforme os sócios decidirem.</small>
    </section>`;
}

const CONQUISTAS = [
  ['🍽️', 'Primeira vez', 'Fez o primeiro pedido', d => d.pedidos >= 1],
  ['🔥', 'Frequentador', '5 visitas ao Conclave', d => d.visitas >= 5],
  ['🎲', 'Mesa montada', 'Jogou uma Hora de Mesa', d => d.partidas >= 1],
  ['🛡️', 'Em uma casa', 'Escolheu a sua casa', d => !!S.perfil.faccao],
  ['⭐', 'Nível 5', 'Chegou ao nível 5', d => S.perfil.nivel >= 5],
  ['💰', 'Mão aberta', 'Gastou 500 AC no total', d => d.gasto >= 500],
];
const FOTO_PADRAO = null;
async function carregarFoto() {
  const r = await sb.storage.from('avatares').createSignedUrl(`${S.user.id}/avatar.jpg`, 3600).catch(() => null);
  S.fotoUrl = r?.data?.signedUrl || null;
}
const avatarHtml = (p, extra = '') => S.fotoUrl
  ? `<div class="avatar foto ${extra}"><img src="${S.fotoUrl}" alt="Sua foto"></div>`
  : `<div class="avatar ${p.faccao ? '' : 'iniciado'} ${extra}">${SIGILO[p.faccao || 'iniciado']}</div>`;

async function reduzirFoto(arquivo) {
  const img = await new Promise((ok2, ruim) => { const i = new Image(); i.onload = () => ok2(i); i.onerror = ruim; i.src = URL.createObjectURL(arquivo); });
  const lado = Math.min(img.width, img.height), T = 320;
  const c = document.createElement('canvas'); c.width = c.height = T;
  c.getContext('2d').drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, T, T);
  URL.revokeObjectURL(img.src);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
}

async function dadosPerfil() {
  const uid = S.user.id;
  const [cm, ms] = await Promise.all([
    sb.from('comandas').select('id, mesa, total_ac, aberta_em, fechada_em, itens_comanda(quantidade, cardapio(nome))').eq('usuario_id', uid).eq('status', 'fechada')
      .order('fechada_em', { ascending: false }).limit(30).then(r => r.error ? [] : r.data, () => []),
    sb.from('sessoes_mesa').select('iniciada_em, encerrada_em').eq('usuario_id', uid).eq('status', 'encerrada').then(r => r.error ? [] : r.data, () => []),
  ]);
  const gasto = cm.reduce((t, c) => t + Number(c.total_ac || 0), 0) + (S.comanda ? totalComanda() : 0);
  const minutos = ms.reduce((t, m) => t + (m.iniciada_em && m.encerrada_em ? (new Date(m.encerrada_em) - new Date(m.iniciada_em)) / 60000 : 0), 0);
  const pedidos = cm.reduce((t, c) => t + (c.itens_comanda || []).reduce((s, i) => s + i.quantidade, 0), 0) + S.itens.length;
  return { cm, gasto, pedidos, visitas: cm.length + (S.comanda ? 1 : 0), partidas: ms.length, minutos: Math.round(minutos) };
}

async function vPerfil() {
  S.criancas = ok(await sb.from('criancas').select('*').eq('responsavel_id', S.user.id).order('criado_em'));
  const p = S.perfil, aba = S.perfilAba || 'resumo';
  const { prox, pct, falta } = progressoNivel();
  const d = await dadosPerfil();
  const hm = m => m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
  const topo = `
    <section class="cartao perfil-heroi">
      <label class="foto-troca" title="Trocar foto">${avatarHtml(p, 'grande')}<span class="camera">📷</span>
        <input type="file" id="foto-arq" accept="image/*" hidden></label>
      <div style="flex:1;min-width:0">
        <div class="titulo-rank">${p.faccao ? NOME_FACCAO[p.faccao] : 'Iniciado'}</div>
        <h2>${esc(p.nome_exibicao)}</h2>
        ${p.faccao ? `<div class="barra" style="margin:8px 0 4px"><i style="width:${pct}%"></i></div>
          <small>${prox ? `Nível ${p.nivel} · faltam ${fmtNum(falta)} XP para o ${prox.nivel}` : `Nível ${p.nivel} · máximo`}</small>`
          : '<small>Faça o teste para escolher a sua casa.</small>'}
      </div>
    </section>
    <div class="abas-perfil">${[['resumo', 'Resumo'], ['historico', 'Histórico'], ['conta', 'Conta']].map(([id, n]) =>
      `<button class="${aba === id ? 'ativo' : ''}" data-paba="${id}">${n}</button>`).join('')}</div>`;
  if (aba === 'historico') return topo + `
    ${d.cm.length ? d.cm.map(c => `
      <section class="cartao visita">
        <div class="linha"><div><b>${c.fechada_em ? new Date(c.fechada_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : ''}</b>
          <small> · Mesa ${esc(c.mesa)}</small></div><span class="preco">${fmtAC(c.total_ac)}</span></div>
        <small class="sub">${(c.itens_comanda || []).map(i => `${i.quantidade}× ${esc(i.cardapio?.nome || 'Item')}`).join(', ') || 'Sem itens'}</small>
      </section>`).join('') : '<section class="cartao"><p class="sub" style="margin:0">Suas visitas aparecem aqui depois que a primeira conta for fechada.</p></section>'}`;
  if (aba === 'conta') return topo + `
    <section class="cartao"><h2>Foto e nome</h2>
      <p class="sub">Toque na sua foto lá em cima para trocar. Ela é só sua e da equipe.</p>
      <form id="f-nome"><label>Nome<input name="nome" value="${esc(p.nome_exibicao)}" required maxlength="40"></label>
        <button class="botao" type="submit">Salvar nome</button></form>
    </section>
    <section class="cartao"><h2>Senha</h2>
      <form id="f-senha"><label>Nova senha<input name="senha" type="password" minlength="8" autocomplete="new-password" required></label>
        <p class="sub dica-senha">Mínimo 8 caracteres, com maiúscula, minúscula, número e símbolo (* ! @ #). Sem sequências como 123 ou abc.</p>
        <button class="botao" type="submit">Salvar senha</button></form>
    </section>
    <section class="cartao"><h2>Sobre você</h2>
      <form id="f-cadastro-perfil">${camposCadastro(p)}<button class="botao" type="submit">Salvar</button></form>
    </section>
    <section class="cartao"><h2>Crianças</h2>
      <p class="sub">Para o Kids. Sem CPF, sem e-mail, sem XP, só o nome.</p>
      ${S.criancas.map(c => `<div class="linha" style="padding:6px 0"><span>🧒 ${esc(c.nome)}</span>
        <button class="botao pequeno perigo" data-rm-crianca="${c.id}">Remover</button></div>`).join('')}
      <form id="f-crianca" class="linha" style="margin-top:8px">
        <input name="nome" placeholder="Nome da criança" required maxlength="40" style="margin:0">
        <button class="botao" type="submit">Adicionar</button></form>
    </section>
    <button class="botao perigo" data-acao="sair" style="width:100%">Sair da conta</button>`;
  return topo + `
    <div class="estatisticas grade6">
      <div><b>${p.faccao ? p.nivel : 0}</b><span>Nível</span></div>
      <div><b>${fmtNum(p.faccao ? p.xp : p.xp_bloqueado)}</b><span>${p.faccao ? 'XP' : 'XP no Cofre'}</span></div>
      <div><b>${fmtNum(p.saldo_ac)}</b><span>Saldo AC</span></div>
      <div><b>${fmtNum(d.gasto)}</b><span>Gasto total AC</span></div>
      <div><b>${fmtNum(d.visitas)}</b><span>Visitas</span></div>
      <div><b>${fmtNum(d.pedidos)}</b><span>Itens pedidos</span></div>
      <div><b>${fmtNum(d.partidas)}</b><span>Partidas</span></div>
      <div><b>${hm(d.minutos)}</b><span>Tempo de mesa</span></div>
    </div>
    <section class="cartao"><h3>Conquistas</h3>
      <div class="conquistas">${CONQUISTAS.map(([ic, nome, desc, ok2]) => { const tem = ok2(d);
        return `<div class="conquista ${tem ? 'tem' : ''}" title="${esc(desc)}"><i>${tem ? ic : '🔒'}</i><b>${esc(nome)}</b><small>${esc(desc)}</small></div>`; }).join('')}</div>
    </section>`;
}

/* ---------- carteira: carregar moedas por PIX ---------- */
const brl = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let pararEspera = null;

async function vCarteira() {
  if (S.pedido) return vPix();
  const [pacotes, hist] = await Promise.all([
    sb.from('pacotes_recarga').select('*').eq('ativo', true).order('ordem').then(r => r.error ? [] : r.data),
    sb.from('livro_saldo').select('*').eq('usuario_id', S.user.id).in('tipo', ['recarga', 'recarga_pix', 'rendimento'])
      .order('criado_em', { ascending: false }).limit(5).then(r => r.error ? [] : r.data),
  ]);
  return `
    <section class="cartao heroi"><div>
      <div class="titulo-rank">Seu saldo</div>
      <p class="moedas" style="margin:2px 0 0">${fmtNum(S.perfil.saldo_ac)} <small>AC</small></p>
    </div></section>
    <h2 style="margin:18px 0 10px">Carregar moedas</h2>
    <p class="sub" style="margin-top:0">Pague com PIX. Assim que o banco confirmar, as moedas caem aqui.</p>
    ${pacotes.length ? pacotes.map(p => {
      const bonus = Math.round((p.valor_ac / Number(p.valor_reais) - 1) * 100);
      return `<button class="pacote ${p.destaque ? 'destaque' : ''}" data-pacote="${p.id}">
        ${p.destaque ? '<span class="selo-pacote">Mais escolhido</span>' : ''}
        <span><strong>${esc(p.nome)}</strong><br><small>${brl(p.valor_reais)} no PIX</small></span>
        <span class="pacote-ac"><b>${fmtNum(p.valor_ac)} AC</b>${bonus > 0 ? `<em>+${bonus}% de bônus</em>` : ''}</span></button>`;
    }).join('') : '<p class="vazio">Nenhum pacote disponível agora. Peça a recarga ao garçom.</p>'}
    <p class="sub" style="margin-top:14px">Prefere pagar no balcão? O garçom também faz a recarga.</p>
    ${hist.length ? `<h3 style="margin:20px 0 8px">Últimas recargas</h3>${hist.map(h => `
      <div class="linha" style="padding:7px 0;border-top:1px solid var(--borda)"><span>${h.tipo === 'rendimento' ? '🐉 Rendimento' : 'Recarga'}
      <small>· ${new Date(h.criado_em).toLocaleDateString('pt-BR')}</small></span><span class="preco">+${fmtNum(h.valor_ac)} AC</span></div>`).join('')}` : ''}`;
}

function vPix() {
  const p = S.pedido;
  return `
    <section class="cartao pix">
      <div class="titulo-rank">Pague com PIX</div>
      <h2 style="margin:4px 0">${brl(p.valor_reais)} <small style="color:var(--texto-2)">→ ${fmtNum(p.valor_ac)} AC</small></h2>
      <img class="qr" alt="QR Code do PIX" src="data:image/png;base64,${esc(p.pix_qr_base64)}">
      <button class="botao primario" id="copiar-pix">Copiar código PIX</button>
      <p class="sub" style="margin:12px 0 0">Abra o app do seu banco, escolha <strong>PIX → Copia e Cola</strong> ou leia o QR Code.</p>
      <p class="aguardando"><span class="ponto"></span> Aguardando o pagamento… <small id="pix-tempo"></small></p>
      <button class="botao link" data-acao="cancelar-pix">Voltar</button>
    </section>`;
}

async function escolherPacote(id) {
  const { data, error } = await sb.functions.invoke('criar-recarga-pix', { body: { pacote_id: id } });
  if (error) {
    let msg = 'Não foi possível gerar o PIX agora.';
    try { const j = await error.context?.json?.(); if (j?.erro) msg = j.erro; } catch { /* mantém a mensagem padrão */ }
    throw new Error(msg);
  }
  if (data?.erro) throw new Error(data.erro);
  S.pedido = data; desenhar(); esperarPagamento(data.pedido_id);
}

// Espera o pagamento: ouve o banco em tempo real e, por garantia, confere a cada 4 s.
function esperarPagamento(pedidoId) {
  pararEspera?.();
  let ativo = true;
  const conferir = async () => {
    if (!ativo) return;
    const r = await sb.from('pedidos_recarga').select('status').eq('id', pedidoId).maybeSingle();
    if (r.data?.status === 'pago') { ativo = false; pararEspera?.(); await pagou(); }
    else if (r.data && ['expirado', 'cancelado'].includes(r.data.status)) { ativo = false; pararEspera?.(); S.pedido = null; toast('O PIX venceu. Gere outro.', 'erro'); desenhar(); }
  };
  const canal = sb.channel('pix-' + pedidoId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos_recarga', filter: `id=eq.${pedidoId}` }, conferir).subscribe();
  const timer = setInterval(() => {
    conferir();
    const el = $('#pix-tempo'); if (el && S.pedido?.expira_em) {
      const seg = Math.max(0, Math.floor((new Date(S.pedido.expira_em) - Date.now()) / 1000));
      el.textContent = `(vence em ${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')})`;
    }
  }, 4000);
  pararEspera = () => { ativo = false; clearInterval(timer); sb.removeChannel(canal); pararEspera = null; };
}

async function pagou() {
  const ac = S.pedido?.valor_ac; S.pedido = null;
  await recarregarPerfil();
  const o = document.createElement('div');
  o.id = 'revelacao'; o.dataset.faccao = S.perfil.faccao || '';
  o.innerHTML = `<div class="onda"></div><div class="conteudo">
    <div class="selo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 9.5c0-1 1.3-1.7 3-1.7s3 .7 3 1.7-1.3 1.6-3 2.2-3 1.1-3 2.2 1.3 1.7 3 1.7 3-.7 3-1.7"/></svg></div>
    <p class="pre">Pagamento confirmado</p>
    <h1>+${fmtNum(ac)} AC</h1>
    <p class="txt">As moedas já estão na sua carteira.</p>
    <button class="botao primario" data-fechar-rev>Bora jogar</button></div>`;
  document.body.appendChild(o);
}

/* ---------- Covil do Dragão (investidores) ---------- */
async function vCovil() {
  if (!S.cotas.length) return '<p class="vazio">Esta área é só para a Sociedade Secreta.</p>';
  const rend = await sb.from('rendimentos_investidor').select('*').eq('usuario_id', S.user.id).order('competencia', { ascending: false })
    .then(r => r.error ? [] : r.data);
  const total = rend.reduce((t, r) => t + Number(r.valor_ac), 0);
  const buff = S.cotas.reduce((t, c) => t + Number(c.bonus_xp_percentual), 0);
  return `
    <section class="cartao dourado heroi"><div class="avatar" style="color:#ffc83d">🐉</div><div>
      <div class="titulo-rank" style="color:#ffc83d">Sociedade Secreta</div><h2>Covil do Dragão</h2>
      <p class="sub" style="margin:0">Rendimentos pagos: <strong class="preco" style="color:#ffc83d">${fmtNum(total)} AC</strong></p></div></section>
    ${buff > 0 ? `<section class="cartao dourado"><h3>⚡ Buff de XP</h3><p style="margin:0">Todo XP que você ganha no consumo vem com <strong>+${buff}%</strong>.</p></section>` : ''}
    <h3 style="margin:16px 0 8px">Suas cotas</h3>
    ${S.cotas.map(c => `<div class="cartao"><strong>${esc(c.descricao)}</strong>
      <div class="sub">${Number(c.participacao_percentual) ? `Participação ${Number(c.participacao_percentual).toLocaleString('pt-BR')}%` : ''}
      ${Number(c.bonus_xp_percentual) ? ` · XP +${Number(c.bonus_xp_percentual)}%` : ''}</div></div>`).join('')}
    <h3 style="margin:16px 0 8px">Rendimentos</h3>
    ${rend.length ? rend.map(r => `<div class="linha" style="padding:8px 0;border-top:1px solid var(--borda)">
      <span>${new Date(r.competencia + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
      <span class="preco" style="color:#ffc83d">+${fmtNum(r.valor_ac)} AC</span></div>`).join('')
      : '<p class="sub">O primeiro rendimento aparece aqui quando for pago. Ele cai direto no seu saldo, para gastar na casa.</p>'}
    <button class="botao" data-ir="inicio" style="margin-top:14px;width:100%">Voltar</button>`;
}

/* ---------- quiz ---------- */
async function vQuiz() {
  if (S.perfil.faccao) {
    return `<section class="cartao heroi"><div class="avatar">${SIGILO[S.perfil.faccao]}</div><div><div class="titulo-rank">Sua casa</div><h2>${NOME_FACCAO[S.perfil.faccao]}</h2>
      <p class="sub">A calibração é definitiva.</p><button class="botao pequeno" data-ir="inicio">Voltar</button></div></section>`;
  }
  const respostas = ok(await sb.from('respostas_quiz').select('pergunta_id,resposta').eq('usuario_id', S.user.id));
  const feitas = new Set(respostas.map(r => r.pergunta_id));
  const i = PERGUNTAS.findIndex((_, idx) => !feitas.has(idx));
  if (i === -1) return vQuizFim(respostas);
  if (feitas.size === 0 && !S.quiz.comecou) {
    return `<div class="quiz-tela"><div class="quiz-topo"><button class="sair" data-ir="inicio" aria-label="Sair">✕</button></div>
      <div class="quiz-centro">
        <div class="scan">${SIGILO.iniciado}</div>
        <h1>Teste de Calibração</h1>
        <p class="regras">${PERGUNTAS.length} perguntas, uns 3 minutos.<br>Responda no instinto: não existe certo ou errado.<br>No final, o Conclave revela a sua casa.</p>
        <button class="botao primario" data-quiz="comecar">Começar</button>
      </div></div>`;
  }
  if (!S.quiz.ordem[i]) S.quiz.ordem[i] = Object.keys(PERGUNTAS[i].r).sort(() => Math.random() - .5);
  const pips = PERGUNTAS.map((_, k) => `<i class="${k < i ? 'feito' : k === i ? 'atual' : ''}"></i>`).join('');
  return `
    <div class="quiz-tela" id="q-${i}">
      <div class="quiz-topo"><button class="sair" data-ir="inicio" aria-label="Pausar">✕</button><div class="pips">${pips}</div><span class="quiz-contador">${i + 1}/${PERGUNTAS.length}</span></div>
      <p class="quiz-rotulo">Calibração</p>
      <h2 class="pergunta">${esc(PERGUNTAS[i].p)}</h2>
      <div class="opcoes">${S.quiz.ordem[i].map((f, k) =>
        `<button class="opcao-card" data-resp="${i}|${f}"><i>${'ABC'[k]}</i><span>${esc(PERGUNTAS[i].r[f])}</span></button>`).join('')}</div>
    </div>`;
}

function contagemQuiz(respostas) {
  const c = { guilda: 0, frequencia: 0, esquadrao: 0 };
  respostas.forEach(r => { if (c[r.resposta] !== undefined) c[r.resposta]++; });
  return c;
}

function vQuizFim(respostas) {
  const c = contagemQuiz(respostas);
  const max = Math.max(...Object.values(c));
  const topo = Object.keys(c).filter(f => c[f] === max);
  if (topo.length === 1) {
    return `<div class="quiz-tela"><div class="quiz-centro">
      <div class="scan">${SIGILO.iniciado}</div>
      <h1>Calibração completa</h1>
      <p class="regras">O Conclave já sabe quem você é.<br>Isso é definitivo e libera o XP do Cofre.</p>
      <button class="botao primario" data-faccao="${topo[0]}">Revelar minha casa</button>
    </div></div>`;
  }
  return `<div class="quiz-tela"><div class="quiz-centro">
    <h1>Perfil híbrido</h1>
    <p class="regras">Você ficou entre mais de uma casa. Escolha a que mais combina com você (definitivo).</p>
    <div class="casas">${topo.map(f => `<button class="casa-card" data-faccao="${f}" data-faccao-tema="${f}" style="color:var(--${f})"><span>${SIGILO[f]}</span>
      <span><strong style="font-size:1.1rem">${NOME_FACCAO[f]}</strong><br><small style="color:var(--texto-2)">${esc(TEXTO_CASA[f])}</small></span></button>`).join('')}</div>
  </div></div>`;
}

/* ---------- primeiro acesso: perguntas rápidas ---------- */
function camposCadastro(p = {}, pedirNome = false) {
  return `
    ${pedirNome ? `<label>Como devemos te chamar?<input name="nome" required maxlength="40" value="${esc(/^[+\d]/.test(p.nome_exibicao || '') ? '' : (p.nome_exibicao || ''))}" autocomplete="name"></label>` : ''}
    <label>Data de nascimento<input type="date" name="nasc" required value="${esc(p.data_nascimento || '')}" max="${new Date().toISOString().slice(0, 10)}"></label>
    <label>Há quanto tempo você joga?<input name="tempo" maxlength="120" placeholder="Ex.: desde criança, uns 5 anos…" value="${esc(p.tempo_jogando || '')}"></label>
    <label>O que precisa ser interessante para você continuar jogando?<textarea name="motiva" rows="3" maxlength="300" placeholder="Pode ser curtinho!">${esc(p.motivacao_continuar || '')}</textarea></label>`;
}
async function salvarCadastro(form) {
  const f = new FormData(form);
  if (f.get('nome')) {
    const r = await sb.from('perfis').update({ nome_exibicao: String(f.get('nome')).trim() }).eq('id', S.user.id);
    if (r.error) throw r.error;
  }
  const { error } = await sb.rpc('salvar_cadastro_jogador', {
    _data_nascimento: f.get('nasc'), _tempo_jogando: f.get('tempo'), _motivacao_continuar: f.get('motiva') });
  if (error) throw error;
  await recarregarPerfil();
}
function telaPrimeiroAcesso() {
  document.body.classList.add('modo-quiz');
  raiz.innerHTML = `<div class="quiz-tela"><div class="quiz-centro" style="text-align:left;margin:auto 0">
    <p class="quiz-rotulo" style="margin-top:0">Primeiro acesso</p>
    <h1>Conta pra gente</h1>
    <p class="regras">Três perguntinhas rápidas para o Conclave te conhecer melhor.</p>
    <form id="f-cadastro" class="cartao">${camposCadastro(S.perfil, true)}
      <button class="botao primario" type="submit">Continuar</button></form>
  </div></div>`;
  $('#f-cadastro').addEventListener('submit', async e => {
    e.preventDefault();
    await comTrava(e.target.querySelector('button'), async () => {
      await salvarCadastro(e.target);
      document.body.classList.remove('modo-quiz');
      raiz.innerHTML = ''; desenhar();
    });
  });
}

/* ---------- ações ---------- */
function perguntarMesa() {
  return new Promise(resolve => {
    const m = abrirModal(`
      <h2>Em qual mesa você está?</h2>
      <form id="f-mesa"><label>Número ou nome da mesa<input name="mesa" required maxlength="20" autofocus></label>
        <button class="botao primario" type="submit">Abrir comanda</button></form>`);
    m.querySelector('[data-fechar]').addEventListener('click', () => resolve(null));
    m.querySelector('#f-mesa').addEventListener('submit', e => {
      e.preventDefault(); const v = new FormData(e.target).get('mesa').trim(); fecharModal(); resolve(v);
    });
  });
}

async function garantirComanda() {
  if (S.comanda) return S.comanda.id;
  const mesa = await perguntarMesa();
  if (!mesa) return null;
  const { data, error } = await sb.rpc('abrir_comanda', { _mesa: mesa });
  if (error) throw error;
  await carregarComanda();
  return data;
}

async function adicionar(item, detalhes = null) {
  const id = await garantirComanda();
  if (!id) return;
  const { error } = await sb.rpc('adicionar_item', { _comanda: id, _item_cardapio: item.id, _quantidade: 1, _detalhes: detalhes });
  if (error) throw error;
  await carregarComanda();
  feedback({ icone: ehJogo(item) ? '🎲' : '✓', titulo: ehJogo(item) ? 'Bora jogar!' : 'Pedido enviado!', sub: item.nome });
  desenhar();
}

const EMOJI_AD = { 'Bacon crocante': '🥓', 'Cheddar extra': '🧀', 'Ovo': '🍳', 'Cebola caramelizada': '🧅', 'Jalapeño': '🌶️', 'Cogumelos': '🍄', 'Molho da casa': '🥫', 'Queijo brie': '🧀' };
function montarPersonalizado(item) {
  const extra = S.cfg.adicional_ac ?? 5;
  const m = abrirModal(`
    <form id="f-pers" class="montador">
      <div class="montador-topo"><h2>🍔 Monte o seu hambúrguer</h2>
        <p class="sub">O hambúrguer base já vem completo (${fmtAC(item.preco_ac)}). Quer turbinar? Toque nos extras que quiser, cada um é + ${fmtAC(extra)}.</p></div>
      <div class="montador-corpo">
        <h4>1. Escolha os extras <small>(opcional)</small></h4>
        <div class="extras">${ADICIONAIS.map(a => `
          <label class="extra"><input type="checkbox" name="ad" value="${esc(a)}"><span class="extra-cartao">
            <i>${EMOJI_AD[a] || '➕'}</i><b>${esc(a)}</b><em>+ ${fmtAC(extra)}</em><u>✓</u></span></label>`).join('')}</div>
        <h4>2. Algum recado para a cozinha? <small>(opcional)</small></h4>
        <input name="obs" maxlength="120" placeholder="Ex.: sem cebola, carne bem passada">
      </div>
      <div class="montador-rodape">
        <div class="montador-resumo"><span id="resumo-pers"></span><b id="preco-pers"></b></div>
        <button class="botao primario" type="submit">Pedir meu hambúrguer</button>
        <button class="botao" type="button" data-fechar style="width:100%;margin-top:6px">Cancelar</button>
      </div>
    </form>`);
  const form = m.querySelector('#f-pers');
  const atualizar = () => {
    const n = form.querySelectorAll('input[name=ad]:checked').length;
    m.querySelector('#preco-pers').textContent = fmtAC(item.preco_ac + n * extra);
    m.querySelector('#resumo-pers').textContent = n ? `Base + ${n} ${n === 1 ? 'extra' : 'extras'}` : 'Hambúrguer base, sem extras';
  };
  form.addEventListener('change', () => { vibrar(10); atualizar(); }); atualizar();
  form.addEventListener('submit', e => {
    e.preventDefault();
    const adicionais = [...form.querySelectorAll('input[name=ad]:checked')].map(x => x.value);
    const obs = form.obs.value.trim();
    fecharModal();
    comTrava(null, () => adicionar(item, { adicionais, ...(obs ? { observacao: obs } : {}) }));
  });
}

async function responderQuiz(idx, faccao) {
  await dorme(280);
  const { error } = await sb.from('respostas_quiz').insert({ usuario_id: S.user.id, pergunta_id: idx, resposta: faccao });
  if (error && error.code !== '23505') throw error;
  desenhar();
}

async function confirmarFaccao(f) {
  const liberado = S.perfil.xp_bloqueado;
  const { error } = await sb.rpc('definir_faccao', { _faccao: f });
  if (error) throw error;
  await recarregarPerfil();
  const o = document.createElement('div');
  o.id = 'revelacao'; o.dataset.faccao = f;
  o.innerHTML = `<div class="onda"></div><div class="conteudo">
    <div class="selo">${SIGILO[f]}</div>
    <p class="pre">O Sistema reconhece você</p>
    <h1>${NOME_FACCAO[f]}</h1>
    <p class="txt">${esc(TEXTO_CASA[f])}</p>
    <p class="xp-lib">🔓 ${fmtNum(liberado)} XP liberados do Cofre</p>
    <button class="botao primario" data-fechar-rev>Entrar no Conclave</button></div>`;
  document.body.appendChild(o);
}

function fecharRevelacao() {
  const o = $('#revelacao'); if (!o) return;
  o.classList.add('saindo');
  S.tela = 'inicio'; location.hash = 'inicio';
  desenhar();                                   // o tema da casa troca por trás da revelação
  setTimeout(() => o.remove(), 700);
}

/* ---------- HORA DE MESA ---------- */
const ST_MESA = ['solicitada', 'separando', 'pronta', 'jogando'];
const ROTULO_MESA = { solicitada: 'Pedido enviado', separando: 'Separando o jogo', pronta: 'Mesa pronta', jogando: 'Jogando' };
let placar = [];                // [{ jogador, pontos, usuario_id }] — o 1º é sempre o anfitrião (você)
let placarDaSessao = null;
let fase = 'placar';            // 'placar' | 'avaliar'
let aval = { nota: 0, texto: '', audio: null, url: null };
let gravador = null, limiteGravacao = null, salvarT = null;
const fmtTempo = ms => { const t = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const nomeDoJogo = m => m?.jogos?.nome || m?.jogo_livre || 'Jogo a combinar';

async function carregarJogos() {
  const r = await sb.from('jogos').select('*').eq('ativo', true).order('nome');
  S.jogos = r.error ? [] : r.data;
}

async function carregarMesa() {
  const r = await sb.from('sessoes_mesa').select('*, jogos(nome)').eq('usuario_id', S.user.id)
    .in('status', ST_MESA).order('criada_em', { ascending: false }).limit(1).maybeSingle();
  S.mesa = r.error ? null : r.data;                       // sem a tabela ainda: o app segue sem a Hora de Mesa
  if (S.mesa && ['pronta', 'jogando'].includes(S.mesa.status) && placarDaSessao !== S.mesa.id) {
    const p = await sb.from('placar_mesa').select('*').eq('sessao_id', S.mesa.id).order('ordem');
    placar = p.data?.length ? p.data.map(x => ({ jogador: x.jogador, pontos: x.pontos, usuario_id: x.usuario_id }))
      : [{ jogador: S.perfil.nome_exibicao, pontos: 0, usuario_id: S.user.id }];
    placarDaSessao = S.mesa.id;
  }
  if (!S.mesa) { placar = []; placarDaSessao = null; fase = 'placar'; }
}

async function iniciarJogo(item) {                         // toque em "Jogar": garante comanda e abre a reserva
  if (S.mesa) {
    return feedback({ icone: '🎲', titulo: 'Você já tem uma mesa', sub: 'Termine essa partida antes de pedir outra.', tipo: 'info', ms: 2400,
      acao: { texto: 'Ver minha mesa', fn: () => ir('mesa') } });
  }
  const cid = await garantirComanda();
  if (!cid) return;
  let jogoId = '', n = 4;
  const jogos = S.jogos || [];
  const m = abrirModal(`
    <h2>Reservar mesa</h2>
    <p class="sub">${esc(item.nome)} · ${fmtAC(item.preco_ac)}. Escolha o jogo e a equipe avisa quando a mesa estiver pronta.</p>
    <div class="escolha-jogos">${jogos.map(j => `
      <button type="button" class="opcao-jogo" data-jogo="${j.id}"><b>${esc(j.nome)}</b>
        <small>${j.jogadores_min}–${j.jogadores_max} jogadores${j.duracao_min ? ` · ${j.duracao_min} min` : ''}</small></button>`).join('')}
      <button type="button" class="opcao-jogo sel" data-jogo=""><b>🤔 Ainda não sei</b><small>A equipe ajuda você a escolher</small></button></div>
    <label>Ou diga qual jogo você quer<input id="jogo-livre" maxlength="60" placeholder="Ex.: Banco Imobiliário"></label>
    <div class="linha"><span>Quantas pessoas vão jogar?</span>
      <span class="stepper"><button type="button" class="botao pequeno" data-n="-1">−</button><b id="n-pessoas">${n}</b><button type="button" class="botao pequeno" data-n="1">+</button></span></div>
    <p class="sub" style="margin:10px 0 0">Quem leva mais gente ganha bônus de XP quando a partida termina.</p>
    <button class="botao primario" id="reservar" style="margin-top:14px">Pedir a mesa</button>
    <button class="botao" type="button" data-fechar style="width:100%;margin-top:8px">Cancelar</button>`);
  m.addEventListener('click', e => {
    const o = e.target.closest('[data-jogo]');
    if (o) { jogoId = o.dataset.jogo; m.querySelectorAll('.opcao-jogo').forEach(x => x.classList.toggle('sel', x === o)); return; }
    const b = e.target.closest('[data-n]');
    if (b) { n = Math.max(1, Math.min(20, n + Number(b.dataset.n))); m.querySelector('#n-pessoas').textContent = n; }
  });
  m.querySelector('#reservar').addEventListener('click', ev => comTrava(ev.currentTarget, async () => {
    const livre = jogoId ? '' : m.querySelector('#jogo-livre').value.trim();
    const { data: iid, error } = await sb.rpc('adicionar_item', { _comanda: cid, _item_cardapio: item.id, _quantidade: 1, _detalhes: null });
    if (error) throw error;
    const r2 = await sb.rpc('mesa_solicitar', { _item: iid, _jogo: jogoId || null, _jogo_livre: livre || null, _jogadores: n });
    if (r2.error) throw r2.error;
    await carregarComanda(); await carregarMesa();
    fecharModal();
    feedback({ icone: '🎲', titulo: 'Mesa pedida!', sub: 'Vamos separar o seu jogo. Você será avisado.' });
    ir('mesa');
  }));
}

function lider() {
  const max = Math.max(...placar.map(j => j.pontos));
  return max > 0 || placar.some(j => j.pontos !== 0) ? placar.findIndex(j => j.pontos === max) : -1;
}

function vMesa() {
  const m = S.mesa;
  if (!m) return `<section class="cartao aviso"><h2>Nenhuma mesa agora</h2>
    <p class="sub">Peça uma Hora de Mesa, escolha o jogo e monte a sua equipe.</p>
    <button class="botao primario" data-cat="jogo" data-ir="cardapio">Ver os jogos</button></section>`;
  const etapas = ['solicitada', 'separando', 'pronta', 'jogando'], idx = etapas.indexOf(m.status);
  const cab = `
    <section class="mesa-cab">
      <div class="mesa-jogo"><span>🎲</span><div><b>${esc(nomeDoJogo(m))}</b><small>${m.jogadores} pessoa(s)${m.mesa_jogo ? ` · ${esc(m.mesa_jogo)}` : ''}</small></div></div>
      <div class="passos">${etapas.map((e, i) => `<div class="passo ${i < idx ? 'feito' : ''} ${i === idx ? 'atual' : ''}"><i>${i < idx ? '✓' : i + 1}</i><span>${ROTULO_MESA[e]}</span></div>`).join('')}</div>
    </section>`;
  if (m.status === 'solicitada' || m.status === 'separando') return cab + `
    <section class="cartao esperando">
      <div class="radar"><i></i><i></i><i></i><span>${m.status === 'separando' ? '📦' : '📨'}</span></div>
      <h3>${m.status === 'separando' ? 'A equipe está separando o seu jogo' : 'Pedido enviado para a equipe'}</h3>
      <p class="sub">Pode ficar tranquilo. Quando a mesa estiver pronta, avisamos aqui na tela e você toca para abrir.</p>
      ${m.status === 'solicitada' ? '<button class="botao perigo" data-acao="cancelar-mesa">Cancelar pedido</button>' : ''}
    </section>`;
  if (m.status === 'pronta') return cab + `
    <section class="cartao mesa-pronta inclina">
      <div class="sino">🔔</div><h2>Sua mesa está pronta!</h2>
      <div class="mesa-numero">${esc(m.mesa_jogo || 'Mesa')}</div>
      <p class="sub">${esc(nomeDoJogo(m))} já está esperando por vocês. Sentou? Toque para começar a contar o tempo e o placar.</p>
      <button class="botao primario" data-acao="iniciar-mesa">Cheguei, começar a partida</button>
    </section>`;
  return cab + (fase === 'avaliar' ? vAvaliar() : vPlacar());
}

function vPlacar() {
  const m = S.mesa, extras = Math.max(0, placar.length - 1);
  const por = S.cfg.xp_equipe_por_pessoa ?? 10, teto = S.cfg.xp_equipe_max ?? 50, min = S.cfg.xp_equipe_min_minutos ?? 10;
  const bonus = Math.min(por * extras, teto), ld = lider();
  return `
    <section class="cartao relogio"><small>Tempo de mesa</small><b data-timer>${fmtTempo(Date.now() - new Date(m.iniciada_em || Date.now()))}</b></section>
    <section class="cartao equipe-bonus"><div class="linha"><div><b>Sua equipe: ${placar.length} ${placar.length === 1 ? 'pessoa' : 'pessoas'}</b>
      <small>${extras ? `Bônus de equipe: +${bonus} XP${bonus >= teto ? ' (máximo)' : ''}` : `+${por} XP por pessoa que você levar (até +${teto})`}</small></div>
      <button class="botao pequeno" data-acao="add-jogador">+ Pessoa</button></div>
      <small>O bônus vale para partidas com pelo menos ${min} min.</small></section>
    <section class="placar">${placar.map((j, i) => `
      <div class="jogador ${ld === i ? 'lider' : ''}">
        <div class="ini">${esc((j.jogador || '?').trim().slice(0, 1).toUpperCase())}</div>
        <div class="nome">${i === 0 ? `<b>${esc(j.jogador)}</b> <small>você</small>` : `<input data-nome-jog="${i}" value="${esc(j.jogador)}" maxlength="30" aria-label="Nome do jogador">`}
          ${ld === i ? '<span class="coroa">👑 na frente</span>' : (j.usuario_id && i ? '<small>jogador do Conclave</small>' : '')}</div>
        <div class="pontos"><button class="botao pequeno" data-pt="${i}|-1" aria-label="Tirar ponto">−</button><b>${j.pontos}</b><button class="botao pequeno" data-pt="${i}|1" aria-label="Dar ponto">+</button>
          <button class="botao pequeno" data-pt="${i}|5" aria-label="Dar 5 pontos">+5</button></div>
        ${i ? `<button class="x-jog" data-rm-jog="${i}" aria-label="Remover jogador">×</button>` : ''}
      </div>`).join('')}</section>
    <button class="botao primario" data-acao="encerrar-mesa">Encerrar a partida</button>`;
}

function vAvaliar() {
  return `
    <section class="cartao avaliar">
      <h2>Como foi a partida?</h2>
      <p class="sub">Conte a sua experiência. Pode escrever, mandar um áudio, ou os dois. Não é obrigatório.</p>
      <div class="estrelas" role="group" aria-label="Nota">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${n <= aval.nota ? 'on' : ''}" data-nota="${n}" aria-label="${n} estrelas">★</button>`).join('')}</div>
      <label>O que você achou?<textarea id="aval-texto" rows="3" maxlength="1000" placeholder="O jogo, a mesa, o atendimento, o que podemos melhorar…">${esc(aval.texto)}</textarea></label>
      <div class="audio-bloco">
        ${gravador ? '<button class="botao perigo gravando" data-acao="gravar">⏹ Parar a gravação</button><small>Gravando… até 60 segundos</small>'
          : `<button class="botao" data-acao="gravar">🎙️ ${aval.url ? 'Gravar de novo' : 'Gravar um áudio'}</button>`}
        ${aval.url && !gravador ? `<audio controls src="${aval.url}"></audio>` : ''}
      </div>
      <button class="botao primario" data-acao="enviar-aval">Encerrar e enviar</button>
      <button class="botao" data-acao="voltar-placar" style="width:100%;margin-top:8px">Voltar ao placar</button>
    </section>`;
}

function agendarSalvar() {
  clearTimeout(salvarT);
  salvarT = setTimeout(() => salvarPlacar().catch(() => {}), 700);
}
async function salvarPlacar() {
  clearTimeout(salvarT);
  if (!S.mesa || S.mesa.status !== 'jogando') return;
  const { error } = await sb.rpc('mesa_salvar_placar', { _id: S.mesa.id, _placar: placar.map(j => ({ jogador: j.jogador, pontos: j.pontos, usuario_id: j.usuario_id || null })) });
  if (error) throw error;
}

function abrirAdicionarPessoa() {
  const m = abrirModal(`
    <h2>Adicionar à equipe</h2>
    <label>Procurar jogador do Conclave pelo nome<input id="busca-jog" placeholder="Digite pelo menos 3 letras" autocomplete="off"></label>
    <div id="res-jog" class="resultado-busca"></div>
    <form id="f-convidado"><label>Ou adicione quem ainda não tem conta<input name="nome" maxlength="30" placeholder="Nome do convidado"></label>
      <button class="botao" type="submit">Adicionar convidado</button></form>
    <button class="botao" type="button" data-fechar style="width:100%;margin-top:8px">Fechar</button>`);
  let t = null;
  m.querySelector('#busca-jog').addEventListener('input', ev => {
    clearTimeout(t); const q = ev.target.value.trim();
    t = setTimeout(async () => {
      const box = m.querySelector('#res-jog');
      if (q.length < 3) { box.innerHTML = ''; return; }
      const { data } = await sb.rpc('buscar_jogadores', { _q: q });
      const livres = (data || []).filter(p => !placar.some(j => j.usuario_id === p.id));
      box.innerHTML = livres.length ? livres.map(p => `<button type="button" class="botao" data-add-membro="${p.id}|${esc(p.nome_exibicao)}">${esc(p.nome_exibicao)} <small>adicionar</small></button>`).join('')
        : '<p class="sub">Ninguém encontrado com esse nome.</p>';
    }, 350);
  });
  m.addEventListener('click', e => {
    const b = e.target.closest('[data-add-membro]'); if (!b) return;
    const [id, ...resto] = b.dataset.addMembro.split('|');
    placar.push({ jogador: resto.join('|').slice(0, 30), pontos: 0, usuario_id: id });
    fecharModal(); agendarSalvar(); desenhar();
  });
  m.querySelector('#f-convidado').addEventListener('submit', e => {
    e.preventDefault(); const nome = new FormData(e.target).get('nome').trim(); if (!nome) return;
    placar.push({ jogador: nome.slice(0, 30), pontos: 0, usuario_id: null });
    fecharModal(); agendarSalvar(); desenhar();
  });
}

async function alternarGravacao() {
  if (gravador) { gravador.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tipo = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => window.MediaRecorder?.isTypeSupported?.(t));
    const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined), partes = [];
    rec.ondataavailable = e => { if (e.data.size) partes.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop()); clearTimeout(limiteGravacao);
      aval.audio = new Blob(partes, { type: rec.mimeType || tipo || 'audio/webm' });
      if (aval.url) URL.revokeObjectURL(aval.url);
      aval.url = URL.createObjectURL(aval.audio); gravador = null; desenhar();
    };
    rec.start(); gravador = rec; limiteGravacao = setTimeout(() => rec.state === 'recording' && rec.stop(), 60000); desenhar();
  } catch { toast('Não consegui usar o microfone. Libere o acesso nas configurações do navegador.', 'erro'); }
}

async function enviarAvaliacao() {
  const m = S.mesa; await salvarPlacar();
  let caminho = null;
  if (aval.audio) {
    const ext = aval.audio.type.includes('mp4') ? 'm4a' : 'webm';
    caminho = `${S.user.id}/${m.id}.${ext}`;
    const up = await sb.storage.from('experiencias').upload(caminho, aval.audio, { contentType: aval.audio.type.split(';')[0], upsert: true });
    if (up.error) throw new Error('Não deu para enviar o áudio. Tente de novo ou envie só o texto.');
  }
  const { data, error } = await sb.rpc('mesa_encerrar', { _id: m.id, _nota: aval.nota || null, _comentario: aval.texto.trim() || null, _audio: caminho });
  if (error) throw error;
  if (aval.url) URL.revokeObjectURL(aval.url);
  aval = { nota: 0, texto: '', audio: null, url: null };
  await carregarMesa(); await recarregarPerfil();
  const xp = data?.xp_equipe || 0;
  feedback({ icone: '🏆', titulo: 'Partida encerrada!', sub: xp ? `Bônus de equipe: +${xp} XP. Obrigado por contar como foi.` : 'Obrigado por contar como foi.', ms: 2800 });
  ir('inicio');
}

setInterval(() => {
  const el = document.querySelector('[data-timer]');
  if (el && S.mesa?.iniciada_em) el.textContent = fmtTempo(Date.now() - new Date(S.mesa.iniciada_em));
}, 1000);

/* ---------- eventos ---------- */
function alternarDescricao(el) {
  const aberto = el.classList.toggle('aberto'); el.setAttribute('aria-expanded', aberto);
  const v = el.querySelector('.ver-mais'); if (v) v.textContent = aberto ? 'fechar ▴' : 'o que tem ▾';
  vibrar(8);
}
raiz.addEventListener('click', e => { const c = e.target.closest('[data-desc]'); if (c && !e.target.closest('button')) alternarDescricao(c); });
raiz.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-desc]')) { e.preventDefault(); alternarDescricao(e.target); } });

raiz.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.pacote) return comTrava(t, () => escolherPacote(t.dataset.pacote));
  if (t.dataset.acao === 'cancelar-pix') { pararEspera?.(); S.pedido = null; return desenhar(); }
  if (t.id === 'copiar-pix') return comTrava(t, async () => {
    try { await navigator.clipboard.writeText(S.pedido.pix_copia_cola); toast('Código PIX copiado. Cole no app do seu banco.'); }
    catch { toast('Não deu para copiar. Selecione o código e copie.', 'erro'); }
  });
  const ac = t.dataset.acao;
  if (ac === 'cancelar-mesa') return comTrava(t, async () => { const { error } = await sb.rpc('mesa_cancelar', { _id: S.mesa.id }); if (error) throw error;
    await carregarMesa(); await carregarComanda(); toast('Pedido cancelado.'); ir('inicio'); });
  if (ac === 'iniciar-mesa') return comTrava(t, async () => { const { error } = await sb.rpc('mesa_iniciar', { _id: S.mesa.id }); if (error) throw error;
    await carregarMesa(); fase = 'placar'; feedback({ icone: '🎲', titulo: 'Partida iniciada!', sub: 'Bom jogo! O tempo começou a contar.' }); desenhar(); });
  if (ac === 'add-jogador') return abrirAdicionarPessoa();
  if (ac === 'encerrar-mesa') { fase = 'avaliar'; return desenhar(); }
  if (ac === 'voltar-placar') { fase = 'placar'; return desenhar(); }
  if (ac === 'gravar') return alternarGravacao();
  if (ac === 'enviar-aval') return comTrava(t, enviarAvaliacao);
  if (t.dataset.nota) { aval.nota = Number(t.dataset.nota); return desenhar(); }
  if (t.dataset.pt) { const [i, d] = t.dataset.pt.split('|').map(Number); placar[i].pontos = Math.max(-9999, Math.min(9999, placar[i].pontos + d)); agendarSalvar(); return desenhar(); }
  if (t.dataset.rmJog) { placar.splice(Number(t.dataset.rmJog), 1); agendarSalvar(); return desenhar(); }
  if (t.dataset.quiz === 'comecar') { S.quiz.comecou = true; return desenhar(); }
  if (t.dataset.paba) { S.perfilAba = t.dataset.paba; return desenhar(); }
  if (t.dataset.tela) { if (t.dataset.tela === 'cardapio') S.categoria = 'todos'; return ir(t.dataset.tela); }
  if (t.dataset.cat && t.dataset.ir) { S.categoria = t.dataset.cat; return ir(t.dataset.ir); }
  if (t.dataset.ir) { if (t.dataset.ir === 'cardapio') S.categoria = 'todos'; return ir(t.dataset.ir); }
  if (t.dataset.cat) {
    S.categoria = t.dataset.cat;
    const y = window.scrollY; desenhar();                      // mantém a posição da tela e centraliza a categoria escolhida
    requestAnimationFrame(() => { window.scrollTo(0, y); $('.categorias .ativo')?.scrollIntoView({ inline: 'center', block: 'nearest' }); });
    return;
  }
  if (t.dataset.add) {
    const item = S.cardapio.find(i => i.id === t.dataset.add);
    if (item.categoria === 'jogo') return comTrava(t, () => iniciarJogo(item));
    return item.categoria === 'personalizado' ? montarPersonalizado(item) : comTrava(t, async () => { voarParaComanda(t); await adicionar(item); });
  }
  if (t.dataset.resp) { const [i, f] = t.dataset.resp.split('|'); t.classList.add('marcado'); return comTrava(t, () => responderQuiz(Number(i), f)); }
  if (t.dataset.faccao) return comTrava(t, () => confirmarFaccao(t.dataset.faccao));
  if (t.dataset.rmCrianca) return comTrava(t, async () => {
    const { error } = await sb.from('criancas').delete().eq('id', t.dataset.rmCrianca); if (error) throw error; desenhar();
  });
  if (t.dataset.acao === 'sair') return sair();
});

document.addEventListener('click', e => { if (e.target.closest('[data-fechar-rev]')) fecharRevelacao(); });
ligarInclinacao(); ligarOnda();
document.addEventListener('input', e => {
  if (e.target.id === 'aval-texto') { aval.texto = e.target.value; return; }
  if (e.target.dataset?.nomeJog) { placar[Number(e.target.dataset.nomeJog)].jogador = e.target.value.slice(0, 30); agendarSalvar(); return; }
  if (e.target.id !== 'busca') return;
  const q = e.target.value.trim().toLowerCase(); let n = 0;
  $$('#main [data-busca]').forEach(el => { const ok = !q || el.dataset.busca.includes(q); el.hidden = !ok; if (ok) n++; });
  $$('#main [data-secao]').forEach(sec => { sec.hidden = !sec.querySelector('[data-busca]:not([hidden])'); });
  const sr = $('#sem-resultado'); if (sr) sr.hidden = n > 0;
});

raiz.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  if (e.target.id === 'f-senha') {
    await comTrava(btn, async () => {
      const senha = new FormData(e.target).get('senha');
      const faltas = validarSenha(senha, S.user.email || '');
      if (faltas.length) throw new Error('Senha fraca. Falta: ' + faltas.join('; ') + '.');
      const { error } = await sb.auth.updateUser({ password: senha });
      if (error) throw error;
      e.target.reset(); toast('Senha salva. Use-a para entrar com e-mail.');
    });
  }
  if (e.target.id === 'f-nome') {
    await comTrava(btn, async () => {
      const nome = new FormData(e.target).get('nome').trim();
      const { error } = await sb.from('perfis').update({ nome_exibicao: nome }).eq('id', S.user.id);
      if (error) throw error;
      await recarregarPerfil(); toast('Nome salvo.'); desenhar();
    });
  }
  if (e.target.id === 'f-cadastro-perfil') {
    await comTrava(btn, async () => { await salvarCadastro(e.target); toast('Salvo.'); desenhar(); });
  }
  if (e.target.id === 'f-crianca') {
    await comTrava(btn, async () => {
      const nome = new FormData(e.target).get('nome').trim();
      const { error } = await sb.from('criancas').insert({ responsavel_id: S.user.id, nome });
      if (error) throw error;
      desenhar();
    });
  }
});

document.addEventListener('change', async e => {
  if (e.target.id !== 'foto-arq' || !e.target.files?.[0]) return;
  try {
    const blob = await reduzirFoto(e.target.files[0]);
    const { error } = await sb.storage.from('avatares').upload(`${S.user.id}/avatar.jpg`, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
    await carregarFoto(); feedback({ icone: '📸', titulo: 'Foto atualizada!', ms: 1500 }); desenhar();
  } catch { toast('Não foi possível enviar a foto. Tente outra imagem.', 'erro'); }
});

/* ---------- tempo real ---------- */
function assinarTempoReal() {
  const AVISO = { preparando: ['👨‍🍳', 'Estamos preparando!'], pronto: ['🔔', 'Seu pedido está pronto!'], entregue: ['✅', 'Pedido entregue. Bom proveito!'] };
  const atualizar = async payload => {
    try {
      const novo = payload?.new;
      if (payload?.eventType === 'UPDATE' && novo?.status && AVISO[novo.status] && novo.status !== payload.old?.status) {
        await carregarComanda();
        const meu = S.itens.find(i => i.id === novo.id);
        if (meu) { const [icone, titulo] = AVISO[novo.status];
          feedback({ icone, titulo, sub: meu.cardapio?.nome || '', tipo: novo.status === 'pronto' ? 'ok' : 'info', ms: novo.status === 'pronto' ? 2600 : 1800 });
          if (novo.status === 'pronto') vibrar([120, 60, 120]); }
      }
      await carregarComanda(); await recarregarPerfil();
      if (['inicio', 'comanda'].includes(S.tela)) desenhar();   // só redesenha onde nada está sendo digitado
      else if ($('#saldo')) { $('#saldo').textContent = fmtAC(S.perfil.saldo_ac); }
    } catch (e) { /* silencioso: tenta de novo na próxima mudança */ }
  };
  sb.channel('cliente')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'itens_comanda' }, atualizar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comandas' }, atualizar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessoes_mesa', filter: `usuario_id=eq.${S.user.id}` }, async p => {
      const antes = S.mesa?.status, novo = p.new?.status;
      try { await carregarMesa(); } catch { return; }
      if (novo && novo !== antes) {
        if (novo === 'separando') feedback({ icone: '📦', titulo: 'Separando o seu jogo!', sub: 'A equipe já está preparando a mesa.', tipo: 'info', ms: 2200 });
        if (novo === 'pronta') { feedback({ icone: '🔔', titulo: 'Sua mesa está pronta!', sub: p.new.mesa_jogo || '', acao: { texto: 'Ver minha mesa', fn: () => ir('mesa') } }); vibrar([150, 80, 150]); }
        if (novo === 'cancelada') feedback({ icone: '⚠️', titulo: 'Pedido de mesa cancelado', sub: 'Fale com a equipe se precisar.', tipo: 'info', ms: 2600 });
      }
      if (['inicio', 'mesa'].includes(S.tela) && !$('#modal.aberto') && !gravador && !document.activeElement?.matches?.('input, textarea')) desenhar();
      else desenhar();
    })
    .subscribe();
}

/* ---------- início ---------- */
async function iniciar() {
  if (!configurado) return avisoSemConfig(raiz);
  const sessao = await sessaoAtual();
  if (sessao && emRecuperacao()) return telaNovaSenha(raiz);
  if (!sessao) {
    return montarLogin(raiz, {
      titulo: 'O Conclave', subtitulo: 'Entre para pedir, jogar e subir de nível.',
      permiteCadastro: true, permiteWhatsApp: true, aoEntrar: iniciar,
    });
  }
  S.user = sessao.user;
  try { await carregar(); }
  catch (e) { raiz.innerHTML = `<div class="cartao aviso"><h2>Não deu para carregar</h2><p>${esc(erroAmigavel(e))}</p><button class="botao" onclick="location.reload()">Tentar de novo</button></div>`; return; }
  if (!iniciado) {
    iniciado = true;
    window.addEventListener('hashchange', () => { S.tela = location.hash.slice(1) || 'inicio'; desenhar(); });
    assinarTempoReal();
  }
  S.tela = location.hash.slice(1) || 'inicio';
  raiz.innerHTML = '';
  if (!S.perfil.cadastro_completo_em) return telaPrimeiroAcesso();
  desenhar();
}

iniciar();
