// App do FUNCIONÁRIO — O Conclave (salão, cozinha e administração)
import { sb, configurado, $, $$, esc, fmtNum, fmtReais, fmtAC, toast, abrirModal, fecharModal, avisoSemConfig,
         comTrava, erroAmigavel, tempoDecorrido, contem, partir, NOME_FACCAO } from '../nucleo.js';
import { sessaoAtual, montarLogin, sair } from '../auth.js';

const raiz = document.getElementById('app');
const ok = r => { if (r.error) throw r.error; return r.data; };
const CATEGORIAS = ['comida', 'bebida', 'jogo', 'kids', 'personalizado'];
const PACOTES = [[20, 20000], [50, 55000], [100, 120000]];   // R$ → AC (com bônus)

const E = { user: null, perfil: null, papeis: [], aba: null, subAdmin: 'cardapio' };
let iniciado = false;
const tem = p => E.papeis.includes(p) || E.papeis.includes('admin');

/* ---------- estrutura ---------- */
function abasDisponiveis() {
  const a = [];
  if (tem('garcom')) a.push(['salao', '🍽️ Salão']);
  if (tem('cozinha')) a.push(['cozinha', '👨‍🍳 Cozinha']);
  if (tem('admin')) a.push(['admin', '⚙️ Admin']);
  return a;
}

