// Regras de cálculo. Nenhuma dependência de tela ou Firebase: dá para testar no Node.
import { r2, money, nf, addMonths, addDays, diasEntre, parseISO, hoje } from './util.js';
import { ENC_PADRAO } from './config.js';

/* =========================================================
   Periodicidade (mensal, quinzenal, semanal, diária, "a cada N")
   ========================================================= */
export const UNIDADES = {
  mes: { taxa: 'ao mês', un: ['mês', 'meses'], adj: ['mensal', 'mensais'], dias: 30 },
  quinzena: { taxa: 'por quinzena', un: ['quinzena', 'quinzenas'], adj: ['quinzenal', 'quinzenais'], dias: 15 },
  semana: { taxa: 'por semana', un: ['semana', 'semanas'], adj: ['semanal', 'semanais'], dias: 7 },
  dia: { taxa: 'por dia', un: ['dia', 'dias'], adj: ['diária', 'diárias'], dias: 1 }
};

export function periodoDe(l) {
  const p = { unidade: 'mes', passo: 1, ...(l?.periodo || {}) };
  if (!UNIDADES[p.unidade]) p.unidade = 'mes';
  p.passo = Math.max(1, parseInt(p.passo, 10) || 1);
  return p;
}
export const taxaRotulo = p => p.passo === 1 ? UNIDADES[p.unidade].taxa : `a cada ${p.passo} ${UNIDADES[p.unidade].un[1]}`;
const adjRotulo = (p, plural) => p.passo === 1 ? UNIDADES[p.unidade].adj[plural ? 1 : 0] : `a cada ${p.passo} ${UNIDADES[p.unidade].un[1]}`;

export function somaPeriodos(iso, k, p, ancora) {
  const n = k * p.passo;
  if (p.unidade === 'mes') return addMonths(iso, n, ancora);
  return addDays(iso, n * UNIDADES[p.unidade].dias);
}

/* =========================================================
   Textos de apoio
   ========================================================= */
export const tipoLabel = l => l.modalidade || (l.tipo === 'parcelado' ? 'Parcelado' : 'Juros periódicos');

export function descEmp(l) {
  const p = periodoDe(l);
  if (l.tipo === 'parcelado') {
    const n = l.cronograma?.length || 0;
    const ini = l.calculo === 'sac' ? 'a partir de ' : '';
    return `${n} ${n === 1 ? 'parcela' : 'parcelas'} ${adjRotulo(p, n !== 1)} de ${ini}${money(l.cronograma?.[0]?.valor)}`;
  }
  return `Juros de ${nf(l.taxa)}% ${taxaRotulo(p)}`;
}

export function descEncargos(c) {
  if (!temEnc(c)) return 'nenhum configurado.';
  const p = [];
  if (c.multaPct > 0) p.push(`multa de ${nf(c.multaPct)}%`);
  if (c.multaFixa > 0) p.push(`multa fixa de ${money(c.multaFixa)}`);
  if (c.moraPct > 0) p.push(`mora de ${nf(c.moraPct)}% ${c.moraPeriodo === 'mes' ? 'ao mês' : 'ao dia'}`);
  if (c.carencia > 0) p.push(`carência de ${c.carencia} ${c.carencia === 1 ? 'dia' : 'dias'}`);
  if (c.tetoPct > 0) p.push(`teto de ${nf(c.tetoPct)}% do valor`);
  return p.join(', ') + '.';
}

/* =========================================================
   Cronograma de parcelas
   calculo: 'simples' (taxa × períodos), 'price' (parcela fixa, juros compostos),
            'sac' (amortização constante, parcelas decrescentes)
   ========================================================= */
export function gerarCronograma(v) {
  const i = (v.taxa || 0) / 100;
  const n = v.n;
  const p = v.periodo || periodoDe({});
  const ancora = parseISO(v.primeiroVenc).getDate();
  let valores;
  if (v.parcelaManual > 0) {
    valores = Array(n).fill(r2(v.parcelaManual));
  } else if (v.calculo === 'sac') {
    const am = v.valor / n;
    let saldo = v.valor;
    valores = Array.from({ length: n }, () => { const val = r2(am + saldo * i); saldo -= am; return val; });
  } else if (v.calculo === 'price' && i > 0) {
    valores = Array(n).fill(r2(v.valor * i / (1 - Math.pow(1 + i, -n))));
  } else {
    valores = Array(n).fill(r2((v.valor + v.valor * i * n) / n));
  }
  return valores.map((valor, k) => ({ n: k + 1, venc: somaPeriodos(v.primeiroVenc, k, p, ancora), valor, pago: 0, encPago: 0 }));
}

