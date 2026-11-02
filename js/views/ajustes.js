import { esc, nf, uid, csvTexto, numCsv, baixar, hoje, getLocale } from '../util.js';
import { CONFIG_PADRAO, ENC_PADRAO } from '../config.js';
import { UNIDADES, descEncargos, taxaRotulo } from '../calc.js';
import { TIPOS_CAMPO, blocoEncargos, lerEncargos } from '../campos.js';
import { dlg, abrirModal, fecharModal, ligarForm, toast } from '../modal.js';
import {
  db, collection, doc, getDocs, setDoc, query, orderBy, limit
} from '../firebase.js';
import { S, ui, acoes, mudancas, envios, views, aoEntrar, can, log, msgErro } from '../state.js';

const ABAS = [
  ['empresa', 'Empresa e região'], ['modalidades', 'Modalidades'], ['encargos', 'Multa e mora'],
  ['campos', 'Campos personalizados'], ['mensagens', 'Mensagens'], ['dados', 'Dados e backup'], ['auditoria', 'Auditoria']
];

// Grava só as chaves informadas em config/geral (as demais ficam como estão)
async function salvarConfig(parcial, descricao) {
  await setDoc(doc(db, 'config', 'geral'), parcial, { merge: true });
  log('ajustes', descricao);
  toast('Ajustes salvos.');
}

/* =========================================================
   Listas editáveis (modalidades e campos personalizados)
   Para criar outra lista configurável, basta incluir um item aqui.
   ========================================================= */
