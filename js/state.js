// Estado compartilhado e registros que ligam os módulos sem dependência circular
import { CONFIG_PADRAO, PAPEIS_PADRAO, mesclar } from './config.js';
import { setRegional } from './util.js';
import { db, collection, addDoc, serverTimestamp } from './firebase.js';

export const S = {
  user: null, perfil: null, view: 'painel',
  clientes: [], emprestimos: [], pagMes: [], usuarios: [],
  cfgRaw: null, papeisRaw: null, cfg: CONFIG_PADRAO, papeis: PAPEIS_PADRAO,
  filtroEmp: 'ativos', diasAgenda: null, detalheId: null, eventosDet: {},
  rel: { periodo: 'mes', ini: '', fim: '', pag: [], carregando: false },
  ajustesAba: 'empresa', auditoria: [],
  unsubs: [], msgLogin: '', renderPendente: false
};

// Registros preenchidos pelos módulos de tela
export const views = {};      // views.painel = () => html
export const acoes = {};      // acoes['novo-cliente'] = (dataset, elemento) => ...  (data-acao)
export const mudancas = {};   // mudancas['filtro-emp'] = elemento => ...            (data-mudar)
export const envios = {};     // envios['f-empresa'] = (FormData, form) => ...        (id do <form>)
export const aoEntrar = {};   // aoEntrar.relatorios = () => ...                      (ao abrir a tela)
export const ui = {};         // ui.render(force), ui.abrirDetalhe(id) ...

export function recalcCfg() {
  S.cfg = mesclar(CONFIG_PADRAO, S.cfgRaw || {});
  S.papeis = S.papeisRaw ?? PAPEIS_PADRAO;
  setRegional(S.cfg.regional);
}
recalcCfg();

export const ehAdmin = () => S.perfil?.papel === 'admin';
export const can = p => ehAdmin() || S.papeis?.[S.perfil?.papel]?.perm?.[p] === true;
export const clienteDe = id => S.clientes.find(c => c.id === id);
export const nomeCliente = l => clienteDe(l.clienteId)?.nome || l.clienteNome || 'Cliente removido';
export const nomePapel = id => id === 'admin' ? 'Administrador' : (S.papeis?.[id]?.nome || id || '—');

// Registro de auditoria (quem fez o quê). Falha em silêncio para nunca atrapalhar o uso.
export function log(acao, detalhe = '') {
  try {
    addDoc(collection(db, 'auditoria'), {
      acao, detalhe: String(detalhe).slice(0, 300), uid: S.user.uid,
      usuario: S.perfil?.nome || S.perfil?.email || '', ts: serverTimestamp()
    }).catch(() => {});
  } catch { /* ignora */ }
}

const ERROS = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/user-disabled': 'Este usuário foi desativado.',
  'auth/too-many-requests': 'Muitas tentativas. Espere um pouco e tente de novo.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
  'auth/email-already-in-use': 'Já existe um usuário com este e-mail.',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'permission-denied': 'Você não tem permissão para fazer isso.',
  'unavailable': 'Sem conexão com o servidor. Tente de novo.'
};
export const msgErro = e => ERROS[e?.code] || ERROS[String(e?.code || '').replace('firestore/', '')] || e?.message || 'Algo deu errado.';
