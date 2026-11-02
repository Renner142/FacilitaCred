import { esc, money, r2, hoje, fmtData, diasEntre, intervaloMes, preencher, nf, getLocale } from '../util.js';
import { calc, itensCobranca } from '../calc.js';
import { S, ui, acoes, mudancas, views, can, clienteDe, nomeCliente } from '../state.js';
import { codEmprestimo, badge } from '../codigos.js';

/* ---------- mensagem de cobrança (modelos editáveis em Ajustes) ---------- */
export function linkZap(it) {
  const c = clienteDe(it.loan.clienteId);
  const dig = (c?.telefone || '').replace(/\D/g, '');
  if (dig.length < 8) return '';
  const ddi = String(S.cfg.regional.ddi || '').replace(/\D/g, '');
  const num = dig.length <= 11 && ddi ? ddi + dig : dig;
  const d = diasEntre(hoje(), it.venc);
  const modelo = d < 0 ? 'atraso' : d === 0 ? 'hoje' : 'lembrete';
  const txt = preencher(S.cfg.mensagens[modelo], {
    nome: c.nome || '', primeiroNome: (c.nome || '').split(' ')[0], valor: money(it.valor), encargos: money(it.enc),
    total: money(r2(it.valor + it.enc)), rotulo: it.rotulo.toLowerCase(), vencimento: fmtData(it.venc),
    dias: Math.max(0, -d), empresa: S.cfg.empresa.nome,
    encargosTxt: it.enc > 0 ? ` Multa e mora: ${money(it.enc)}.` : ''
  });
  return `https://wa.me/${num}?text=${encodeURIComponent(txt)}`;
}

