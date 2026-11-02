import { esc, money, nf, r2, intervalo, diasEntre, fmtData, csvTexto, numCsv, baixar } from '../util.js';
import { calc, parteJuros } from '../calc.js';
import { toast } from '../modal.js';
import { db, collection, getDocs, query, where } from '../firebase.js';
import { S, ui, acoes, mudancas, envios, views, aoEntrar, nomeCliente, msgErro } from '../state.js';

const NOMES = { parcela: 'Parcela', juros: 'Juros', amortizacao: 'Amortização', prorrogacao: 'Prorrogação' };
const PERIODOS = { mes: 'Este mês', mesPassado: 'Mês passado', '3meses': 'Últimos 3 meses', ano: 'Este ano', custom: 'Escolher datas' };

const faixa = () => S.rel.periodo === 'custom' ? { ini: S.rel.ini, fim: S.rel.fim } : intervalo(S.rel.periodo);

async function carregar() {
  const { ini, fim } = faixa();
  if (!ini || !fim || ini > fim) { S.rel.pag = []; ui.render(true); return; }
  S.rel.carregando = true; ui.render(true);
  try {
    const s = await getDocs(query(collection(db, 'pagamentos'), where('data', '>=', ini), where('data', '<=', fim)));
    S.rel.pag = s.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { toast(msgErro(e)); S.rel.pag = []; }
  S.rel.carregando = false;
  ui.render(true);
}
aoEntrar.relatorios = carregar;

function agrupar(pag, ini, fim) {
  const porDia = diasEntre(ini, fim) + 1 <= 62;
  const m = new Map();
  for (const p of pag) {
    const k = porDia ? p.data : p.data.slice(0, 7);
    m.set(k, r2((m.get(k) || 0) + (p.valor || 0) + (p.encargos || 0)));
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({
    rot: porDia ? k.slice(8) + '/' + k.slice(5, 7) : k.slice(5) + '/' + k.slice(2, 4), val: v
  }));
}

function grafico(dados) {
  if (!dados.length) return '<p class="vazio">Sem pagamentos no período.</p>';
  const W = 680, H = 190, ml = 8, mb = 28, mt = 14;
  const max = Math.max(...dados.map(d => d.val), 1);
  const bw = (W - ml * 2) / dados.length;
  const passo = Math.ceil(dados.length / 14);
  const barras = dados.map((d, i) => {
    const h = (H - mb - mt) * d.val / max;
    const x = ml + i * bw + bw * 0.15, y = H - mb - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="var(--verde)"><title>${esc(d.rot)}: ${esc(money(d.val))}</title></rect>
      ${i % passo === 0 ? `<text x="${(x + bw * 0.35).toFixed(1)}" y="${H - 10}" font-size="11" text-anchor="middle" fill="var(--suave)">${esc(d.rot)}</text>` : ''}`;
  }).join('');
  return `<div class="rolagem"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Recebimentos por período" style="min-width:420px">
    <line x1="${ml}" x2="${W - ml}" y1="${H - mb}" y2="${H - mb}" stroke="var(--linha)"/>${barras}
    <text x="${ml}" y="10" font-size="11" fill="var(--suave)">Maior: ${esc(money(max))}</text></svg></div>`;
}

views.relatorios = function renderRelatorios() {
  const { ini, fim } = faixa();
  const pag = S.rel.pag.filter(p => p.tipo !== 'prorrogacao');
  const emp = id => S.emprestimos.find(l => l.id === id);
  let total = 0, enc = 0, jur = 0;
  const porTipo = {};
  for (const p of pag) {
    total += (p.valor || 0) + (p.encargos || 0); enc += p.encargos || 0;
    const l = emp(p.emprestimoId);
    if (l) jur += parteJuros(l, p);
    porTipo[p.tipo] = r2((porTipo[p.tipo] || 0) + (p.valor || 0));
  }
  const noPeriodo = S.emprestimos.filter(l => l.dataInicio >= ini && l.dataInicio <= fim);
  const emprestado = noPeriodo.reduce((a, l) => a + l.valor, 0);
  const tarifas = noPeriodo.reduce((a, l) => a + (l.tarifa || 0), 0);
  const resultado = r2(jur + enc + tarifas);

  const ativos = S.emprestimos.filter(l => l.status !== 'quitado');
  const atrasados = ativos.filter(l => calc(l).situacao === 'atrasado');
  const principal = ativos.reduce((a, l) => a + calc(l).principal, 0);
  const lista = [...pag].sort((a, b) => b.data.localeCompare(a.data) || (b.ts || 0) - (a.ts || 0)).slice(0, 200);

  return `<h1>Relatórios</h1>
  <form class="barra" id="f-rel">
    <select name="periodo" data-mudar="rel-periodo" aria-label="Período">${Object.entries(PERIODOS).map(([k, t]) => `<option value="${k}" ${S.rel.periodo === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    ${S.rel.periodo === 'custom' ? `<input type="date" name="ini" value="${esc(S.rel.ini)}" required aria-label="De"> <input type="date" name="fim" value="${esc(S.rel.fim)}" required aria-label="Até"><button class="primario" type="submit">Ver</button>` : ''}
    <span class="espaco"></span>
    <button type="button" data-acao="rel-csv" ${pag.length ? '' : 'disabled'}>Baixar planilha (CSV)</button>
  </form>
  <p class="ajuda">De ${fmtData(ini)} até ${fmtData(fim)}. ${S.rel.carregando ? 'Carregando…' : ''}</p>
  <section class="painel">
    <dl class="linhas">
      <div><dt>Total recebido</dt><dd>${money(total)}</dd></div>
      ${Object.entries(porTipo).map(([t, v]) => `<div><dt>&nbsp;&nbsp;${esc(NOMES[t] || t)}</dt><dd>${money(v)}</dd></div>`).join('')}
      <div><dt>&nbsp;&nbsp;Multa e mora</dt><dd>${money(enc)}</dd></div>
      <div><dt>Emprestado no período</dt><dd>${money(emprestado)}</dd></div>
    </dl>
    <dl class="linhas">
      <div><dt>Juros recebidos (estimado)</dt><dd>${money(jur)}</dd></div>
      <div><dt>Multa e mora recebidas</dt><dd>${money(enc)}</dd></div>
      <div><dt>Tarifas de abertura</dt><dd>${money(tarifas)}</dd></div>
      <div><dt><b>Resultado estimado</b></dt><dd>${money(resultado)}</dd></div>
    </dl>
  </section>
  <p class="ajuda">Nas parcelas, a parte de juros é estimada proporcionalmente ao contrato. Nos empréstimos de juros periódicos, todo pagamento de juros conta como resultado.</p>
  <h2>Recebido por ${diasEntre(ini, fim) + 1 <= 62 ? 'dia' : 'mês'}</h2>
  ${grafico(agrupar(pag, ini, fim))}
  <h2>Carteira hoje</h2>
  <dl class="linhas">
    <div><dt>Empréstimos ativos</dt><dd>${ativos.length}</dd></div>
    <div><dt>Principal em aberto</dt><dd>${money(principal)}</dd></div>
    <div class="alerta"><dt>Empréstimos atrasados</dt><dd>${atrasados.length}</dd></div>
    <div><dt>Quitados</dt><dd>${S.emprestimos.length - ativos.length}</dd></div>
  </dl>
  <h2>Pagamentos do período <span class="cont">${pag.length}</span></h2>
  ${lista.length ? `<div class="rolagem"><table><thead><tr><th>Data</th><th>Cliente</th><th>Tipo</th><th class="n">Valor</th><th class="n">Multa e mora</th></tr></thead><tbody>
    ${lista.map(p => { const l = emp(p.emprestimoId); return `<tr><td>${fmtData(p.data)}</td><td>${esc(l ? nomeCliente(l) : p.clienteNome)}</td><td>${esc(NOMES[p.tipo] || p.tipo)}</td><td class="n">${money(p.valor)}</td><td class="n">${p.encargos > 0 ? money(p.encargos) : '—'}</td></tr>`; }).join('')}
    </tbody></table></div>${pag.length > lista.length ? '<p class="ajuda">Mostrando os 200 mais recentes. A planilha tem todos.</p>' : ''}` : '<p class="vazio">Nenhum pagamento neste período.</p>'}`;
};

mudancas['rel-periodo'] = el => {
  S.rel.periodo = el.value;
  if (el.value === 'custom') {
    const m = intervalo('mes');
    S.rel.ini ||= m.ini; S.rel.fim ||= m.fim;
    ui.render(true);
  } else carregar();
};
envios['f-rel'] = fd => { S.rel.ini = fd.get('ini'); S.rel.fim = fd.get('fim'); return carregar(); };

acoes['rel-csv'] = () => {
  const { ini, fim } = faixa();
  const linhas = [['Data', 'Cliente', 'Tipo', 'Valor', 'Multa e mora', 'Total', 'Observação']];
  [...S.rel.pag].sort((a, b) => a.data.localeCompare(b.data)).forEach(p => {
    const l = S.emprestimos.find(x => x.id === p.emprestimoId);
    linhas.push([p.data, l ? nomeCliente(l) : p.clienteNome, NOMES[p.tipo] || p.tipo, numCsv(p.valor), numCsv(p.encargos), numCsv((p.valor || 0) + (p.encargos || 0)), p.obs || '']);
  });
  baixar(`pagamentos_${ini}_a_${fim}.csv`, csvTexto(linhas));
};
