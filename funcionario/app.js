// App do FUNCIONÁRIO — O Conclave (salão, cozinha e administração)
import { sb, configurado, $, $$, esc, fmtNum, fmtReais, fmtAC, toast, abrirModal, fecharModal, avisoSemConfig,
         comTrava, erroAmigavel, tempoDecorrido, contem, partir, NOME_FACCAO } from '../nucleo.js';
import { sessaoAtual, montarLogin, sair, validarSenha, emRecuperacao, telaNovaSenha } from '../auth.js';
import { entrada, ligarOnda, animarNumeros } from '../cliente/efeitos.js';

const raiz = document.getElementById('app');
const ok = r => { if (r.error) throw r.error; return r.data; };
const CATEGORIAS = ['comida', 'bebida', 'jogo', 'experiencia', 'kids', 'personalizado'];
const ROT = { pendente: 'Pendente', preparando: 'Preparando', pronto: 'Pronto', entregue: 'Entregue' };
const PACOTES = [[30, 30], [50, 55], [100, 115], [200, 240]];   // R$ → AC (com bônus)

const E = { user: null, perfil: null, papeis: [], aba: null, subAdmin: 'cardapio' };
let iniciado = false;
const tem = p => E.papeis.includes(p) || E.papeis.includes('admin');

/* ---------- estrutura ---------- */
// Estações de produção: cada pedido vai para a fila da estação da sua categoria
const ESTACOES = {
  cozinha: { nome: 'Cozinha', icone: '👨‍🍳', cor: '#f59e0b', titulo: 'Fila da cozinha', vazio: 'Cozinha limpa. Nenhum prato na fila.',
    acao: { pendente: ['Começar a preparar', 'preparando'], preparando: ['Prato pronto', 'pronto'] } },
  bar: { nome: 'Bar', icone: '🍹', cor: '#38bdf8', titulo: 'Fila do bar', vazio: 'Nenhuma bebida na fila.',
    acao: { pendente: ['Começar a servir', 'preparando'], preparando: ['Bebida pronta', 'pronto'] } },
  jogos: { nome: 'Jogos', icone: '🎲', cor: '#a78bfa', titulo: 'Mesa de jogos', vazio: 'Nenhum jogo ou mesa pedidos agora.',
    acao: { pendente: ['Separar o jogo', 'preparando'], preparando: ['Pronto na mesa', 'pronto'] } },
};
const estacaoDe = cat => (['bebida'].includes(cat) ? 'bar' : ['jogo', 'experiencia'].includes(cat) ? 'jogos' : 'cozinha');

function abasDisponiveis() {
  const a = [];
  if (tem('garcom')) a.push(['salao', '🍽️', 'Salão']);
  if (tem('cozinha')) for (const [id, e] of Object.entries(ESTACOES)) a.push([id, e.icone, e.nome]);
  if (tem('admin')) a.push(['admin', '⚙️', 'Admin']);
  return a;
}

let contagens = {};
async function atualizarContagens() {
  try {
    const itens = ok(await sb.from('itens_comanda').select('status, cardapio(categoria), comandas!inner(status)')
      .in('status', ['pendente', 'preparando', 'pronto']).eq('comandas.status', 'aberta'));
    const c = { salao: 0, cozinha: 0, bar: 0, jogos: 0 };
    for (const i of itens) {
      if (i.status === 'pronto') c.salao++;
      else c[estacaoDe(i.cardapio?.categoria)]++;
    }
    try {
      const m = await sb.from('sessoes_mesa').select('id', { count: 'exact', head: true }).in('status', ['solicitada', 'separando', 'pronta']);
      if (!m.error) c.jogos = Math.max(c.jogos, 0) + (m.count || 0);
    } catch { /* tabela ainda não existe */ }
    contagens = c;
    $$('#abas [data-aba]').forEach(b => {
      const n = contagens[b.dataset.aba] || 0, cnt = b.querySelector('.cont');
      if (cnt) { cnt.textContent = n; cnt.hidden = !n; }
    });
  } catch { /* silencioso */ }
}

function desenhar() {
  const abas = abasDisponiveis();
  if (!abas.some(([id]) => id === E.aba)) E.aba = abas[0][0];
  if (!$('#conteudo')) {
    raiz.innerHTML = `
      <header class="barra-topo">
        <div class="linha"><strong class="marca-equipe"><i></i> O CONCLAVE <small>EQUIPE</small></strong>
          <span class="quem"><small>${esc(E.perfil.nome_exibicao)}</small>
            <button class="botao pequeno" data-acao="senha">Senha</button>
            <button class="botao pequeno" data-acao="sair">Sair</button></span></div>
        <nav class="abas" id="abas"></nav>
      </header>
      <main id="conteudo"></main>`;
  }
  $('#abas').innerHTML = abas.map(([id, ic, nome]) =>
    `<button class="botao aba ${id === E.aba ? 'ativo' : ''}" data-aba="${id}"><span class="aba-ic">${ic}</span>${nome}<b class="cont" hidden>${contagens[id] || ''}</b></button>`).join('');
  $$('#abas .cont').forEach(c => { c.hidden = !c.textContent; });
  const vistas = { salao: vSalao, cozinha: () => vEstacao('cozinha'), bar: () => vEstacao('bar'), jogos: () => vEstacao('jogos'), admin: vAdmin };
  Promise.resolve(vistas[E.aba]()).then(html => { const c = $('#conteudo'); if (c) { c.innerHTML = html; entrada(c); animarNumeros(c); } atualizarContagens(); })
    .catch(e => { $('#conteudo').innerHTML = `<div class="cartao aviso">${esc(erroAmigavel(e))}</div>`; });
}

