// Ponto de entrada: login, menu, atualização em tempo real e distribuição dos cliques.
// As telas ficam em js/views/ e se registram nos objetos views/acoes/mudancas/envios.
import { $, $$, esc, norm, intervaloMes } from './js/util.js';
import {
  configurado, auth, db, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  collection, doc, getDoc, setDoc, onSnapshot, query, orderBy, where
} from './js/firebase.js';
import { S, ui, views, acoes, mudancas, envios, aoEntrar, can, ehAdmin, nomePapel, recalcCfg, msgErro } from './js/state.js';
import { CONFIG_PADRAO, PAPEIS_PADRAO } from './js/config.js';
import { toast, dlg } from './js/modal.js';
import './js/views/painel.js';
import './js/views/clientes.js';
import './js/views/emprestimos.js';
import './js/views/relatorios.js';
import './js/views/ajustes.js';
import './js/views/usuarios.js';
import './js/views/listas.js';   // precisa ficar depois de clientes.js e emprestimos.js
import { aplicarAparencia } from './js/aparencia.js';

aplicarAparencia(); // tema guardado neste aparelho, já na tela de login

/* ---------- menu (para incluir uma tela nova, basta acrescentar uma linha) ---------- */
const VER_DADOS = () => can('dados.ver');
const NAV = [
  ['painel', 'Painel', VER_DADOS], ['cobrancas', 'Cobranças', VER_DADOS], ['clientes', 'Clientes', VER_DADOS],
  ['emprestimos', 'Empréstimos', VER_DADOS], ['relatorios', 'Relatórios', VER_DADOS],
  ['usuarios', 'Usuários', () => can('usuarios.gerenciar')], ['ajustes', 'Ajustes', () => can('ajustes.editar')]
];
const visiveis = () => NAV.filter(n => n[2]());

function desenharNav() {
  $('#nav').innerHTML = visiveis().map(([id, t]) => `<button data-view="${id}" aria-current="${S.view === id ? 'page' : 'false'}">${esc(t)}</button>`).join('');
}

function navegar(view) {
  S.view = view;
  render(true);
  aoEntrar[view]?.();
}

// force = true quando foi o próprio usuário que pediu. Atualizações em tempo real
// não interrompem quem está digitando.
function render(force = false) {
  if (!S.perfil) return;
  const a = document.activeElement;
  if (!force && a && $('#main').contains(a) && a.matches('input,textarea,select')) { S.renderPendente = true; return; }
  S.renderPendente = false;
  $('#marca').textContent = S.cfg.empresa.nome;
  document.title = `${S.cfg.empresa.nome} – gestão de empréstimos`;
  $('#quem').textContent = `${S.perfil.nome || S.perfil.email} (${nomePapel(S.perfil.papel)})`;
  const v = visiveis();
  if (!v.some(n => n[0] === S.view)) S.view = v[0]?.[0] || 'painel';
  desenharNav();
  $('#main').innerHTML = v.length && views[S.view] ? views[S.view]() : '<p class="vazio">Seu usuário ainda não tem permissão para ver nenhuma tela. Fale com o administrador.</p>';
}
ui.render = render;
ui.navegar = navegar;

$('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) navegar(b.dataset.view); });
$('#main').addEventListener('focusout', () => {
  if (!S.renderPendente) return;
  setTimeout(() => { const a = document.activeElement; if (!(a && $('#main').contains(a) && a.matches('input,textarea,select'))) render(true); }, 60);
});

/* ---------- distribuição de eventos ---------- */
const despachar = e => {
  const el = e.target.closest('[data-acao]');
  if (el && acoes[el.dataset.acao]) acoes[el.dataset.acao](el.dataset, el);
};
$('#main').addEventListener('click', despachar);
dlg.addEventListener('click', despachar);

const mudou = e => { const k = e.target.dataset.mudar; if (k && mudancas[k]) mudancas[k](e.target); };
$('#main').addEventListener('change', mudou);
dlg.addEventListener('change', mudou);

$('#main').addEventListener('input', e => {
  const alvo = e.target.dataset.busca;
  if (!alvo) return;
  const q = norm(e.target.value);
  $$(`#${alvo} tbody tr`).forEach(tr => { tr.hidden = !norm((tr.dataset.q || '') + ' ' + tr.textContent).includes(q); });
});

$('#main').addEventListener('submit', async e => {
  const h = envios[e.target.id];
  if (!h) return;
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]');
  const er = e.target.querySelector('.erro');
  if (er) er.textContent = '';
  if (btn) btn.disabled = true;
  try { await h(new FormData(e.target), e.target); }
  catch (err) { if (er) er.textContent = msgErro(err); else toast(msgErro(err)); }
  finally { if (btn) btn.disabled = false; }
});

/* ---------- login ---------- */
function mostrarLogin() {
  $('#app').hidden = true;
  aplicarAparencia();
  $('#login').hidden = false;
  $('#erro-login').textContent = S.msgLogin;
  S.msgLogin = '';
}

