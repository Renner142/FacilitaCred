import { $, esc } from './util.js';
import { S, msgErro } from './state.js';

export const dlg = $('#dlg');

let tt;
export function toast(m) {
  const t = $('#toast');
  t.textContent = m;
  t.classList.add('on');
  clearTimeout(tt);
  tt = setTimeout(() => t.classList.remove('on'), 4200);
}

export function abrirModal(titulo, corpo, largo = false) {
  dlg.innerHTML = `<div class="dlg-head"><h2>${esc(titulo)}</h2><button type="button" class="icone" data-fechar aria-label="Fechar">×</button></div><div class="dlg-body">${corpo}</div>`;
  dlg.classList.toggle('largo', largo);
  if (!dlg.open) dlg.showModal();
}
export function fecharModal() { S.detalheId = null; if (dlg.open) dlg.close(); }
dlg.addEventListener('click', e => { if (e.target.closest('[data-fechar]') || e.target === dlg) fecharModal(); });
dlg.addEventListener('close', () => { S.detalheId = null; });

// Liga o envio de um formulário dentro da janela, com bloqueio do botão e mensagem de erro
export function ligarForm(sel, fn) {
  const f = $(sel, dlg);
  if (!f) return;
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]');
    const er = f.querySelector('.erro');
    if (er) er.textContent = '';
    if (btn) btn.disabled = true;
    try { await fn(new FormData(f), f); }
    catch (err) { if (er) er.textContent = msgErro(err); else toast(msgErro(err)); }
    finally { if (btn) btn.disabled = false; }
  });
}

// Abre uma janela só com o documento (recibo, extrato) e chama a impressão
export function imprimir(titulo, corpo) {
  const w = window.open('', '_blank');
  if (!w) { toast('O navegador bloqueou a janela. Permita pop-ups para este site e tente de novo.'); return; }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;max-width:720px;margin:24px auto;padding:0 20px;line-height:1.5}
  header{border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:18px}
  h1{font-size:1.5rem;letter-spacing:.08em;text-align:center;margin:18px 0 6px}
  h2{font-size:1.05rem;margin:22px 0 6px}
  .valor{font-size:2rem;font-weight:700;text-align:center;margin:6px 0 20px}
  table{width:100%;border-collapse:collapse;font-size:.92rem}
  th,td{border-bottom:1px solid #ccc;padding:6px 8px;text-align:left}
  th.n,td.n{text-align:right}
  .ass{margin-top:60px;text-align:center}
  dl{display:grid;grid-template-columns:auto 1fr;gap:4px 18px}
  dt{color:#555} dd{margin:0;font-weight:600}
  @media print{body{margin:0}}
</style></head><body>${corpo}</body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 300);
}
