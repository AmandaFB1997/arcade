// App do CLIENTE — O Conclave
import { sb, configurado, $, $$, esc, fmtNum, fmtReais, fmtAC, fmtAcReais, toast, abrirModal, fecharModal,
         avisoSemConfig, comTrava, erroAmigavel, NOME_FACCAO } from '../nucleo.js';
import { sessaoAtual, montarLogin, sair } from '../auth.js';
import { PERGUNTAS } from '../dados/quiz.js';
import { ADICIONAIS } from '../dados/adicionais.js';

const raiz = document.getElementById('app');
const TELAS = [
  ['inicio', '🏠', 'Início'], ['cardapio', '🍔', 'Cardápio'], ['comanda', '🧾', 'Comanda'],
  ['guerra', '⚔️', 'Guerra'], ['perfil', '👤', 'Perfil'],
];
const CATEGORIAS = { comida: 'Comida', bebida: 'Bebidas', jogo: 'Jogos', kids: 'Kids', personalizado: 'Monte o seu' };

const S = {
  user: null, perfil: null, niveis: [], cfg: {}, cardapio: [], comanda: null, itens: [],
  criancas: [], tela: 'inicio', categoria: 'todos',
  quiz: { ordem: {}, empate: null },
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
  await carregarComanda();
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
  if (!$('#main')) {
    raiz.innerHTML = `
      <header class="topo linha"><span class="marca">⚔️ O CONCLAVE</span><span class="saldo" id="saldo"></span></header>
      <main id="main"></main>
      <nav class="nav-baixo">${TELAS.map(([id, ic, nome]) =>
        `<button data-tela="${id}"><span>${ic}</span>${nome}<b class="contador" id="cnt-${id}" hidden></b></button>`).join('')}</nav>`;
  }
  $('#saldo').textContent = fmtReais(S.perfil.saldo_ac);
  $$('.nav-baixo button').forEach(b => b.classList.toggle('ativo', b.dataset.tela === S.tela));
  const cnt = $('#cnt-comanda');
  cnt.hidden = S.itens.length === 0; cnt.textContent = S.itens.length;
  const vistas = { inicio: vInicio, cardapio: vCardapio, comanda: vComanda, guerra: vGuerra, perfil: vPerfil, quiz: vQuiz };
  const tela = vistas[S.tela] || vInicio;
  Promise.resolve(tela()).then(html => { if ($('#main')) { $('#main').innerHTML = html; } })
    .catch(e => { $('#main').innerHTML = `<div class="cartao aviso">${esc(erroAmigavel(e))}</div>`; });
}

function ir(tela) { S.tela = tela; if (location.hash !== '#' + tela) location.hash = tela; else desenhar(); }

/* ---------- telas ---------- */
function vInicio() {
  const p = S.perfil;
  const atual = S.niveis.find(n => n.nivel === p.nivel);
  const prox = S.niveis.find(n => n.nivel === p.nivel + 1);
  const base = atual?.xp_necessario ?? 0;
  const pct = prox ? Math.max(0, Math.min(100, ((p.xp - base) / (prox.xp_necessario - base)) * 100)) : 100;
  return `
    <section class="cartao">
      <h2>Olá, ${esc(p.nome_exibicao)}</h2>
      ${p.faccao ? `<span class="chip ${p.faccao}">${NOME_FACCAO[p.faccao]}</span>` : '<span class="chip">Iniciado</span>'}
      <p class="saldo" style="font-size:1.6rem;margin:12px 0 0">${fmtReais(p.saldo_ac)}</p>
      <small>${fmtAC(p.saldo_ac)} de saldo${p.saldo_ac < 0 ? ' — a diferença é cobrada em reais no fechamento' : ''}</small>
    </section>
    <section class="cartao">
      <div class="linha"><h3>Nível ${p.nivel}</h3><small>${fmtNum(p.xp)} XP</small></div>
      <div class="barra"><i style="width:${pct}%"></i></div>
      <small>${prox ? `Próximo nível: ${fmtNum(prox.xp_necessario)} XP` : 'Nível máximo'}</small>
    </section>
    ${p.faccao ? '' : `
    <section class="cartao aviso">
      <h3>🔒 Cofre de Cristal</h3>
      <p>Você tem <strong>${fmtNum(p.xp_bloqueado)} XP</strong> guardado. Faça o quiz, descubra sua facção e libere tudo.</p>
      <button class="botao primario" data-ir="quiz">Descobrir minha facção</button>
    </section>`}
    <section class="cartao">
      <h3>Comanda</h3>
      ${S.comanda
        ? `<p>Mesa <strong>${esc(S.comanda.mesa)}</strong> · ${S.itens.length} item(ns) · ${fmtReais(totalComanda())}</p>
           <button class="botao" data-ir="comanda">Ver comanda</button>`
        : '<p class="sub">Nenhuma comanda aberta. Peça algo do cardápio para começar.</p><button class="botao primario" data-ir="cardapio">Ver cardápio</button>'}
    </section>`;
}

