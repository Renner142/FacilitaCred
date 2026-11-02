// Listas de clientes e de empréstimos com código, colunas escolhidas por você, filtro por cliente e ordenação.
// Este arquivo é carregado depois de clientes.js e emprestimos.js e substitui as listas antigas deles.
import { esc, money, nf, fmtData } from '../util.js';
import { calc, descEmp, tipoLabel } from '../calc.js';
import { fecharModal } from '../modal.js';
import { S, ui, views, acoes, mudancas, can, nomeCliente } from '../state.js';
import { codCliente, codEmprestimo, badge } from '../codigos.js';
import { colunasVisiveis, abrirColunas } from '../aparencia.js';

const vazio = v => (v === undefined || v === null || v === '') ? '—' : esc(v);
const pill = s => ({
  atrasado: '<span class="pill atrasado">Atrasado</span>',
  em_dia: '<span class="pill ok">Em dia</span>',
  quitado: '<span class="pill quitado">Quitado</span>'
})[s] || '';
const atrasoTxt = v => v > 0 ? `<span class="txt-atraso">${money(v)}</span>` : '—';

/* ---------- definição das colunas (para criar outra, basta acrescentar um item) ---------- */
const colsCli = () => [
  { id: 'cod', rotulo: 'Cód.', cel: c => badge(codCliente(c)) || '—' },
  { id: 'nome', rotulo: 'Nome', fixo: true, cel: c => `<button class="link" data-acao="editar-cliente" data-id="${esc(c.id)}">${esc(c.nome)}</button>` },
  { id: 'telefone', rotulo: 'Telefone', cel: c => vazio(c.telefone) },
  { id: 'documento', rotulo: 'Documento', padrao: false, cel: c => vazio(c.documento) },
  { id: 'endereco', rotulo: 'Endereço', padrao: false, cel: c => vazio(c.endereco) },
  { id: 'ativos', rotulo: 'Empréstimos ativos', n: true, cel: (c, x) => x.ls.length },
  { id: 'aberto', rotulo: 'Principal em aberto', n: true, cel: (c, x) => money(x.aberto) },
  { id: 'atraso', rotulo: 'Em atraso', n: true, cel: (c, x) => atrasoTxt(x.atraso) },
  ...S.cfg.camposCliente.map(d => ({ id: 'x_' + d.id, rotulo: d.rotulo, padrao: false, cel: c => vazio(c.extras?.[d.id]) }))
];

const colsEmp = () => [
  { id: 'cod', rotulo: 'Cód.', cel: l => badge(codEmprestimo(l)) || '—' },
  { id: 'cliente', rotulo: 'Cliente', fixo: true, cel: l => `<button class="link" data-acao="abrir-emp" data-id="${esc(l.id)}">${esc(nomeCliente(l))}</button>` },
  { id: 'modalidade', rotulo: 'Modalidade', cel: l => `${esc(tipoLabel(l))}<br><small>${esc(descEmp(l))}</small>` },
  { id: 'data', rotulo: 'Data', cel: l => fmtData(l.dataInicio) },
  { id: 'emprestado', rotulo: 'Emprestado', n: true, cel: l => money(l.valor) },
  { id: 'taxa', rotulo: 'Taxa', n: true, padrao: false, cel: l => `${nf(l.taxa)}%` },
  { id: 'aberto', rotulo: 'Principal em aberto', n: true, cel: (l, c) => money(c.principal) },
  { id: 'proximo', rotulo: 'Próximo vencimento', cel: (l, c) => c.proxVenc ? `${fmtData(c.proxVenc)}<br><small>${money(c.proxValor)}</small>` : '—' },
  { id: 'atraso', rotulo: 'Em atraso', n: true, padrao: false, cel: (l, c) => atrasoTxt(c.atraso) },
  { id: 'dias', rotulo: 'Dias de atraso', n: true, padrao: false, cel: (l, c) => c.diasAtraso || '—' },
  { id: 'situacao', rotulo: 'Situação', cel: (l, c) => pill(c.situacao) },
  ...S.cfg.camposEmprestimo.map(d => ({ id: 'x_' + d.id, rotulo: d.rotulo, padrao: false, cel: l => vazio(l.extras?.[d.id]) }))
];