/* =========================================================
   Encargos de atraso (multa e mora)
   ========================================================= */
export const encCfg = l => ({ ...ENC_PADRAO, ...(l.encargos || {}) });
export const temEnc = c => c.multaPct > 0 || c.multaFixa > 0 || c.moraPct > 0;

// Encargos de um item em atraso (uma parcela ou um período de juros) na data "ref"
export function encItem(c, base, falta, venc, ref) {
  const dias = diasEntre(venc, ref);
  if (falta <= 0 || dias <= c.carencia || !temEnc(c)) return { dias: Math.max(dias, 0), total: 0 };
  const multa = r2(base * c.multaPct / 100 + c.multaFixa);
  const taxaDia = c.moraPeriodo === 'mes' ? c.moraPct / 100 / 30 : c.moraPct / 100;
  const mora = r2(falta * taxaDia * dias);
  let total = r2(multa + mora);
  if (c.tetoPct > 0) total = Math.min(total, r2(base * c.tetoPct / 100));
  return { dias, multa, mora, total };
}

// Encargos em aberto do empréstimo na data "ref" (já descontando o que foi cobrado antes)
export function encargosLoan(l, ref) {
  const c = encCfg(l);
  if (l.status === 'quitado' || !temEnc(c)) return { total: 0, itens: [] };
  if (l.tipo === 'parcelado') {
    const itens = l.cronograma.map(p => {
      const e = encItem(c, p.valor, r2(p.valor - p.pago), p.venc, ref);
      return { n: p.n, venc: p.venc, devido: Math.max(0, r2(e.total - (p.encPago || 0))) };
    });
    return { total: r2(itens.reduce((a, i) => a + i.devido, 0)), itens };
  }
  const per = periodoDe(l);
  const jm = r2(l.principalAberto * l.taxa / 100);
  const itens = [];
  let v = l.proximoVenc, k = 0;
  while (v < ref && k < 600) {
    const falta = k === 0 ? Math.max(0, r2(jm - (l.jurosParcial || 0))) : jm;
    itens.push({ venc: v, bruto: encItem(c, jm, falta, v, ref).total });
    k++; v = somaPeriodos(v, 1, per, l.diaVenc);
  }
  const bruto = itens.reduce((a, i) => a + i.bruto, 0);
  return { total: Math.max(0, r2(bruto - (l.encPago || 0))), itens };
}

// Quanto de encargos é sugerido para um pagamento (usado no formulário)
export function simularEncargos(l, valor, tipo, ref) {
  if (!(valor > 0)) return { sug: 0 };
  const e = encargosLoan(l, ref);
  if (l.tipo === 'parcelado') {
    let resto = valor, sug = 0;
    for (const p of l.cronograma) {
      if (resto <= 0.004) break;
      const falta = r2(p.valor - p.pago);
      if (falta <= 0) continue;
      resto = r2(resto - Math.min(falta, resto));
      sug += e.itens.find(i => i.n === p.n)?.devido || 0;
    }
    return { sug: r2(sug) };
  }
  if (tipo !== 'juros') return { sug: 0 };
  const jm = r2(l.principalAberto * l.taxa / 100);
  const k = jm > 0 ? Math.floor((r2((l.jurosParcial || 0) + valor) + 0.004) / jm) : 0;
  const liquidados = r2(e.itens.slice(0, k).reduce((a, i) => a + i.bruto, 0));
  return { sug: Math.max(0, r2(liquidados - (l.encPago || 0))) };
}

/* =========================================================
   Situação atual de um empréstimo
   ========================================================= */