function desenhar() {
  const abas = abasDisponiveis();
  if (!abas.some(([id]) => id === E.aba)) E.aba = abas[0][0];
  if (!$('#conteudo')) {
    raiz.innerHTML = `
      <header class="barra-topo">
        <div class="linha"><strong>⚔️ O Conclave · Equipe</strong>
          <span><small>${esc(E.perfil.nome_exibicao)}</small> <button class="botao pequeno" data-acao="sair">Sair</button></span></div>
        <nav class="abas" id="abas"></nav>
      </header>
      <main id="conteudo"></main>`;
  }
  $('#abas').innerHTML = abas.map(([id, nome]) =>
    `<button class="botao ${id === E.aba ? 'ativo' : ''}" data-aba="${id}">${nome}</button>`).join('');
  const vistas = { salao: vSalao, cozinha: vCozinha, admin: vAdmin };
  Promise.resolve(vistas[E.aba]()).then(html => { if ($('#conteudo')) $('#conteudo').innerHTML = html; })
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
          <span><span class="chip ${i.status}">${i.status}</span>
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
    const ac = acPacote ?? Math.round(reais * 1000);
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
async function vCozinha() {
  const itens = ok(await sb.from('itens_comanda')
    .select('*, cardapio(nome), comandas!inner(mesa, status)')
    .in('status', ['pendente', 'preparando']).eq('comandas.status', 'aberta').order('criado_em'));
  return `
    <h2>Fila da cozinha (${itens.length})</h2>
    <div class="painel">${itens.length ? itens.map(i => `
      <div class="cartao ticket ${i.status}">
        <div class="linha"><h2 style="margin:0">${i.quantidade}× ${esc(i.cardapio?.nome)}</h2><span class="chip ${i.status}">${i.status}</span></div>
        <p style="margin:4px 0">Mesa <strong>${esc(i.comandas?.mesa)}</strong> · há ${tempoDecorrido(i.criado_em)}</p>
        ${i.detalhes_personalizados?.adicionais?.length ? `<p class="detalhe" style="font-size:1rem">+ ${esc(i.detalhes_personalizados.adicionais.join(', '))}</p>` : ''}
        ${i.detalhes_personalizados?.observacao ? `<p class="detalhe" style="font-size:1rem">Obs: ${esc(i.detalhes_personalizados.observacao)}</p>` : ''}
        ${i.status === 'pendente'
          ? `<button class="botao primario" data-item-status="${i.id}|preparando">Começar a preparar</button>`
          : `<button class="botao primario" data-item-status="${i.id}|pronto">Pronto</button>`}
      </div>`).join('') : '<p class="vazio">Nada na fila. 🎉</p>'}</div>`;
}

/* ================= ADMIN ================= */
async function vAdmin() {
  const sub = E.subAdmin;
  const menu = `<div class="abas" style="margin-bottom:12px">${[['cardapio', 'Cardápio'], ['regras', 'Regras e níveis'], ['equipe', 'Equipe']]
    .map(([id, n]) => `<button class="botao pequeno ${sub === id ? 'ativo' : ''}" data-sub="${id}">${n}</button>`).join('')}</div>`;
  if (sub === 'cardapio') return menu + await adminCardapio();
  if (sub === 'regras') return menu + await adminRegras();
  return menu + await adminEquipe();
}

const opcoesCat = sel => CATEGORIAS.map(c => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('');
const opcoesFac = sel => `<option value="">— nenhuma —</option>` + Object.entries(NOME_FACCAO)
  .map(([k, n]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${n}</option>`).join('');

async function adminCardapio() {
  const itens = ok(await sb.from('cardapio').select('*').order('categoria').order('nome'));
  const linha = i => `
    <tr data-id="${i?.id || ''}">
      <td><input data-c="nome" value="${esc(i?.nome || '')}" placeholder="Nome do item"></td>
      <td><select data-c="categoria">${opcoesCat(i?.categoria)}</select></td>
      <td><select data-c="faccao">${opcoesFac(i?.faccao)}</select></td>
      <td><input data-c="preco_ac" type="number" min="0" step="500" value="${i?.preco_ac ?? ''}" placeholder="AC"></td>
      <td><input data-c="ativo" type="checkbox" ${i?.ativo === false ? '' : 'checked'}></td>
      <td><button class="botao pequeno" data-salvar-item>${i ? 'Salvar' : 'Adicionar'}</button></td>
    </tr>`;
  return `<div class="cartao" style="overflow:auto"><p class="sub">Preço em AC (1.000 AC = R$ 1). Item desativado some do cardápio do cliente.</p>
    <table class="tabela"><thead><tr><th>Nome</th><th>Categoria</th><th>Facção</th><th>Preço (AC)</th><th>Ativo</th><th></th></tr></thead>
    <tbody>${linha(null)}${itens.map(linha).join('')}</tbody></table></div>`;
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

async function adminEquipe() {
  const papeis = ok(await sb.from('papeis_usuarios').select('*'));
  const ids = [...new Set(papeis.map(p => p.usuario_id))];
  const perfis = ids.length ? ok(await sb.from('perfis').select('id, nome_exibicao').in('id', ids)) : [];
  const nome = id => perfis.find(p => p.id === id)?.nome_exibicao || id.slice(0, 8);
  return `
    <div class="cartao"><h2>Dar um papel</h2>
      <p class="sub">A pessoa precisa já ter criado a conta (cliente ou Authentication do Supabase).</p>
      <form id="f-papel" class="linha" style="flex-wrap:wrap"><input name="email" type="email" placeholder="e-mail da pessoa" required style="flex:2;min-width:200px;margin:0">
        <select name="papel" style="flex:1;min-width:120px;margin:0"><option>garcom</option><option>cozinha</option><option>admin</option></select>
        <button class="botao" type="submit">Conceder</button></form></div>
    <div class="cartao"><h2>Quem tem papel</h2>
      ${papeis.map(p => `<div class="linha" style="padding:6px 0"><span>${esc(nome(p.usuario_id))} — <span class="chip">${p.papel}</span></span>
        <button class="botao pequeno perigo" data-rm-papel="${p.usuario_id}|${p.papel}">Remover</button></div>`).join('') || '<p class="sub">Ninguém.</p>'}</div>`;
}

/* ---------- eventos ---------- */
raiz.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.acao === 'sair') return sair();
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
      preco_ac: Math.round(Number(v('preco_ac').value)), ativo: v('ativo').checked };
    if (!reg.nome || Number.isNaN(reg.preco_ac)) throw new Error('Preencha nome e preço.');
    const id = tr.dataset.id;
    const { error } = id ? await sb.from('cardapio').update(reg).eq('id', id) : await sb.from('cardapio').insert(reg);
    if (error) throw error; toast(id ? 'Item salvo.' : 'Item adicionado.'); desenhar();
  });
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
  if (e.target.id === 'f-papel') {
    const f = new FormData(e.target);
    comTrava(e.target.querySelector('button'), async () => {
      const { error } = await sb.rpc('conceder_papel', { _email: f.get('email').trim(), _papel: f.get('papel') });
      if (error) throw error; toast('Papel concedido.'); desenhar();
    });
  }
});

/* ---------- tempo real ---------- */
function assinarTempoReal() {
  const atualizar = () => { if (['salao', 'cozinha'].includes(E.aba) && !$('#modal.aberto')) desenhar(); };
  sb.channel('equipe')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'itens_comanda' }, atualizar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comandas' }, atualizar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessoes_kids' }, atualizar)
    .subscribe();
  setInterval(atualizar, 60000);   // atualiza os "há X min" mesmo sem evento
}

/* ---------- início ---------- */
async function iniciar() {
  if (!configurado) return avisoSemConfig(raiz);
  const sessao = await sessaoAtual();
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