function vCardapio() {
  const cats = ['todos', ...new Set(S.cardapio.map(i => i.categoria))];
  const lista = S.cardapio.filter(i => S.categoria === 'todos' || i.categoria === S.categoria);
  return `
    <div class="categorias">${cats.map(c =>
      `<button class="botao pequeno ${c === S.categoria ? 'ativo' : ''}" data-cat="${esc(c)}">${c === 'todos' ? 'Tudo' : esc(CATEGORIAS[c] || c)}</button>`).join('')}</div>
    ${lista.length ? lista.map(i => `
      <div class="cartao item">
        <div>
          <h3>${esc(i.nome)}</h3>
          ${i.faccao ? `<span class="chip ${i.faccao}">${NOME_FACCAO[i.faccao]}</span>` : ''}
          <div class="preco">${fmtAC(i.preco_ac)} <small>(${fmtReais(i.preco_ac)})</small>${i.categoria === 'personalizado' ? ' <small>+ adicionais</small>' : ''}</div>
        </div>
        <button class="botao" data-add="${i.id}">${i.categoria === 'personalizado' ? 'Montar' : 'Pedir'}</button>
      </div>`).join('') : '<p class="vazio">Cardápio vazio. Peça ao administrador para cadastrar os itens.</p>'}`;
}

function vComanda() {
  if (!S.comanda) return '<p class="vazio">Sem comanda aberta.<br><button class="botao" data-ir="cardapio" style="margin-top:12px">Ir ao cardápio</button></p>';
  const total = totalComanda();
  return `
    <section class="cartao">
      <div class="linha"><h2>Mesa ${esc(S.comanda.mesa)}</h2><span class="preco">${fmtReais(total)}</span></div>
      ${S.itens.length ? S.itens.map(i => `
        <div class="linha" style="padding:8px 0;border-top:1px solid var(--borda)">
          <div>${i.quantidade}× ${esc(i.cardapio?.nome || 'Item')}
            ${i.detalhes_personalizados?.adicionais?.length ? `<br><small>+ ${esc(i.detalhes_personalizados.adicionais.join(', '))}</small>` : ''}</div>
          <span class="chip ${i.status}">${i.status}</span>
        </div>`).join('') : '<p class="sub">Ainda sem itens.</p>'}
    </section>
    <p class="sub">A conta é fechada na mesa pelo garçom. Saldo atual: ${fmtReais(S.perfil.saldo_ac)} → depois: ${fmtReais(S.perfil.saldo_ac - total)}.</p>`;
}

async function vGuerra() {
  const placar = ok(await sb.from('placar_guerra').select('*'));
  const max = Math.max(1, ...placar.map(l => Number(l.pontos)));
  const ordenado = [...placar].sort((a, b) => b.pontos - a.pontos);
  return `
    <h2>Guerra do Domínio</h2>
    <p class="sub">Cada XP ganho pelos membros soma pontos para a facção.</p>
    ${ordenado.map(l => `
      <div class="guerra-linha ${l.faccao}">
        <div class="linha"><strong>${NOME_FACCAO[l.faccao]}${S.perfil.faccao === l.faccao ? ' (a sua)' : ''}</strong><span>${fmtNum(l.pontos)}</span></div>
        <div class="barra"><i style="width:${(Number(l.pontos) / max) * 100}%"></i></div>
      </div>`).join('')}`;
}

