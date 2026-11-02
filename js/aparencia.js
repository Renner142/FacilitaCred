// Temas, cor de destaque, tamanho do texto, densidade e colunas das listas.
// As preferências ficam no usuário (usuarios/{uid}.prefs) e acompanham o login em qualquer aparelho.
// A empresa pode definir um padrão (config/geral.visual); cada pessoa pode sobrepor.
import { $, esc } from './util.js';
import { S, acoes, mudancas, ui, can, log, msgErro } from './state.js';
import { abrirModal, fecharModal, ligarForm, toast } from './modal.js';
import { db, doc, setDoc, updateDoc } from './firebase.js';

/* ---------- temas: para criar um novo, copie um bloco e mude as cores (6 dígitos, com #) ---------- */
const VERDE = {
  papel: '#F2F4F1', sup: '#FFFFFF', tinta: '#16231E', suave: '#5B6963', linha: '#D9DFDA',
  verde: '#14513B', 'verde-esc': '#0D3B2B', 'verde-claro': '#E3EFE8',
  atraso: '#B23A2B', 'atraso-bg': '#FBEDEA', aviso: '#8A5A00', 'aviso-bg': '#FFF4DB', ok: '#2B7A4B', 'ok-bg': '#E5F3EA',
  campo: '#FFFFFF', 'borda-campo': '#BCC6C0', hover: '#F8FAF8',
  'topo-bg': '#0D3B2B', 'topo-txt': '#FFFFFF', 'topo-suave': '#CFE0D7', 'sobre-destaque': '#FFFFFF'
};
export const TEMAS = {
  auto: { nome: 'Automático', v: {} },
  verde: { nome: 'Verde', v: {} },
  azul: { nome: 'Azul', v: {
    papel: '#F1F4F8', tinta: '#14202E', suave: '#5A6878', linha: '#D8DFE8', verde: '#1F5FA8', 'verde-esc': '#123F73', 'verde-claro': '#E2ECF8',
    'borda-campo': '#B9C4D2', hover: '#F7F9FC', 'topo-bg': '#123F73', 'topo-suave': '#C9DAF0' } },
  roxo: { nome: 'Roxo', v: {
    papel: '#F4F2F7', tinta: '#1D1A28', suave: '#605B72', linha: '#DDD9E6', verde: '#5B3F8C', 'verde-esc': '#3E2A66', 'verde-claro': '#ECE6F6',
    'borda-campo': '#C2BCD2', hover: '#FAF9FC', 'topo-bg': '#3E2A66', 'topo-suave': '#D8CEF0' } },
  grafite: { nome: 'Grafite', v: {
    papel: '#F3F4F5', tinta: '#171A1D', suave: '#5E666D', linha: '#DADDE0', verde: '#2F3A45', 'verde-esc': '#1B232B', 'verde-claro': '#E6EAEE',
    'borda-campo': '#BDC3C8', hover: '#F8F9FA', 'topo-bg': '#1B232B', 'topo-suave': '#C5CCD3' } },
  escuro: { nome: 'Escuro', escuro: true, v: {
    papel: '#12171A', sup: '#1B2226', tinta: '#E6ECE9', suave: '#9AA8A2', linha: '#2C373C',
    verde: '#3FA574', 'verde-esc': '#55BC8B', 'verde-claro': '#1D3A2D',
    atraso: '#F08A7B', 'atraso-bg': '#3A1F1C', aviso: '#E8B450', 'aviso-bg': '#3A2F14', ok: '#6CCB93', 'ok-bg': '#17331F',
    campo: '#12171A', 'borda-campo': '#3A474D', hover: '#212A2F',
    'topo-bg': '#0B1013', 'topo-txt': '#E6ECE9', 'topo-suave': '#9AA8A2', 'sobre-destaque': '#07140E' } },
  contraste: { nome: 'Alto contraste', v: {
    papel: '#FFFFFF', tinta: '#000000', suave: '#222222', linha: '#555555', verde: '#00338D', 'verde-esc': '#001F5C', 'verde-claro': '#E6EEFF',
    atraso: '#A00000', 'atraso-bg': '#FFE3E3', aviso: '#6B4200', 'aviso-bg': '#FFF0C2', ok: '#006B2D', 'ok-bg': '#D9F5E3',
    'borda-campo': '#000000', hover: '#F0F0F0', 'topo-bg': '#000000', 'topo-suave': '#FFFFFF' } }
};
const BASE = { tema: 'verde', destaque: '', tamanho: 'normal', densidade: 'normal' };