function tabela(id, nome, defs, linhas) {
  const cols = colunasVisiveis(nome, defs);
  return `<div class="rolagem"><table id="${id}"><thead><tr>${cols.map(d => `<th class="${d.n ? 'n' : ''}">${esc(d.rotulo)}</th>`).join('')}</tr></thead><tbody>
    ${linhas.map(({ obj, x, acao, q }) => `<tr class="clicavel" data-acao="${acao}" data-id="${esc(obj.id)}" data-q="${esc(q)}">${cols.map(d => `<td class="${d.n ? 'n' : ''}">${d.cel(obj, x)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>`;
}

/* ---------- clientes ---------- */
views.clientes = function renderClientes() {
  const linhas = S.clientes.map(c => {
    const ls = S.emprestimos.filter(l => l.clienteId === c.id && l.status !== 'quitado');
    let aberto = 0, atraso = 0;
    ls.forEach(l => { const k = calc(l); aberto += k.principal; atraso += k.atraso; });
    return { obj: c, x: { ls, aberto, atraso }, acao: 'editar-cliente', q: `${codCliente(c)} ${c.nome} ${c.telefone || ''} ${c.documento || ''}` };
  });
  return `<h1>Clientes</h1>
  <div class="barra">
    <input type="search" placeholder="Buscar por código, nome, telefone ou documento" data-busca="tab-clientes" aria-label="Buscar cliente">
    <span class="espaco"></span>
    <button data-acao="colunas-cli">Colunas</button>
    ${can('clientes.criar') ? '<button class="primario" data-acao="novo-cliente">Novo cliente</button>' : ''}
  </div>
  ${linhas.length ? tabela('tab-clientes', 'clientes', colsCli(), linhas)
    : '<p class="vazio">Nenhum cliente cadastrado. Cadastre o primeiro para começar a registrar empréstimos.</p>'}`;
};

/* ---------- empréstimos ---------- */
const ORDENS = { recentes: 'Mais recentes', codigo: 'Código', vencimento: 'Vencimento mais próximo', atraso: 'Maior atraso', valor: 'Maior valor' };
const COMPARAR = {
  recentes: (a, b) => (b.l.dataInicio || '').localeCompare(a.l.dataInicio || '') || (b.l.codigo || 0) - (a.l.codigo || 0),
  codigo: (a, b) => (a.l.codigo || 0) - (b.l.codigo || 0),
  vencimento: (a, b) => (a.c.proxVenc || '9999').localeCompare(b.c.proxVenc || '9999'),
  atraso: (a, b) => (b.c.atraso + b.c.enc) - (a.c.atraso + a.c.enc),
  valor: (a, b) => b.l.valor - a.l.valor
};

views.emprestimos = function renderEmprestimos() {
  const f = S.filtroEmp, cli = S.filtroClienteEmp || '', ordem = COMPARAR[S.ordemEmp] ? S.ordemEmp : 'recentes';
  const itens = S.emprestimos.map(l => ({ l, c: calc(l) }))
    .filter(({ l, c }) => (!cli || l.clienteId === cli) && (f === 'todos' ? true : f === 'quitados' ? l.status === 'quitado'
      : f === 'atrasados' ? (l.status !== 'quitado' && c.situacao === 'atrasado') : l.status !== 'quitado'))
    .sort(COMPARAR[ordem]);
  const linhas = itens.map(({ l, c }) => ({ obj: l, x: c, acao: 'abrir-emp', q: `${codEmprestimo(l)} ${nomeCliente(l)} ${l.modalidade || ''}` }));
  const op = (v, t, atual) => `<option value="${esc(v)}" ${atual === v ? 'selected' : ''}>${esc(t)}</option>`;
  return `<h1>Empréstimos</h1>
  <div class="barra">
    <select data-mudar="filtro-emp" aria-label="Situação">${op('ativos', 'Ativos', f)}${op('atrasados', 'Atrasados', f)}${op('quitados', 'Quitados', f)}${op('todos', 'Todos', f)}</select>
    <select data-mudar="filtro-cli-emp" aria-label="Cliente">${op('', 'Todos os clientes', cli)}${S.clientes.map(c => op(c.id, `${codCliente(c) ? codCliente(c) + ' – ' : ''}${c.nome}`, cli)).join('')}</select>
    <select data-mudar="ordem-emp" aria-label="Ordenar por">${Object.entries(ORDENS).map(([k, t]) => op(k, 'Ordem: ' + t, ordem)).join('')}</select>
    <input type="search" placeholder="Buscar por código, cliente ou modalidade" data-busca="tab-emp" aria-label="Buscar empréstimo">
    <span class="espaco"></span>
    <button data-acao="colunas-emp">Colunas</button>
    ${can('emprestimos.criar') ? '<button class="primario" data-acao="novo-emp">Novo empréstimo</button>' : ''}
  </div>
  ${linhas.length ? tabela('tab-emp', 'emprestimos', colsEmp(), linhas) : '<p class="vazio">Nenhum empréstimo nesta lista.</p>'}`;
};

mudancas['filtro-cli-emp'] = el => { S.filtroClienteEmp = el.value; ui.render(true); };
mudancas['ordem-emp'] = el => { S.ordemEmp = el.value; ui.render(true); };
acoes['colunas-cli'] = () => abrirColunas('clientes', colsCli(), 'Clientes');
acoes['colunas-emp'] = () => abrirColunas('emprestimos', colsEmp(), 'Empréstimos');
acoes['ver-emp-cliente'] = ds => { S.filtroClienteEmp = ds.id; S.filtroEmp = 'todos'; fecharModal(); ui.navegar('emprestimos'); };