async function vPerfil() {
  S.criancas = ok(await sb.from('criancas').select('*').eq('responsavel_id', S.user.id).order('criado_em'));
  return `
    <section class="cartao">
      <h2>Meu perfil</h2>
      <form id="f-nome"><label>Nome<input name="nome" value="${esc(S.perfil.nome_exibicao)}" required maxlength="40"></label>
        <button class="botao" type="submit">Salvar nome</button></form>
    </section>
    <section class="cartao">
      <h2>Crianças</h2>
      <p class="sub">Para o Kids. Sem CPF, sem e-mail, sem XP — só o nome.</p>
      ${S.criancas.map(c => `<div class="linha" style="padding:6px 0"><span>🧒 ${esc(c.nome)}</span>
        <button class="botao pequeno perigo" data-rm-crianca="${c.id}">Remover</button></div>`).join('')}
      <form id="f-crianca" class="linha" style="margin-top:8px">
        <input name="nome" placeholder="Nome da criança" required maxlength="40" style="margin:0">
        <button class="botao" type="submit">Adicionar</button></form>
    </section>
    <button class="botao perigo" data-acao="sair" style="width:100%">Sair da conta</button>`;
}

/* ---------- quiz ---------- */
async function vQuiz() {
  if (S.perfil.faccao) {
    return `<section class="cartao"><h2>Sua facção</h2><span class="chip ${S.perfil.faccao}">${NOME_FACCAO[S.perfil.faccao]}</span>
      <p class="sub">A calibração é definitiva.</p><button class="botao" data-ir="inicio">Voltar</button></section>`;
  }
  const respostas = ok(await sb.from('respostas_quiz').select('pergunta_id,resposta').eq('usuario_id', S.user.id));
  const feitas = new Set(respostas.map(r => r.pergunta_id));
  const i = PERGUNTAS.findIndex((_, idx) => !feitas.has(idx));
  if (i === -1) return vQuizFim(respostas);
  if (!S.quiz.ordem[i]) S.quiz.ordem[i] = Object.keys(PERGUNTAS[i].r).sort(() => Math.random() - .5);
  return `
    <p class="sub">Pergunta ${i + 1} de ${PERGUNTAS.length}</p>
    <div class="barra"><i style="width:${(i / PERGUNTAS.length) * 100}%"></i></div>
    <h2 class="pergunta">${esc(PERGUNTAS[i].p)}</h2>
    ${S.quiz.ordem[i].map(f => `<button class="botao opcao" data-resp="${i}|${f}">${esc(PERGUNTAS[i].r[f])}</button>`).join('')}`;
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
    return `<section class="cartao"><h2>Resultado</h2><p>Você é da <span class="chip ${topo[0]}">${NOME_FACCAO[topo[0]]}</span></p>
      <p class="sub">Isso é definitivo e libera o XP guardado no Cofre.</p>
      <button class="botao primario" data-faccao="${topo[0]}">Confirmar facção</button></section>`;
  }
  return `<section class="cartao"><h2>Empate!</h2><p>Você ficou entre mais de uma facção. Escolha a que mais combina com você (definitivo):</p>
    ${topo.map(f => `<button class="botao opcao" data-faccao="${f}"><span class="chip ${f}">${NOME_FACCAO[f]}</span></button>`).join('')}</section>`;
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
  toast(`${item.nome} pedido!`);
  desenhar();
}