/* ---------- cores ---------- */
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const toHex = a => '#' + a.map(n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((x, i) => x * (1 - t) + B[i] * t)); };
const lum = h => { const [r, g, b] = hex(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/* ---------- preferências ---------- */
const CHAVE = 'cad.prefs';
const lerLocal = () => { try { return JSON.parse(localStorage.getItem(CHAVE)) || {}; } catch { return {}; } };
const gravarLocal = p => { try { localStorage.setItem(CHAVE, JSON.stringify(p || {})); } catch { /* sem armazenamento */ } };
const prefsAtuais = () => (S.perfil ? S.perfil.prefs : lerLocal()) || {};

export function prefsEfetivas() {
  const out = { ...BASE, ...(S.cfg.visual || {}) };
  const u = prefsAtuais();
  for (const k of Object.keys(BASE)) if (u[k] !== undefined && u[k] !== null && u[k] !== '') out[k] = u[k];
  return out;
}

const resolverTema = id => id === 'auto'
  ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'escuro' : 'verde')
  : (TEMAS[id] ? id : 'verde');

export function aplicarAparencia(guardar = false) {
  if (guardar && S.perfil) gravarLocal(S.perfil.prefs);
  const p = prefsEfetivas();
  const T = TEMAS[resolverTema(p.tema)];
  const v = { ...VERDE, ...T.v };
  if (/^#[0-9a-f]{6}$/i.test(p.destaque || '')) {
    const d = p.destaque;
    v.verde = d;
    v['verde-esc'] = T.escuro ? mix(d, '#FFFFFF', 0.25) : mix(d, '#000000', 0.3);
    v['verde-claro'] = mix(d, v.sup, T.escuro ? 0.8 : 0.88);
    v['sobre-destaque'] = lum(d) > 0.5 ? '#0B0B0B' : '#FFFFFF';
    if (!T.escuro) v['topo-bg'] = v['verde-esc'];
  }
  const r = document.documentElement;
  for (const [k, val] of Object.entries(v)) r.style.setProperty('--' + k, val);
  r.style.colorScheme = T.escuro ? 'dark' : 'light';
  r.dataset.tamanho = p.tamanho;
  r.dataset.densidade = p.densidade;
}

async function gravarPrefs(novo) {
  if (S.perfil) S.perfil.prefs = novo;
  gravarLocal(novo);
  aplicarAparencia();
  if (S.user) {
    try { await updateDoc(doc(db, 'usuarios', S.user.uid), { prefs: novo }); }
    catch (e) { toast('Salvo só neste aparelho: ' + msgErro(e)); }
  }
}
export const salvarPrefs = parcial => gravarPrefs({ ...prefsAtuais(), ...parcial });

/* ---------- janela "Aparência" ---------- */
function amostra(id) {
  const cores = id === 'auto'
    ? [VERDE.papel, TEMAS.escuro.v.papel, TEMAS.escuro.v.verde]
    : (() => { const v = { ...VERDE, ...TEMAS[id].v }; return [v.papel, v.verde, v['topo-bg']]; })();
  return `<span class="sw">${cores.map(c => `<i style="background:${c}"></i>`).join('')}</span>`;
}

export function abrirAparencia() {
  const p = prefsEfetivas();
  const cor = p.destaque || ({ ...VERDE, ...TEMAS[resolverTema(p.tema)].v }).verde;
  const op = (v, t, atual) => `<option value="${v}" ${atual === v ? 'selected' : ''}>${t}</option>`;
  abrirModal('Aparência', `
    <p class="ajuda">Vale só para você e acompanha o seu login em qualquer aparelho.</p>
    <div class="temas">${Object.entries(TEMAS).map(([id, T]) =>
      `<button type="button" class="tema-btn" data-acao="tema" data-tema="${id}" aria-pressed="${p.tema === id}">${amostra(id)}<span>${esc(T.nome)}</span></button>`).join('')}</div>
    <div class="dupla">
      <label>Cor de destaque<input type="color" value="${esc(cor)}" data-mudar="pref-destaque"></label>
      <label>Tamanho do texto<select data-mudar="pref-tamanho">${op('pequeno', 'Pequeno', p.tamanho)}${op('normal', 'Normal', p.tamanho)}${op('grande', 'Grande', p.tamanho)}</select></label>
    </div>
    <div class="dupla">
      <label>Densidade das listas<select data-mudar="pref-densidade">${op('normal', 'Confortável', p.densidade)}${op('compacta', 'Compacta', p.densidade)}</select></label>
      <label>&nbsp;<button type="button" data-acao="pref-limpar-destaque">Usar a cor do tema</button></label>
    </div>
    <div class="acoes">
      <button type="button" class="perigo" data-acao="pref-padrao">Voltar ao padrão da empresa</button>
      <span class="espaco"></span>
      ${can('ajustes.editar') ? '<button type="button" data-acao="pref-empresa">Usar como padrão da empresa</button>' : ''}
      <button type="button" class="primario" data-fechar>Fechar</button>
    </div>`);
}

acoes.tema = async ds => { await salvarPrefs({ tema: ds.tema }); abrirAparencia(); };
acoes['pref-limpar-destaque'] = async () => { await salvarPrefs({ destaque: '' }); abrirAparencia(); };
acoes['pref-padrao'] = async () => { await gravarPrefs({ colunas: prefsAtuais().colunas || {} }); toast('Voltou ao padrão da empresa.'); abrirAparencia(); };
acoes['pref-empresa'] = async () => {
  const e = prefsEfetivas();
  try {
    await setDoc(doc(db, 'config', 'geral'), { visual: { tema: e.tema, destaque: e.destaque || '', tamanho: e.tamanho, densidade: e.densidade } }, { merge: true });
    log('ajustes', 'aparência padrão da empresa');
    toast('Aparência definida como padrão da empresa.');
  } catch (err) { toast(msgErro(err)); }
};
mudancas['pref-destaque'] = el => salvarPrefs({ destaque: el.value });
mudancas['pref-tamanho'] = el => salvarPrefs({ tamanho: el.value });
mudancas['pref-densidade'] = el => salvarPrefs({ densidade: el.value });
$('#aparencia')?.addEventListener('click', abrirAparencia);

/* ---------- colunas das listas ---------- */
export function colunasVisiveis(tabela, defs) {
  const sel = (prefsAtuais().colunas || {})[tabela];
  return defs.filter(d => d.fixo || (sel ? sel.includes(d.id) : d.padrao !== false));
}

export function abrirColunas(tabela, defs, titulo) {
  const ativas = new Set(colunasVisiveis(tabela, defs).map(d => d.id));
  abrirModal('Colunas: ' + titulo, `
    <form id="f">
      <p class="ajuda">Escolha o que aparece na lista. Vale só para você.</p>
      ${defs.map(d => `<label class="check"><input type="checkbox" name="c_${esc(d.id)}" ${ativas.has(d.id) ? 'checked' : ''} ${d.fixo ? 'disabled' : ''}> ${esc(d.rotulo)}</label>`).join('')}
      <div class="acoes">
        <button type="button" data-acao="colunas-padrao" data-tabela="${esc(tabela)}">Voltar ao padrão</button>
        <span class="espaco"></span>
        <button type="button" data-fechar>Cancelar</button>
        <button class="primario" type="submit">Salvar</button>
      </div>
    </form>`);
  ligarForm('#f', async fd => {
    const ids = defs.filter(d => d.fixo || fd.has('c_' + d.id)).map(d => d.id);
    const u = prefsAtuais();
    await gravarPrefs({ ...u, colunas: { ...(u.colunas || {}), [tabela]: ids } });
    fecharModal();
    ui.render(true);
  });
}
acoes['colunas-padrao'] = async ds => {
  const u = prefsAtuais();
  const col = { ...(u.colunas || {}) };
  delete col[ds.tabela];
  await gravarPrefs({ ...u, colunas: col });
  fecharModal();
  ui.render(true);
};
