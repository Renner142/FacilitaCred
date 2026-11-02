import { esc, slug } from '../util.js';
import { PERMS } from '../config.js';
import { dlg, abrirModal, fecharModal, ligarForm, toast } from '../modal.js';
import {
  db, auth2, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, createUserWithEmailAndPassword, signOut
} from '../firebase.js';
import { S, acoes, mudancas, views, can, ehAdmin, nomePapel, log, msgErro } from '../state.js';

const papeisDisponiveis = () => [...(ehAdmin() ? [['admin', 'Administrador']] : []), ...Object.entries(S.papeis).map(([id, p]) => [id, p.nome])];

views.usuarios = function renderUsuarios() {
  if (!can('usuarios.gerenciar')) return '<p class="vazio">Você não tem acesso a esta tela.</p>';
  const linhas = [...S.usuarios].sort((a, b) => (a.nome || '').localeCompare(b.nome || '')).map(u => {
    const eu = u.id === S.user.uid;
    const protegido = eu || (u.papel === 'admin' && !ehAdmin());
    return `<tr>
      <td>${esc(u.nome)}${eu ? ' (você)' : ''}<br><small>${esc(u.email)}</small></td>
      <td><select data-mudar="papel" data-id="${esc(u.id)}" ${protegido ? 'disabled' : ''} aria-label="Permissão de ${esc(u.nome)}" style="margin:0">
        ${papeisDisponiveis().map(([k, t]) => `<option value="${esc(k)}" ${u.papel === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        ${papeisDisponiveis().some(([k]) => k === u.papel) ? '' : `<option selected>${esc(nomePapel(u.papel))}</option>`}</select></td>
      <td><label class="check" style="margin:0"><input type="checkbox" data-mudar="ativo" data-id="${esc(u.id)}" ${u.ativo ? 'checked' : ''} ${protegido ? 'disabled' : ''}> Acesso liberado</label></td></tr>`;
  }).join('');

  const papeis = Object.entries(S.papeis).map(([id, p]) => {
    const n = S.usuarios.filter(u => u.papel === id).length;
    const qtd = Object.values(p.perm || {}).filter(Boolean).length;
    return `<li><div class="txt"><b>${esc(p.nome)}</b><br><small>${qtd} ${qtd === 1 ? 'permissão' : 'permissões'}, ${n} ${n === 1 ? 'usuário' : 'usuários'}</small></div>
      <div class="bt"><button class="peq" data-acao="papel-editar" data-id="${esc(id)}">Editar</button>
      <button class="peq perigo" data-acao="papel-remover" data-id="${esc(id)}">Remover</button></div></li>`;
  }).join('');

  return `<h1>Usuários</h1>
  <div class="barra"><span class="espaco"></span><button class="primario" data-acao="novo-usuario">Novo usuário</button></div>
  <div class="rolagem"><table><thead><tr><th>Usuário</th><th>Papel</th><th>Acesso</th></tr></thead><tbody>${linhas}</tbody></table></div>
  <h2>Papéis e permissões</h2>
  <p class="ajuda">O Administrador sempre pode tudo. Crie quantos papéis quiser e escolha, um a um, o que cada papel pode fazer.${ehAdmin() ? '' : ' Só o administrador altera os papéis.'}</p>
  <ul class="lista-edit">${papeis}</ul>
  ${ehAdmin() ? '<p><button class="primario" data-acao="papel-novo">Novo papel</button></p>' : ''}`;
};

mudancas.papel = async el => {
  try { await updateDoc(doc(db, 'usuarios', el.dataset.id), { papel: el.value }); log('usuario.papel', `${el.dataset.id} → ${el.value}`); toast('Papel atualizado.'); }
  catch (e) { toast(msgErro(e)); }
};
mudancas.ativo = async el => {
  try { await updateDoc(doc(db, 'usuarios', el.dataset.id), { ativo: el.checked }); log('usuario.acesso', `${el.dataset.id} ${el.checked ? 'liberado' : 'bloqueado'}`); toast(el.checked ? 'Acesso liberado.' : 'Acesso bloqueado.'); }
  catch (e) { toast(msgErro(e)); }
};

acoes['novo-usuario'] = () => {
  abrirModal('Novo usuário', `
    <form id="f" autocomplete="off">
      <label>Nome<input name="nome" required></label>
      <label>E-mail<input name="email" type="email" required></label>
      <label>Senha provisória (mínimo 6 caracteres)<input name="senha" type="text" minlength="6" required></label>
      <label>Papel<select name="papel">${papeisDisponiveis().map(([k, t]) => `<option value="${esc(k)}">${esc(t)}</option>`).join('')}</select></label>
      <p class="erro" role="alert"></p>
      <div class="acoes"><span class="espaco"></span><button type="button" data-fechar>Cancelar</button><button class="primario" type="submit">Criar usuário</button></div>
    </form>`);
  ligarForm('#f', async fd => {
    const nome = fd.get('nome').trim(), email = fd.get('email').trim();
    const cred = await createUserWithEmailAndPassword(auth2, email, fd.get('senha'));
    await signOut(auth2);
    await setDoc(doc(db, 'usuarios', cred.user.uid), { nome, email, papel: fd.get('papel'), ativo: true, criadoEm: serverTimestamp() });
    log('usuario.criar', `${nome} (${fd.get('papel')})`);
    fecharModal();
    toast('Usuário criado. Passe o e-mail e a senha provisória para ele.');
  });
};

/* ---------- papéis ---------- */
const salvarPapeis = async obj => { await setDoc(doc(db, 'config', 'papeis'), obj); };

function formPapel(id) {
  if (!ehAdmin()) return;
  const p = id ? S.papeis[id] : { nome: '', perm: {} };
  const grupos = [...new Set(PERMS.map(x => x.grupo))];
  abrirModal(id ? 'Editar papel' : 'Novo papel', `
    <form id="f">
      <label>Nome do papel<input name="nome" required value="${esc(p.nome)}" placeholder="Ex.: Cobrador, Caixa, Sócio"></label>
      ${grupos.map(g => `<fieldset class="perm"><legend>${esc(g)}</legend>
        ${PERMS.filter(x => x.grupo === g).map(x => `<label class="check"><input type="checkbox" name="p_${esc(x.id)}" ${p.perm?.[x.id] ? 'checked' : ''}> ${esc(x.rotulo)}</label>`).join('')}</fieldset>`).join('')}
      <p class="ajuda">Quem tem "Criar e bloquear usuários" pode dar a outros qualquer papel, menos Administrador.</p>
      <p class="erro" role="alert"></p>
      <div class="acoes"><span class="espaco"></span><button type="button" data-fechar>Cancelar</button><button class="primario" type="submit">Salvar papel</button></div>
    </form>`, true);
  ligarForm('#f', async fd => {
    const nome = fd.get('nome').trim();
    if (!nome) throw new Error('Informe o nome do papel.');
    const perm = {};
    PERMS.forEach(x => { if (fd.has('p_' + x.id)) perm[x.id] = true; });
    let chave = id;
    if (!chave) { chave = slug(nome); if (chave === 'admin' || S.papeis[chave]) chave += '-' + Math.random().toString(36).slice(2, 5); }
    await salvarPapeis({ ...S.papeis, [chave]: { nome, perm } });
    log('papel.salvar', nome);
    fecharModal();
    toast('Papel salvo.');
  });
}

acoes['papel-novo'] = () => formPapel();
acoes['papel-editar'] = ds => formPapel(ds.id);
acoes['papel-remover'] = async ds => {
  if (!ehAdmin()) return;
  if (S.usuarios.some(u => u.papel === ds.id)) { toast('Há usuários com este papel. Troque o papel deles antes de remover.'); return; }
  if (!confirm(`Remover o papel "${nomePapel(ds.id)}"?`)) return;
  const novo = { ...S.papeis }; delete novo[ds.id];
  try { await salvarPapeis(novo); log('papel.remover', ds.id); toast('Papel removido.'); } catch (e) { toast(msgErro(e)); }
};
