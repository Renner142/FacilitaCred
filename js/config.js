// Tudo que antes era "fixo" no código vive aqui como PADRÃO inicial.
// Depois de configurado em Ajustes, o que vale é o que está salvo no Firestore.

export const ENC_PADRAO = { multaPct: 0, multaFixa: 0, moraPct: 0, moraPeriodo: 'dia', carencia: 0, tetoPct: 0 };

// Lista de permissões. Para criar uma nova, basta incluir aqui e usar can('id') no código
// (e a mesma chave em firestore.rules, se ela precisar ser garantida no servidor).
export const PERMS = [
  { id: 'dados.ver', grupo: 'Dados', rotulo: 'Ver clientes, empréstimos e pagamentos' },
  { id: 'clientes.criar', grupo: 'Clientes', rotulo: 'Cadastrar clientes' },
  { id: 'clientes.editar', grupo: 'Clientes', rotulo: 'Editar clientes' },
  { id: 'clientes.excluir', grupo: 'Clientes', rotulo: 'Excluir clientes' },
  { id: 'emprestimos.criar', grupo: 'Empréstimos', rotulo: 'Registrar empréstimos' },
  { id: 'emprestimos.editar', grupo: 'Empréstimos', rotulo: 'Editar encargos, observações e campos' },
  { id: 'emprestimos.excluir', grupo: 'Empréstimos', rotulo: 'Excluir empréstimos' },
  { id: 'pagamentos.registrar', grupo: 'Pagamentos', rotulo: 'Registrar pagamentos e prorrogações' },
  { id: 'pagamentos.estornar', grupo: 'Pagamentos', rotulo: 'Estornar pagamentos' },
  { id: 'ajustes.editar', grupo: 'Sistema', rotulo: 'Alterar ajustes, ver auditoria e fazer backup' },
  { id: 'usuarios.gerenciar', grupo: 'Sistema', rotulo: 'Criar e bloquear usuários' }
];

// O papel "admin" sempre pode tudo e não aparece aqui. Estes são só pontos de partida.
export const PAPEIS_PADRAO = {
  operador: {
    nome: 'Operador',
    perm: {
      'dados.ver': true, 'clientes.criar': true, 'clientes.editar': true,
      'emprestimos.criar': true, 'emprestimos.editar': true, 'pagamentos.registrar': true
    }
  },
  consulta: { nome: 'Somente consulta', perm: { 'dados.ver': true } }
};

export const CONFIG_PADRAO = {
  empresa: { nome: 'Caderneta', documento: '', telefone: '', endereco: '' },
  regional: { locale: 'pt-BR', moeda: 'BRL', ddi: '55' },
  agenda: { dias: 7 },
  encargos: { ...ENC_PADRAO },
  // Modelos prontos para preencher o formulário de empréstimo. Editáveis em Ajustes.
  modalidades: [
    {
      id: 'parcelado-mensal', nome: 'Parcelado mensal', base: 'parcelado', taxa: null, parcelas: 10,
      periodo: { unidade: 'mes', passo: 1 }, calculo: 'simples', tarifaPct: 0, tarifaFixa: 0, encargos: null
    },
    {
      id: 'juros-mensal', nome: 'Juros mensais (principal livre)', base: 'juros', taxa: null, parcelas: null,
      periodo: { unidade: 'mes', passo: 1 }, calculo: 'simples', tarifaPct: 0, tarifaFixa: 0, encargos: null
    },
    {
      id: 'parcelado-semanal', nome: 'Parcelado semanal', base: 'parcelado', taxa: null, parcelas: 8,
      periodo: { unidade: 'semana', passo: 1 }, calculo: 'simples', tarifaPct: 0, tarifaFixa: 0, encargos: null
    }
  ],
  // Campos extras que o administrador cria. Ex.: { id, rotulo, tipo: 'texto'|'numero'|'data'|'lista'|'area', opcoes: [], obrigatorio }
  camposCliente: [],
  camposEmprestimo: [],
  // Variáveis: {nome} {primeiroNome} {valor} {encargos} {total} {rotulo} {vencimento} {dias} {empresa} {encargosTxt}
  mensagens: {
    lembrete: 'Olá, {primeiroNome}! Passando para lembrar do pagamento de {valor} ({rotulo}), com vencimento em {vencimento}.',
    hoje: 'Olá, {primeiroNome}! Hoje vence o pagamento de {valor} ({rotulo}). Qualquer dúvida, é só chamar.',
    atraso: 'Olá, {primeiroNome}! O pagamento de {valor} ({rotulo}) venceu em {vencimento} e está atrasado há {dias} dia(s).{encargosTxt} Podemos combinar o pagamento?',
    recibo: 'Obrigado pelo pagamento!'
  }
};

// Mescla objetos simples em profundidade; listas e valores simples do "extra" substituem o padrão.
export function mesclar(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra === undefined ? base : extra;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(extra)) {
    const b = base?.[k], e = extra[k];
    out[k] = (b && typeof b === 'object' && !Array.isArray(b) && e && typeof e === 'object' && !Array.isArray(e)) ? mesclar(b, e) : e;
  }
  return out;
}