export function calc(l, h = hoje()) {
  let r;
  if (l.tipo === 'parcelado') {
    const cron = l.cronograma || [];
    const total = r2(cron.reduce((a, p) => a + p.valor, 0));
    const pago = r2(cron.reduce((a, p) => a + p.pago, 0));
    const aberto = r2(total - pago);
    const pend = cron.filter(p => r2(p.valor - p.pago) > 0);
    const atras = pend.filter(p => p.venc < h);
    const prox = pend[0];
    r = {
      total, pago, aberto,
      atraso: r2(atras.reduce((a, p) => a + p.valor - p.pago, 0)),
      principal: r2(l.valor * (total > 0 ? aberto / total : 0)),
      proxVenc: prox?.venc || null,
      proxValor: prox ? r2(prox.valor - prox.pago) : 0,
      situacao: atras.length ? 'atrasado' : 'em_dia',
      mesesAtraso: atras.length,
      diasAtraso: atras.length ? diasEntre(atras[0].venc, h) : 0
    };
  } else {
    const per = periodoDe(l);
    const jm = r2(l.principalAberto * l.taxa / 100);
    let v = l.proximoVenc, m = 0;
    while (v < h && m < 600) { m++; v = somaPeriodos(v, 1, per, l.diaVenc); }
    const atraso = m > 0 ? Math.max(0, r2(m * jm - (l.jurosParcial || 0))) : 0;
    r = {
      principal: l.principalAberto, aberto: l.principalAberto, jm, atraso,
      proxVenc: l.proximoVenc,
      proxValor: m > 0 ? atraso : Math.max(0, r2(jm - (l.jurosParcial || 0))),
      situacao: m > 0 ? 'atrasado' : 'em_dia',
      mesesAtraso: m,
      diasAtraso: m > 0 ? diasEntre(l.proximoVenc, h) : 0
    };
  }
  if (l.status === 'quitado') {
    r = { ...r, principal: 0, aberto: 0, atraso: 0, proxVenc: null, proxValor: 0, situacao: 'quitado', mesesAtraso: 0, diasAtraso: 0 };
  }
  r.enc = r.situacao === 'quitado' ? 0 : encargosLoan(l, h).total;
  return r;
}

// Lista do que precisa ser cobrado até "dias" dias a partir de hoje
export function itensCobranca(emps, dias, h = hoje()) {
  const lim = addDays(h, dias);
  const itens = [];
  for (const l of emps) {
    if (l.status === 'quitado') continue;
    const eL = encargosLoan(l, h);
    if (l.tipo === 'parcelado') {
      for (const p of l.cronograma) {
        const falta = r2(p.valor - p.pago);
        if (falta > 0 && p.venc <= lim) {
          itens.push({ loan: l, venc: p.venc, valor: falta, enc: eL.itens.find(i => i.n === p.n)?.devido || 0, rotulo: `Parcela ${p.n} de ${l.cronograma.length}` });
        }
      }
    } else {
      const c = calc(l, h);
      if (c.proxVenc && c.proxVenc <= lim && c.proxValor > 0) {
        itens.push({ loan: l, venc: c.proxVenc, valor: c.proxValor, enc: c.enc, rotulo: c.mesesAtraso > 1 ? `Juros de ${c.mesesAtraso} períodos` : 'Juros do período' });
      }
    }
  }
  return itens.sort((a, b) => a.venc.localeCompare(b.venc));
}

/* =========================================================
   Eventos (pagamentos, prorrogações) e reconstrução do estado
   Todo o estado do empréstimo pode ser refeito a partir do contrato + eventos.
   Por isso estornar um pagamento é só refazer a conta sem ele.
   ========================================================= */
export function estadoInicial(l) {
  const b = { ...l, status: 'ativo', descontoTotal: 0 };
  if (l.tipo === 'parcelado') {
    b.cronograma = (l.cronogramaOrig || l.cronograma).map(p => ({ n: p.n, venc: p.venc, valor: p.valor, pago: 0, encPago: 0 }));
  } else {
    b.principalAberto = l.valor;
    b.proximoVenc = l.primeiroVenc;
    b.diaVenc = parseISO(l.primeiroVenc).getDate();
    b.jurosParcial = 0;
    b.encPago = 0;
  }
  return b;
}