/* ================= SALÃO ================= */
async function vSalao() {
  const [comandas, kids] = await Promise.all([
    sb.from('comandas').select('*, perfis(nome_exibicao, saldo_ac), itens_comanda(*, cardapio(nome))')
      .eq('status', 'aberta').order('aberta_em').then(ok),
    sb.from('sessoes_kids').select('*, criancas(nome), comandas(mesa)').is('encerrada_em', null).order('iniciada_em').then(ok),
  ]);
  return `
    <div class="linha" style="margin-bottom:12px">
      <h2 style="margin:0">Comandas abertas (${comandas.length})</h2>
      <button class="botao" data-recarga="">💰 Recarga de saldo</button>
    </div>
    <div class="painel">${comandas.length ? comandas.map(cardComanda).join('') : '<p class="vazio">Nenhuma comanda aberta.</p>'}</div>
    ${kids.length ? `<h2 style="margin-top:24px">Kids em andamento</h2>
      <div class="painel">${kids.map(k => `
        <div class="cartao linha"><div>🧒 <strong>${esc(k.criancas?.nome)}</strong><br><small>Mesa ${esc(k.comandas?.mesa)} · há ${tempoDecorrido(k.iniciada_em)}</small></div>
          <button class="botao pequeno" data-kids-fim="${k.id}">Encerrar</button></div>`).join('')}</div>` : ''}`;
}

function cardComanda(c) {
  const itens = c.itens_comanda || [];
  const total = itens.reduce((t, i) => t + i.preco_ac * i.quantidade, 0);
  return `
    <div class="cartao comanda">
      <div class="linha"><h2>Mesa ${esc(c.mesa)}</h2><small>há ${tempoDecorrido(c.aberta_em)}</small></div>
      <p style="margin:0"><strong>${esc(c.perfis?.nome_exibicao)}</strong> · saldo ${fmtReais(c.perfis?.saldo_ac)}</p>
      <div style="margin:10px 0">${itens.length ? itens.map(i => `
        <div class="linha-item">
          <div>${i.quantidade}× ${esc(i.cardapio?.nome)}
            ${i.detalhes_personalizados?.adicionais?.length ? `<div class="detalhe">+ ${esc(i.detalhes_personalizados.adicionais.join(', '))}</div>` : ''}
            ${i.detalhes_personalizados?.observacao ? `<div class="detalhe">Obs: ${esc(i.detalhes_personalizados.observacao)}</div>` : ''}</div>
          <span><span class="chip ${i.status}">${ROT[i.status] || i.status}</span>
            ${i.status === 'pronto' ? `<button class="botao pequeno" data-item-status="${i.id}|entregue">Entregue</button>` : ''}</span>
        </div>`).join('') : '<p class="sub">Sem itens.</p>'}</div>
      <div class="linha"><strong>Total ${fmtReais(total)}</strong><small>${fmtAC(total)}</small></div>
      <div class="linha" style="margin-top:10px;flex-wrap:wrap">
        <button class="botao pequeno" data-recarga="${c.usuario_id}|${esc(c.perfis?.nome_exibicao)}">💰 Recarga</button>
        <button class="botao pequeno" data-kids="${c.id}|${c.usuario_id}">🧒 Kids</button>
        <button class="botao pequeno primario" style="width:auto" data-fechar-conta="${c.id}|${total}|${esc(c.mesa)}">Fechar conta</button>
      </div>
    </div>`;
}

function modalFecharConta(id, total, mesa) {
  const m = abrirModal(`
    <h2>Fechar a conta da mesa ${esc(mesa)}?</h2>
    <p>Total: <strong>${fmtReais(total)}</strong> (${fmtAC(total)}). O saldo do cliente será debitado e o XP lançado.<br>
    <small>Se o saldo não cobrir, ele fica negativo e a diferença deve ser cobrada em reais.</small></p>
    <div class="linha"><button class="botao" data-fechar>Cancelar</button><button class="botao primario" style="width:auto" id="ok-fechar">Fechar conta</button></div>`);
  m.querySelector('#ok-fechar').addEventListener('click', ev => comTrava(ev.target, async () => {
    const { error } = await sb.rpc('fechar_comanda', { _comanda: id }); if (error) throw error;
    fecharModal(); toast('Conta fechada.'); desenhar();
  }));
}

function modalRecarga(usuarioId = '', nome = '') {
  let escolhido = usuarioId ? { id: usuarioId, nome } : null;
  const m = abrirModal(`
    <h2>Recarga de saldo</h2>
    <div id="bloco-busca" ${escolhido ? 'hidden' : ''}>
      <label>Buscar cliente (qualquer parte do nome)<input id="busca-cli" autocomplete="off" placeholder="digite o nome…"></label>
      <div class="resultado-busca" id="res-busca"></div>
    </div>
    <p id="cli-escolhido">${escolhido ? `Cliente: <strong>${esc(nome)}</strong>` : ''}</p>
    <p class="sub">Pacotes (com bônus):</p>
    <div class="pacotes">${PACOTES.map(([r, ac]) => `<button class="botao" data-pacote="${ac}">R$ ${r}<br><small>${fmtNum(ac)} AC</small></button>`).join('')}</div>
    <label>Ou outro valor em reais<input id="valor-r" type="number" min="1" step="1" placeholder="ex.: 30"></label>
    <button class="botao primario" id="ok-recarga">Confirmar recarga</button>`);
  let acPacote = null;
  const busca = m.querySelector('#busca-cli'), res = m.querySelector('#res-busca');
  busca?.addEventListener('input', async () => {
    const termo = busca.value.trim();
    if (termo.length < 2) { res.innerHTML = ''; return; }
    const { data } = await sb.from('perfis').select('id, nome_exibicao, saldo_ac').ilike('nome_exibicao', `%${termo}%`).limit(20);
    res.innerHTML = (data || []).filter(p => contem(p.nome_exibicao, termo)).map(p =>
      `<button class="botao" data-cli="${p.id}|${esc(p.nome_exibicao)}"><span>${esc(p.nome_exibicao)}</span><small>${fmtReais(p.saldo_ac)}</small></button>`).join('')
      || '<p class="sub">Ninguém encontrado.</p>';
  });
  m.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.cli) {
      const [id, n] = partir(b.dataset.cli); escolhido = { id, nome: n };
      m.querySelector('#bloco-busca').hidden = true;
      m.querySelector('#cli-escolhido').innerHTML = `Cliente: <strong>${esc(n)}</strong>`;
    }
    if (b.dataset.pacote) {
      acPacote = Number(b.dataset.pacote); m.querySelector('#valor-r').value = '';
      $$('.pacotes .botao', m).forEach(x => x.classList.toggle('ativo', x === b));
    }
  });
  m.querySelector('#valor-r').addEventListener('input', () => { acPacote = null; $$('.pacotes .botao', m).forEach(x => x.classList.remove('ativo')); });
  m.querySelector('#ok-recarga').addEventListener('click', ev => comTrava(ev.target, async () => {
    const reais = Number(m.querySelector('#valor-r').value);
    const ac = acPacote ?? Math.round(reais);
    if (!escolhido) throw new Error('Escolha o cliente.');
    if (!ac || ac <= 0) throw new Error('Escolha um pacote ou digite um valor.');
    const { error } = await sb.rpc('recarga_saldo', { _usuario: escolhido.id, _valor_ac: ac, _tipo: 'recarga' });
    if (error) throw error;
    fecharModal(); toast(`Recarga de ${fmtNum(ac)} AC feita para ${escolhido.nome}.`); desenhar();
  }));
}