const selUnidade = v => Object.entries(UNIDADES).map(([k, u]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${u.taxa}</option>`).join('');
const num = (f, n) => { const v = parseFloat(f.elements[n].value); return Number.isFinite(v) ? v : null; };

const LISTAS = {
  modalidades: {
    titulo: 'Modalidade', novo: () => ({ id: uid(), nome: '', base: 'parcelado', taxa: null, parcelas: 10, periodo: { unidade: 'mes', passo: 1 }, calculo: 'simples', tarifaPct: 0, tarifaFixa: 0, encargos: null }),
    linha: m => `<b>${esc(m.nome)}</b><br><small>${m.base === 'parcelado' ? `Parcelado${m.parcelas ? `, ${m.parcelas}x` : ''}` : 'Juros periódicos'}${m.taxa != null ? `, ${nf(m.taxa)}% ${taxaRotulo(m.periodo)}` : ''}${m.encargos ? ', encargos próprios' : ''}</small>`,
    form: m => `
      <label>Nome do modelo<input name="nome" required value="${esc(m.nome)}"></label>
      <div class="dupla">
        <label>Tipo<select name="base"><option value="parcelado" ${m.base === 'parcelado' ? 'selected' : ''}>Parcelado</option><option value="juros" ${m.base === 'juros' ? 'selected' : ''}>Juros periódicos</option></select></label>
        <label>Taxa de juros (%) — deixe vazio para digitar em cada empréstimo<input name="taxa" type="number" step="0.01" min="0" value="${m.taxa ?? ''}"></label>
      </div>
      <div class="trio">
        <label>Cobrada<select name="unidade">${selUnidade(m.periodo?.unidade)}</select></label>
        <label>A cada (períodos)<input name="passo" type="number" min="1" step="1" value="${m.periodo?.passo || 1}"></label>
        <label>Nº de parcelas<input name="parcelas" type="number" min="1" step="1" value="${m.parcelas ?? ''}"></label>
      </div>
      <div class="trio">
        <label>Cálculo<select name="calculo">${[['simples', 'Juros simples'], ['price', 'Tabela Price'], ['sac', 'SAC']].map(([k, t]) => `<option value="${k}" ${m.calculo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Tarifa de abertura (%)<input name="tarifaPct" type="number" step="0.01" min="0" value="${m.tarifaPct || 0}"></label>
        <label>Tarifa fixa<input name="tarifaFixa" type="number" step="0.01" min="0" value="${m.tarifaFixa || 0}"></label>
      </div>
      <label class="check"><input type="checkbox" name="encPropria" ${m.encargos ? 'checked' : ''}> Usar multa e mora próprias (senão vale o padrão do sistema)</label>
      ${blocoEncargos({ ...ENC_PADRAO, ...(S.cfg.encargos || {}), ...(m.encargos || {}) })}`,
    ler: (f, m) => ({
      ...m, nome: f.elements.nome.value.trim(), base: f.elements.base.value, taxa: num(f, 'taxa'),
      parcelas: parseInt(f.elements.parcelas.value, 10) || null,
      periodo: { unidade: f.elements.unidade.value, passo: Math.max(1, parseInt(f.elements.passo.value, 10) || 1) },
      calculo: f.elements.calculo.value, tarifaPct: num(f, 'tarifaPct') || 0, tarifaFixa: num(f, 'tarifaFixa') || 0,
      encargos: f.elements.encPropria.checked ? lerEncargos(f) : null
    })
  },
  camposCliente: campos('Campo de cliente'),
  camposEmprestimo: campos('Campo de empréstimo')
};

function campos(titulo) {
  return {
    titulo, novo: () => ({ id: uid(), rotulo: '', tipo: 'texto', opcoes: [], obrigatorio: false }),
    linha: d => `<b>${esc(d.rotulo)}</b><br><small>${esc(TIPOS_CAMPO[d.tipo] || d.tipo)}${d.tipo === 'lista' ? `: ${esc((d.opcoes || []).join(', '))}` : ''}${d.obrigatorio ? ' · obrigatório' : ''}</small>`,
    form: d => `
      <label>Nome do campo<input name="rotulo" required value="${esc(d.rotulo)}" placeholder="Ex.: Profissão, Indicado por, Garantia"></label>
      <label>Tipo<select name="tipo">${Object.entries(TIPOS_CAMPO).map(([k, t]) => `<option value="${k}" ${d.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Opções da lista (uma por linha, só para o tipo "Lista de opções")<textarea name="opcoes" rows="4">${esc((d.opcoes || []).join('\n'))}</textarea></label>
      <label class="check"><input type="checkbox" name="obrigatorio" ${d.obrigatorio ? 'checked' : ''}> Preenchimento obrigatório</label>`,
    ler: (f, d) => ({
      ...d, rotulo: f.elements.rotulo.value.trim(), tipo: f.elements.tipo.value,
      opcoes: f.elements.opcoes.value.split('\n').map(x => x.trim()).filter(Boolean), obrigatorio: f.elements.obrigatorio.checked
    })
  };
}

function editarItem(chave, i) {
  const L = LISTAS[chave];
  const lista = [...(S.cfg[chave] || [])];
  const item = i === '' || i == null ? L.novo() : lista[Number(i)];
  abrirModal(`${i === '' || i == null ? 'Novo' : 'Editar'}: ${L.titulo.toLowerCase()}`, `<form id="f">${L.form(item)}
    <p class="erro" role="alert"></p>
    <div class="acoes"><span class="espaco"></span><button type="button" data-fechar>Cancelar</button><button class="primario" type="submit">Salvar</button></div></form>`, true);
  ligarForm('#f', async (fd, f) => {
    const novo = L.ler(f, item);
    if (chave === 'modalidades' && !novo.nome) throw new Error('Informe o nome do modelo.');
    if (chave !== 'modalidades' && !novo.rotulo) throw new Error('Informe o nome do campo.');
    if (novo.tipo === 'lista' && !novo.opcoes?.length) throw new Error('Informe pelo menos uma opção para a lista.');
    if (i === '' || i == null) lista.push(novo); else lista[Number(i)] = novo;
    await salvarConfig({ [chave]: lista }, `${chave}: ${novo.nome || novo.rotulo}`);
    fecharModal();
  });
}

function blocoLista(chave, titulo, ajuda) {
  const L = LISTAS[chave];
  const itens = S.cfg[chave] || [];
  return `<h2>${esc(titulo)}</h2><p class="ajuda">${esc(ajuda)}</p>
    ${itens.length ? `<ul class="lista-edit">${itens.map((it, i) => `<li><div class="txt">${L.linha(it)}</div>
      <div class="bt">
        <button class="peq" data-acao="lista-mover" data-lista="${chave}" data-i="${i}" data-dir="-1" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="peq" data-acao="lista-mover" data-lista="${chave}" data-i="${i}" data-dir="1" aria-label="Descer" ${i === itens.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="peq" data-acao="lista-editar" data-lista="${chave}" data-i="${i}">Editar</button>
        <button class="peq perigo" data-acao="lista-remover" data-lista="${chave}" data-i="${i}">Remover</button>
      </div></li>`).join('')}</ul>` : '<p class="vazio">Nada cadastrado ainda.</p>'}
    <p><button class="primario" data-acao="lista-novo" data-lista="${chave}">Adicionar</button></p>`;
}

acoes['lista-novo'] = ds => editarItem(ds.lista, '');
acoes['lista-editar'] = ds => editarItem(ds.lista, ds.i);
acoes['lista-remover'] = async ds => {
  const lista = [...S.cfg[ds.lista]];
  const it = lista[Number(ds.i)];
  if (!confirm(`Remover "${it.nome || it.rotulo}"? Empréstimos e clientes que já usam isso não são alterados.`)) return;
  lista.splice(Number(ds.i), 1);
  try { await salvarConfig({ [ds.lista]: lista }, `${ds.lista}: removido`); } catch (e) { toast(msgErro(e)); }
};
acoes['lista-mover'] = async ds => {
  const lista = [...S.cfg[ds.lista]], i = Number(ds.i), j = i + Number(ds.dir);
  if (j < 0 || j >= lista.length) return;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  try { await salvarConfig({ [ds.lista]: lista }, `${ds.lista}: reordenado`); } catch (e) { toast(msgErro(e)); }
};

/* =========================================================
   Abas
   ========================================================= */
const MOEDAS = ['BRL', 'USD', 'EUR', 'ARS', 'CLP', 'COP', 'MXN', 'PYG', 'UYU', 'GBP'];
const IDIOMAS = [['pt-BR', 'Português (Brasil)'], ['pt-PT', 'Português (Portugal)'], ['en-US', 'English (US)'], ['es-ES', 'Español (España)'], ['es-AR', 'Español (Argentina)'], ['es-MX', 'Español (México)']];

function abaEmpresa() {
  const e = S.cfg.empresa, r = S.cfg.regional;
  return `<h2 style="margin-top:0">Dados da empresa</h2>
  <p class="ajuda">Aparecem no topo do sistema, nos recibos e nos extratos.</p>
  <form id="f-empresa" class="form-inline">
    <div class="dupla"><label>Nome<input name="nome" required value="${esc(e.nome)}"></label><label>CNPJ / CPF<input name="documento" value="${esc(e.documento)}"></label></div>
    <div class="dupla"><label>Telefone<input name="telefone" value="${esc(e.telefone)}"></label><label>Endereço<input name="endereco" value="${esc(e.endereco)}"></label></div>
    <h2>Região e agenda</h2>
    <div class="trio">
      <label>Idioma dos números e datas<select name="locale">${IDIOMAS.map(([k, t]) => `<option value="${k}" ${r.locale === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Moeda<input name="moeda" list="moedas" value="${esc(r.moeda)}" maxlength="3" required><datalist id="moedas">${MOEDAS.map(m => `<option value="${m}">`).join('')}</datalist></label>
      <label>Código do país no WhatsApp<input name="ddi" value="${esc(r.ddi)}" inputmode="numeric"></label>
    </div>
    <label style="max-width:320px">Dias exibidos na agenda de cobranças<input name="dias" type="number" min="0" max="365" value="${S.cfg.agenda.dias}"></label>
    <h2>Códigos</h2>
    <p class="ajuda">Cada cliente e cada empréstimo recebe um número (ex.: C-0001, E-0001). Mudar o texto muda só a exibição, não os números.</p>
    <div class="trio">
      <label>Prefixo do cliente<input name="prefixoCliente" maxlength="4" value="${esc(S.cfg.codigos?.prefixoCliente ?? 'C')}"></label>
      <label>Prefixo do empréstimo<input name="prefixoEmprestimo" maxlength="4" value="${esc(S.cfg.codigos?.prefixoEmprestimo ?? 'E')}"></label>
      <label>Quantidade de dígitos<input name="digitos" type="number" min="1" max="8" value="${S.cfg.codigos?.digitos ?? 4}"></label>
    </div>
    <p class="erro" role="alert"></p>
    <button class="primario" type="submit">Salvar</button>
  </form>`;
}
envios['f-empresa'] = async fd => {
  const moeda = fd.get('moeda').trim().toUpperCase();
  try { new Intl.NumberFormat(fd.get('locale'), { style: 'currency', currency: moeda }); } catch { throw new Error('Código de moeda inválido. Use 3 letras, como BRL ou USD.'); }
  await salvarConfig({
    empresa: { nome: fd.get('nome').trim(), documento: fd.get('documento').trim(), telefone: fd.get('telefone').trim(), endereco: fd.get('endereco').trim() },
    regional: { locale: fd.get('locale'), moeda, ddi: fd.get('ddi').trim() },
    agenda: { dias: Math.max(0, parseInt(fd.get('dias'), 10) || 0) },
    codigos: {
      prefixoCliente: fd.get('prefixoCliente').trim().toUpperCase() || 'C',
      prefixoEmprestimo: fd.get('prefixoEmprestimo').trim().toUpperCase() || 'E',
      digitos: Math.min(8, Math.max(1, parseInt(fd.get('digitos'), 10) || 4))
    }
  }, 'empresa e região');
};

function abaEncargos() {
  return `<h2 style="margin-top:0">Multa e mora (padrão do sistema)</h2>
  <p class="ajuda">Já vem preenchido ao registrar um empréstimo novo e pode ser mudado em cada um. Hoje: ${esc(descEncargos({ ...ENC_PADRAO, ...S.cfg.encargos }))}</p>
  <form id="f-encargos" class="form-inline">${blocoEncargos({ ...ENC_PADRAO, ...S.cfg.encargos }, true)}
    <p class="erro" role="alert"></p><button class="primario" type="submit">Salvar padrão</button></form>`;
}
envios['f-encargos'] = (fd, f) => salvarConfig({ encargos: lerEncargos(f) }, 'multa e mora padrão');

function abaMensagens() {
  const m = S.cfg.mensagens;
  const campo = (k, t) => `<label>${t}<textarea name="${k}" rows="3">${esc(m[k])}</textarea></label>`;
  return `<h2 style="margin-top:0">Mensagens</h2>
  <p class="ajuda">Textos usados no botão de WhatsApp e nos recibos. Variáveis disponíveis (escreva entre chaves): <code>{nome}</code> <code>{primeiroNome}</code> <code>{valor}</code> <code>{encargos}</code> <code>{total}</code> <code>{rotulo}</code> <code>{vencimento}</code> <code>{dias}</code> <code>{empresa}</code> <code>{encargosTxt}</code></p>
  <form id="f-mensagens" class="form-inline">
    ${campo('lembrete', 'Lembrete (antes do vencimento)')}${campo('hoje', 'Vence hoje')}${campo('atraso', 'Em atraso')}${campo('recibo', 'Rodapé do recibo')}
    <p class="erro" role="alert"></p>
    <button class="primario" type="submit">Salvar mensagens</button>
    <button type="button" data-acao="msg-padrao">Voltar ao texto original</button>
  </form>`;
}
envios['f-mensagens'] = fd => salvarConfig({ mensagens: { lembrete: fd.get('lembrete'), hoje: fd.get('hoje'), atraso: fd.get('atraso'), recibo: fd.get('recibo') } }, 'mensagens');
acoes['msg-padrao'] = async () => {
  if (!confirm('Voltar todas as mensagens ao texto original?')) return;
  try { await salvarConfig({ mensagens: CONFIG_PADRAO.mensagens }, 'mensagens (padrão)'); } catch (e) { toast(msgErro(e)); }
};

function abaDados() {
  return `<h2 style="margin-top:0">Dados e backup</h2>
  <p class="ajuda">Baixe uma cópia dos dados de vez em quando e guarde em local seguro. O backup completo (JSON) tem tudo: clientes, empréstimos, pagamentos e ajustes.</p>
  <p><button class="primario" data-acao="bkp-json">Baixar backup completo (JSON)</button></p>
  <p><button data-acao="exp-clientes">Planilha de clientes (CSV)</button>
     <button data-acao="exp-emprestimos">Planilha de empréstimos (CSV)</button>
     <button data-acao="exp-pagamentos">Planilha de todos os pagamentos (CSV)</button></p>`;
}
async function todosPagamentos() {
  const s = await getDocs(collection(db, 'pagamentos'));
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}
const limpar = o => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === 'object' && 'seconds' in v && 'nanoseconds' in v) ? new Date(v.seconds * 1000).toISOString() : v));
acoes['bkp-json'] = async () => {
  try {
    const pagamentos = await todosPagamentos();
    baixar(`backup_${hoje()}.json`, JSON.stringify(limpar({ geradoEm: new Date().toISOString(), config: S.cfgRaw, papeis: S.papeisRaw, clientes: S.clientes, emprestimos: S.emprestimos, pagamentos }), null, 1), 'application/json');
    log('backup', 'json');
  } catch (e) { toast(msgErro(e)); }
};
acoes['exp-clientes'] = () => {
  const defs = S.cfg.camposCliente;
  const linhas = [['Nome', 'Telefone', 'Documento', 'Endereço', 'Observações', ...defs.map(d => d.rotulo)]];
  S.clientes.forEach(c => linhas.push([c.nome, c.telefone, c.documento, c.endereco, c.obs, ...defs.map(d => c.extras?.[d.id] ?? '')]));
  baixar(`clientes_${hoje()}.csv`, csvTexto(linhas));
};
acoes['exp-emprestimos'] = () => {
  const defs = S.cfg.camposEmprestimo;
  const linhas = [['Cliente', 'Modalidade', 'Tipo', 'Valor', 'Taxa %', 'Data', 'Situação', 'Desconto', 'Tarifa', 'Observações', ...defs.map(d => d.rotulo)]];
  S.emprestimos.forEach(l => linhas.push([l.clienteNome, l.modalidade, l.tipo, numCsv(l.valor), numCsv(l.taxa), l.dataInicio, l.status, numCsv(l.descontoTotal), numCsv(l.tarifa), l.obs, ...defs.map(d => l.extras?.[d.id] ?? '')]));
  baixar(`emprestimos_${hoje()}.csv`, csvTexto(linhas));
};
acoes['exp-pagamentos'] = async () => {
  try {
    const ps = (await todosPagamentos()).sort((a, b) => (a.data || '').localeCompare(b.data || ''));
    const linhas = [['Data', 'Cliente', 'Tipo', 'Valor', 'Multa e mora', 'Observação']];
    ps.forEach(p => linhas.push([p.data, p.clienteNome, p.tipo, numCsv(p.valor), numCsv(p.encargos), p.obs || '']));
    baixar(`pagamentos_${hoje()}.csv`, csvTexto(linhas));
  } catch (e) { toast(msgErro(e)); }
};

function abaAuditoria() {
  return `<h2 style="margin-top:0">Auditoria</h2><p class="ajuda">As 100 ações mais recentes: quem fez o quê e quando.</p>
  ${S.auditoria.length ? `<div class="rolagem"><table><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
    ${S.auditoria.map(a => `<tr><td>${a.ts?.seconds ? new Date(a.ts.seconds * 1000).toLocaleString(getLocale()) : '—'}</td><td>${esc(a.usuario)}</td><td>${esc(a.acao)}</td><td>${esc(a.detalhe)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="vazio">Nada registrado ainda.</p>'}`;
}
async function carregarAuditoria() {
  try {
    const s = await getDocs(query(collection(db, 'auditoria'), orderBy('ts', 'desc'), limit(100)));
    S.auditoria = s.docs.map(d => d.data());
  } catch (e) { toast(msgErro(e)); }
  ui.render(true);
}
aoEntrar.ajustes = () => { if (S.ajustesAba === 'auditoria') carregarAuditoria(); };

/* =========================================================
   Tela
   ========================================================= */
views.ajustes = function renderAjustes() {
  if (!can('ajustes.editar')) return '<p class="vazio">Você não tem acesso a esta tela.</p>';
  const corpo = {
    empresa: abaEmpresa, encargos: abaEncargos, mensagens: abaMensagens, dados: abaDados, auditoria: abaAuditoria,
    modalidades: () => blocoLista('modalidades', 'Modalidades de empréstimo', 'Modelos que preenchem o formulário de novo empréstimo (tipo, taxa, período, parcelas, cálculo, tarifa e encargos). Nada impede de ajustar na hora.'),
    campos: () => blocoLista('camposCliente', 'Campos extras do cliente', 'Informações que só o seu negócio precisa, como profissão, indicação ou referência.')
      + blocoLista('camposEmprestimo', 'Campos extras do empréstimo', 'Por exemplo garantia, finalidade ou número do contrato.')
  }[S.ajustesAba] || abaEmpresa;
  return `<h1>Ajustes</h1>
  <div class="abas" role="tablist">${ABAS.map(([k, t]) => `<button role="tab" data-acao="aba" data-aba="${k}" aria-selected="${S.ajustesAba === k}">${t}</button>`).join('')}</div>
  <div class="aba-corpo">${corpo()}</div>`;
};
acoes.aba = ds => { S.ajustesAba = ds.aba; if (ds.aba === 'auditoria') carregarAuditoria(); else ui.render(true); };
