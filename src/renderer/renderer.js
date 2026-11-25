'use strict';

// ---------- utilidades ----------
function h(tag, props, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f.nodeType ? f : document.createTextNode(String(f)));
  return e;
}
const $ = (sel) => document.querySelector(sel);
const vazio = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

let avisoTimer = null;
function aviso(texto, tipo = '', ms = 6000) {
  const a = $('#aviso');
  a.className = 'aviso ' + tipo;
  a.textContent = texto;
  clearTimeout(avisoTimer);
  if (ms) avisoTimer = setTimeout(() => a.classList.add('oculto'), ms);
}

async function chamar(promessa) {
  const r = await promessa;
  if (!r.ok) { aviso(r.erro, 'erro', 9000); return undefined; }
  return r.dados;
}

const dataBR = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

// ---------- estado da tela ----------
const S = { ajustes: null, planilha: null, config: {}, modelos: [], aba: 'enviar', enviando: false };

function irPara(aba) {
  S.aba = aba;
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  document.querySelectorAll('main > section').forEach((s) => s.classList.toggle('oculto', s.id !== 'aba-' + aba));
  desenhar(aba);
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.aba)));

async function carregarBase() {
  S.ajustes = await chamar(window.api.ajustes.ler());
  if (S.ajustes && S.ajustes.pronto) {
    const p = await chamar(window.api.planilha.estado());
    if (p) { S.planilha = p.resumo; S.config = p.config || {}; S.modelos = S.config.modelos || []; }
  }
  $('#rodape-menu').textContent = S.ajustes ? `${S.ajustes.operador || 'sem nome'} · v${S.ajustes.versao}` : '';
}

async function desenhar(aba) {
  await carregarBase();
  if (!S.ajustes || !S.ajustes.pronto) { if (aba !== 'ajustes') { aviso('Antes de começar: escolha a pasta compartilhada e informe seu nome em Ajustes.', '', 0); return irPara('ajustes'); } }
  const fn = { enviar: telaEnviar, planilha: telaPlanilha, mensagens: telaMensagens, descadastros: telaDescad, historico: telaHistorico, ajustes: telaAjustes }[aba];
  await fn(vazio($('#aba-' + aba)));
}

// ---------- Ajustes ----------
async function telaAjustes(raiz) {
  const a = S.ajustes;
  const nome = h('input', { type: 'text', value: a.operador, placeholder: 'Ex.: Rayan' });
  const limite = h('input', { type: 'number', min: '0', value: a.limiteDiario });
  const intervalo = h('input', { type: 'number', min: '0', step: '100', value: a.intervaloMs });
  raiz.append(
    h('h2', {}, 'Ajustes'),
    h('p', { class: 'sub' }, 'Configure uma vez em cada computador. Todos devem apontar para a MESMA pasta compartilhada.'),
    h('div', { class: 'cartao' },
      h('label', {}, 'Pasta compartilhada (Google Drive, OneDrive, Dropbox...)'),
      h('div', { class: 'linha' },
        h('div', { class: 'cresce' }, h('input', { type: 'text', value: a.pasta, readonly: true, placeholder: 'Nenhuma pasta escolhida' })),
        h('button', { class: 'b', onclick: async () => { const p = await chamar(window.api.ajustes.escolherPasta()); if (p) { aviso('Pasta definida.', 'ok'); irPara('ajustes'); } } }, 'Escolher pasta'),
        a.pasta && h('button', { class: 'b', onclick: () => window.api.abrirPasta() }, 'Abrir')),
      h('p', { class: 'dica' }, 'Aqui ficam a planilha, a lista de descadastros, o histórico de envios e os modelos de mensagem. Cada pessoa grava só no próprio arquivo, então ninguém sobrescreve o trabalho do outro.'),
      h('label', {}, 'Seu nome (aparece no histórico; use um nome diferente em cada computador)'),
      h('div', { class: 'linha' }, h('div', { class: 'cresce' }, nome),
        h('button', { class: 'b principal', onclick: async () => { if (await chamar(window.api.ajustes.salvarOperador(nome.value))) { aviso('Nome salvo.', 'ok'); irPara('ajustes'); } } }, 'Salvar nome'))),
    a.pronto && h('div', { class: 'cartao' },
      h('h3', {}, 'Limites de envio (valem para todos)'),
      h('label', {}, 'Máximo de mensagens por dia, somando todas as pessoas (0 = sem limite)'), limite,
      h('label', {}, 'Pausa entre mensagens, em milissegundos (só no envio real)'), intervalo,
      h('p', { class: 'dica' }, 'O WhatsApp começa com um teto diário de contatos novos e só sobe se a qualidade do número se mantiver boa. Comece baixo.'),
      h('div', { class: 'linha' }, h('button', { class: 'b principal', onclick: async () => { if (await chamar(window.api.ajustes.salvarLimites({ limiteDiario: limite.value, intervaloMs: intervalo.value }))) aviso('Limites salvos.', 'ok'); } }, 'Salvar limites'))));
}