async function modalKids(comandaId, usuarioId) {
  const criancas = ok(await sb.from('criancas').select('*').eq('responsavel_id', usuarioId).order('nome'));
  const m = abrirModal(`
    <h2>Iniciar Kids</h2>
    ${criancas.length ? criancas.map(c => `<button class="botao opcao" style="width:100%;margin-bottom:8px" data-crianca="${c.id}">🧒 ${esc(c.nome)}</button>`).join('')
      : '<p class="sub">O responsável ainda não cadastrou crianças no app dele (Perfil → Crianças).</p>'}
    <button class="botao" data-fechar style="width:100%">Fechar</button>`);
  m.addEventListener('click', ev => {
    const b = ev.target.closest('[data-crianca]'); if (!b) return;
    comTrava(b, async () => {
      const { error } = await sb.from('sessoes_kids').insert({ comanda_id: comandaId, crianca_id: b.dataset.crianca });
      if (error) throw error;
      fecharModal(); toast('Kids iniciado.'); desenhar();
    });
  });
}

/* ================= COZINHA ================= */
async function vEstacao(chave) {
  const est = ESTACOES[chave];
  const todos = ok(await sb.from('itens_comanda')
    .select('*, cardapio(nome, categoria), comandas!inner(mesa, status)')
    .in('status', ['pendente', 'preparando', 'pronto']).eq('comandas.status', 'aberta').order('criado_em'));
  let sessoes = [];
  if (chave === 'jogos') {
    const r = await sb.from('sessoes_mesa').select('*, jogos(nome), perfis(nome_exibicao), comandas(mesa), placar_mesa(jogador, pontos, ordem)')
      .in('status', ['solicitada', 'separando', 'pronta', 'jogando']).order('criada_em');
    sessoes = r.error ? [] : r.data;                          // sem a tabela ainda: segue sem mesas
  }
  const ligados = new Set(sessoes.map(x => x.item_id).filter(Boolean));
  const itens = todos.filter(i => estacaoDe(i.cardapio?.categoria) === chave && !ligados.has(i.id));
  const col = st => itens.filter(i => i.status === st);
  const ticket = i => `
    <div class="ticket ${i.status} ${i.status === 'pendente' && Date.now() - new Date(i.criado_em) > 10 * 60000 ? 'atrasado' : ''}">
      <div class="linha"><h3>${i.quantidade}× ${esc(i.cardapio?.nome)}</h3><span class="mesa-selo">Mesa ${esc(i.comandas?.mesa)}</span></div>
      <small>há ${tempoDecorrido(i.criado_em)}</small>
      ${i.detalhes_personalizados?.adicionais?.length ? `<p class="detalhe">+ ${esc(i.detalhes_personalizados.adicionais.join(', '))}</p>` : ''}
      ${i.detalhes_personalizados?.observacao ? `<p class="detalhe">Obs: ${esc(i.detalhes_personalizados.observacao)}</p>` : ''}
      ${est.acao[i.status]
        ? `<button class="botao primario" data-item-status="${i.id}|${est.acao[i.status][1]}">${est.acao[i.status][0]}</button>`
        : `<button class="botao" style="width:100%" data-item-status="${i.id}|entregue">Entregue na mesa</button>`}
    </div>`;
  const coluna = (titulo, st, cor) => `
    <section class="coluna" style="--cor:${cor}">
      <h3>${titulo} <b>${col(st).length}</b></h3>
      ${col(st).length ? col(st).map(ticket).join('') : '<p class="vazio-col">—</p>'}
    </section>`;
  return `
    <div class="estacao-topo" style="--cor:${est.cor}">
      <div class="estacao-icone">${est.icone}</div>
      <div><h2>${est.titulo}</h2><small>${col('pendente').length} novos · ${col('preparando').length} em andamento · ${col('pronto').length} prontos</small></div>
    </div>
    ${chave === 'jogos' ? secaoMesas(sessoes) : ''}
    ${itens.length ? `<div class="kanban">
      ${coluna('Novos', 'pendente', '#f59e0b')}${coluna('Em andamento', 'preparando', '#38bdf8')}${coluna('Prontos', 'pronto', '#22c55e')}
    </div>` : (chave === 'jogos' && sessoes.length ? '' : `<p class="vazio grande">${est.vazio} 🎉</p>`)}`;
}

