// Campos personalizados (definidos em Ajustes) e o bloco de encargos, usados em vários formulários
import { esc, nf, fmtData } from './util.js';
import { ENC_PADRAO } from './config.js';
import { descEncargos } from './calc.js';

export const TIPOS_CAMPO = { texto: 'Texto curto', area: 'Texto longo', numero: 'Número', data: 'Data', lista: 'Lista de opções' };

export function camposHTML(defs, vals = {}, ro = false) {
  return (defs || []).map(d => {
    const n = 'x_' + d.id, v = vals?.[d.id] ?? '';
    const req = d.obrigatorio ? 'required' : '', dis = ro ? 'disabled' : '';
    let inp;
    if (d.tipo === 'lista') {
      inp = `<select name="${n}" ${req} ${dis}><option value="">—</option>${(d.opcoes || []).map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else if (d.tipo === 'area') {
      inp = `<textarea name="${n}" rows="2" ${req} ${dis}>${esc(v)}</textarea>`;
    } else {
      const tipo = d.tipo === 'numero' ? 'number' : d.tipo === 'data' ? 'date' : 'text';
      inp = `<input name="${n}" type="${tipo}" ${d.tipo === 'numero' ? 'step="any"' : ''} value="${esc(v)}" ${req} ${dis}>`;
    }
    return `<label>${esc(d.rotulo)}${d.obrigatorio ? ' *' : ''}${inp}</label>`;
  }).join('');
}

export function lerCampos(defs, f) {
  const o = {};
  (defs || []).forEach(d => {
    const el = f.elements['x_' + d.id];
    if (!el) return;
    const v = el.value.trim();
    if (v !== '') o[d.id] = d.tipo === 'numero' ? Number(v) : v;
  });
  return o;
}

// Mostra os valores preenchidos (para telas de detalhe)
export function camposResumo(defs, vals = {}) {
  const itens = (defs || []).filter(d => vals?.[d.id] !== undefined && vals[d.id] !== '').map(d => {
    const v = d.tipo === 'data' ? fmtData(vals[d.id]) : d.tipo === 'numero' ? nf(vals[d.id]) : vals[d.id];
    return `<div><dt>${esc(d.rotulo)}</dt><dd>${esc(v)}</dd></div>`;
  });
  return itens.length ? `<dl class="fatos" style="margin-top:14px">${itens.join('')}</dl>` : '';
}

/* ---------- encargos de atraso ---------- */
export function blocoEncargos(c, aberto = false) {
  const v = n => esc(c[n] ?? 0);
  return `<details class="enc" ${aberto ? 'open' : ''}>
    <summary>Multa e mora por atraso <small>${esc(descEncargos({ ...ENC_PADRAO, ...c }))}</small></summary>
    <div class="dupla">
      <label>Multa (% do valor em atraso)<input name="multaPct" type="number" step="0.01" min="0" inputmode="decimal" value="${v('multaPct')}"></label>
      <label>Multa fixa (por parcela ou período atrasado)<input name="multaFixa" type="number" step="0.01" min="0" inputmode="decimal" value="${v('multaFixa')}"></label>
    </div>
    <div class="dupla">
      <label>Juros de mora (%)<input name="moraPct" type="number" step="0.001" min="0" inputmode="decimal" value="${v('moraPct')}"></label>
      <label>A mora é cobrada
        <select name="moraPeriodo">
          <option value="dia" ${c.moraPeriodo !== 'mes' ? 'selected' : ''}>ao dia</option>
          <option value="mes" ${c.moraPeriodo === 'mes' ? 'selected' : ''}>ao mês (calculada por dia)</option>
        </select></label>
    </div>
    <div class="dupla">
      <label>Carência (dias de atraso sem cobrar)<input name="carencia" type="number" step="1" min="0" inputmode="numeric" value="${v('carencia')}"></label>
      <label>Teto (% do valor, 0 = sem teto)<input name="tetoPct" type="number" step="0.01" min="0" inputmode="decimal" value="${v('tetoPct')}"></label>
    </div>
    <p class="ajuda">A multa é cobrada uma vez por parcela (ou período de juros) atrasada. A mora cresce a cada dia sobre o que falta pagar. Deixe tudo em 0 para não cobrar.</p>
  </details>`;
}

export function lerEncargos(f) {
  const n = k => Math.max(0, parseFloat(f.elements[k].value) || 0);
  return {
    multaPct: n('multaPct'), multaFixa: n('multaFixa'), moraPct: n('moraPct'),
    moraPeriodo: f.elements.moraPeriodo.value === 'mes' ? 'mes' : 'dia',
    carencia: Math.round(n('carencia')), tetoPct: n('tetoPct')
  };
}
