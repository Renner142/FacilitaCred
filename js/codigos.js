// Códigos legíveis (C-0001, E-0001). O número vem de um contador no Firestore,
// gravado na mesma transação que cria o registro, então nunca se repete.
import { esc } from './util.js';
import { S } from './state.js';
import { db, doc, collection, runTransaction } from './firebase.js';

const cfg = () => ({ prefixoCliente: 'C', prefixoEmprestimo: 'E', digitos: 4, ...(S.cfg.codigos || {}) });
const fmt = (pre, n, dig) => n ? `${pre}-${String(n).padStart(dig, '0')}` : '';

export const codCliente = c => fmt(cfg().prefixoCliente, c?.codigo, cfg().digitos);
export const codEmprestimo = l => fmt(cfg().prefixoEmprestimo, l?.codigo, cfg().digitos);
export const badge = txt => txt ? `<span class="cod">${esc(txt)}</span>` : '';

// colecao: 'clientes' | 'emprestimos'   contador: 'cliente' | 'emprestimo'
export async function criarComCodigo(colecao, contador, dados) {
  const ctr = doc(db, 'config', 'contadores');
  const novo = doc(collection(db, colecao));
  await runTransaction(db, async tx => {
    const s = await tx.get(ctr);
    const n = (s.exists() ? s.data()[contador] || 0 : 0) + 1;
    tx.set(ctr, { [contador]: n }, { merge: true });
    tx.set(novo, { ...dados, codigo: n });
  });
  return novo;
}