const ROT_MESA = { solicitada: 'Novo pedido', separando: 'Separando', pronta: 'Esperando o cliente', jogando: 'Jogando' };
function secaoMesas(sessoes) {
  if (!sessoes.length) return '';
  const card = m => {
    const jogo = m.jogos?.nome || m.jogo_livre || 'Jogo a combinar';
    const placar = (m.placar_mesa || []).slice().sort((a, b) => a.ordem - b.ordem);
    const max = placar.length ? Math.max(...placar.map(x => x.pontos)) : 0;
    let botao = '';
    if (m.status === 'solicitada') botao = `<button class="botao primario" data-mesa-av="${m.id}|separando">Separar o jogo</button>`;
    else if (m.status === 'separando') botao = `<button class="botao primario" data-mesa-pronta="${m.id}">Mesa pronta</button>`;
    else if (m.status === 'pronta') botao = `<button class="botao primario" data-mesa-av="${m.id}|jogando">Cliente sentou</button>`;
    return `<div class="ticket mesa-ticket ${m.status}">
      <div class="linha"><h3>🎲 ${esc(jogo)}</h3><span class="mesa-selo">${esc(ROT_MESA[m.status])}</span></div>
      <small>${esc(m.perfis?.nome_exibicao || 'Cliente')} · ${m.jogadores} pessoa(s) · comanda ${esc(m.comandas?.mesa || '—')}${m.mesa_jogo ? ` · <b>${esc(m.mesa_jogo)}</b>` : ''} · há ${tempoDecorrido(m.criada_em)}</small>
      ${m.status === 'jogando' && placar.length ? `<div class="mini-placar">${placar.map(x => `<span class="${x.pontos === max && max > 0 ? 'lider' : ''}">${esc(x.jogador)} <b>${x.pontos}</b></span>`).join('')}</div>` : ''}
      ${botao}
      ${['solicitada', 'separando'].includes(m.status) ? `<button class="botao pequeno" style="margin-top:6px" data-mesa-av="${m.id}|cancelada">Cancelar</button>` : ''}
    </div>`;
  };
  return `<section class="mesas-bloco"><h3>Mesas de jogo <b>${sessoes.length}</b></h3><div class="mesas-grade">${sessoes.map(card).join('')}</div></section>`;
}

function perguntarRotuloMesa(id) {
  const m = abrirModal(`<h2>Mesa pronta</h2>
    <form id="f-mesa"><label>Qual mesa foi separada?<input name="mesa" maxlength="20" placeholder="Ex.: Mesa 5" required autofocus></label>
    <p class="sub">O cliente recebe o aviso na hora, com este nome da mesa.</p>
    <button class="botao primario" type="submit">Avisar o cliente</button>
    <button class="botao" type="button" data-fechar style="width:100%;margin-top:8px">Cancelar</button></form>`);
  m.querySelector('#f-mesa').addEventListener('submit', ev => {
    ev.preventDefault();
    comTrava(ev.target.querySelector('button[type=submit]'), async () => {
      const rot = new FormData(ev.target).get('mesa').trim(); if (!rot) return;
      const { error } = await sb.rpc('mesa_avancar', { _id: id, _status: 'pronta', _mesa: rot }); if (error) throw error;
      fecharModal(); toast('Cliente avisado. 🔔'); desenhar();
    });
  });
}

/* ================= ADMIN ================= */
async function vAdmin() {
  const sub = E.subAdmin;
  const menu = `<div class="abas sub-abas" style="margin-bottom:14px">${[['cardapio', '📋 Cardápio'], ['regras', '📈 Regras e níveis'], ['pacotes', '💳 Pacotes'], ['pesquisa', '🎮 Jogadores'], ['investidores', '🐉 Investidores'], ['jogos', '🎲 Jogos'], ['partidas', '⭐ Partidas'], ['equipe', '👥 Equipe']]
    .map(([id, n]) => `<button class="botao pequeno ${sub === id ? 'ativo' : ''}" data-sub="${id}">${n}</button>`).join('')}</div>`;
  if (sub === 'cardapio') return menu + await adminCardapio();
  if (sub === 'regras') return menu + await adminRegras();
  if (sub === 'pesquisa') return menu + await adminPesquisa();
  if (sub === 'pacotes') return menu + await adminPacotes();
  if (sub === 'investidores') return menu + await adminInvestidores();
  if (sub === 'jogos') return menu + await adminJogos();
  if (sub === 'partidas') return menu + await adminPartidas();
  return menu + await adminEquipe();
}

