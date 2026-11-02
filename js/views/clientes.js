import { esc, money, fmtData } from '../util.js';
import { calc, descEmp } from '../calc.js';
import { camposHTML, lerCampos, camposResumo } from '../campos.js';
import { abrirModal, fecharModal, ligarForm, toast } from '../modal.js';
import { db, collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from '../firebase.js';
import { S, acoes, views, can, log, msgErro } from '../state.js';
import { criarComCodigo, codCliente, codEmprestimo, badge } from '../codigos.js';

views.clientes = function renderClientes() {
  const linhas = S.clientes.map(c => {
    const ls = S.emprestimos.filter(l => l.clienteId === c.id && l.status !== 'quitado');
    let aberto = 0, atraso = 0;
    ls.forEach(l => { const k = calc(l); aberto += k.principal; atraso += k.atraso; });
    return `<tr class="clicavel" data-acao="editar-cliente" data-id="${esc(c.id)}">
      <td><button class="link" data-acao="editar-cliente" data-id="${esc(c.id)}">${esc(c.nome)}</button></td>
      <td>${esc(c.telefone) || '—'}</td>
      <td class="n">${ls.length}</td>
      <td class="n">${money(aberto)}</td>
      <td class="n ${atraso > 0 ? 'txt-atraso' : ''}">${atraso > 0 ? money(atraso) : '—'}</td></tr>`;
  }).join('');
  return `<h1>Clientes</h1>
  <div class="barra">
    <input type="search" placeholder="Buscar por nome, telefone ou documento" data-busca="tab-clientes" aria-label="Buscar cliente">
    <span class="espaco"></span>
    ${can('clientes.criar') ? '<button class="primario" data-acao="novo-cliente">Novo cliente</button>' : ''}
  </div>
  ${S.clientes.length ? `<div class="rolagem"><table id="tab-clientes"><thead><tr><th>Nome</th><th>Telefone</th><th class="n">Empréstimos ativos</th><th class="n">Principal em aberto</th><th class="n">Em atraso</th></tr></thead><tbody>${linhas}</tbody></table></div>`
    : '<p class="vazio">Nenhum cliente cadastrado. Cadastre o primeiro para começar a registrar empréstimos.</p>'}`;
};

export function formCliente(id) {
  const c = id ? S.clientes.find(x => x.id === id) : {};
  if (!c) return;
  const ro = id ? !can('clientes.editar') : !can('clientes.criar');
  const d = ro ? 'disabled' : '';
  const defs = S.cfg.camposCliente;
  const dig = (c.telefone || '').replace(/\D/g, '');
  const ddi = String(S.cfg.regional.ddi || '').replace(/\D/g, '');
  const loans = id ? S.emprestimos.filter(l => l.clienteId === id) : [];

  abrirModal(id ? ('Cliente ' + codCliente(c)).trim() : 'Novo cliente', `
    <form id="f">
      <label>Nome<input name="nome" required value="${esc(c.nome)}" ${d}></label>
      <label>Telefone com DDD (usado no WhatsApp)<input name="telefone" inputmode="tel" value="${esc(c.telefone)}" ${d}></label>
      <label>CPF ou outro documento<input name="documento" value="${esc(c.documento)}" ${d}></label>
      <label>Endereço<input name="endereco" value="${esc(c.endereco)}" ${d}></label>
      ${camposHTML(defs, c.extras, ro)}
      <label>Observações<textarea name="obs" rows="3" ${d}>${esc(c.obs)}</textarea></label>
      ${dig.length >= 8 ? `<p><a class="botao peq" href="tel:+${dig.length <= 11 ? ddi + dig : dig}">Ligar</a>
        <a class="botao peq" href="https://wa.me/${dig.length <= 11 ? ddi + dig : dig}" target="_blank" rel="noopener">WhatsApp</a></p>` : ''}
      ${loans.length ? `<h3>Empréstimos deste cliente <button type="button" class="link" data-acao="ver-emp-cliente" data-id="${esc(id)}">ver na lista</button></h3><div class="rolagem"><table><tbody>
        ${loans.map(l => { const k = calc(l); return `<tr class="clicavel" data-acao="abrir-emp" data-id="${esc(l.id)}">
          <td>${badge(codEmprestimo(l))}</td><td>${esc(descEmp(l))}<br><small>${fmtData(l.dataInicio)}</small></td><td class="n">${money(k.principal)}</td>
          <td>${k.situacao === 'atrasado' ? '<span class="pill atrasado">Atrasado</span>' : k.situacao === 'quitado' ? '<span class="pill quitado">Quitado</span>' : '<span class="pill ok">Em dia</span>'}</td></tr>`; }).join('')}
        </tbody></table></div>` : ''}
      <p class="erro" role="alert"></p>
      <div class="acoes">
        ${id && can('clientes.excluir') ? '<button type="button" class="perigo" id="del">Excluir cliente</button>' : ''}
        <span class="espaco"></span>
        <button type="button" data-fechar>${ro ? 'Fechar' : 'Cancelar'}</button>
        ${ro ? '' : '<button class="primario" type="submit">Salvar cliente</button>'}
      </div>
    </form>`);

  ligarForm('#f', async (fd, f) => {
    const dados = {
      nome: fd.get('nome').trim(), telefone: fd.get('telefone').trim(), documento: fd.get('documento').trim(),
      endereco: fd.get('endereco').trim(), obs: fd.get('obs').trim(), extras: lerCampos(defs, f)
    };
    if (!dados.nome) throw new Error('Informe o nome do cliente.');
    if (id) await updateDoc(doc(db, 'clientes', id), dados);
    else await criarComCodigo('clientes', 'cliente', { ...dados, criadoEm: serverTimestamp(), criadoPor: S.user.uid });
    log(id ? 'cliente.editar' : 'cliente.criar', dados.nome);
    fecharModal();
    toast('Cliente salvo.');
  });

  document.querySelector('#dlg #del')?.addEventListener('click', async () => {
    if (S.emprestimos.some(l => l.clienteId === id)) { toast('Este cliente tem empréstimos. Exclua os empréstimos primeiro.'); return; }
    if (!confirm('Excluir este cliente?')) return;
    try { await deleteDoc(doc(db, 'clientes', id)); log('cliente.excluir', c.nome); fecharModal(); toast('Cliente excluído.'); }
    catch (e) { toast(msgErro(e)); }
  });
}

acoes['novo-cliente'] = () => formCliente();
acoes['editar-cliente'] = ds => formCliente(ds.id);
export { camposResumo };