if (!configurado) {
  $('#login').hidden = false;
  $('#erro-login').textContent = 'Falta configurar o Firebase: abra o arquivo firebase-config.js e cole os dados do seu projeto.';
} else {
  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const er = $('#erro-login');
    er.textContent = '';
    try { await signInWithEmailAndPassword(auth, fd.get('email').trim(), fd.get('senha')); }
    catch (err) { er.textContent = msgErro(err); }
  });
  $('#esqueci').addEventListener('click', async () => {
    const er = $('#erro-login');
    const email = $('#form-login [name=email]').value.trim();
    if (!email) { er.textContent = 'Digite seu e-mail acima e clique de novo.'; return; }
    try { await sendPasswordResetEmail(auth, email); er.textContent = ''; toast('Enviamos um link para redefinir a senha no seu e-mail.'); }
    catch (err) { er.textContent = msgErro(err); }
  });
  $('#sair').addEventListener('click', () => signOut(auth));

  onAuthStateChanged(auth, async u => {
    pararListeners();
    if (!u) { S.user = null; S.perfil = null; mostrarLogin(); return; }
    try {
      const snap = await getDoc(doc(db, 'usuarios', u.uid));
      if (!snap.exists() || snap.data().ativo !== true) {
        S.msgLogin = 'Seu acesso não está liberado. Fale com o administrador.';
        await signOut(auth);
        return;
      }
      const perfil = { id: u.uid, ...snap.data() };
      const [g, p] = await Promise.all([getDoc(doc(db, 'config', 'geral')), getDoc(doc(db, 'config', 'papeis'))]);
      if (perfil.papel !== 'admin' && !p.exists()) {
        S.msgLogin = 'O sistema ainda não foi configurado. Peça ao administrador para entrar primeiro.';
        await signOut(auth);
        return;
      }
      S.user = u; S.perfil = perfil;
      S.cfgRaw = g.exists() ? g.data() : null;
      S.papeisRaw = p.exists() ? p.data() : null;
      recalcCfg();
      aplicarAparencia(true); // aplica o tema da pessoa e guarda uma cópia neste aparelho
      iniciarApp(g.exists(), p.exists());
    } catch (e) {
      S.msgLogin = msgErro(e);
      await signOut(auth);
    }
  });
}

function pararListeners() {
  S.unsubs.forEach(f => f());
  S.unsubs = [];
  Object.assign(S, { clientes: [], emprestimos: [], pagMes: [], usuarios: [], auditoria: [], eventosDet: {}, detalheId: null });
  S.rel = { periodo: 'mes', ini: '', fim: '', pag: [], carregando: false };
}

function iniciarApp(temGeral, temPapeis) {
  $('#login').hidden = true;
  $('#app').hidden = false;
  S.view = visiveis()[0]?.[0] || 'painel';

  // Primeiro acesso do administrador: grava os ajustes iniciais para todos usarem
  if (ehAdmin()) {
    if (!temGeral) setDoc(doc(db, 'config', 'geral'), CONFIG_PADRAO).catch(() => {});
    if (!temPapeis) setDoc(doc(db, 'config', 'papeis'), PAPEIS_PADRAO).catch(() => {});
  }

  const erro = e => toast(msgErro(e));
  const atualizar = () => { aplicarAparencia(); render(); ui.atualizarDetalhe?.(); };

  S.unsubs.push(onSnapshot(doc(db, 'config', 'geral'), s => { S.cfgRaw = s.exists() ? s.data() : null; recalcCfg(); atualizar(); }, erro));
  S.unsubs.push(onSnapshot(doc(db, 'config', 'papeis'), s => { S.papeisRaw = s.exists() ? s.data() : null; recalcCfg(); atualizar(); }, erro));
  if (can('dados.ver')) {
    S.unsubs.push(onSnapshot(query(collection(db, 'clientes'), orderBy('nome')), s => {
      S.clientes = s.docs.map(d => ({ id: d.id, ...d.data() })); atualizar();
    }, erro));
    S.unsubs.push(onSnapshot(collection(db, 'emprestimos'), s => {
      S.emprestimos = s.docs.map(d => ({ id: d.id, ...d.data() })); atualizar();
    }, erro));
    const { ini, fim } = intervaloMes();
    S.unsubs.push(onSnapshot(query(collection(db, 'pagamentos'), where('data', '>=', ini), where('data', '<=', fim)), s => {
      S.pagMes = s.docs.map(d => d.data()); render();
    }, erro));
  }
  if (can('usuarios.gerenciar')) {
    S.unsubs.push(onSnapshot(collection(db, 'usuarios'), s => {
      S.usuarios = s.docs.map(d => ({ id: d.id, ...d.data() }));
      if (S.view === 'usuarios') render();
    }, erro));
  }
  render(true);
  aoEntrar[S.view]?.();
}