const opcoesCat = sel => CATEGORIAS.map(c => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('');
const opcoesFac = sel => `<option value="">— nenhuma —</option>` + Object.entries(NOME_FACCAO)
  .map(([k, n]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${n}</option>`).join('');

async function adminCardapio() {
  const itens = ok(await sb.from('cardapio').select('*').order('categoria').order('nome'));
  const linha = i => `
    <tr data-id="${i?.id || ''}">
      <td><input data-c="nome" value="${esc(i?.nome || '')}" placeholder="Nome do item">
        <input data-c="descricao" value="${esc(i?.descricao || '')}" placeholder="O que tem (aparece ao tocar no item)" maxlength="300" style="margin-top:4px"></td>
      <td><select data-c="categoria">${opcoesCat(i?.categoria)}</select></td>
      <td><select data-c="faccao">${opcoesFac(i?.faccao)}</select></td>
      <td><input data-c="preco_ac" type="number" min="0" step="500" value="${i?.preco_ac ?? ''}" placeholder="AC"></td>
      <td><input data-c="ativo" type="checkbox" ${i?.ativo === false ? '' : 'checked'}></td>
      <td><button class="botao pequeno" data-salvar-item>${i ? 'Salvar' : 'Adicionar'}</button></td>
    </tr>`;
  return `<div class="cartao" style="overflow:auto"><p class="sub">Preço em AC (1 AC = R$ 1). Item desativado some do cardápio do cliente.</p>
    <table class="tabela"><thead><tr><th>Nome</th><th>Categoria</th><th>Facção</th><th>Preço (AC)</th><th>Ativo</th><th></th></tr></thead>
    <tbody>${linha(null)}${itens.map(linha).join('')}</tbody></table></div>`;
}

async function adminJogos() {
  const r = await sb.from('jogos').select('*').order('nome');
  if (r.error) return '<div class="cartao"><p class="sub">Atualize o banco (arquivo atualizar_tudo.sql) para ativar o catálogo de jogos.</p></div>';
  const linha = j => `<tr data-id="${j?.id || ''}">
      <td><input data-c="nome" value="${esc(j?.nome || '')}" placeholder="Nome do jogo"></td>
      <td><input data-c="jogadores_min" type="number" min="1" max="20" value="${j?.jogadores_min ?? 2}"></td>
      <td><input data-c="jogadores_max" type="number" min="1" max="20" value="${j?.jogadores_max ?? 4}"></td>
      <td><input data-c="duracao_min" type="number" min="0" step="5" value="${j?.duracao_min ?? ''}" placeholder="min"></td>
      <td><input data-c="ativo" type="checkbox" ${j?.ativo === false ? '' : 'checked'}></td>
      <td><button class="botao pequeno" data-salvar-jogo>${j ? 'Salvar' : 'Adicionar'}</button></td></tr>`;
  return `<div class="cartao" style="overflow:auto"><p class="sub">Catálogo de jogos de tabuleiro que o cliente escolhe ao pedir a Hora de Mesa.</p>
    <table class="tabela"><thead><tr><th>Jogo</th><th>Mín.</th><th>Máx.</th><th>Duração</th><th>Ativo</th><th></th></tr></thead>
    <tbody>${linha(null)}${r.data.map(linha).join('')}</tbody></table></div>`;
}

async function adminPartidas() {
  const r = await sb.from('sessoes_mesa').select('*, jogos(nome), perfis(nome_exibicao), placar_mesa(jogador, pontos, ordem)')
    .eq('status', 'encerrada').order('encerrada_em', { ascending: false }).limit(40);
  if (r.error) return '<div class="cartao"><p class="sub">Atualize o banco (arquivo atualizar_tudo.sql) para ver as partidas.</p></div>';
  const lista = await Promise.all(r.data.map(async m => {
    let url = null;
    if (m.audio_path) { const u = await sb.storage.from('experiencias').createSignedUrl(m.audio_path, 3600); url = u.data?.signedUrl || null; }
    const placar = (m.placar_mesa || []).slice().sort((a, b) => b.pontos - a.pontos);
    return `<div class="cartao partida">
      <div class="linha"><h3>🎲 ${esc(m.jogos?.nome || m.jogo_livre || 'Jogo a combinar')}</h3><span class="estrelas-leitura">${'★'.repeat(m.nota || 0)}${'☆'.repeat(5 - (m.nota || 0))}</span></div>
      <small>${esc(m.perfis?.nome_exibicao || 'Cliente')} · ${m.jogadores} pessoa(s) · ${m.encerrada_em ? new Date(m.encerrada_em).toLocaleString('pt-BR') : ''} · bônus de equipe ${m.xp_equipe} XP</small>
      ${placar.length ? `<div class="mini-placar">${placar.map((x, i) => `<span class="${i === 0 && x.pontos > 0 ? 'lider' : ''}">${esc(x.jogador)} <b>${x.pontos}</b></span>`).join('')}</div>` : ''}
      ${m.comentario ? `<p class="comentario">“${esc(m.comentario)}”</p>` : ''}
      ${url ? `<audio controls preload="none" src="${url}"></audio>` : ''}
    </div>`;
  }));
  return lista.length ? lista.join('') : '<p class="vazio grande">Nenhuma partida encerrada ainda.</p>';
}

async function adminRegras() {
  const [cfg, niveis] = await Promise.all([sb.from('configuracoes').select('*').order('chave').then(ok), sb.from('niveis').select('*').order('nivel').then(ok)]);
  return `
    <div class="cartao"><h2>Regras</h2>
      ${cfg.map(c => `<label>${esc(c.chave)} <small>— ${esc(c.observacao || '')}</small>
        <input data-cfg="${esc(c.chave)}" type="number" step="any" value="${Number(c.valor)}"></label>`).join('')}
      <button class="botao primario" data-salvar-cfg>Salvar regras</button></div>
    <div class="cartao"><h2>Níveis (XP necessário)</h2>
      <p class="sub">Curva provisória. Troque pelos valores oficiais quando os sócios decidirem.</p>
      <div class="grade" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
      ${niveis.map(n => `<label>Nível ${n.nivel}<input data-nivel="${n.nivel}" type="number" min="0" value="${n.xp_necessario}"></label>`).join('')}</div>
      <button class="botao primario" data-salvar-niveis>Salvar níveis</button></div>`;
}

async function adminPacotes() {
  const { data, error } = await sb.from('pacotes_recarga').select('*').order('ordem');
  if (error) throw error;
  const linha = p => `<tr data-pid="${p?.id || ''}">
    <td><input data-c="nome" value="${esc(p?.nome || '')}" placeholder="Nome" style="margin:0"></td>
    <td><input data-c="valor_reais" type="number" step="0.01" min="1" value="${p?.valor_reais ?? ''}" style="margin:0;width:90px"></td>
    <td><input data-c="valor_ac" type="number" min="1" value="${p?.valor_ac ?? ''}" style="margin:0;width:90px"></td>
    <td><input data-c="ordem" type="number" value="${p?.ordem ?? data.length + 1}" style="margin:0;width:60px"></td>
    <td><label style="margin:0"><input type="checkbox" data-c="destaque" ${p?.destaque ? 'checked' : ''}> destaque</label>
        <label style="margin:0"><input type="checkbox" data-c="ativo" ${p?.ativo !== false ? 'checked' : ''}> ativo</label></td>
    <td><button class="botao pequeno" data-salvar-pacote>${p ? 'Salvar' : 'Adicionar'}</button></td></tr>`;
  return `<div class="cartao" style="overflow:auto"><p class="sub">Pacotes que o cliente vê para pagar com PIX. Quanto maior o pacote, maior o bônus em AC (1 AC = R$ 1). Valores provisórios.</p>
    <table><thead><tr><th>Nome</th><th>Paga (R$)</th><th>Recebe (AC)</th><th>Ordem</th><th></th><th></th></tr></thead>
    <tbody>${data.map(linha).join('')}${linha(null)}</tbody></table></div>`;
}

async function adminInvestidores() {
  const { data, error } = await sb.rpc('listar_investidores');
  if (error) throw error;
  const mesAtual = new Date().toISOString().slice(0, 7);
  return `<div class="cartao"><h2>Nova cota</h2>
      <p class="sub">A pessoa precisa já ter conta no app (cliente). Use o e-mail do cadastro dela.</p>
      <form id="f-cota">
        <label>E-mail<input name="email" type="email" required></label>
        <label>Descrição<input name="descricao" required placeholder="Ex.: Cota fundadora"></label>
        <div class="grade" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
          <label>Aportado (R$)<input name="aporte" type="number" step="0.01" min="0" value="0"></label>
          <label>Participação (%)<input name="part" type="number" step="0.001" min="0" value="0"></label>
          <label>Bônus de XP (%)<input name="bonus" type="number" step="0.01" min="0" value="0"></label></div>
        <button class="botao primario" type="submit">Cadastrar cota</button></form></div>
    <div class="cartao" style="overflow:auto"><h2>Investidores</h2>
      ${data.length ? `<table><thead><tr><th>Pessoa</th><th>Cota</th><th>Aportado</th><th>Part.</th><th>XP</th><th>Rendimentos</th><th></th></tr></thead><tbody>
      ${data.map(c => `<tr><td>${esc(c.nome)}<br><small>${esc(c.email)}</small></td><td>${esc(c.descricao)}${c.ativo ? '' : ' <small>(encerrada)</small>'}</td>
        <td>${fmtReais(c.valor_aportado)}</td><td>${Number(c.participacao_percentual)}%</td><td>+${Number(c.bonus_xp_percentual)}%</td><td>${fmtAC(c.total_rendimentos)}</td>
        <td>${c.ativo ? `<button class="botao pequeno" data-pagar-rend="${c.usuario_id}|${esc(c.nome)}">Pagar rendimento</button>
          <button class="botao pequeno perigo" data-encerrar-cota="${c.cota_id}">Encerrar</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<p class="vazio">Nenhum investidor ainda.</p>'}</div>
    <p class="sub">O rendimento cai no saldo do investidor em AC, uma vez por mês. Mês atual: ${mesAtual}.</p>`;
}

async function adminPesquisa() {
  const { data, error } = await sb.rpc('listar_pesquisa_jogadores');
  if (error) throw error;
  if (!data.length) return '<p class="vazio">Ninguém respondeu ainda. As respostas aparecem aqui conforme os clientes fazem o primeiro acesso.</p>';
  const idades = data.filter(d => d.idade != null).map(d => d.idade);
  const media = idades.length ? Math.round(idades.reduce((a, b) => a + b, 0) / idades.length) : '—';
  const porCasa = Object.keys(NOME_FACCAO).map(k => `${NOME_FACCAO[k]}: ${data.filter(d => d.faccao === k).length}`).join(' · ');
  const linhas = data.map(d => `<tr><td>${esc(d.nome)}<br><small>${esc(d.email)}</small></td><td>${d.idade ?? '—'}</td>
    <td>${d.faccao ? esc(NOME_FACCAO[d.faccao]) : '—'}</td><td>${esc(d.tempo_jogando || '—')}</td><td>${esc(d.motivacao_continuar || '—')}</td></tr>`).join('');
  return `<div class="cartao"><strong>${data.length}</strong> respostas · idade média <strong>${media}</strong><br><small>${porCasa}</small></div>
    <div class="cartao" style="overflow:auto"><p class="sub">O que mantém cada pessoa jogando, nas palavras dela.</p>
    <table><thead><tr><th>Jogador</th><th>Idade</th><th>Casa</th><th>Joga há</th><th>O que a faz continuar</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
}

const ROTULO_PAPEL = { admin: 'Administrador', garcom: 'Garçom (salão)', cozinha: 'Cozinha, bar e jogos' };
async function adminEquipe() {
  const papeis = ok(await sb.from('papeis_usuarios').select('*'));
  const ids = [...new Set(papeis.map(p => p.usuario_id))];
  const perfis = ids.length ? ok(await sb.from('perfis').select('id, nome_exibicao').in('id', ids)) : [];
  const nome = id => perfis.find(p => p.id === id)?.nome_exibicao || id.slice(0, 8);
  return `
    <div class="cartao"><h2>Criar acesso da equipe</h2>
      <p class="sub">Informe o e-mail, a senha inicial e o que a pessoa pode fazer. A conta já nasce pronta para entrar. Se ela esquecer a senha, usa "Esqueci minha senha" na tela de login e recebe o link no e-mail.</p>
      <form id="f-acesso">
        <label>Nome<input name="nome" maxlength="40" placeholder="Ex.: Lúcio" autocomplete="off"></label>
        <label>E-mail<input name="email" type="email" required placeholder="nome@empresa.com" autocomplete="off"></label>
        <label>Senha inicial<input name="senha" type="password" minlength="8" required autocomplete="new-password"></label>
        <p class="sub dica-senha">Mínimo 8 caracteres, com maiúscula, minúscula, número e símbolo. Peça para a pessoa trocar depois em "Senha".</p>
        <label>Acesso<select name="papel">${Object.entries(ROTULO_PAPEL).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
        <button class="botao primario" type="submit">Criar acesso</button></form></div>
    <div class="cartao"><h2>Quem tem acesso</h2>
      ${papeis.map(p => `<div class="linha" style="padding:6px 0"><span>${esc(nome(p.usuario_id))} <span class="chip">${esc(ROTULO_PAPEL[p.papel] || p.papel)}</span></span>
        <button class="botao pequeno perigo" data-rm-papel="${p.usuario_id}|${p.papel}">Remover</button></div>`).join('') || '<p class="sub">Ninguém.</p>'}</div>
    <div class="cartao"><h2>Dar acesso a quem já tem conta</h2>
      <form id="f-papel" class="linha" style="flex-wrap:wrap"><input name="email" type="email" placeholder="e-mail da pessoa" required style="flex:2;min-width:200px;margin:0">
        <select name="papel" style="flex:1;min-width:120px;margin:0"><option value="garcom">garçom</option><option value="cozinha">cozinha</option><option value="admin">admin</option></select>
        <button class="botao" type="submit">Conceder</button></form></div>`;
}

/* ---------- eventos ---------- */
raiz.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.acao === 'sair') return sair();
  if (d.acao === 'senha') {
    const m = abrirModal(`<h2>Trocar senha</h2>
      <form id="f-senha"><label>Nova senha<input name="senha" type="password" minlength="8" autocomplete="new-password" required></label>
      <p class="sub">Mínimo 8 caracteres, com maiúscula, minúscula, número e símbolo (* ! @ #). Sem sequências como 123 ou abc.</p>
      <button class="botao primario" type="submit">Salvar senha</button>
      <button class="botao" type="button" data-fechar style="width:100%;margin-top:8px">Cancelar</button></form>`);
    m.querySelector('#f-senha').addEventListener('submit', ev => {
      ev.preventDefault();
      comTrava(ev.target.querySelector('button[type=submit]'), async () => {
        const senha = new FormData(ev.target).get('senha');
        const faltas = validarSenha(senha, E.user?.email || '');
        if (faltas.length) throw new Error('Senha fraca. Falta: ' + faltas.join('; ') + '.');
        const { error } = await sb.auth.updateUser({ password: senha });
        if (error) throw error;
        fecharModal(); toast('Senha salva.');
      });
    });
    return;
  }
  if (d.aba) { E.aba = d.aba; return desenhar(); }
  if (d.sub) { E.subAdmin = d.sub; return desenhar(); }
  if (d.recarga !== undefined) { const [id, n] = partir(d.recarga); return modalRecarga(id || '', n || ''); }
  if (d.fecharConta) { const [id, resto] = partir(d.fecharConta); const [t, mesa] = partir(resto); return modalFecharConta(id, Number(t), mesa); }
  if (d.kids) { const [c, u] = partir(d.kids); return modalKids(c, u); }
  if (d.kidsFim) return comTrava(b, async () => {
    const { error } = await sb.from('sessoes_kids').update({ encerrada_em: new Date().toISOString() }).eq('id', d.kidsFim);
    if (error) throw error; toast('Kids encerrado.'); desenhar();
  });
  if (d.itemStatus) return comTrava(b, async () => {
    const [id, st] = d.itemStatus.split('|');
    const { error } = await sb.from('itens_comanda').update({ status: st }).eq('id', id);
    if (error) throw error; desenhar();
  });
  if (d.salvarItem !== undefined) return comTrava(b, async () => {
    const tr = b.closest('tr'); const v = c => tr.querySelector(`[data-c=${c}]`);
    const reg = { nome: v('nome').value.trim(), categoria: v('categoria').value, faccao: v('faccao').value || null,
      preco_ac: Math.round(Number(v('preco_ac').value)), ativo: v('ativo').checked, descricao: v('descricao').value.trim() || null };
    if (!reg.nome || Number.isNaN(reg.preco_ac)) throw new Error('Preencha nome e preço.');
    const id = tr.dataset.id;
    const { error } = id ? await sb.from('cardapio').update(reg).eq('id', id) : await sb.from('cardapio').insert(reg);
    if (error) throw error; toast(id ? 'Item salvo.' : 'Item adicionado.'); desenhar();
  });
  if (d.mesaAv) return comTrava(b, async () => {
    const [id, st] = d.mesaAv.split('|');
    const { error } = await sb.rpc('mesa_avancar', { _id: id, _status: st }); if (error) throw error;
    toast(st === 'jogando' ? 'Partida iniciada.' : st === 'cancelada' ? 'Pedido cancelado.' : 'Marcado como separando.'); desenhar();
  });
  if (d.mesaPronta) return perguntarRotuloMesa(d.mesaPronta);
  if (d.salvarJogo !== undefined) return comTrava(b, async () => {
    const tr = b.closest('tr'); const v = c => tr.querySelector(`[data-c=${c}]`);
    const mn = Math.round(Number(v('jogadores_min').value)), mx = Math.round(Number(v('jogadores_max').value));
    const reg = { nome: v('nome').value.trim(), jogadores_min: mn, jogadores_max: mx,
      duracao_min: v('duracao_min').value ? Math.round(Number(v('duracao_min').value)) : null, ativo: v('ativo').checked };
    if (!reg.nome || !(mn >= 1) || !(mx >= mn)) throw new Error('Confira o nome e o número de jogadores.');
    const id = tr.dataset.id;
    const { error } = id ? await sb.from('jogos').update(reg).eq('id', id) : await sb.from('jogos').insert(reg);
    if (error) throw error; toast(id ? 'Jogo salvo.' : 'Jogo adicionado.'); desenhar();
  });
  if (d.salvarPacote !== undefined) return comTrava(b, async () => {
    const tr = b.closest('tr'); const v = c => tr.querySelector(`[data-c=${c}]`);
    const reg = { nome: v('nome').value.trim(), valor_reais: Number(v('valor_reais').value), valor_ac: Math.round(Number(v('valor_ac').value)),
      ordem: Math.round(Number(v('ordem').value) || 0), destaque: v('destaque').checked, ativo: v('ativo').checked };
    if (!reg.nome || !(reg.valor_reais > 0) || !(reg.valor_ac > 0)) throw new Error('Preencha nome, valor em R$ e quantidade de AC.');
    const id = tr.dataset.pid;
    const { error } = id ? await sb.from('pacotes_recarga').update(reg).eq('id', id) : await sb.from('pacotes_recarga').insert(reg);
    if (error) throw error; toast(id ? 'Pacote salvo.' : 'Pacote adicionado.'); desenhar();
  });
  if (d.encerrarCota) return comTrava(b, async () => {
    if (!confirm('Encerrar esta cota? O investidor perde o buff de XP e não recebe novos rendimentos.')) return;
    const { error } = await sb.rpc('encerrar_cota', { _cota: d.encerrarCota });
    if (error) throw error; toast('Cota encerrada.'); desenhar();
  });
  if (d.pagarRend) {
    const [uid, nome] = partir(d.pagarRend);
    const m = abrirModal(`<h2>Pagar rendimento</h2><p class="sub">${esc(nome)} — cai no saldo dele em AC.</p>
      <form id="f-rend"><label>Mês de referência<input name="mes" type="month" required value="${new Date().toISOString().slice(0, 7)}"></label>
      <label>Valor em AC<input name="valor" type="number" min="1" step="1" required></label>
      <label>Observação (opcional)<input name="obs" maxlength="120"></label>
      <button class="botao primario" type="submit">Pagar</button>
      <button class="botao" type="button" data-fechar style="width:100%;margin-top:8px">Cancelar</button></form>`);
    m.querySelector('#f-rend').addEventListener('submit', ev => {
      ev.preventDefault(); const fd = new FormData(ev.target);
      comTrava(ev.target.querySelector('button[type=submit]'), async () => {
        const { error } = await sb.rpc('pagar_rendimento', { _usuario: uid, _competencia: fd.get('mes') + '-01',
          _valor_ac: Math.round(Number(fd.get('valor'))), _observacao: fd.get('obs') || null });
        if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Esse mês já foi pago para esta pessoa.' : error.message);
        fecharModal(); toast('Rendimento pago.'); desenhar();
      });
    });
    return;
  }
  if (d.salvarCfg !== undefined) return comTrava(b, async () => {
    for (const el of $$('[data-cfg]')) {
      const { error } = await sb.from('configuracoes').update({ valor: Number(el.value) }).eq('chave', el.dataset.cfg);
      if (error) throw error;
    }
    toast('Regras salvas.');
  });
  if (d.salvarNiveis !== undefined) return comTrava(b, async () => {
    const linhas = $$('[data-nivel]').map(el => ({ nivel: Number(el.dataset.nivel), xp_necessario: Math.round(Number(el.value)) }));
    const { error } = await sb.from('niveis').upsert(linhas); if (error) throw error; toast('Níveis salvos.');
  });
  if (d.rmPapel) return comTrava(b, async () => {
    const [u, p] = d.rmPapel.split('|');
    if (u === E.user.id && p === 'admin') throw new Error('Você não pode remover o seu próprio admin.');
    const { error } = await sb.from('papeis_usuarios').delete().eq('usuario_id', u).eq('papel', p);
    if (error) throw error; desenhar();
  });
});

raiz.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'f-acesso') {
    return comTrava(e.target.querySelector('button[type=submit]'), async () => {
      const f = Object.fromEntries(new FormData(e.target));
      const faltas = validarSenha(f.senha, f.email);
      if (faltas.length) throw new Error('Senha fraca. Falta: ' + faltas.join('; ') + '.');
      const { data, error } = await sb.functions.invoke('super-function', { body: { nome: f.nome, email: f.email, senha: f.senha, papel: f.papel } });
      if (error) {
        let msg = 'Não foi possível criar o acesso. A função (super-function) já foi publicada no Supabase?';
        try { const j = await error.context?.json?.(); if (j?.erro) msg = j.erro; } catch { /* mantém a mensagem */ }
        throw new Error(msg);
      }
      if (data?.erro) throw new Error(data.erro);
      toast(`${data.criado ? 'Acesso criado' : 'Acesso atualizado'}: ${f.email}. Já pode entrar.`); desenhar();
    });
  }
  if (e.target.id === 'f-papel') {
    const f = new FormData(e.target);
    comTrava(e.target.querySelector('button'), async () => {
      const { error } = await sb.rpc('conceder_papel', { _email: f.get('email').trim(), _papel: f.get('papel') });
      if (error) throw error; toast('Papel concedido.'); desenhar();
    });
  }
  if (e.target.id === 'f-cota') {
    const f = new FormData(e.target);
    comTrava(e.target.querySelector('button'), async () => {
      const { error } = await sb.rpc('cadastrar_cota', { _email: f.get('email').trim(), _descricao: f.get('descricao'),
        _valor_aportado: Number(f.get('aporte')), _participacao: Number(f.get('part')), _bonus_xp: Number(f.get('bonus')) });
      if (error) throw error; toast('Cota cadastrada.'); desenhar();
    });
  }
});

/* ---------- tempo real ---------- */
let audio = null;
function bip() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = .15; o.connect(g); g.connect(audio.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .35); o.stop(audio.currentTime + .4);
    navigator.vibrate?.([80, 40, 80]);
  } catch { /* sem áudio: segue */ }
}
document.addEventListener('pointerdown', () => { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch {} }, { once: true });

function assinarTempoReal() {
  const telasVivas = ['salao', 'cozinha', 'bar', 'jogos'];
  const atualizar = () => { if (telasVivas.includes(E.aba) && !$('#modal.aberto')) desenhar(); else atualizarContagens(); };
  const novoPedido = async payload => {
    try {
      const it = payload.new;
      const { data } = await sb.from('cardapio').select('nome, categoria').eq('id', it.item_cardapio_id).maybeSingle();
      const est = estacaoDe(data?.categoria);
      if (tem('cozinha')) {
        bip(); toast(`${ESTACOES[est].icone} Novo pedido: ${it.quantidade}× ${data?.nome || 'item'}`);
      }
    } catch { /* silencioso */ }
    atualizar();
  };
  const pronto = payload => {
    if (payload.new?.status === 'pronto' && payload.old?.status !== 'pronto' && tem('garcom')) { bip(); toast('🔔 Pedido pronto para entregar.'); }
    atualizar();
  };
  sb.channel('equipe')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'itens_comanda' }, novoPedido)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'itens_comanda' }, pronto)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'itens_comanda' }, atualizar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comandas' }, atualizar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessoes_kids' }, atualizar)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessoes_mesa' }, () => { if (tem('cozinha')) { bip(); toast('🎲 Nova mesa de jogo pedida.'); } atualizar(); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessoes_mesa' }, atualizar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'placar_mesa' }, atualizar)
    .subscribe();
  setInterval(atualizar, 60000);   // atualiza os "há X min" mesmo sem evento
}

/* ---------- início ---------- */
async function iniciar() {
  if (!configurado) return avisoSemConfig(raiz);
  const sessao = await sessaoAtual();
  if (sessao && emRecuperacao()) return telaNovaSenha(raiz);
  if (!sessao) {
    return montarLogin(raiz, { titulo: 'O Conclave · Equipe', subtitulo: 'Entre com o seu login individual.', permiteCadastro: false, aoEntrar: iniciar });
  }
  E.user = sessao.user;
  try {
    E.perfil = ok(await sb.from('perfis').select('*').eq('id', E.user.id).single());
    E.papeis = ok(await sb.from('papeis_usuarios').select('papel').eq('usuario_id', E.user.id)).map(r => r.papel);
  } catch (e) {
    raiz.innerHTML = `<div class="cartao aviso"><h2>Não deu para carregar</h2><p>${esc(erroAmigavel(e))}</p></div>`; return;
  }
  ligarOnda();
  if (!abasDisponiveis().length) {
    raiz.innerHTML = `<div class="login"><h1>Sem acesso</h1><p class="sub">Seu login (${esc(E.user.email)}) ainda não tem papel de equipe. Peça ao administrador.</p>
      <button class="botao" id="sair">Sair</button></div>`;
    $('#sair').addEventListener('click', sair); return;
  }
  if (!iniciado) { iniciado = true; assinarTempoReal(); }
  raiz.innerHTML = '';
  desenhar();
}

iniciar();