// ---------- Planilha ----------
function adivinhar(headers, re) { return headers.find((x) => re.test(x.normalize('NFD').replace(/[̀-ͯ]/g, ''))) || ''; }

async function telaPlanilha(raiz) {
  const p = S.planilha;
  const mapa = { ...(S.config.mapa || {}) };
  if (p && !mapa.telefone) {
    mapa.telefone = adivinhar(p.headers, /tel|cel|whats|fone|contato/i);
    mapa.nome = mapa.nome || adivinhar(p.headers, /nome|passageir/i);
    mapa.aceite = mapa.aceite || adivinhar(p.headers, /aceit|opt|consent|autoriz/i);
  }
  const url = h('input', { type: 'text', placeholder: 'https://docs.google.com/spreadsheets/d/.../pub?output=csv', value: (S.config.fonte && S.config.fonte.url) || '' });

  raiz.append(h('h2', {}, 'Planilha'), h('p', { class: 'sub' }, 'De onde vêm os contatos. O app confere a planilha a cada 15 segundos e atualiza sozinho.'));
  raiz.append(h('div', { class: 'cartao' },
    h('div', { class: 'linha' },
      h('button', { class: 'b principal', onclick: async () => { const r = await chamar(window.api.planilha.escolherArquivo()); if (r) { aviso('Planilha carregada.', 'ok'); irPara('planilha'); } } }, 'Escolher arquivo (.xlsx ou .csv)'),
      p && h('button', { class: 'b', onclick: async () => { if (await chamar(window.api.planilha.recarregar())) { aviso('Planilha recarregada.', 'ok'); irPara('planilha'); } } }, 'Recarregar agora')),
    h('p', { class: 'dica' }, 'O arquivo é copiado para a pasta compartilhada. Para atualizar, basta SUBSTITUIR esse arquivo lá (mesmo nome): os outros computadores pegam a versão nova sozinhos.'),
    h('label', {}, 'Ou use um link (Google Sheets publicado como CSV, ou outro endereço https)'),
    h('div', { class: 'linha' }, h('div', { class: 'cresce' }, url),
      h('button', { class: 'b', onclick: async () => { if (await chamar(window.api.planilha.definirUrl(url.value))) { aviso('Link carregado.', 'ok'); irPara('planilha'); } } }, 'Usar link'))));

  if (!p) { raiz.append(h('div', { class: 'aviso' }, 'Nenhuma planilha carregada ainda.')); return; }

  const sel = (chave, obrigatorio) => {
    const s = h('select', {}, h('option', { value: '' }, obrigatorio ? '— escolha —' : '— nenhuma —'), p.headers.map((x) => h('option', { value: x, selected: mapa[chave] === x }, x)));
    s.addEventListener('change', () => { mapa[chave] = s.value; });
    return s;
  };
  raiz.append(h('div', { class: 'cartao' },
    h('b', {}, `${p.linhas} linhas`), ` · origem: ${p.origem} · lida em ${dataBR(p.atualizadoEm)}`,
    h('h3', {}, 'Quais colunas usar'),
    h('label', {}, 'Telefone (obrigatório)'), sel('telefone', true),
    h('label', {}, 'Nome (para "Olá, Maria")'), sel('nome', false),
    h('label', {}, 'Aceite de receber mensagens (recomendado)'), sel('aceite', false),
    h('p', { class: 'dica' }, 'Com coluna de aceite, só recebe quem tem "sim" (ou true, 1, aceito). Sem ela, TODOS os números da planilha entram: só use assim se o aceite já estiver garantido de outra forma.'),
    h('div', { class: 'linha' }, h('button', { class: 'b principal', onclick: async () => { if (!mapa.telefone) return aviso('Escolha a coluna do telefone.', 'erro'); if (await chamar(window.api.planilha.salvarMapa(mapa))) aviso('Colunas salvas para todos.', 'ok'); } }, 'Salvar colunas'))));

  raiz.append(h('details', {}, h('summary', {}, 'Ver primeiras linhas'),
    h('table', {}, h('tr', {}, p.headers.map((x) => h('th', {}, x))), p.amostra.map((l) => h('tr', {}, p.headers.map((x) => h('td', {}, l[x])))))));
}

