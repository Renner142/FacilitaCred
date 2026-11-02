import { $, esc, money, r2, hoje, addDays, fmtData, parseISO } from '../util.js';
import { ENC_PADRAO } from '../config.js';
import {
  UNIDADES, periodoDe, taxaRotulo, somaPeriodos, gerarCronograma, calc, descEmp, descEncargos, encCfg, tipoLabel,
  simularEncargos, replay, camposEstado
} from '../calc.js';
import { camposHTML, lerCampos, camposResumo, blocoEncargos, lerEncargos } from '../campos.js';
import { dlg, abrirModal, fecharModal, ligarForm, toast, imprimir } from '../modal.js';
import {
  db, collection, doc, getDocs, addDoc, updateDoc, query, where, writeBatch, serverTimestamp
} from '../firebase.js';
import { S, ui, acoes, mudancas, views, can, clienteDe, nomeCliente, log, msgErro } from '../state.js';
import { criarComCodigo, codCliente, codEmprestimo, badge } from '../codigos.js';

const pill = s => ({
  atrasado: '<span class="pill atrasado">Atrasado</span>',
  em_dia: '<span class="pill ok">Em dia</span>',
  quitado: '<span class="pill quitado">Quitado</span>'
})[s] || '';
const NOMES_EV = { parcela: 'Parcela', juros: 'Juros', amortizacao: 'Amortização', prorrogacao: 'Prorrogação' };

/* =========================================================
   Lista
   ========================================================= */
views.emprestimos = function renderEmprestimos() {
  const f = S.filtroEmp;
  const ls = [...S.emprestimos]
    .sort((a, b) => (b.dataInicio || '').localeCompare(a.dataInicio || ''))
    .filter(l => f === 'todos' ? true : f === 'quitados' ? l.status === 'quitado'
      : f === 'atrasados' ? (l.status !== 'quitado' && calc(l).situacao === 'atrasado') : l.status !== 'quitado');
  const linhas = ls.map(l => {
    const c = calc(l);
    return `<tr class="clicavel" data-acao="abrir-emp" data-id="${esc(l.id)}">
      <td><button class="link" data-acao="abrir-emp" data-id="${esc(l.id)}">${esc(nomeCliente(l))}</button></td>
      <td>${esc(tipoLabel(l))}<br><small>${esc(descEmp(l))}</small></td>
      <td class="n">${money(l.valor)}</td>
      <td class="n">${money(c.principal)}</td>
      <td>${c.proxVenc ? `${fmtData(c.proxVenc)}<br><small>${money(c.proxValor)}</small>` : '—'}</td>
      <td>${pill(c.situacao)}</td></tr>`;
  }).join('');
  const opt = (v, t) => `<option value="${v}" ${f === v ? 'selected' : ''}>${t}</option>`;
  return `<h1>Empréstimos</h1>
  <div class="barra">
    <select data-mudar="filtro-emp" aria-label="Filtrar empréstimos">${opt('ativos', 'Ativos')}${opt('atrasados', 'Atrasados')}${opt('quitados', 'Quitados')}${opt('todos', 'Todos')}</select>
    <input type="search" placeholder="Buscar por cliente ou modalidade" data-busca="tab-emp" aria-label="Buscar empréstimo">
    <span class="espaco"></span>
    ${can('emprestimos.criar') ? '<button class="primario" data-acao="novo-emp">Novo empréstimo</button>' : ''}
  </div>
  ${ls.length ? `<div class="rolagem"><table id="tab-emp"><thead><tr><th>Cliente</th><th>Modalidade</th><th class="n">Emprestado</th><th class="n">Principal em aberto</th><th>Próximo vencimento</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table></div>`
    : '<p class="vazio">Nenhum empréstimo nesta lista.</p>'}`;
};
mudancas['filtro-emp'] = el => { S.filtroEmp = el.value; ui.render(true); };

/* =========================================================
   Novo empréstimo
   ========================================================= */
function lerEmp(f) {
  const g = n => f.elements[n]?.value;
  return {
    clienteId: g('clienteId'), modeloId: g('modalidade'), tipo: g('tipo'),
    valor: parseFloat(g('valor')), taxa: parseFloat(g('taxa')),
    periodo: { unidade: g('unidade'), passo: Math.max(1, parseInt(g('passo'), 10) || 1) },
    inicio: g('dataInicio'), primeiroVenc: g('primeiroVenc'),
    n: parseInt(g('parcelas'), 10), calculo: g('calculo'), parcelaManual: parseFloat(g('parcelaManual')) || 0,
    tarifaPct: Math.max(0, parseFloat(g('tarifaPct')) || 0), tarifaFixa: Math.max(0, parseFloat(g('tarifaFixa')) || 0),
    obs: (g('obs') || '').trim()
  };
}

