// Funções utilitárias sem dependência de Firebase

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
export const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid();

/* ---------- formatação (idioma e moeda configuráveis) ---------- */
let _loc = 'pt-BR';
let _moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function setRegional({ locale = 'pt-BR', moeda = 'BRL' } = {}) {
  try { _moeda = new Intl.NumberFormat(locale, { style: 'currency', currency: moeda }); _loc = locale; }
  catch { /* mantém a formatação anterior */ }
}
export const getLocale = () => _loc;
export const money = n => _moeda.format(n || 0);
export const nf = (n, max = 3) => Number(n || 0).toLocaleString(_loc, { maximumFractionDigits: max });
export const numCsv = n => Number(n || 0).toLocaleString(_loc, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

/* ---------- datas (sempre em texto AAAA-MM-DD) ---------- */
export const toISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const hoje = () => toISO(new Date());
export const fmtData = s => s ? parseISO(s).toLocaleDateString(_loc) : '—';
export const diasEntre = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
export const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };

// Soma meses mantendo o dia de vencimento (dia 31 vira 28/29/30 nos meses curtos)
export function addMonths(iso, n, ancora) {
  const d = parseISO(iso);
  const primeiro = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const ultimo = new Date(primeiro.getFullYear(), primeiro.getMonth() + 1, 0).getDate();
  return toISO(new Date(primeiro.getFullYear(), primeiro.getMonth(), Math.min(ancora || d.getDate(), ultimo)));
}

export function intervalo(tipo) {
  const h = new Date(), y = h.getFullYear(), m = h.getMonth();
  const f = (a, b) => ({ ini: toISO(a), fim: toISO(b) });
  if (tipo === 'mesPassado') return f(new Date(y, m - 1, 1), new Date(y, m, 0));
  if (tipo === '3meses') return f(new Date(y, m - 2, 1), new Date(y, m + 1, 0));
  if (tipo === 'ano') return f(new Date(y, 0, 1), new Date(y, 11, 31));
  return f(new Date(y, m, 1), new Date(y, m + 1, 0));
}
export const intervaloMes = () => intervalo('mes');

/* ---------- textos e arquivos ---------- */
// Troca {variavel} pelo valor; variáveis desconhecidas ficam como estão
export const preencher = (tpl, vars) => String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

export function csvTexto(linhas) {
  const q = c => { const s = String(c ?? ''); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '\ufeff' + linhas.map(l => l.map(q).join(';')).join('\r\n');
}
export function baixar(nome, texto, tipo = 'text/csv;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
  a.download = nome;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