// ---------- Mensagens ----------
async function telaMensagens(raiz) {
  const modelos = JSON.parse(JSON.stringify(S.modelos));
  raiz.append(h('h2', {}, 'Mensagens'), h('p', { class: 'sub' }, 'Modelos de texto das campanhas. Use {{nome}} para o primeiro nome, ou {{nome|passageiro}} para ter um texto padrão quando faltar o nome.'));
  raiz.append(h('div', { class: 'aviso' }, 'No envio real, a mensagem precisa ser um modelo (template) aprovado pela Meta. O texto aqui deve ser igual ao aprovado.'));

  const lista = h('div', {});
  const salvar = async () => { if (await chamar(window.api.modelos.salvar(modelos))) { S.modelos = modelos; aviso('Modelos salvos para todos.', 'ok'); } };
  const desenharLista = () => {
    vazio(lista);
    modelos.forEach((m, i) => {
      const nome = h('input', { type: 'text', value: m.nome, placeholder: 'Nome do modelo (ex.: Campanha local)' });
      const corpo = h('textarea', {}, m.corpo);
      const previa = h('div', { class: 'balao' });
      const atualizar = async () => { m.nome = nome.value; m.corpo = corpo.value; const r = await window.api.envio.previa({ corpo: corpo.value, nome: 'Maria' }); previa.textContent = r.ok ? r.dados : ''; };
      nome.addEventListener('input', atualizar); corpo.addEventListener('input', atualizar); atualizar();
      lista.append(h('div', { class: 'cartao' }, h('label', {}, 'Nome'), nome, h('label', {}, 'Texto'), corpo,
        h('label', {}, 'Prévia (com o nome "Maria")'), previa,
        h('div', { class: 'linha', }, h('button', { class: 'b perigo', onclick: () => { modelos.splice(i, 1); desenharLista(); } }, 'Excluir'))));
    });
    if (!modelos.length) lista.append(h('p', { class: 'dica' }, 'Nenhum modelo ainda.'));
  };
  desenharLista();
  raiz.append(lista, h('div', { class: 'linha' },
    h('button', { class: 'b', onclick: () => { modelos.push({ id: String(Date.now()), nome: '', corpo: '' }); desenharLista(); } }, '+ Novo modelo'),
    h('button', { class: 'b principal', onclick: salvar }, 'Salvar modelos')));
}

// ---------- Descadastros ----------
async function telaDescad(raiz) {
  const caixa = h('textarea', { placeholder: 'Cole um ou mais telefones, um por linha' });
  raiz.append(h('h2', {}, 'Descadastros'), h('p', { class: 'sub' }, 'Quem pediu para não receber mais. Vale para todos os computadores e nunca entra em campanha.'),
    h('div', { class: 'cartao' }, caixa, h('div', { class: 'linha' },
      h('button', { class: 'b principal', onclick: async () => {
        const r = await chamar(window.api.descadastros.adicionar(caixa.value));
        if (r) { aviso(`${r.ok} adicionados.` + (r.invalidos.length ? ` Ignorados (inválidos): ${r.invalidos.join(', ')}` : ''), r.invalidos.length ? '' : 'ok'); irPara('descadastros'); }
      } }, 'Adicionar à lista'))));
  const itens = (await chamar(window.api.descadastros.listar())) || [];
  raiz.append(h('div', { class: 'cartao' }, h('b', {}, `${itens.length} descadastrados`),
    itens.length ? h('table', {}, h('tr', {}, h('th', {}, 'Telefone'), h('th', {}, 'Motivo'), h('th', {}, 'Quem / quando'), h('th', {})),
      itens.map((d) => h('tr', {}, h('td', {}, d.exibir), h('td', {}, d.motivo || ''), h('td', {}, `${d.operador} · ${dataBR(d.t)}`),
        h('td', {}, h('button', { class: 'b', onclick: async () => { if (await chamar(window.api.descadastros.remover(d.telefone))) irPara('descadastros'); } }, 'Reativar'))))) : h('p', { class: 'dica' }, 'Ninguém na lista.')));
}