// ev: { tipo: 'parcela'|'juros'|'amortizacao'|'prorrogacao', valor, encargos, data, quitar, n, novoVenc, deslocar }
export function aplicarEvento(l, ev) {
  const upd = {};
  if (l.status === 'quitado') throw new Error('Este empréstimo já está quitado.');

  if (ev.tipo === 'prorrogacao') {
    if (!ev.novoVenc) throw new Error('Informe a nova data de vencimento.');
    if (l.tipo === 'parcelado') {
      const cron = l.cronograma.map(p => ({ ...p }));
      const alvo = cron.find(p => p.n === ev.n);
      if (!alvo) throw new Error('Parcela não encontrada.');
      const delta = diasEntre(alvo.venc, ev.novoVenc);
      alvo.venc = ev.novoVenc;
      if (ev.deslocar) cron.filter(p => p.n > ev.n).forEach(p => { p.venc = addDays(p.venc, delta); });
      upd.cronograma = cron;
    } else {
      upd.proximoVenc = ev.novoVenc;
      upd.diaVenc = parseISO(ev.novoVenc).getDate();
    }
    return upd;
  }

  const valor = ev.valor || 0, encargos = ev.encargos || 0;
  const e = encargosLoan(l, ev.data);

  if (l.tipo === 'parcelado') {
    let resto = valor;
    const tocadas = [];
    const cron = l.cronograma.map(p => ({ ...p }));
    for (const p of cron) {
      if (resto <= 0.004) break;
      const falta = r2(p.valor - p.pago);
      if (falta <= 0) continue;
      const abate = Math.min(falta, resto);
      p.pago = r2(p.pago + abate);
      resto = r2(resto - abate);
      tocadas.push({ p, devido: e.itens.find(i => i.n === p.n)?.devido || 0 });
    }
    if (resto > 0.004) throw new Error('O valor é maior que o saldo que falta receber neste contrato.');
    if (encargos > 0 && tocadas.length) {
      const somaDev = tocadas.reduce((a, t) => a + t.devido, 0);
      let resta = encargos;
      tocadas.forEach((t, i) => {
        const parte = i === tocadas.length - 1 ? resta : r2(somaDev > 0 ? encargos * t.devido / somaDev : (i === 0 ? encargos : 0));
        t.p.encPago = r2((t.p.encPago || 0) + parte);
        resta = r2(resta - parte);
      });
    }
    upd.cronograma = cron;
    if (cron.every(p => r2(p.valor - p.pago) <= 0)) upd.status = 'quitado';
  } else if (ev.tipo === 'juros') {
    const per = periodoDe(l);
    const jm = r2(l.principalAberto * l.taxa / 100);
    let credito = r2((l.jurosParcial || 0) + valor);
    const k = jm > 0 ? Math.floor((credito + 0.004) / jm) : 0;
    credito = Math.max(0, r2(credito - k * jm));
    upd.proximoVenc = somaPeriodos(l.proximoVenc, k, per, l.diaVenc);
    upd.jurosParcial = credito;
    const liquidados = r2(e.itens.slice(0, k).reduce((a, i) => a + i.bruto, 0));
    upd.encPago = Math.max(0, r2((l.encPago || 0) + encargos - liquidados));
  } else {
    if (valor > l.principalAberto + 0.004) throw new Error('O valor é maior que o saldo devedor.');
    upd.encPago = r2((l.encPago || 0) + encargos);
    upd.principalAberto = r2(l.principalAberto - valor);
    if (upd.principalAberto <= 0.004) { upd.principalAberto = 0; upd.status = 'quitado'; }
  }

  // Quitação com desconto: o que ainda faltava vira desconto
  if (ev.quitar && upd.status !== 'quitado') {
    const restante = l.tipo === 'parcelado'
      ? upd.cronograma.reduce((a, p) => a + Math.max(0, p.valor - p.pago), 0)
      : (upd.principalAberto ?? l.principalAberto);
    upd.status = 'quitado';
    upd.descontoTotal = r2(restante);
  }
  return upd;
}

export const ordenarEventos = evs => [...evs].sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.ts || 0) - (b.ts || 0));

export function replay(l, eventos) {
  let cur = estadoInicial(l);
  for (const ev of ordenarEventos(eventos)) cur = { ...cur, ...aplicarEvento(cur, ev) };
  return cur;
}

// Campos que mudam com os eventos (são os que vão para o Firestore)
export function camposEstado(l) {
  const base = { status: l.status || 'ativo', descontoTotal: l.descontoTotal || 0 };
  if (l.tipo === 'parcelado') return { ...base, cronograma: l.cronograma };
  return { ...base, principalAberto: l.principalAberto, proximoVenc: l.proximoVenc, diaVenc: l.diaVenc, jurosParcial: l.jurosParcial || 0, encPago: l.encPago || 0 };
}

// Parte de um pagamento que é "juros" (estimativa usada nos relatórios)
export function parteJuros(l, ev) {
  if (ev.tipo === 'juros') return ev.valor || 0;
  if (ev.tipo === 'parcela' && l.tipo === 'parcelado') {
    const orig = l.cronogramaOrig || l.cronograma;
    const total = orig.reduce((a, p) => a + p.valor, 0);
    const j = Math.max(0, total - l.valor);
    return total > 0 ? r2((ev.valor || 0) * j / total) : 0;
  }
  return 0;
}