export function linhaCobranca(it) {
  const d = diasEntre(hoje(), it.venc);
  const quando = d < 0 ? `atrasada há ${-d} ${-d === 1 ? 'dia' : 'dias'}` : d === 0 ? 'vence hoje' : `vence em ${d} ${d === 1 ? 'dia' : 'dias'}`;
  const cls = d < 0 ? 'atrasado' : d === 0 ? 'hoje' : '';
  const zap = linkZap(it);
  return `<li class="cob ${cls}">
    <div class="quem"><b>${esc(nomeCliente(it.loan))} ${badge(codEmprestimo(it.loan))}</b><span>${esc(it.rotulo)}, ${quando} (${fmtData(it.venc)})</span></div>
    <div class="val">${money(it.valor)}${it.enc > 0 ? `<small>+ ${money(it.enc)} de multa e mora</small>` : ''}</div>
    <div class="bt">
      ${can('pagamentos.registrar') ? `<button class="primario peq" data-acao="receber" data-id="${esc(it.loan.id)}" data-valor="${it.valor}">Receber</button>` : ''}
      ${zap ? `<a class="botao peq" href="${esc(zap)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
    </div></li>`;
}

/* ---------- Painel ---------- */
views.painel = function renderPainel() {
  const h = hoje();
  const { fim } = intervaloMes();
  const ativos = S.emprestimos.filter(l => l.status !== 'quitado');
  let naRua = 0, atraso = 0, falta = 0, capAtrasado = 0, encTotal = 0;
  const inad = new Set(), clientesAtivos = new Set(), ranking = [];
  for (const l of ativos) {
    const c = calc(l);
    clientesAtivos.add(l.clienteId);
    naRua += c.principal; atraso += c.atraso; encTotal += c.enc;
    if (c.situacao === 'atrasado') { inad.add(l.clienteId); capAtrasado += c.principal; ranking.push({ l, c }); }
    if (l.tipo === 'parcelado') {
      for (const p of l.cronograma) {
        const f = r2(p.valor - p.pago);
        if (f > 0 && p.venc >= h && p.venc <= fim) falta += f;
      }
    } else if (c.proxVenc >= h && c.proxVenc <= fim) falta += c.proxValor;
  }
  const recebido = S.pagMes.reduce((a, p) => a + (p.valor || 0) + (p.encargos || 0), 0);
  const pct = naRua > 0 ? Math.min(100, Math.round(capAtrasado / naRua * 100)) : 0;
  const mes = new Date().toLocaleDateString(getLocale(), { month: 'long' });
  const agenda = itensCobranca(S.emprestimos, 0).slice(0, 6);
  ranking.sort((a, b) => (b.c.atraso + b.c.enc) - (a.c.atraso + a.c.enc));
  const top = ranking.slice(0, 5);

  return `<h1>Painel</h1>
  <section class="painel">
    <div class="destaque">
      <span class="rot">Dinheiro na rua</span>
      <strong class="num">${money(naRua)}</strong>
      <span class="nota">${ativos.length} ${ativos.length === 1 ? 'empréstimo ativo' : 'empréstimos ativos'} com ${clientesAtivos.size} ${clientesAtivos.size === 1 ? 'cliente' : 'clientes'}</span>
      <div class="medidor" role="img" aria-label="${pct}% do dinheiro na rua está em empréstimos atrasados"><i style="width:${pct}%"></i></div>
      <span class="nota">${pct}% do dinheiro na rua está em empréstimos atrasados</span>
    </div>
    <dl class="linhas">
      <div><dt>Recebido em ${esc(mes)}</dt><dd>${money(recebido)}</dd></div>
      <div><dt>A vencer até o fim do mês</dt><dd>${money(falta)}</dd></div>
      <div class="alerta"><dt>Total em atraso</dt><dd>${money(atraso)}</dd></div>
      ${encTotal > 0 ? `<div class="alerta"><dt>Multa e mora a cobrar</dt><dd>${money(encTotal)}</dd></div>` : ''}
      <div><dt>Clientes com atraso</dt><dd>${inad.size}</dd></div>
    </dl>
  </section>
  <h2>Para cobrar hoje</h2>
  ${agenda.length ? `<ul class="cobs">${agenda.map(linhaCobranca).join('')}</ul>
    <p style="margin-top:12px"><button data-acao="ir" data-view="cobrancas">Ver agenda completa</button></p>`
    : '<p class="vazio">Nada atrasado nem vencendo hoje.</p>'}
  ${top.length ? `<h2>Maiores atrasos</h2>
    <div class="rolagem"><table><thead><tr><th>Cliente</th><th class="n">Dias de atraso</th><th class="n">Em atraso</th><th class="n">Multa e mora</th></tr></thead><tbody>
    ${top.map(({ l, c }) => `<tr class="clicavel" data-acao="abrir-emp" data-id="${esc(l.id)}"><td><button class="link" data-acao="abrir-emp" data-id="${esc(l.id)}">${esc(nomeCliente(l))}</button></td>
      <td class="n">${nf(c.diasAtraso, 0)}</td><td class="n txt-atraso">${money(c.atraso)}</td><td class="n">${c.enc > 0 ? money(c.enc) : '—'}</td></tr>`).join('')}
    </tbody></table></div>` : ''}`;
};

/* ---------- Cobranças ---------- */
views.cobrancas = function renderCobrancas() {
  const h = hoje();
  const dias = S.diasAgenda ?? S.cfg.agenda.dias;
  const its = itensCobranca(S.emprestimos, dias);
  const bloco = (t, l) => l.length ? `<h2>${t} <span class="cont">${l.length}</span></h2><ul class="cobs">${l.map(linhaCobranca).join('')}</ul>` : '';
  const opcoes = [...new Set([7, 15, 30, 60, dias])].sort((a, b) => a - b);
  return `<h1>Cobranças</h1>
  <div class="barra">
    <label style="margin:0">Mostrar vencimentos dos próximos
      <select data-mudar="agenda" style="width:auto">${opcoes.map(n => `<option value="${n}" ${dias === n ? 'selected' : ''}>${n} dias</option>`).join('')}</select>
    </label>
  </div>
  ${its.length ? bloco('Atrasadas', its.filter(i => i.venc < h)) + bloco('Vencem hoje', its.filter(i => i.venc === h)) + bloco(`Próximos ${dias} dias`, its.filter(i => i.venc > h))
    : '<p class="vazio">Nenhuma cobrança neste período.</p>'}`;
};

acoes.ir = ds => { S.view = ds.view; ui.navegar(ds.view); };
mudancas.agenda = el => { S.diasAgenda = Number(el.value); ui.render(true); };