// ---------- Histórico ----------
async function telaHistorico(raiz) {
  const r = await chamar(window.api.historico.ler());
  raiz.append(h('h2', {}, 'Histórico'), h('p', { class: 'sub' }, 'Tudo que foi enviado por qualquer pessoa.'));
  if (!r) return;
  raiz.append(h('div', { class: 'cartao' }, h('h3', {}, 'Campanhas'),
    r.resumo.length ? h('table', {}, h('tr', {}, ['Campanha', 'Modo', 'Enviadas', 'Falhas', 'Quem', 'Último envio'].map((x) => h('th', {}, x))),
      r.resumo.map((c) => h('tr', {}, h('td', {}, c.campanha), h('td', {}, h('span', { class: 'etiqueta' + (c.simulacao ? ' sim' : '') }, c.simulacao ? 'simulação' : 'real')),
        h('td', {}, c.enviados), h('td', {}, c.falhas), h('td', {}, c.operadores.join(', ')), h('td', {}, dataBR(c.ultimo))))) : h('p', { class: 'dica' }, 'Nenhum envio ainda.')));
  raiz.append(h('details', {}, h('summary', {}, `Últimos ${r.recentes.length} envios`),
    h('table', {}, h('tr', {}, ['Quando', 'Campanha', 'Telefone', 'Status', 'Quem'].map((x) => h('th', {}, x))),
      r.recentes.map((e) => h('tr', {}, h('td', {}, dataBR(e.t)), h('td', {}, e.campanha), h('td', {}, e.exibir), h('td', {}, e.status + (e.erro ? ` (${e.erro})` : '')), h('td', {}, e.operador))))));
}