function formEmprestimo() {
  if (!S.clientes.length) {
    abrirModal('Novo empréstimo', `<p>Cadastre um cliente antes de registrar um empréstimo.</p>
      <div class="acoes"><span class="espaco"></span><button type="button" data-fechar>Fechar</button><button class="primario" data-acao="novo-cliente">Cadastrar cliente</button></div>`);
    return;
  }
  const mods = S.cfg.modalidades || [];
  const h = hoje();
  const defs = S.cfg.camposEmprestimo;
  abrirModal('Novo empréstimo', `
    <form id="f">
      <label>Cliente<select name="clienteId" required>${S.clientes.map(c => `<option value="${esc(c.id)}">${esc(codCliente(c) ? codCliente(c) + ' – ' : '')}${esc(c.nome)}</option>`).join('')}</select></label>
      <label>Modelo (preenche os campos abaixo, você pode ajustar tudo)
        <select name="modalidade"><option value="">Personalizado</option>${mods.map(m => `<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join('')}</select>
      </label>
      <div class="dupla">
        <label>Tipo
          <select name="tipo">
            <option value="parcelado">Parcelado (parcelas definidas)</option>
            <option value="juros">Juros periódicos (principal pago quando puder)</option>
          </select></label>
        <label>Valor emprestado<input name="valor" type="number" step="0.01" min="0.01" inputmode="decimal" required></label>
      </div>
      <div class="trio">
        <label>Taxa de juros (%)<input name="taxa" type="number" step="0.01" min="0" inputmode="decimal" required></label>
        <label>Cobrada<select name="unidade">${Object.entries(UNIDADES).map(([k, u]) => `<option value="${k}">${u.taxa}</option>`).join('')}</select></label>
        <label>A cada (períodos)<input name="passo" type="number" min="1" step="1" value="1"></label>
      </div>
      <div class="dupla">
        <label>Data do empréstimo<input name="dataInicio" type="date" value="${h}" required></label>
        <label>Primeiro vencimento<input name="primeiroVenc" type="date" value="${somaPeriodos(h, 1, { unidade: 'mes', passo: 1 })}" required></label>
      </div>
      <div id="blocoParc">
        <div class="trio">
          <label>Número de parcelas<input name="parcelas" type="number" min="1" max="360" step="1" value="10"></label>
          <label>Cálculo
            <select name="calculo">
              <option value="simples">Juros simples</option>
              <option value="price">Tabela Price</option>
              <option value="sac">SAC (parcela decrescente)</option>
            </select></label>
          <label>Parcela fixa (opcional)<input name="parcelaManual" type="number" step="0.01" min="0" inputmode="decimal"></label>
        </div>
      </div>
      <div class="dupla">
        <label>Tarifa de abertura (%)<input name="tarifaPct" type="number" step="0.01" min="0" inputmode="decimal" value="0"></label>
        <label>Tarifa fixa<input name="tarifaFixa" type="number" step="0.01" min="0" inputmode="decimal" value="0"></label>
      </div>
      ${blocoEncargos({ ...ENC_PADRAO, ...(S.cfg.encargos || {}) })}
      ${camposHTML(defs, {})}
      <div class="previa" id="previa" aria-live="polite"></div>
      <label>Observações<textarea name="obs" rows="2"></textarea></label>
      <p class="erro" role="alert"></p>
      <div class="acoes">
        <span class="espaco"></span>
        <button type="button" data-fechar>Cancelar</button>
        <button class="primario" type="submit">Registrar empréstimo</button>
      </div>
    </form>`, true);

  const f = $('#f', dlg);
  const set = (n, v) => { if (f.elements[n]) f.elements[n].value = v ?? ''; };

  const atualizar = () => {
    const v = lerEmp(f);
    $('#blocoParc', dlg).hidden = v.tipo !== 'parcelado';
    const el = $('#previa', dlg);
    if (!(v.valor > 0)) { el.textContent = 'Preencha o valor para ver o resumo.'; return; }
    const tarifa = r2(v.valor * v.tarifaPct / 100 + v.tarifaFixa);
    const extra = tarifa > 0 ? ` Tarifa de abertura: ${money(tarifa)}.` : '';
    if (v.tipo === 'parcelado') {
      if (!(v.n > 0) || !v.primeiroVenc) { el.textContent = 'Informe o número de parcelas.'; return; }
      const cr = gerarCronograma(v);
      const tot = r2(cr.reduce((a, p) => a + p.valor, 0));
      el.textContent = `${descEmp({ tipo: 'parcelado', cronograma: cr, periodo: v.periodo, calculo: v.calculo })}. Total a receber: ${money(tot)} (juros de ${money(tot - v.valor)}).${extra}`;
    } else {
      el.textContent = `O cliente paga ${money(r2(v.valor * (v.taxa || 0) / 100))} de juros ${taxaRotulo(v.periodo)}, sobre ${money(v.valor)}.${extra}`;
    }
  };
  const primeiroVenc = () => {
    const v = lerEmp(f);
    if (v.inicio) set('primeiroVenc', somaPeriodos(v.inicio, 1, periodoDe({ periodo: v.periodo })));
  };
  const aplicarModelo = () => {
    const m = mods.find(x => x.id === f.elements.modalidade.value);
    if (!m) return;
    set('tipo', m.base);
    if (m.taxa != null) set('taxa', m.taxa);
    if (m.parcelas) set('parcelas', m.parcelas);
    set('unidade', m.periodo?.unidade || 'mes'); set('passo', m.periodo?.passo || 1);
    set('calculo', m.calculo || 'simples');
    set('tarifaPct', m.tarifaPct || 0); set('tarifaFixa', m.tarifaFixa || 0);
    const enc = { ...ENC_PADRAO, ...(S.cfg.encargos || {}), ...(m.encargos || {}) };
    Object.keys(ENC_PADRAO).forEach(k => set(k, enc[k]));
    primeiroVenc(); atualizar();
  };
  f.addEventListener('input', atualizar);
  f.elements.tipo.addEventListener('change', atualizar);
  f.elements.modalidade.addEventListener('change', aplicarModelo);
  ['dataInicio', 'unidade', 'passo'].forEach(n => f.elements[n].addEventListener('change', () => { primeiroVenc(); atualizar(); }));
  atualizar();

  ligarForm('#f', async () => {
    const v = lerEmp(f);
    if (!v.clienteId) throw new Error('Escolha o cliente.');
    if (!(v.valor > 0)) throw new Error('Informe o valor emprestado.');
    if (!(v.taxa >= 0)) throw new Error('Informe a taxa de juros (pode ser 0).');
    if (!v.inicio || !v.primeiroVenc) throw new Error('Informe as datas.');
    if (v.primeiroVenc < v.inicio) throw new Error('O primeiro vencimento não pode ser antes da data do empréstimo.');
    const m = mods.find(x => x.id === v.modeloId);
    const base = {
      clienteId: v.clienteId, clienteNome: clienteDe(v.clienteId)?.nome || '', tipo: v.tipo, valor: r2(v.valor), taxa: v.taxa,
      periodo: v.periodo, modalidade: m?.nome || '', modalidadeId: m?.id || '',
      dataInicio: v.inicio, primeiroVenc: v.primeiroVenc, status: 'ativo', descontoTotal: 0, obs: v.obs,
      extras: lerCampos(defs, f), encargos: lerEncargos(f),
      tarifaPct: v.tarifaPct, tarifaFixa: v.tarifaFixa, tarifa: r2(v.valor * v.tarifaPct / 100 + v.tarifaFixa),
      criadoEm: serverTimestamp(), criadoPor: S.user.uid, ts: Date.now()
    };
    if (v.tipo === 'parcelado') {
      if (!Number.isInteger(v.n) || v.n < 1 || v.n > 360) throw new Error('O número de parcelas deve ficar entre 1 e 360.');
      const cr = gerarCronograma(v);
      base.calculo = v.calculo;
      base.cronograma = cr;
      base.cronogramaOrig = cr.map(p => ({ n: p.n, venc: p.venc, valor: p.valor }));
    } else {
      base.principalAberto = r2(v.valor);
      base.proximoVenc = v.primeiroVenc;
      base.diaVenc = parseISO(v.primeiroVenc).getDate();
      base.jurosParcial = 0;
      base.encPago = 0;
    }
    await criarComCodigo('emprestimos', 'emprestimo', base);
    log('emprestimo.criar', `${base.clienteNome} ${money(base.valor)}`);
    fecharModal();
    toast('Empréstimo registrado.');
  });
}

/* =========================================================
   Eventos: registrar, estornar, excluir
   ========================================================= */
async function buscarEventos(id) {
  const s = await getDocs(query(collection(db, 'pagamentos'), where('emprestimoId', '==', id)));
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function registrarEvento(id, ev) {
  const l = S.emprestimos.find(x => x.id === id);
  if (!l) throw new Error('Empréstimo não encontrado.');
  const evs = await buscarEventos(id);
  const novo = {
    ...ev, emprestimoId: id, clienteId: l.clienteId, clienteNome: nomeCliente(l),
    criadoPor: S.user.uid, criadoEm: serverTimestamp(), ts: Date.now()
  };
  const estado = replay(l, [...evs, novo]); // valida e calcula o novo estado
  const b = writeBatch(db);
  b.set(doc(collection(db, 'pagamentos')), novo);
  b.update(doc(db, 'emprestimos', id), camposEstado(estado));
  await b.commit();
  log(`pagamento.${ev.tipo}`, `${nomeCliente(l)} ${money((ev.valor || 0) + (ev.encargos || 0))}`);
}

async function estornar(id, evId) {
  const l = S.emprestimos.find(x => x.id === id);
  const ev = S.eventosDet[evId];
  if (!l || !ev) return;
  const rotulo = ev.tipo === 'prorrogacao' ? 'esta prorrogação' : `este pagamento de ${money((ev.valor || 0) + (ev.encargos || 0))}`;
  if (!confirm(`Estornar ${rotulo}? O empréstimo volta ao estado anterior.`)) return;
  try {
    const evs = (await buscarEventos(id)).filter(e => e.id !== evId);
    const estado = replay(l, evs);
    const b = writeBatch(db);
    b.delete(doc(db, 'pagamentos', evId));
    b.update(doc(db, 'emprestimos', id), camposEstado(estado));
    await b.commit();
    log('pagamento.estornar', `${nomeCliente(l)} ${money((ev.valor || 0) + (ev.encargos || 0))}`);
    toast('Estornado.');
  } catch (e) { toast(msgErro(e)); }
}

async function excluirEmprestimo(id) {
  const l = S.emprestimos.find(x => x.id === id);
  if (!confirm('Excluir este empréstimo e todo o histórico de pagamentos dele? Não dá para desfazer.')) return;
  try {
    const evs = await buscarEventos(id);
    const b = writeBatch(db);
    evs.forEach(e => b.delete(doc(db, 'pagamentos', e.id)));
    b.delete(doc(db, 'emprestimos', id));
    await b.commit();
    log('emprestimo.excluir', l ? `${nomeCliente(l)} ${money(l.valor)}` : id);
    fecharModal();
    toast('Empréstimo excluído.');
  } catch (e) { toast(msgErro(e)); }
}

/* =========================================================
   Detalhe
   ========================================================= */
function tabelaParcelas(l, comAcao) {
  const h = hoje();
  return `<h3>Parcelas</h3><div class="rolagem"><table><thead><tr><th>Nº</th><th>Vencimento</th><th class="n">Valor</th><th class="n">Pago</th><th>Situação</th></tr></thead><tbody>
    ${l.cronograma.map(p => {
      const falta = r2(p.valor - p.pago);
      const st = falta <= 0 ? '<span class="pill ok">Paga</span>'
        : l.status === 'quitado' ? '<span class="pill quitado">Dispensada</span>'
        : p.venc < h ? '<span class="pill atrasado">Atrasada</span>'
        : p.pago > 0 ? '<span class="pill aviso">Parcial</span>' : '<span class="pill quitado">A vencer</span>';
      return `<tr><td>${p.n}</td><td>${fmtData(p.venc)}</td><td class="n">${money(p.valor)}</td><td class="n">${money(p.pago)}</td><td>${st}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function fatosDe(l, c) {
  let f;
  if (l.tipo === 'parcelado') {
    f = `<div><dt>Emprestado</dt><dd>${money(l.valor)}</dd></div>
      <div><dt>Total do contrato</dt><dd>${money(c.total)}</dd></div>
      <div><dt>Já recebido</dt><dd>${money(c.pago)}</dd></div>
      <div><dt>Falta receber</dt><dd>${money(c.aberto)}</dd></div>`;
  } else {
    f = `<div><dt>Emprestado</dt><dd>${money(l.valor)}</dd></div>
      <div><dt>Principal em aberto</dt><dd>${money(c.principal)}</dd></div>
      <div><dt>Juros por período</dt><dd>${money(c.jm)}</dd></div>
      <div><dt>Próximo vencimento</dt><dd>${c.proxVenc ? fmtData(c.proxVenc) : '—'}</dd></div>`;
  }
  if (c.atraso > 0) f += `<div class="alerta"><dt>Em atraso</dt><dd>${money(c.atraso)}</dd></div>`;
  if (c.enc > 0) f += `<div class="alerta"><dt>Multa e mora hoje</dt><dd>${money(c.enc)}</dd></div>`;
  if (l.tarifa > 0) f += `<div><dt>Tarifa de abertura</dt><dd>${money(l.tarifa)}</dd></div>`;
  if (l.descontoTotal > 0) f += `<div><dt>Desconto dado</dt><dd>${money(l.descontoTotal)}</dd></div>`;
  return f;
}

export function abrirDetalhe(id) {
  S.detalheId = id;
  renderDetalhe();
  carregarHistorico(id);
}

function renderDetalhe() {
  const l = S.emprestimos.find(x => x.id === S.detalheId);
  if (!l) { fecharModal(); return; }
  const c = calc(l);
  const aberto = l.status !== 'quitado';
  abrirModal('Empréstimo', `
    <div class="cab-det">
      <div><div class="nome">${badge(codEmprestimo(l))} ${esc(nomeCliente(l))}</div>
        <div class="sub">${esc(tipoLabel(l))}: ${esc(descEmp(l))}, desde ${fmtData(l.dataInicio)}</div></div>
      ${pill(c.situacao)}
    </div>
    <dl class="fatos">${fatosDe(l, c)}</dl>
    <p class="ajuda" style="margin-top:12px">Encargos por atraso: ${esc(descEncargos(encCfg(l)))}</p>
    ${l.obs ? `<p class="ajuda">${esc(l.obs)}</p>` : ''}
    ${camposResumo(S.cfg.camposEmprestimo, l.extras)}
    ${l.tipo === 'parcelado' ? tabelaParcelas(l) : ''}
    <h3>Histórico</h3>
    <div id="hist"><p class="vazio">Carregando…</p></div>
    <div class="acoes" style="margin-top:20px">
      ${can('emprestimos.excluir') ? '<button class="perigo" data-acao="excluir-emp" data-id="' + esc(l.id) + '">Excluir</button>' : ''}
      <button data-acao="extrato" data-id="${esc(l.id)}">Imprimir extrato</button>
      ${can('emprestimos.editar') && aberto ? `<button data-acao="editar-emp" data-id="${esc(l.id)}">Editar</button>` : ''}
      <span class="espaco"></span>
      ${can('pagamentos.registrar') && aberto ? `<button data-acao="prorrogar" data-id="${esc(l.id)}">Prorrogar</button>` : ''}
      ${can('pagamentos.registrar') && aberto ? `<button class="primario" data-acao="pagar" data-id="${esc(l.id)}">Registrar pagamento</button>` : ''}
    </div>`, true);
}

const detEv = ev => [
  ev.tipo === 'prorrogacao' ? `${ev.n ? `Parcela ${ev.n}` : 'Vencimento'} para ${fmtData(ev.novoVenc)}${ev.deslocar ? ' (e as seguintes)' : ''}` : '',
  ev.quitar ? 'Quitação com desconto' : '', ev.obs
].filter(Boolean).join(' — ');

async function carregarHistorico(id) {
  const box = $('#hist', dlg);
  if (!box) return;
  try {
    const evs = (await buscarEventos(id)).sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.ts || 0) - (a.ts || 0));
    S.eventosDet = Object.fromEntries(evs.map(e => [e.id, e]));
    const alvo = $('#hist', dlg);
    if (!alvo || S.detalheId !== id) return;
    alvo.innerHTML = evs.length
      ? `<div class="rolagem"><table><thead><tr><th>Data</th><th>Tipo</th><th class="n">Valor</th><th class="n">Multa e mora</th><th>Detalhes</th><th></th></tr></thead><tbody>
        ${evs.map(e => `<tr><td>${fmtData(e.data)}</td><td>${esc(NOMES_EV[e.tipo] || e.tipo)}</td>
          <td class="n">${e.tipo === 'prorrogacao' ? '—' : money(e.valor)}</td><td class="n">${e.encargos > 0 ? money(e.encargos) : '—'}</td>
          <td>${esc(detEv(e))}</td>
          <td class="nowrap">${e.tipo !== 'prorrogacao' ? `<button class="peq" data-acao="recibo" data-id="${esc(id)}" data-ev="${esc(e.id)}">Recibo</button>` : ''}
            ${can('pagamentos.estornar') ? `<button class="peq perigo" data-acao="estornar" data-id="${esc(id)}" data-ev="${esc(e.id)}">Estornar</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>`
      : '<p class="vazio">Nenhum pagamento registrado ainda.</p>';
  } catch (e) { box.textContent = 'Não foi possível carregar o histórico.'; }
}

/* =========================================================
   Pagamento, prorrogação e edição
   ========================================================= */
function formPagamento(id, sugerido = 0, voltar = false) {
  const l = S.emprestimos.find(x => x.id === id);
  if (!l || !can('pagamentos.registrar')) return;
  const c = calc(l);
  const juros = l.tipo === 'juros';
  S.detalheId = null; // evita que a atualização em tempo real troque esta janela
  abrirModal('Registrar pagamento', `
    <form id="f">
      <p><b>${esc(nomeCliente(l))}</b><br>
      ${juros ? `Principal em aberto: ${money(c.principal)}. Juros por período: ${money(c.jm)}.` : `Falta receber: ${money(c.aberto)}.`}
      ${c.enc > 0 ? `<br>Multa e mora até hoje: ${money(c.enc)}.` : ''}</p>
      <div class="dupla">
        <label>${juros ? 'Valor recebido' : 'Valor da parcela recebido'}<input name="valor" type="number" step="0.01" min="0" inputmode="decimal" required value="${sugerido > 0 ? sugerido : ''}"></label>
        <label>Data do pagamento<input name="data" type="date" value="${hoje()}" required></label>
      </div>
      ${juros ? `<label>O que foi pago
          <select name="tipo">
            <option value="juros">Juros do período</option>
            <option value="amortizacao">Parte do valor emprestado (reduz o principal)</option>
          </select></label>`
        : '<p class="ajuda">O valor é aplicado primeiro às parcelas mais antigas que ainda estão em aberto.</p>'}
      <label>Multa e mora cobradas<input name="encargos" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00"></label>
      <p class="ajuda"><span id="sugEnc"></span> Você pode trocar o valor para dar desconto ou combinar outro valor com o cliente.
        <button type="button" class="link" id="usarCalc">Usar o valor calculado</button></p>
      <label class="check"><input type="checkbox" name="quitar"> Dar baixa total (quitar): o que ainda faltar vira desconto</label>
      <div class="previa">Total recebido agora: <b id="totalRec"></b></div>
      <label>Observação (opcional)<input name="obs"></label>
      <p class="erro" role="alert"></p>
      <div class="acoes">
        <span class="espaco"></span>
        <button type="button" id="cancel">Cancelar</button>
        <button class="primario" type="submit">Salvar pagamento</button>
      </div>
    </form>`);
  const f = $('#f', dlg);
  let manual = false;
  const atualizar = () => {
    const v = r2(parseFloat(f.elements.valor.value) || 0);
    const t = juros ? f.elements.tipo.value : 'parcela';
    const { sug } = simularEncargos(l, v, t, f.elements.data.value || hoje());
    $('#sugEnc', dlg).textContent = sug > 0 ? `Calculado até a data do pagamento: ${money(sug)}.` : 'Nenhuma multa ou mora calculada para este pagamento.';
    if (!manual) f.elements.encargos.value = sug > 0 ? sug.toFixed(2) : '';
    $('#totalRec', dlg).textContent = money(v + (parseFloat(f.elements.encargos.value) || 0));
  };
  f.elements.encargos.addEventListener('input', () => { manual = true; atualizar(); });
  ['valor', 'data'].forEach(n => f.elements[n].addEventListener('input', atualizar));
  f.elements.tipo?.addEventListener('change', atualizar);
  $('#usarCalc', dlg).addEventListener('click', () => { manual = false; atualizar(); });
  atualizar();
  $('#cancel', dlg).addEventListener('click', () => voltar ? abrirDetalhe(id) : fecharModal());
  ligarForm('#f', async fd => {
    const valor = r2(parseFloat(fd.get('valor')) || 0);
    const quitar = fd.has('quitar');
    if (!(valor > 0) && !quitar) throw new Error('Informe um valor maior que zero.');
    await registrarEvento(id, {
      tipo: juros ? fd.get('tipo') : 'parcela', valor, encargos: Math.max(0, r2(parseFloat(fd.get('encargos')) || 0)),
      data: fd.get('data'), quitar, obs: fd.get('obs').trim()
    });
    toast('Pagamento registrado.');
    if (voltar) abrirDetalhe(id); else fecharModal();
  });
}

function formProrrogar(id) {
  const l = S.emprestimos.find(x => x.id === id);
  if (!l || !can('pagamentos.registrar')) return;
  const c = calc(l);
  S.detalheId = null;
  const pend = l.tipo === 'parcelado' ? l.cronograma.filter(p => r2(p.valor - p.pago) > 0) : [];
  abrirModal('Prorrogar vencimento', `
    <form id="f">
      <p><b>${esc(nomeCliente(l))}</b></p>
      ${l.tipo === 'parcelado' ? `<label>Parcela
        <select name="n">${pend.map(p => `<option value="${p.n}">Parcela ${p.n}, vence em ${fmtData(p.venc)} (${money(r2(p.valor - p.pago))})</option>`).join('')}</select></label>`
        : `<p class="ajuda">Vencimento atual: ${fmtData(c.proxVenc)}.</p>`}
      <label>Nova data de vencimento<input name="novoVenc" type="date" required value="${addDays(l.tipo === 'parcelado' ? (pend[0]?.venc || hoje()) : c.proxVenc, 7)}"></label>
      ${l.tipo === 'parcelado' ? '<label class="check"><input type="checkbox" name="deslocar"> Mover também as parcelas seguintes pelo mesmo número de dias</label>' : ''}
      <label>Observação (opcional)<input name="obs"></label>
      <p class="ajuda">Se a parcela estava atrasada, a multa e a mora passam a contar a partir da nova data.</p>
      <p class="erro" role="alert"></p>
      <div class="acoes">
        <span class="espaco"></span>
        <button type="button" id="cancel">Cancelar</button>
        <button class="primario" type="submit">Salvar nova data</button>
      </div>
    </form>`);
  $('#cancel', dlg).addEventListener('click', () => abrirDetalhe(id));
  ligarForm('#f', async fd => {
    await registrarEvento(id, {
      tipo: 'prorrogacao', n: l.tipo === 'parcelado' ? Number(fd.get('n')) : null, novoVenc: fd.get('novoVenc'),
      deslocar: fd.has('deslocar'), valor: 0, encargos: 0, data: hoje(), obs: fd.get('obs').trim()
    });
    toast('Vencimento alterado.');
    abrirDetalhe(id);
  });
}

function formEditarEmp(id) {
  const l = S.emprestimos.find(x => x.id === id);
  if (!l || !can('emprestimos.editar')) return;
  S.detalheId = null;
  const defs = S.cfg.camposEmprestimo;
  abrirModal('Editar empréstimo', `
    <form id="f">
      <p><b>${esc(nomeCliente(l))}</b>: ${esc(descEmp(l))}</p>
      ${blocoEncargos(encCfg(l), true)}
      ${camposHTML(defs, l.extras)}
      <label>Observações<textarea name="obs" rows="3">${esc(l.obs)}</textarea></label>
      <p class="ajuda">Valor, taxa e parcelas não mudam aqui. Para corrigir o contrato, exclua e registre de novo.</p>
      <p class="erro" role="alert"></p>
      <div class="acoes">
        <span class="espaco"></span>
        <button type="button" id="cancel">Cancelar</button>
        <button class="primario" type="submit">Salvar</button>
      </div>
    </form>`);
  $('#cancel', dlg).addEventListener('click', () => abrirDetalhe(id));
  ligarForm('#f', async (fd, f) => {
    const patch = { encargos: lerEncargos(f), extras: lerCampos(defs, f), obs: fd.get('obs').trim() };
    const estado = replay({ ...l, ...patch }, await buscarEventos(id)); // mantém o saldo coerente com os novos encargos
    await updateDoc(doc(db, 'emprestimos', id), { ...patch, ...camposEstado(estado) });
    log('emprestimo.editar', nomeCliente(l));
    toast('Alterações salvas.');
    abrirDetalhe(id);
  });
}

/* =========================================================
   Documentos para imprimir
   ========================================================= */
function cabecalhoEmpresa() {
  const e = S.cfg.empresa;
  return `<header><b style="font-size:1.2rem">${esc(e.nome)}</b><br>${[e.documento, e.telefone].filter(Boolean).map(esc).join(' · ')}${e.endereco ? '<br>' + esc(e.endereco) : ''}</header>`;
}

function recibo(ev, l) {
  const cli = clienteDe(l.clienteId);
  const total = r2((ev.valor || 0) + (ev.encargos || 0));
  const o = ev.tipo === 'juros' ? 'juros' : ev.tipo === 'amortizacao' ? 'parte do valor emprestado' : 'parcela(s)';
  imprimir('Recibo', `${cabecalhoEmpresa()}
    <h1>RECIBO</h1>
    <p class="valor">${money(total)}</p>
    <p>Recebi de <b>${esc(nomeCliente(l))}</b>${cli?.documento ? `, documento ${esc(cli.documento)}` : ''}, a quantia de <b>${money(total)}</b>${ev.encargos > 0 ? ` (${money(ev.valor)} de ${o} e ${money(ev.encargos)} de multa e mora)` : ` referente a ${o}`},
    do empréstimo ${esc(codEmprestimo(l))} de ${money(l.valor)} (${esc(descEmp(l))}), em ${fmtData(ev.data)}.</p>
    ${ev.quitar ? '<p><b>Empréstimo quitado.</b></p>' : ''}
    ${ev.obs ? `<p>${esc(ev.obs)}</p>` : ''}
    <p>${esc(S.cfg.mensagens.recibo)}</p>
    <div class="ass">______________________________<br>${esc(S.cfg.empresa.nome)}</div>`);
}

function extrato(l) {
  const c = calc(l);
  const evs = Object.values(S.eventosDet).sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.ts || 0) - (b.ts || 0));
  imprimir('Extrato', `${cabecalhoEmpresa()}
    <h1>EXTRATO DO EMPRÉSTIMO ${esc(codEmprestimo(l))}</h1>
    <p><b>${esc(nomeCliente(l))}</b><br>${esc(tipoLabel(l))}: ${esc(descEmp(l))}, desde ${fmtData(l.dataInicio)}.</p>
    <dl class="fatos">${fatosDe(l, c).replace(/<div class="alerta">/g, '<div>')}</dl>
    ${l.tipo === 'parcelado' ? tabelaParcelas(l) : ''}
    <h2>Pagamentos</h2>
    ${evs.length ? `<table><thead><tr><th>Data</th><th>Tipo</th><th class="n">Valor</th><th class="n">Multa e mora</th><th>Detalhes</th></tr></thead><tbody>
      ${evs.map(e => `<tr><td>${fmtData(e.data)}</td><td>${esc(NOMES_EV[e.tipo] || e.tipo)}</td><td class="n">${e.tipo === 'prorrogacao' ? '—' : money(e.valor)}</td><td class="n">${e.encargos > 0 ? money(e.encargos) : '—'}</td><td>${esc(detEv(e))}</td></tr>`).join('')}</tbody></table>` : '<p>Nenhum pagamento registrado.</p>'}
    <p style="margin-top:24px;color:#555">Emitido em ${fmtData(hoje())}.</p>`);
}

/* =========================================================
   Registro das ações
   ========================================================= */
acoes['novo-emp'] = () => can('emprestimos.criar') && formEmprestimo();
acoes['abrir-emp'] = ds => abrirDetalhe(ds.id);
acoes.receber = ds => formPagamento(ds.id, Number(ds.valor), false);
acoes.pagar = ds => formPagamento(ds.id, calc(S.emprestimos.find(x => x.id === ds.id) || {}).proxValor || 0, true);
acoes.prorrogar = ds => formProrrogar(ds.id);
acoes['editar-emp'] = ds => formEditarEmp(ds.id);
acoes['excluir-emp'] = ds => excluirEmprestimo(ds.id);
acoes.estornar = ds => estornar(ds.id, ds.ev);
acoes.recibo = ds => { const ev = S.eventosDet[ds.ev], l = S.emprestimos.find(x => x.id === ds.id); if (ev && l) recibo(ev, l); };
acoes.extrato = ds => { const l = S.emprestimos.find(x => x.id === ds.id); if (l) extrato(l); };

ui.abrirDetalhe = abrirDetalhe;
ui.atualizarDetalhe = () => { if (S.detalheId && dlg.open) { renderDetalhe(); carregarHistorico(S.detalheId); } };