function montarPersonalizado(item) {
  const extra = S.cfg.adicional_ac ?? 5000;
  const m = abrirModal(`
    <h2>${esc(item.nome)}</h2>
    <p class="sub">Base ${fmtAC(item.preco_ac)} · cada adicional + ${fmtAC(extra)}</p>
    <form id="f-pers">
      ${ADICIONAIS.map(a => `<label style="color:var(--texto)"><input type="checkbox" name="ad" value="${esc(a)}">${esc(a)}</label>`).join('')}
      <label>Observação para a cozinha<input name="obs" maxlength="120"></label>
      <p class="preco" id="preco-pers"></p>
      <button class="botao primario" type="submit">Pedir</button>
    </form>`);
  const form = m.querySelector('#f-pers');
  const atualizar = () => {
    const n = form.querySelectorAll('input[name=ad]:checked').length;
    m.querySelector('#preco-pers').textContent = `Total: ${fmtAC(item.preco_ac + n * extra)} (${fmtReais(item.preco_ac + n * extra)})`;
  };
  form.addEventListener('change', atualizar); atualizar();
  form.addEventListener('submit', e => {
    e.preventDefault();
    const adicionais = [...form.querySelectorAll('input[name=ad]:checked')].map(x => x.value);
    const obs = form.obs.value.trim();
    fecharModal();
    comTrava(null, () => adicionar(item, { adicionais, ...(obs ? { observacao: obs } : {}) }));
  });
}

async function responderQuiz(idx, faccao) {
  const { error } = await sb.from('respostas_quiz').insert({ usuario_id: S.user.id, pergunta_id: idx, resposta: faccao });
  if (error && error.code !== '23505') throw error;
  desenhar();
}

async function confirmarFaccao(f) {
  const { error } = await sb.rpc('definir_faccao', { _faccao: f });
  if (error) throw error;
  await recarregarPerfil();
  toast(`Bem-vindo à ${NOME_FACCAO[f]}! XP do Cofre liberado.`);
  ir('inicio');
}

/* ---------- eventos ---------- */
raiz.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.tela) return ir(t.dataset.tela);
  if (t.dataset.ir) return ir(t.dataset.ir);
  if (t.dataset.cat) { S.categoria = t.dataset.cat; return desenhar(); }
  if (t.dataset.add) {
    const item = S.cardapio.find(i => i.id === t.dataset.add);
    return item.categoria === 'personalizado' ? montarPersonalizado(item) : comTrava(t, () => adicionar(item));
  }
  if (t.dataset.resp) { const [i, f] = t.dataset.resp.split('|'); return comTrava(t, () => responderQuiz(Number(i), f)); }
  if (t.dataset.faccao) return comTrava(t, () => confirmarFaccao(t.dataset.faccao));
  if (t.dataset.rmCrianca) return comTrava(t, async () => {
    const { error } = await sb.from('criancas').delete().eq('id', t.dataset.rmCrianca); if (error) throw error; desenhar();
  });
  if (t.dataset.acao === 'sair') return sair();
});

raiz.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  if (e.target.id === 'f-nome') {
    await comTrava(btn, async () => {
      const nome = new FormData(e.target).get('nome').trim();
      const { error } = await sb.from('perfis').update({ nome_exibicao: nome }).eq('id', S.user.id);
      if (error) throw error;
      await recarregarPerfil(); toast('Nome salvo.'); desenhar();
    });
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

/* ---------- tempo real ---------- */
function assinarTempoReal() {
  const atualizar = async () => {
    try {
      await carregarComanda(); await recarregarPerfil();
      if (['inicio', 'comanda'].includes(S.tela)) desenhar();   // só redesenha onde nada está sendo digitado
      else if ($('#saldo')) { $('#saldo').textContent = fmtReais(S.perfil.saldo_ac); }
    } catch (e) { /* silencioso: tenta de novo na próxima mudança */ }
  };
  sb.channel('cliente')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'itens_comanda' }, atualizar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comandas' }, atualizar)
    .subscribe();
}

/* ---------- início ---------- */
async function iniciar() {
  if (!configurado) return avisoSemConfig(raiz);
  const sessao = await sessaoAtual();
  if (!sessao) {
    return montarLogin(raiz, {
      titulo: 'O Conclave', subtitulo: 'Entre para pedir, jogar e subir de nível.',
      permiteCadastro: true, aoEntrar: iniciar,
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
  desenhar();
}

iniciar();