// ---------- Enviar ----------
async function telaEnviar(raiz) {
  raiz.append(h('h2', {}, 'Enviar campanha'), h('p', { class: 'sub' }, 'Escolha a mensagem, confira quem vai receber e dispare.'));
  if (!S.planilha) { raiz.append(h('div', { class: 'aviso' }, 'Primeiro carregue a planilha na aba Planilha.')); return; }
  if (!(S.config.mapa && S.config.mapa.telefone)) { raiz.append(h('div', { class: 'aviso' }, 'Escolha as colunas (telefone, nome, aceite) na aba Planilha.')); return; }
  if (!S.modelos.length) { raiz.append(h('div', { class: 'aviso' }, 'Crie ao menos um modelo na aba Mensagens.')); return; }

  const nomeCamp = h('input', { type: 'text', placeholder: 'Ex.: dinheiro-fica-na-cidade-nov26' });
  const modelo = h('select', {}, S.modelos.map((m, i) => h('option', { value: i }, m.nome || `Modelo ${i + 1}`)));
  const previa = h('div', { class: 'balao' });
  const painel = h('div', {});
  const progresso = h('div', { class: 'oculto' });
  let confirmando = false;

  const corpoAtual = () => (S.modelos[Number(modelo.value)] || {}).corpo || '';
  const atualizarPrevia = async () => { const r = await window.api.envio.previa({ corpo: corpoAtual(), nome: 'Maria' }); previa.textContent = r.ok ? r.dados : ''; };
  modelo.addEventListener('change', atualizarPrevia);

  const botao = h('button', { class: 'b principal' }, 'Calcular público');
  let publicoOk = null;

  async function calcular() {
    const r = await chamar(window.api.publico.calcular({ campanha: nomeCamp.value }));
    if (!r) return;
    publicoOk = r;
    const s = r.stats;
    vazio(painel).append(
      h('div', { class: 'grade' },
        h('div', { class: 'num ok' }, h('b', {}, s.aptos), h('span', {}, 'vão receber')),
        h('div', { class: 'num' }, h('b', {}, s.linhas), h('span', {}, 'linhas na planilha')),
        h('div', { class: 'num aviso' }, h('b', {}, s.semAceite), h('span', {}, 'sem aceite')),
        h('div', { class: 'num aviso' }, h('b', {}, s.descadastrados), h('span', {}, 'descadastrados')),
        h('div', { class: 'num aviso' }, h('b', {}, s.jaEnviados), h('span', {}, 'já receberam esta campanha')),
        h('div', { class: 'num' }, h('b', {}, s.telefoneInvalido + s.semTelefone), h('span', {}, 'telefone inválido ou vazio')),
        h('div', { class: 'num' }, h('b', {}, s.duplicados), h('span', {}, 'repetidos'))),
      r.usouAceite ? null : h('div', { class: 'aviso' }, 'Atenção: nenhuma coluna de aceite foi escolhida, então TODOS os números válidos entram. Confirme que todos aceitaram receber mensagens.'),
      r.stats.corrigidos ? h('p', { class: 'dica' }, `${s.corrigidos} número(s) tiveram o 9º dígito acrescentado automaticamente.`) : null,
      r.amostra.length ? h('details', {}, h('summary', {}, 'Primeiros destinatários'), h('table', {}, h('tr', {}, h('th', {}, 'Nome'), h('th', {}, 'Telefone'), h('th', {}, 'Linha')),
        r.amostra.map((d) => h('tr', {}, h('td', {}, d.nomeCompleto || '(sem nome)'), h('td', {}, d.exibir), h('td', {}, d.linha))))) : null,
      r.rejeitados.length ? h('details', {}, h('summary', {}, `Quem ficou de fora (${r.rejeitados.length}${r.rejeitados.length >= 200 ? '+' : ''})`), h('table', {}, h('tr', {}, h('th', {}, 'Linha'), h('th', {}, 'Valor'), h('th', {}, 'Motivo')),
        r.rejeitados.map((x) => h('tr', {}, h('td', {}, x.linha), h('td', {}, x.valor), h('td', {}, x.motivo))))) : null);
    botao.textContent = s.aptos ? `Enviar para ${s.aptos} (simulação)` : 'Ninguém para enviar';
    botao.disabled = !s.aptos;
    confirmando = false;
  }

  botao.addEventListener('click', async () => {
    if (!publicoOk) return calcular();
    if (S.enviando) return;
    if (!nomeCamp.value.trim()) return aviso('Dê um nome à campanha.', 'erro');
    if (!confirmando) {
      confirmando = true; botao.textContent = `Confirmar: enviar para ${publicoOk.stats.aptos} pessoas?`; botao.className = 'b perigo';
      setTimeout(() => { if (confirmando && !S.enviando) { confirmando = false; botao.className = 'b principal'; botao.textContent = `Enviar para ${publicoOk.stats.aptos} (simulação)`; } }, 6000);
      return;
    }
    confirmando = false; botao.className = 'b principal';
    const r = await chamar(window.api.envio.iniciar({ campanha: nomeCamp.value, corpo: corpoAtual() }));
    if (!r) return;
    S.enviando = true; botao.disabled = true;
    const preenchimento = h('div', {});
    const texto = h('p', {}, `0 de ${r.total}`);
    vazio(progresso).append(h('div', { class: 'cartao' }, texto, h('div', { class: 'barra' }, preenchimento),
      h('div', { class: 'linha' }, h('button', { class: 'b', onclick: () => window.api.envio.cancelar() }, 'Parar envio'))));
    progresso.classList.remove('oculto');
    const fora1 = window.api.aoProgredir((p) => { texto.textContent = `${p.feitos} de ${p.total}`; preenchimento.style.width = Math.round((p.feitos / p.total) * 100) + '%'; });
    const fora2 = window.api.aoTerminar((res) => {
      fora1(); fora2(); S.enviando = false;
      if (res.erro) aviso(res.erro, 'erro', 0);
      else {
        let m = `${res.enviados} enviadas, ${res.falhas} falhas.`;
        if (res.parouPorLimite) m += ' Parou no limite diário; o restante pode ser enviado amanhã (quem já recebeu não repete).';
        if (res.cancelado) m += ' Envio interrompido por você.';
        aviso(m, res.falhas ? '' : 'ok', 20000);
      }
      publicoOk = null; botao.textContent = 'Calcular público'; botao.disabled = false; vazio(painel); progresso.classList.add('oculto');
    });
  });

  raiz.append(h('div', { class: 'cartao' },
    h('label', {}, 'Nome da campanha (ela evita mandar duas vezes para a mesma pessoa)'), nomeCamp,
    h('label', {}, 'Mensagem'), modelo, h('label', {}, 'Prévia'), previa,
    h('div', { class: 'linha' }, h('div', { class: 'cresce' }), botao)), painel, progresso);
  atualizarPrevia();
  nomeCamp.addEventListener('input', () => { publicoOk = null; botao.textContent = 'Calcular público'; botao.disabled = false; });
}

// ---------- recarga automática quando a planilha muda ----------
window.api.aoMudarPlanilha((resumo) => {
  S.planilha = resumo;
  aviso(`Planilha atualizada: ${resumo.linhas} linhas.`, 'ok');
  if (!S.enviando && (S.aba === 'enviar' || S.aba === 'planilha')) desenhar(S.aba);
});

irPara('enviar');
