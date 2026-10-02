/**
 * Lógica das abas protegidas por senha do painel público "Controle SHM":
 * Utilidades (entrega dos 2 scripts .gs para copiar/colar no Apps Script) e
 * Acesso (login + lista somente leitura de usuários cadastrados).
 *
 * Reaproveita a mesma UX do lockGateOverlay do painel original
 * (controle-shm-painel.html) — mas a validação da senha agora vai para o
 * backend deste repositório (POST /api/access/login), que por sua vez fala
 * com a API REST do Notion usando NOTION_TOKEN (variável de ambiente do
 * Render, documentada em github-README.md). Nunca testado ao vivo nesta
 * sessão (sem NOTION_TOKEN disponível) — VALIDAR AO VIVO: formato real da
 * tabela de acesso, e se o endpoint de login responde como esperado.
 *
 * O desbloqueio (variável em memória, reseta ao recarregar a página — sem
 * persistência) vale para as DUAS abas protegidas ao mesmo tempo, mesmo
 * padrão do protectedSectionsUnlocked_ original.
 */

window.PASSWORD_PROTECTED_SECTIONS_ = ['utilidades', 'acesso'];
window.protectedSectionsUnlocked_ = {};
let pendingLockTarget_ = null;

function unlockProtectedSection_(target) {
  window.protectedSectionsUnlocked_[target] = true;
  const badgeId = target === 'utilidades' ? 'navUtilidadesLockBadge' : 'navAcessoLockBadge';
  const badge = document.getElementById(badgeId);
  if (badge) badge.hidden = true;
}

window.openLockGate_ = function openLockGate_(target) {
  pendingLockTarget_ = target;
  const overlay = document.getElementById('lockGateOverlay');
  const status = document.getElementById('lockGateStatus');
  const emailInput = document.getElementById('lockGateEmailInput');
  const passwordInput = document.getElementById('lockGatePasswordInput');
  if (status) { status.textContent = ''; status.className = 'sync-status'; }
  if (emailInput) emailInput.value = '';
  if (passwordInput) passwordInput.value = '';
  if (overlay) overlay.hidden = false;
  if (emailInput) emailInput.focus();
};

function closeLockGate_() {
  const overlay = document.getElementById('lockGateOverlay');
  if (overlay) overlay.hidden = true;
  pendingLockTarget_ = null;
}

const lockGateClose = document.getElementById('lockGateClose');
if (lockGateClose) lockGateClose.addEventListener('click', closeLockGate_);
const lockGateOverlayEl = document.getElementById('lockGateOverlay');
if (lockGateOverlayEl) {
  lockGateOverlayEl.addEventListener('click', (ev) => {
    if (ev.target === lockGateOverlayEl) closeLockGate_();
  });
}

const lockGateSubmitBtn = document.getElementById('lockGateSubmitBtn');
if (lockGateSubmitBtn) {
  lockGateSubmitBtn.addEventListener('click', submitLockGate_);
}
const lockGatePasswordInput = document.getElementById('lockGatePasswordInput');
if (lockGatePasswordInput) {
  lockGatePasswordInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') submitLockGate_();
  });
}

async function submitLockGate_() {
  const status = document.getElementById('lockGateStatus');
  const email = (document.getElementById('lockGateEmailInput').value || '').trim().toLowerCase();
  const password = document.getElementById('lockGatePasswordInput').value;
  if (!email || !password) {
    status.textContent = 'Preencha e-mail e senha.';
    status.className = 'sync-status is-error';
    return;
  }
  lockGateSubmitBtn.disabled = true;
  status.textContent = 'Verificando…';
  status.className = 'sync-status';
  try {
    const res = await fetch('/api/access/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const payload = await res.json().catch(() => null);
    if (res.ok && payload && payload.ok) {
      const target = pendingLockTarget_;
      window.PASSWORD_PROTECTED_SECTIONS_.forEach(unlockProtectedSection_);
      closeLockGate_();
      if (target && window.activateSection_) window.activateSection_(target);
    } else {
      status.textContent = (payload && payload.error) || 'E-mail ou senha incorretos.';
      status.className = 'sync-status is-error';
    }
  } catch (e) {
    status.textContent = 'Falha ao verificar: ' + (e && e.message ? e.message : e);
    status.className = 'sync-status is-error';
  } finally {
    lockGateSubmitBtn.disabled = false;
  }
}

// ============================================================================
// Aba Utilidades — 2 cards de copiar script (Código.gs principal + Relatório
// de Horas), reaproveitando .card/.copy-btn-big/.toggle-row/.toggle-panel do
// painel original. Os botões "Export Snap Notion" e "Sincronizar Gravações
// BotDesign" do original NÃO foram replicados aqui (dependem de Gmail/Notion
// write via MCP, fora de escopo do site público).
// ============================================================================
let utilidadesRendered_ = false;

window.onActivateUtilidades_ = function onActivateUtilidades_() {
  if (utilidadesRendered_) return;
  utilidadesRendered_ = true;

  const codeBlockMain = document.getElementById('codeBlockMain');
  const codeBlockHours = document.getElementById('codeBlockHours');
  if (codeBlockMain) codeBlockMain.textContent = SCRIPT_MAIN;
  if (codeBlockHours) codeBlockHours.textContent = SCRIPT_HOURS;

  wireCopyButton_('copyBtnMain', 'copyStatusMain', () => SCRIPT_MAIN);
  wireCopyButton_('copyBtnHours', 'copyStatusHours', () => SCRIPT_HOURS);

  document.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const panel = document.getElementById(targetId);
      if (!panel) return;
      const willShow = panel.hidden;
      panel.hidden = !willShow;
      btn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
      const chevron = btn.querySelector('.chevron');
      if (chevron) chevron.textContent = willShow ? '▾' : '▸';
    });
  });
};

function wireCopyButton_(btnId, statusId, getText) {
  const btn = document.getElementById(btnId);
  const status = document.getElementById(statusId);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      if (status) { status.textContent = 'Copiado!'; status.className = 'sync-status is-ok'; }
    } catch (e) {
      if (status) { status.textContent = 'Não foi possível copiar automaticamente — selecione o texto em "Ver código" e copie manualmente.'; status.className = 'sync-status is-error'; }
    }
  });
}

// ============================================================================
// Aba Acesso — login já feito pelo lock gate; aqui só carrega a lista
// somente leitura (sem senha, sem formulário de cadastro/remoção).
// ============================================================================
let acessoLoaded_ = false;

window.onActivateAcesso_ = function onActivateAcesso_() {
  if (acessoLoaded_) return;
  acessoLoaded_ = true;
  loadAcessoList_();
};

async function loadAcessoList_() {
  const status = document.getElementById('acessoStatus');
  const wrap = document.getElementById('acessoTableWrap');
  if (status) { status.textContent = 'Carregando…'; status.className = 'sync-status'; }
  try {
    const res = await fetch('/api/access/list');
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((payload && payload.error) || ('Erro ' + res.status));
    }
    const users = (payload && payload.users) || [];
    if (!users.length) {
      wrap.innerHTML = '<p class="metrics-empty">Nenhum usuário cadastrado.</p>';
    } else {
      const rows = users.map((u) => {
        const email = escapeHtml_(u.email);
        const role = u.role === 'administrador' ? 'Administrador' : 'Comum';
        return '<tr><td>' + email + '</td><td>' + role + '</td></tr>';
      }).join('');
      wrap.innerHTML =
        '<table class="site-table"><thead><tr><th>E-mail</th><th>Papel</th></tr></thead><tbody>' +
        rows + '</tbody></table>';
    }
    if (status) { status.textContent = 'Atualizado.'; status.className = 'sync-status is-ok'; }
  } catch (e) {
    if (status) { status.textContent = 'Erro ao carregar lista: ' + (e && e.message ? e.message : e); status.className = 'sync-status is-error'; }
    if (wrap) wrap.innerHTML = '';
  }
}

function escapeHtml_(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

const SCRIPT_MAIN = String.raw`
/**
 * Script para atualizar o slide de acompanhamento (apresentação "BotDesign -
 * Report de Acompanhamento") com os cards do Jira.
 */

// ======================= CONFIG =======================
var CONFIG = {
  PRESENTATION_ID: '1UTbUcUiHEhtalAJMghRa011cy7NxcblFqIJ3Hrn4c-c',
  JIRA_BASE_URL: 'https://cf5empresa.atlassian.net',
  PROJECT_KEY: 'SHMB',
  RISK_CUSTOM_FIELD: 'customfield_10048',
  PLANO_ACAO_CUSTOM_FIELD: 'customfield_10082',
  EPIC_COLOR_CUSTOM_FIELD: 'customfield_10017', // "Issue color" — a cor real que o usuário escolheu pro Epic no Jira
  PRISTINE_MARKER: 'PRISTINE_TEMPLATE_NEC_MELHORIAS', // marca o slide-modelo original, nunca editado, não altere
  REPORT_MARKER_PREFIX: 'REPORT_SLIDE_NEC_MELHORIAS|', // + runId, marca cada página de conteúdo de uma execução
  SEPARATOR_MARKER_PREFIX: 'REPORT_SEPARATOR|',        // + runId + '|before'/'after'
  ROW_TAG_PREFIX: 'RC|',                              // marca interna das células de linha, não altere
  DONE_BORDER_COLOR: '#34a853',
  DONE_BORDER_WEIGHT: 1,
  DONE_FILL_COLOR: '#a8dab5',                         // verde bem visível pintando o card inteiro quando Done
  DEFAULT_BORDER_COLOR: '#e3e5e9',
  DEFAULT_BORDER_WEIGHT: 0.5,
  FONT_SIZE: 7,                                       // tamanho único de fonte em todos os campos (sem negrito)
  CHANGED_VALUE_COLOR: '#3457d5',                     // azul usado na etiqueta "Página X de Y"
  TARGET_ROW_HEIGHT: 36,                              // altura confortável de linha (cards mais altos)
  TARGET_ROW_GAP: 5,                                  // espaçamento confortável entre linhas
  MIN_ROW_HEIGHT: 26,                                 // altura mínima segura (cabe 2-3 linhas quebradas em 7pt, sem cortar)
  MAX_ROW_HEIGHT: 48,                                 // altura máxima de linha
  BOTTOM_MARGIN: 10,                                  // respiro no rodapé de cada página
  ROW_FILL_EVEN: '#ffffff',
  ROW_FILL_ODD: '#f7f8fa',
  SEPARATOR_FILL: '#e8eaed',                          // cinza claro do slide separador de abertura
  MODULE_HEADER_HEIGHT: 13,                           // altura da etiqueta de módulo (ex: "BACKLOG (5)")
  MODULE_GAP_EXTRA: 6,                                // respiro extra entre a etiqueta de módulo e a 1ª linha dele
  MODULE_HEADER_MARKER: 'MODULE_HEADER|',             // marca interna das etiquetas de módulo, não altere
  HEADER_LABELS: [
    'Data Surg',
    'Projeto ou Frente',
    'Key',
    'Status',
    'Nome da Atividade',
    'Plano de Ação',
    'Responsável'
  ]
};
// ========================================================

/**
 * Função principal, SEMPRE a primeira função declarada neste arquivo de
 * propósito — o Apps Script usa a primeira função do arquivo como opção
 * padrão (pré-selecionada) no dropdown ao lado de ▶ Executar, então você não
 * precisa abrir a lista toda vez, só clicar em Executar direto.
 *
 * Toda execução cria um NOVO slide (duplicado do último report válido, ou do
 * slide modelo original na 1ª vez), atualiza MÊS/ANO e DATA APRESENTAÇÃO para a
 * data de hoje, e sincroniza as linhas de dados com o Jira.
 */
function updateSlide() {
  var issues = fetchJiraData_();
  var stories = issues.stories;
  var epics = issues.epics;
  var epicColors = buildEpicColorMap_gs_(epics);

  var presentation = SlidesApp.openById(CONFIG.PRESENTATION_ID);
  var pageWidth = presentation.getPageWidth();
  var pageHeight = presentation.getPageHeight();

  // 1) Localiza (ou cria) o slide-modelo original, intocado — sempre a mesma
  // fonte de duplicação, em toda execução, para nunca acumular sujeira entre
  // páginas/execuções.
  var pristine = ensurePristineTemplate_(presentation);
  migrateHeaderLabel_(pristine, 'Melhoria ou necessidade de negócio ou contexto', 'Nome da Atividade'); // renomeia o cabeçalho físico no modelo, uma única vez, se ainda estiver com o nome antigo
  var columns = locateColumns_(pristine);
  var headerBottom = Math.max.apply(null, columns.map(function (c) { return c.bottom; }));

  // 2) Separa as stories em 2 "pools" por status — cada pool vira 1+ páginas,
  // com um módulo (etiqueta + linhas) por status dentro dele:
  //   Pool 1: Backlog, depois Aprovado Comprometido.
  //   Pool 2: Fazendo, depois Teste Validação, depois Done.
  var pools = groupStoriesIntoPools_(stories);

  var allPages = [];
  pools.forEach(function (modules) {
    planPoolPages_(pageHeight, headerBottom, modules).forEach(function (p) { allPages.push(p); });
  });

  if (allPages.length === 0) {
    // Nenhuma story em nenhum status: ainda assim gera 1 página vazia, pra não quebrar o fluxo.
    var available = pageHeight - (headerBottom + CONFIG.TARGET_ROW_GAP) - CONFIG.BOTTOM_MARGIN;
    var emptyFit = computeCompactRowFit_(available, 1);
    allPages.push({ segments: [], firstRowTop: headerBottom + CONFIG.TARGET_ROW_GAP, rowHeight: emptyFit.rowHeight, rowGap: emptyFit.rowGap });
  }

  var runId = String(Date.now());
  var totalSlidesInBlock = allPages.length + 1; // + 1 do separador (slide 1)

  // 3) Constrói TODOS os slides do bloco primeiro (sem mover nada ainda), na
  // ordem final desejada: [separador, página 2, página 3, ...]. Só depois
  // move cada um pro topo (índice 0), em ordem INVERSA (o último da lista
  // desejada primeiro, o separador por último) — assim o separador acaba
  // sendo o último move(0) e fica na posição 0 de verdade: sempre o "slide 1"
  // do bloco, com as páginas de conteúdo logo abaixo dele, na ordem certa.
  var slidesInFinalOrder = [];
  slidesInFinalOrder.push(createSeparatorSlide_(pristine, runId, 'before'));
  allPages.forEach(function (page, idx) {
    slidesInFinalOrder.push(buildContentPage_(pristine, columns, runId, page, epics, epicColors, idx + 2, totalSlidesInBlock, pageWidth));
  });

  for (var i = slidesInFinalOrder.length - 1; i >= 0; i--) {
    slidesInFinalOrder[i].move(0);
  }

  Logger.log('Execução ' + runId + ': ' + stories.length + ' itens em ' + allPages.length +
    ' página(s) de conteúdo + 1 slide separador cinza no topo (slide 1).');
}

/**
 * Pega email/token do Jira salvos em Script Properties. Se ainda não existem,
 * pede uma única vez via caixa de diálogo e salva para as próximas execuções
 * (não precisa preencher nada no código).
 */
function getJiraCredentials_() {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('JIRA_EMAIL');
  var token = props.getProperty('JIRA_API_TOKEN');

  if (!email || !token) {
    var ui = SlidesApp.getUi();
    if (!email) {
      var emailResp = ui.prompt('Configuração Jira (só uma vez)', 'Digite o e-mail da sua conta Jira:', ui.ButtonSet.OK_CANCEL);
      if (emailResp.getSelectedButton() !== ui.Button.OK) throw new Error('Configuração cancelada.');
      email = emailResp.getResponseText().trim();
      props.setProperty('JIRA_EMAIL', email);
    }
    if (!token) {
      var tokenResp = ui.prompt('Configuração Jira (só uma vez)', 'Cole o API Token do Jira (gerado em id.atlassian.com/manage-profile/security/api-tokens):', ui.ButtonSet.OK_CANCEL);
      if (tokenResp.getSelectedButton() !== ui.Button.OK) throw new Error('Configuração cancelada.');
      token = tokenResp.getResponseText().trim();
      props.setProperty('JIRA_API_TOKEN', token);
    }
  }

  return { email: email, token: token };
}

// Mesma paleta, mesma tabela de cores nomeadas do Jira e mesma regra de
// fallback (chave do épico ordenada alfabeticamente) usadas no painel web —
// pra cada épico sempre sair com a MESMA cor no slide e no site, sem
// precisar de nenhuma configuração manual. Usa a cor REAL do campo "Issue
// color" do Jira quando disponível; só cai pra paleta própria como fallback.
var EPIC_COLOR_PALETTE_GS = ['#4c9aff', '#ff8f73', '#36b37e', '#6554c0', '#ffab00', '#00b8d9', '#e34948', '#8993a4', '#c2185b', '#8d6e63'];

var JIRA_COLOR_NAME_TO_HEX_GS = {
  yellow: '#ffc400', dark_yellow: '#a37200', orange: '#ff8f00', dark_orange: '#a35a00',
  red: '#de350b', dark_red: '#bf2600',
  magenta: '#e774bb', pink: '#e774bb', dark_magenta: '#943d73', dark_pink: '#943d73',
  purple: '#6554c0', dark_purple: '#403294',
  blue: '#0052cc', dark_blue: '#253858', teal: '#00b8d9', dark_teal: '#008da6',
  green: '#36b37e', dark_green: '#006644', light_green: '#79f2c0', lime: '#79f2c0', dark_lime: '#0e6245',
  brown: '#816a5b', gray: '#97a0af', grey: '#97a0af', dark_gray: '#5e6c84', dark_grey: '#5e6c84',
  'blue-gray': '#8993a4', blue_gray: '#8993a4'
};

function buildEpicColorMap_gs_(epics) {
  var map = {};
  var fallbackIdx = 0;
  Object.keys(epics).sort().forEach(function (key) {
    var colorName = epics[key] && epics[key].colorName;
    var hex = colorName && JIRA_COLOR_NAME_TO_HEX_GS[String(colorName).toLowerCase()];
    if (hex) {
      map[key] = hex;
    } else {
      map[key] = EPIC_COLOR_PALETTE_GS[fallbackIdx % EPIC_COLOR_PALETTE_GS.length];
      fallbackIdx++;
    }
  });
  return map;
}

/**
 * Verifica se um nome de status corresponde ao "Aprovado Comprometido" —
 * aceita variações de grafia entre workspaces (ex: "Aprovado Comprometido",
 * "Comprometido" sozinho, ou qualquer nome que contenha "APROVADO").
 */
function isAprovadoComprometidoStatus_(statusName) {
  var u = (statusName || '').trim().toUpperCase();
  return u.indexOf('APROVADO') !== -1 || u === 'COMPROMETIDO';
}

function isTesteValidacaoStatus_(statusName) {
  return (statusName || '').trim().toUpperCase().indexOf('TESTE') !== -1;
}

function isDoneStatus_(statusName) {
  var u = (statusName || '').trim().toUpperCase();
  return u === 'DONE' || u === 'CONCLUÍDO' || u === 'CONCLUIDO';
}

/**
 * Ordena um grupo de stories por Épico (chave) e, dentro do mesmo Épico, por
 * data de criação — mesma ordem de leitura usada no restante do relatório.
 */
function sortByEpicThenCreated_(stories) {
  return stories.slice().sort(function (a, b) {
    if (a.epicKey === b.epicKey) return a.created < b.created ? -1 : 1;
    return (a.epicKey || '').localeCompare(b.epicKey || '');
  });
}

/**
 * Separa as stories em 2 pools de módulos (cada pool vira 1+ páginas de
 * slide, cada módulo é um grupo de linhas com uma etiqueta acima):
 *   Pool 1 — Backlog, depois Aprovado Comprometido.
 *   Pool 2 — Fazendo, depois Teste Validação, depois Done. Qualquer status
 *            que não bata com nenhum desses (raro — fluxo com etapa extra)
 *            entra num módulo "Outros" no fim do Pool 2, pra nunca sumir
 *            silenciosamente do relatório.
 * Módulos sem nenhuma story não aparecem no resultado (planPoolPages_ já os
 * ignora, mas fica registrado aqui pra clareza).
 */
function groupStoriesIntoPools_(stories) {
  var backlog = [], aprovado = [], fazendo = [], teste = [], done = [], outros = [];

  stories.forEach(function (story) {
    var u = (story.status || '').trim().toUpperCase();
    if (u === 'BACKLOG') backlog.push(story);
    else if (isAprovadoComprometidoStatus_(story.status)) aprovado.push(story);
    else if (u === 'FAZENDO') fazendo.push(story);
    else if (isTesteValidacaoStatus_(story.status)) teste.push(story);
    else if (isDoneStatus_(story.status)) done.push(story);
    else outros.push(story);
  });

  var pool1 = [
    { title: 'BACKLOG', stories: sortByEpicThenCreated_(backlog) },
    { title: 'APROVADO COMPROMETIDO', stories: sortByEpicThenCreated_(aprovado) }
  ];
  var pool2 = [
    { title: 'FAZENDO', stories: sortByEpicThenCreated_(fazendo) },
    { title: 'TESTE VALIDAÇÃO', stories: sortByEpicThenCreated_(teste) },
    { title: 'DONE', stories: sortByEpicThenCreated_(done) }
  ];
  if (outros.length > 0) pool2.push({ title: 'OUTROS', stories: sortByEpicThenCreated_(outros) });

  return [pool1, pool2];
}

/**
 * Calcula a altura de linha necessária pra caber TODAS as "rowCount" linhas
 * no espaço disponível, encolhendo o quanto precisar (sem limite mínimo de
 * conforto) — ao contrário de paginar quando o conteúdo não cabe, este
 * relatório sempre força tudo numa página só por pool de status. Só não
 * deixa a altura zerar ou ficar negativa (piso físico de 3pt).
 */
// Altura de linha alvo pra caber até 2 linhas de texto a 7pt (fonte única do
// relatório) bem justificadas: 2x (7pt * 1.25 de entrelinha) ≈ 17.5pt + uma
// folga interna generosa (top/bottom), pra o texto nunca vazar pra fora do
// card — Apps Script não permite "encolher texto pra caber" na forma, então
// a caixa precisa ser alta o bastante de propósito.
var TWO_LINE_ROW_HEIGHT = 30;

/**
 * Encolhe a altura de linha só quando REALMENTE não sobra espaço nem pra 2
 * linhas de texto por card (muitos itens) — nunca estica além do necessário
 * pra 2 linhas, mesmo quando sobra bastante espaço na página (poucos itens).
 * Só não deixa a altura zerar ou ficar negativa (piso físico de 3pt).
 */
function computeFitAllRowHeight_(available, rowCount, rowGap) {
  if (rowCount <= 0) rowCount = 1;
  var raw = (available - (rowCount - 1) * rowGap) / rowCount;
  return Math.max(3, Math.min(TWO_LINE_ROW_HEIGHT, raw));
}

/**
 * Monta a ÚNICA página de um pool de status: um segmento por CADA módulo do
 * pool, na ordem em que foram passados — inclusive os que estão com 0 itens
 * nesta sincronização (etiqueta "NOME (0)", sem nenhuma linha embaixo), pra
 * a etapa sempre aparecer no slide mesmo vazia, igual às colunas fixas do
 * Board Jira. Todos os módulos ficam na mesma página, nunca dividida em
 * mais de uma. A altura de linha é sempre TWO_LINE_ROW_HEIGHT (até 2 linhas
 * de texto), a menos que nem isso caiba (muitos itens) — nesse caso, encolhe
 * mais (ver computeFitAllRowHeight_). Devolve um array com 0 ou 1 página (0
 * só quando TODOS os módulos do pool estão vazios).
 */
function planPoolPages_(pageHeight, headerBottom, modules) {
  var firstRowTop = headerBottom + CONFIG.TARGET_ROW_GAP;
  var available = pageHeight - firstRowTop - CONFIG.BOTTOM_MARGIN;
  var moduleHeaderCost = CONFIG.MODULE_HEADER_HEIGHT + CONFIG.MODULE_GAP_EXTRA;
  var rowGap = 2; // espaçamento mínimo entre linhas

  var totalRows = modules.reduce(function (sum, mod) { return sum + (mod.stories ? mod.stories.length : 0); }, 0);
  if (totalRows === 0) return []; // pool inteiro vazio: não gera slide nenhum pra ele

  var headerReserved = modules.length * moduleHeaderCost;
  var rowHeight = computeFitAllRowHeight_(available - headerReserved, totalRows, rowGap);

  var segments = modules.map(function (mod) {
    return { title: mod.title, stories: mod.stories || [], showHeader: true };
  });

  return [{ segments: segments, firstRowTop: firstRowTop, rowHeight: rowHeight, rowGap: rowGap }];
}

/**
 * Insere a etiqueta de um módulo (ex: "BACKLOG (5)") como uma caixa de texto
 * simples, span da largura total das colunas, azul — igual à cor já usada na
 * etiqueta "Página X de Y", pra ficar visualmente consistente.
 */
function addModuleHeader_(slide, title, count, left, right, top) {
  var box = slide.insertTextBox(title + ' (' + count + ')', left, top, right - left, CONFIG.MODULE_HEADER_HEIGHT);
  var tr = box.getText();
  tr.getTextStyle().setBold(false).setForegroundColor(CONFIG.CHANGED_VALUE_COLOR);
  var ps = tr.getParagraphStyle();
  ps.setSpaceAbove(0);
  ps.setSpaceBelow(0);
  box.setDescription(CONFIG.MODULE_HEADER_MARKER);
}

/**
 * Remove etiquetas de módulo herdadas de uma página antiga usada como
 * modelo (igual a removeOldPageLabels_, mas pra CONFIG.MODULE_HEADER_MARKER).
 */
function removeOldModuleHeaders_(slide) {
  slide.getShapes().forEach(function (shape) {
    if (safeGetDescription_(shape) === CONFIG.MODULE_HEADER_MARKER) shape.remove();
  });
}

/**
 * Constrói uma página de conteúdo: duplica o slide-modelo intocado, marca com
 * o runId desta execução, atualiza a data do cabeçalho e preenche, na ordem,
 * a etiqueta de cada módulo (quando presente no início do segmento) seguida
 * das linhas de dados desse segmento.
 */
function buildContentPage_(pristine, columns, runId, plan, epics, epicColors, pageNumber, totalPages, pageWidth) {
  var slide = pristine.duplicate();
  stripMarker_(slide, CONFIG.PRISTINE_MARKER); // a cópia não deve carregar a marca de "modelo intocado"
  ensureReportMarker_(slide, runId);
  updateHeaderDate_(slide);
  mergeRiscoImpactoIntoLayout_(slide); // remove a coluna Risco Impacto e redistribui a largura pra Projeto/Frente e Melhoria, ANTES de medir as colunas
  widenKeyColumn_(slide); // alarga a coluna Key pra chave nunca ficar cortada, em qualquer situação

  var pageColumns = locateColumns_(slide);
  var exampleRow = findExampleRow_(slide, pageColumns);
  removeLeftoverRows_(slide, exampleRow); // se o modelo veio de uma página antiga, apaga as outras linhas dela
  removeOldPageLabels_(slide); // idem para etiquetas "Página X de Y" que possam ter sobrado de execuções antigas
  removeOldModuleHeaders_(slide); // idem para etiquetas de módulo que possam ter sobrado

  var minColLeft = Math.min.apply(null, pageColumns.map(function (c) { return c.left; }));
  var maxColRight = Math.max.apply(null, pageColumns.map(function (c) { return c.left + c.width; }));

  var cursorTop = plan.firstRowTop;
  var rowIdx = 0;
  var usedExampleRow = false;

  plan.segments.forEach(function (segment) {
    if (segment.showHeader) {
      addModuleHeader_(slide, segment.title, segment.stories.length, minColLeft, maxColRight, cursorTop);
      cursorTop += CONFIG.MODULE_HEADER_HEIGHT + CONFIG.MODULE_GAP_EXTRA;
    }

    segment.stories.forEach(function (story) {
      var epic = epics[story.epicKey] || { key: story.epicKey || '-', summary: '(épico não encontrado)' };
      var valuesByLabel = buildValuesByLabel_(story, epic);

      var rowShapes = (!usedExampleRow) ? exampleRow : cloneRowShapes_(slide, exampleRow, story.key);
      usedExampleRow = true;

      positionRowShapes_(rowShapes, pageColumns, cursorTop, plan.rowHeight);
      fillRowShapes_(rowShapes, pageColumns, valuesByLabel, story.statusAbbrev, story.planoAcao, rowIdx, plan.rowHeight, story.priorityName, epicColors[story.epicKey]);
      tagRowShapes_(rowShapes, story, pageColumns);

      cursorTop += plan.rowHeight + plan.rowGap;
      rowIdx++;
    });
  });

  // Última passada: unifica TODO o texto do slide (fonte 7, sem negrito),
  // exceto o título principal — cobre pills de data, subtítulo, cabeçalhos
  // e as etiquetas de módulo.
  normalizeAllText_(slide);

  return slide;
}

/**
 * Remove o negrito dos rótulos de cabeçalho (Data Surg, Status, etc.), que
 * vinham em negrito por herança do desenho original do template — para o
 * texto ficar uniforme com as linhas de dados, sem negrito em lugar nenhum.
 */
function unboldHeaderLabels_(slide) {
  slide.getShapes().forEach(function (shape) {
    var t = safeGetText_(shape);
    if (CONFIG.HEADER_LABELS.indexOf(t) === -1) return;
    try {
      shape.getText().getTextStyle().setBold(false);
    } catch (e) {}
  });
}

/**
 * Unifica TODO o texto do slide em fonte 7pt sem negrito, exceto o título
 * principal "Jornada do Paciente" (mantido no tamanho original, é a única
 * peça puramente decorativa/de marca do layout — encolher ela para 7pt
 * quebraria visualmente o cabeçalho). Isso cobre os pills de MÊS/ANO e DATA
 * APRESENTAÇÃO, o subtítulo "Necessidades e Melhorias" e os cabeçalhos de
 * coluna, além das linhas de dados (que já saem em 7pt/sem negrito da
 * própria escrita da linha — aqui é só uma segunda passada de garantia).
 */
function normalizeAllText_(slide) {
  slide.getShapes().forEach(function (shape) {
    var t = safeGetText_(shape);
    if (!t) return;
    if (t === 'Jornada do Paciente') return; // único texto preservado do tamanho original

    try {
      var tr = shape.getText();
      var len = tr.asString().length;
      if (len === 0) return;
      tr.getRange(0, len).getTextStyle().setFontSize(CONFIG.FONT_SIZE).setBold(false);
    } catch (e) {}
  });
}

/**
 * Adiciona uma pequena etiqueta "Página X de Y" no canto superior direito da
 * página, para identificar cada slide de conteúdo gerado nesta execução.
 */
/**
 * Adiciona a etiqueta "Página X de Y" no espaço em branco logo ABAIXO do
 * botão/pill "MÊS/ANO" (nunca por cima dele), em azul.
 */
function addPageNumberLabel_(slide, columns, pageWidth, pageNumber, totalPages) {
  var mesAnoPill = null;
  slide.getShapes().forEach(function (shape) {
    var t = safeGetText_(shape);
    if (t && t.indexOf('MÊS/ANO') === 0 && !mesAnoPill) mesAnoPill = shape;
  });

  var width = 90;
  var height = 12;
  var x, y;
  if (mesAnoPill) {
    x = mesAnoPill.getLeft() + (mesAnoPill.getWidth() - width) / 2;
    y = mesAnoPill.getTop() + mesAnoPill.getHeight() + 3;
  } else {
    x = pageWidth - width - 10;
    y = 56; // fallback: logo abaixo da área dos pills, caso não ache o MÊS/ANO
  }

  var label = slide.insertTextBox('Página ' + pageNumber + ' de ' + totalPages, x, y, width, height);
  var tr = label.getText();
  tr.getTextStyle().setFontSize(7).setBold(false).setForegroundColor(CONFIG.CHANGED_VALUE_COLOR);
  var ps = tr.getParagraphStyle();
  ps.setSpaceAbove(0);
  ps.setSpaceBelow(0);
  ps.setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
}

/**
 * Cria o slide separador de ABERTURA (cinza claro, em branco) do bloco de
 * páginas desta execução — é sempre o "slide 1" do bloco, na frente de todas
 * as páginas de conteúdo geradas nesta execução. Duplica o modelo pristine e
 * apaga todo o conteúdo dele. Evita usar SlidesApp.PredefinedLayout.BLANK,
 * que pode não existir no master/tema da apresentação (gera erro
 * "predefined layout not present in the current master").
 */
function createSeparatorSlide_(pristine, runId, which) {
  var slide = pristine.duplicate();

  slide.getPageElements().forEach(function (el) {
    try { el.remove(); } catch (e) {} // ignora elementos que não podem ser removidos (raro)
  });

  slide.getBackground().setSolidFill(CONFIG.SEPARATOR_FILL);

  var marker = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, -20, -20, 1, 1);
  marker.getFill().setTransparent();
  marker.getBorder().setTransparent();
  marker.setDescription(CONFIG.SEPARATOR_MARKER_PREFIX + runId + '|' + which);

  return slide;
}

// ======================= LOCALIZAÇÃO DE COLUNAS/LINHAS =======================

/**
 * Um slide é considerado válido se contém pelo menos as caixas de cabeçalho
 * "Status" e "Key" com o texto exato esperado.
 */
function isValidReportSlide_(slide) {
  var found = { Status: false, Key: false };
  slide.getShapes().forEach(function (shape) {
    var t = safeGetText_(shape);
    if (t === 'Status') found.Status = true;
    if (t === 'Key') found.Key = true;
  });
  return found.Status && found.Key;
}

/**
 * Garante que exista um slide-modelo "intocado" (PRISTINE_MARKER), nunca
 * editado diretamente — todas as páginas de conteúdo são sempre duplicadas
 * dele, nunca umas das outras. Isso evita acumular sujeira (linhas marcadas
 * de execuções antigas) entre execuções e entre páginas de uma mesma execução.
 *
 * Na 1ª vez que o script roda, marca o slide original (o único ainda sem
 * nenhuma marca) como pristine. Nas execuções seguintes, só localiza esse
 * mesmo slide pela marca.
 */
function ensurePristineTemplate_(presentation) {
  var slides = presentation.getSlides();

  for (var i = 0; i < slides.length; i++) {
    var hasPristineMarker = slides[i].getShapes().some(function (shape) {
      return safeGetDescription_(shape) === CONFIG.PRISTINE_MARKER;
    });
    if (hasPristineMarker) return slides[i];
  }

  // Não achou nenhum slide sem marca nenhuma: adota o PRIMEIRO slide
  // estruturalmente válido que encontrar (mesmo que já tenha sido usado como
  // página de conteúdo antes) como modelo permanente daqui pra frente. Isso
  // acontece quando o slide original "limpo" já não existe mais (apagado ou
  // consumido por uma versão antiga do script) — mas qualquer página com o
  // layout certo serve igualmente bem de modelo para clonar.
  for (var j = 0; j < slides.length; j++) {
    var slide = slides[j];
    if (!isValidReportSlide_(slide)) continue;

    var marker = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, -20, -20, 1, 1);
    marker.getFill().setTransparent();
    marker.getBorder().setTransparent();
    marker.setDescription(CONFIG.PRISTINE_MARKER);
    return slide;
  }

  throw new Error('Não encontrei nenhum slide com o layout "Necessidades e Melhorias" (com as caixas de cabeçalho Data Surg, Key, Status, etc) para usar como modelo. Confirme que existe pelo menos um slide com esse layout na apresentação.');
}

/**
 * Remove uma marca específica de um slide (usada para tirar o PRISTINE_MARKER
 * de uma cópia recém-duplicada, já que duplicate() copia os marcadores junto).
 */
function stripMarker_(slide, markerValue) {
  slide.getShapes().forEach(function (shape) {
    if (safeGetDescription_(shape) === markerValue) shape.remove();
  });
}

/**
 * Renomeia o texto de um cabeçalho no MODELO PRISTINE, de oldLabel pra
 * newLabel — usado pra migrar o nome de uma coluna sem precisar editar o
 * texto manualmente dentro do Google Slides. Só mexe se ainda encontrar
 * oldLabel (idempotente: em execuções seguintes, já não encontra nada e não
 * faz nada). É a ÚNICA edição direta permitida no modelo pristine (correção
 * de rótulo de coluna, não é dado de linha) — o resto do modelo continua
 * intocado como sempre.
 */
function migrateHeaderLabel_(slide, oldLabel, newLabel) {
  slide.getShapes().forEach(function (shape) {
    var t = safeGetText_(shape);
    if (t === oldLabel) {
      shape.getText().setText(newLabel);
    }
  });
}

/**
 * Localiza o par (caixa de texto do rótulo + pill de fundo) de UM cabeçalho
 * específico, pelo texto exato — mesma lógica de casamento pill/texto usada
 * em locateColumns_, só que pra um único rótulo qualquer (não precisa estar
 * em CONFIG.HEADER_LABELS). Devolve null se o rótulo não existir no slide.
 */
function getHeaderColumnShapes_(slide, label) {
  var textShape = null;
  var bgCandidates = [];
  slide.getShapes().forEach(function (shape) {
    var t = safeGetText_(shape);
    if (t === label && !textShape) textShape = shape;
    else if (t === '') bgCandidates.push(shape);
  });
  if (!textShape) return null;

  var tLeft = textShape.getLeft(), tTop = textShape.getTop();
  var tRight = tLeft + textShape.getWidth(), tBottom = tTop + textShape.getHeight();
  var matchingBgs = bgCandidates.filter(function (b) {
    var bLeft = b.getLeft(), bTop = b.getTop();
    var bRight = bLeft + b.getWidth(), bBottom = bTop + b.getHeight();
    return Math.abs(bTop - tTop) < 5 && bLeft <= tLeft + 1 && bRight >= tRight - 1 && bBottom >= tBottom - 1;
  });
  matchingBgs.sort(function (a, b) { return a.getWidth() - b.getWidth(); });
  var pillShape = matchingBgs[0] || textShape;

  return { textShape: textShape, pillShape: pillShape };
}

/**
 * Remove a coluna "Risco Impacto" inteira do slide (cabeçalho + qualquer
 * forma — de cabeçalho ou de dado herdado de uma página antiga — que esteja
 * fisicamente dentro da faixa horizontal onde essa coluna ficava) e
 * redistribui a largura liberada, metade pra "Projeto ou Frente" e metade
 * pra "Nome da Atividade", deslocando pra a
 * direita todas as colunas que ficam depois de cada uma delas (Key, Status,
 * Melhoria, Plano de Ação, Responsável) — o conteúdo de Risco Impacto passa
 * a viver só na nota/texto alternativo da coluna Plano de Ação (ver
 * tagRowShapes_), nunca mais aparece como coluna própria. Precisa rodar
 * ANTES de locateColumns_(slide), pra a geometria já vir redistribuída.
 *
 * Move/cresce em 2 passos: (1) o pill + o texto de cada cabeçalho, achados
 * pelo RÓTULO (o texto não muda mesmo depois de mover a forma); (2) qualquer
 * OUTRA forma (a célula da linha de exemplo, ou uma linha de dado herdada de
 * execução antiga) que esteja alinhada com a posição ORIGINAL do pill de
 * cada coluna — sem esse 2º passo, a linha de exemplo fica pra trás dos
 * cabeçalhos já deslocados e findExampleRow_ não a encontra mais (ela é
 * localizada por posição, não por rótulo).
 */
function mergeRiscoImpactoIntoLayout_(slide) {
  var labelsInOrder = [
    'Data Surg', 'Projeto ou Frente', 'Key', 'Status',
    'Nome da Atividade', 'Plano de Ação', 'Responsável', 'Risco Impacto'
  ];

  var originalGeom = {};
  var headerShapesByLabel = {};
  var headerTop = null; // topo do cabeçalho mais alto — delimita onde a tabela começa
  labelsInOrder.forEach(function (label) {
    var geom = getHeaderColumnShapes_(slide, label);
    if (!geom) return;
    headerShapesByLabel[label] = geom;
    var top = geom.pillShape.getTop();
    originalGeom[label] = { left: geom.pillShape.getLeft(), width: geom.pillShape.getWidth(), top: top };
    if (headerTop === null || top < headerTop) headerTop = top;
  });

  if (!originalGeom['Risco Impacto']) return; // já removido, ou modelo sem essa coluna — nada a fazer

  var riscoLeft = originalGeom['Risco Impacto'].left;
  var riscoWidth = originalGeom['Risco Impacto'].width;
  var riscoRight = riscoLeft + riscoWidth;

  slide.getShapes().forEach(function (shape) {
    try {
      var l = shape.getLeft(), w = shape.getWidth(), t = shape.getTop();
      if (t < headerTop - 3) return; // acima da tabela (ex: pills de data): nunca remove
      if (l >= riscoLeft - 1 && (l + w) <= riscoRight + 1) shape.remove();
    } catch (e) {}
  });

  var growEach = riscoWidth / 2;
  var deltaLeftByLabel = {};
  var deltaWidthByLabel = {};
  var cumulativeShift = 0;
  labelsInOrder.forEach(function (label) {
    if (label === 'Risco Impacto') return;
    deltaLeftByLabel[label] = cumulativeShift;
    if (label === 'Projeto ou Frente' || label === 'Nome da Atividade') {
      deltaWidthByLabel[label] = growEach;
      cumulativeShift += growEach;
    } else {
      deltaWidthByLabel[label] = 0;
    }
  });

  // Passo 1: pill + texto de cada cabeçalho, achados pelo rótulo.
  var headerObjectIds = {};
  labelsInOrder.forEach(function (label) {
    if (label === 'Risco Impacto') return;
    var geom = headerShapesByLabel[label];
    if (!geom) return;
    var dl = deltaLeftByLabel[label], dw = deltaWidthByLabel[label];
    [geom.textShape, geom.pillShape].forEach(function (shape) {
      if (!shape) return;
      headerObjectIds[shape.getObjectId()] = true;
      if (dl) shape.setLeft(shape.getLeft() + dl);
      if (dw) shape.setWidth(shape.getWidth() + dw);
    });
  });

  // Passo 2: qualquer outra forma alinhada (por posição) com o pill ORIGINAL
  // de cada coluna — cobre a célula da linha de exemplo e linhas herdadas.
  // Só considera formas na FAIXA VERTICAL da tabela (a partir do topo dos
  // cabeçalhos pra baixo) — sem essa trava, um pill decorativo mais acima na
  // página (ex: "DATA APRESENTAÇÃO"/"MÊS/ANO") podia coincidir em X com uma
  // coluna e ser deslocado/esticado por engano, sobrepondo outro pill.
  var TOLERANCE = 3;
  slide.getShapes().forEach(function (shape) {
    if (headerObjectIds[shape.getObjectId()]) return; // já tratada no passo 1
    var l, t;
    try { l = shape.getLeft(); t = shape.getTop(); } catch (e) { return; }
    if (t < headerTop - TOLERANCE) return; // acima da tabela: nunca mexe
    labelsInOrder.forEach(function (label) {
      if (label === 'Risco Impacto') return;
      var orig = originalGeom[label];
      if (!orig || Math.abs(l - orig.left) > TOLERANCE) return;
      var dl = deltaLeftByLabel[label], dw = deltaWidthByLabel[label];
      if (dl) shape.setLeft(shape.getLeft() + dl);
      if (dw) shape.setWidth(shape.getWidth() + dw);
    });
  });
}

// ~2 caracteres a mais de largura pra coluna Key (a 7pt, ~0.55x o tamanho da
// fonte por caractere) — pra a chave (ex: "SHMB-13") nunca ficar cortada,
// em qualquer situação/filtro.
var KEY_COLUMN_EXTRA_WIDTH = 8;

/**
 * Alarga a coluna "Key" em KEY_COLUMN_EXTRA_WIDTH e desloca pra direita todas
 * as colunas depois dela (Status, Melhoria, Plano de Ação, Responsável) — só
 * a largura muda pra Key, as outras só mudam de posição (largura igual).
 * Mesma técnica de 2 passos de mergeRiscoImpactoIntoLayout_: (1) cabeçalho
 * por rótulo; (2) qualquer outra forma alinhada por posição com o pill
 * ORIGINAL de cada coluna (cobre a célula da linha de exemplo), restrita à
 * faixa vertical da tabela pra nunca mexer nos pills de data no topo.
 */
function widenKeyColumn_(slide) {
  var labelsAfterKey = ['Status', 'Nome da Atividade', 'Plano de Ação', 'Responsável'];
  var allLabels = ['Data Surg', 'Projeto ou Frente', 'Key'].concat(labelsAfterKey);

  var originalGeom = {};
  var headerShapesByLabel = {};
  var headerTop = null;
  allLabels.forEach(function (label) {
    var geom = getHeaderColumnShapes_(slide, label);
    if (!geom) return;
    headerShapesByLabel[label] = geom;
    var top = geom.pillShape.getTop();
    originalGeom[label] = { left: geom.pillShape.getLeft(), width: geom.pillShape.getWidth(), top: top };
    if (headerTop === null || top < headerTop) headerTop = top;
  });
  if (!originalGeom['Key']) return; // modelo sem coluna Key — nada a fazer

  var grow = KEY_COLUMN_EXTRA_WIDTH;

  // Passo 1: cabeçalhos, por rótulo.
  var headerObjectIds = {};
  var keyGeom = headerShapesByLabel['Key'];
  [keyGeom.textShape, keyGeom.pillShape].forEach(function (shape) {
    headerObjectIds[shape.getObjectId()] = true;
    shape.setWidth(shape.getWidth() + grow);
  });
  labelsAfterKey.forEach(function (label) {
    var geom = headerShapesByLabel[label];
    if (!geom) return;
    [geom.textShape, geom.pillShape].forEach(function (shape) {
      if (!shape) return;
      headerObjectIds[shape.getObjectId()] = true;
      shape.setLeft(shape.getLeft() + grow);
    });
  });

  // Passo 2: outras formas alinhadas por posição (célula da linha de exemplo
  // etc), só na faixa vertical da tabela.
  var TOLERANCE = 3;
  slide.getShapes().forEach(function (shape) {
    if (headerObjectIds[shape.getObjectId()]) return; // já tratada no passo 1
    var l, t;
    try { l = shape.getLeft(); t = shape.getTop(); } catch (e) { return; }
    if (t < headerTop - TOLERANCE) return; // acima da tabela: nunca mexe

    if (Math.abs(l - originalGeom['Key'].left) <= TOLERANCE) {
      shape.setWidth(shape.getWidth() + grow);
      return;
    }
    labelsAfterKey.forEach(function (label) {
      var orig = originalGeom[label];
      if (!orig || Math.abs(l - orig.left) > TOLERANCE) return;
      shape.setLeft(shape.getLeft() + grow);
    });
  });
}

/**
 * Localiza as caixas de cabeçalho pelo texto exato e devolve a lista ordenada
 * da esquerda para a direita (posição real na tela), cada uma com {label, left,
 * top, width, height, bottom}.
 */
/**
 * Cada cabeçalho é montado com 2 formas sobrepostas: um "pill" de fundo (sem
 * texto, mais largo) e uma caixa de texto com o rótulo por cima (mais estreita,
 * com um pequeno recuo). A linha de dados usa a geometria do PILL de fundo
 * (não da caixa de texto), então localizamos o texto pelo rótulo e depois
 * achamos o pill de fundo que o contém, para usar como geometria da coluna.
 */
function locateColumns_(slide) {
  var textShapes = [];
  var bgCandidates = [];

  slide.getShapes().forEach(function (shape) {
    var t = safeGetText_(shape);
    if (CONFIG.HEADER_LABELS.indexOf(t) !== -1) {
      textShapes.push({ label: t, shape: shape });
    } else if (t === '') {
      bgCandidates.push(shape);
    }
  });

  var columns = [];
  CONFIG.HEADER_LABELS.forEach(function (label) {
    var entry = textShapes.filter(function (e) { return e.label === label; })[0];
    if (!entry) return;

    var txt = entry.shape;
    var tLeft = txt.getLeft(), tTop = txt.getTop();
    var tRight = tLeft + txt.getWidth(), tBottom = tTop + txt.getHeight();

    var matchingBgs = bgCandidates.filter(function (b) {
      var bLeft = b.getLeft(), bTop = b.getTop();
      var bRight = bLeft + b.getWidth(), bBottom = bTop + b.getHeight();
      return Math.abs(bTop - tTop) < 5 && bLeft <= tLeft + 1 && bRight >= tRight - 1 && bBottom >= tBottom - 1;
    });
    matchingBgs.sort(function (a, b) { return a.getWidth() - b.getWidth(); }); // pega o menor pill que contém o texto
    var geomShape = matchingBgs[0] || txt;

    columns.push({
      label: label,
      left: geomShape.getLeft(),
      top: geomShape.getTop(),
      width: geomShape.getWidth(),
      height: geomShape.getHeight()
    });
  });

  if (columns.length < CONFIG.HEADER_LABELS.length) {
    throw new Error('Não encontrei todas as colunas esperadas no slide. Encontradas: ' + columns.map(function(c){return c.label;}).join(', '));
  }

  columns.sort(function (a, b) { return a.left - b.left; });
  columns.forEach(function (c) { c.bottom = c.top + c.height; });
  return columns;
}

/**
 * Lê as linhas JÁ MARCADAS (RC|) no slide, indexadas por Key da Story.
 * Devolve { key: { colIndex: shape } }.
 */
function readRowShapesByKey_(slide, columns) {
  var rows = {};
  slide.getShapes().forEach(function (shape) {
    var desc = safeGetDescription_(shape);
    if (!desc || desc.indexOf(CONFIG.ROW_TAG_PREFIX) !== 0) return;
    var parts = desc.split('|'); // RC|<key>|<colIndex>
    var key = parts[1];
    var colIdx = parseInt(parts[2], 10);
    if (!rows[key]) rows[key] = {};
    rows[key][colIdx] = shape;
  });
  return rows;
}

/**
 * Localiza, num slide recém-duplicado do modelo pristine, as 8 formas da
 * linha de exemplo (posicionada logo abaixo dos cabeçalhos, alinhada às
 * colunas, ainda sem nenhuma marca RC|). Usada como base de clonagem para
 * todas as linhas da página.
 */
function findExampleRow_(slide, columns) {
  var headerBottom = Math.max.apply(null, columns.map(function (c) { return c.bottom; }));
  var example = {};

  columns.forEach(function (col, idx) {
    var candidate = null;
    slide.getShapes().forEach(function (shape) {
      var desc = safeGetDescription_(shape);
      // Ignora cabeçalhos e marcadores internos, mas ACEITA linhas de dados já
      // marcadas (RC|) como candidatas — o modelo pode ter sido "herdado" de
      // uma página de conteúdo antiga, então nem sempre há uma linha "limpa".
      if (desc && desc.indexOf(CONFIG.ROW_TAG_PREFIX) !== 0 && desc !== '') return;
      var left = shape.getLeft();
      var top = shape.getTop();
      var withinColumn = Math.abs(left - col.left) < 4 && Math.abs(shape.getWidth() - col.width) < 4;
      var belowHeader = top > headerBottom - 2 && top < headerBottom + 60;
      if (withinColumn && belowHeader) {
        if (!candidate || top < candidate.getTop()) candidate = shape;
      }
    });
    if (candidate) example[idx] = candidate;
  });

  if (Object.keys(example).length < columns.length) {
    throw new Error('Não encontrei a linha de exemplo original abaixo dos cabeçalhos para usar como modelo.');
  }

  return example;
}

/**
 * Remove qualquer forma marcada como linha de dados (RC|) que não faça parte
 * da linha de exemplo escolhida — usado quando o modelo foi "herdado" de uma
 * página de conteúdo antiga (que já tinha várias linhas próprias), pra não
 * duplicar cards de execuções anteriores nas páginas novas.
 */
function removeOldPageLabels_(slide) {
  slide.getShapes().forEach(function (shape) {
    var t = safeGetText_(shape);
    if (t && /^Página \d+ de \d+$/.test(t)) shape.remove();
  });
}

function removeLeftoverRows_(slide, exampleRow) {
  var keepIds = {};
  Object.keys(exampleRow).forEach(function (idx) {
    keepIds[exampleRow[idx].getObjectId()] = true;
  });

  slide.getShapes().forEach(function (shape) {
    var desc = safeGetDescription_(shape);
    if (!desc || desc.indexOf(CONFIG.ROW_TAG_PREFIX) !== 0) return;
    if (keepIds[shape.getObjectId()]) return;
    shape.remove();
  });
}

/**
 * Clona as 8 formas de uma linha (duplicate()) para criar uma nova linha.
 */
function cloneRowShapes_(slide, sourceCells, newKey) {
  var clones = {};
  Object.keys(sourceCells).forEach(function (colIdx) {
    // duplicate() devolve um PageElement genérico; asShape() recupera os
    // métodos de Shape (getText, getBorder, getFill, etc.)
    clones[colIdx] = sourceCells[colIdx].duplicate().asShape();
  });
  return clones;
}

function positionRowShapes_(rowShapes, columns, targetTop, rowHeight) {
  columns.forEach(function (col, idx) {
    var shape = rowShapes[idx];
    if (!shape) return;
    shape.setLeft(col.left);
    shape.setTop(targetTop);
    shape.setWidth(col.width);
    if (rowHeight) shape.setHeight(rowHeight);
  });
}

/**
 * Calcula a altura e o espaçamento de linha para uma página com "rowCount"
 * linhas, usando como alvo uma altura confortável (CONFIG.TARGET_ROW_HEIGHT).
 * Só comprime abaixo disso se "rowCount" não couber nem no mínimo confortável
 * dentro do espaço disponível.
 */
function computeCompactRowFit_(available, rowCount) {
  if (rowCount <= 0) rowCount = 1;
  var gap = CONFIG.TARGET_ROW_GAP;
  var rawHeight = (available - (rowCount - 1) * gap) / rowCount;
  var rowHeight = Math.max(CONFIG.MIN_ROW_HEIGHT, Math.min(CONFIG.MAX_ROW_HEIGHT, rawHeight));

  var totalNeeded = rowCount * rowHeight + (rowCount - 1) * gap;
  if (totalNeeded > available && rowCount > 1) {
    gap = Math.max(0.5, gap - (totalNeeded - available) / (rowCount - 1));
  }

  return { rowHeight: rowHeight, rowGap: gap };
}

/**
 * Marca cada forma da linha com "RC|<key>|<colIndex>" (usado pra localizar e
 * atualizar a linha em execuções seguintes). Na forma da coluna Plano de
 * Ação, um terceiro campo é acrescentado com o texto COMPLETO do Plano de
 * Ação (sem o corte de truncateToFit_) SEGUIDO do Risco Impacto (que não
 * tem mais coluna própria no slide) — é uma nota no próprio objeto (campo
 * "Descrição"/Alt text da forma, em Formatar > Opções de formatação > Texto
 * alternativo), não a anotação do apresentador do slide inteiro. O título
 * "Risco Impacto:" sempre aparece nessa nota, mesmo quando o campo está
 * vazio no Jira (mostra "-"). O parsing em readRowShapesByKey_ só lê os dois
 * primeiros campos, então esse texto extra não interfere em nada.
 */
function tagRowShapes_(rowShapes, story, columns) {
  var planoAcaoIdx = columns.findIndex(function (c) { return c.label === 'Plano de Ação'; });
  columns.forEach(function (col, colIdx) {
    var shape = rowShapes[colIdx];
    if (!shape) return;
    var desc = CONFIG.ROW_TAG_PREFIX + story.key + '|' + colIdx;
    if (colIdx === planoAcaoIdx) {
      // A nota do objeto mostra cada item do Plano de Ação em sua própria
      // linha, igual à quantidade de itens que existem no card.
      var planoLines = story.planoAcao || '';
      var riscoNote = 'Risco Impacto: ' + (story.risco || '-');
      desc += '|' + (planoLines ? planoLines + '\n\n' + riscoNote : riscoNote);
    }
    shape.setDescription(desc);
  });
}

/**
 * Trunca o texto pra caber em até 2 LINHAS, na largura real da coluna e na
 * altura real da linha (estimativa de largura média de caractere e de altura
 * de entrelinha a 7pt), cortando com "…" se passar disso. Corta pra 1 linha
 * só quando a linha estiver baixa demais até pra 2 (módulo muito cheio,
 * encolhido por computeFitAllRowHeight_).
 */
function truncateToFit_(text, colWidthPt, rowHeightPt) {
  if (text === null || text === undefined) return text;
  text = String(text);
  if (!text) return text;

  var AVG_CHAR_WIDTH_FACTOR = 0.55; // largura média de caractere ≈ 0.55x o tamanho da fonte, em pt
  var LINE_HEIGHT_FACTOR = 1.25;    // altura de linha ≈ 1.25x o tamanho da fonte, em pt
  var innerWidth = Math.max(10, colWidthPt - 6);   // desconta um respiro interno pequeno
  var innerHeight = Math.max(6, (rowHeightPt || TWO_LINE_ROW_HEIGHT) - 2);

  var charsPerLine = Math.max(4, Math.floor(innerWidth / (CONFIG.FONT_SIZE * AVG_CHAR_WIDTH_FACTOR)));
  var maxLines = Math.max(1, Math.min(2, Math.floor(innerHeight / (CONFIG.FONT_SIZE * LINE_HEIGHT_FACTOR))));
  var maxChars = charsPerLine * maxLines;

  if (text.length <= maxChars) return text;
  return text.substring(0, Math.max(1, maxChars - 1)).trim() + '…';
}

/**
 * Ícone de prioridade (High/Highest), mesmo padrão usado no painel web: um
 * triângulo para High, dois para Highest. Sem coluna própria no slide — o
 * ícone entra junto do texto da coluna Key (a que já tem o link pro card),
 * logo depois da chave.
 */
function priorityIcon_gs_(priorityName) {
  var key = (priorityName || '').trim().toUpperCase();
  if (key === 'HIGHEST') return '▲▲';
  if (key === 'HIGH') return '▲';
  return '';
}

function isHighPriority_gs_(priorityName) {
  var key = (priorityName || '').trim().toUpperCase();
  return key === 'HIGH' || key === 'HIGHEST';
}

function buildValuesByLabel_(story, epic) {
  var icon = priorityIcon_gs_(story.priorityName);
  var values = {};
  values['Data Surg'] = story.createdFormatted;
  values['Projeto ou Frente'] = epic.key + ' ' + epic.summary;
  values['Key'] = story.key + (icon ? ' ' + icon : '');
  values['Status'] = story.status; // nome completo do status, sem abreviação
  values['Nome da Atividade'] = story.summary;
  values['Plano de Ação'] = story.planoAcao;
  values['Responsável'] = story.assignee;
  return values;
}

/**
 * Preenche o texto de cada célula da linha com o valor atual (sem histórico
 * de comparação com execuções anteriores) e aplica a borda (verde fina se
 * Done, cor do épico na célula "Projeto ou Frente" — mesma cor usada pra essa
 * frente no painel web, sinalização discreta, borda fina — padrão nos
 * demais) e o estilo itálico/cinza no Plano de Ação quando houver múltiplos
 * itens.
 */
function fillRowShapes_(rowShapes, columns, valuesByLabel, statusAbbrev, planoAcao, rowIdx, rowHeight, priorityName, epicColor) {
  var isDone = statusAbbrev === 'DON';
  var planoIsMultiple = (planoAcao || '').indexOf('\n') !== -1;
  var isHighPrio = isHighPriority_gs_(priorityName);
  var zebraFill = (rowIdx % 2 === 0) ? CONFIG.ROW_FILL_EVEN : CONFIG.ROW_FILL_ODD;

  columns.forEach(function (col, idx) {
    var shape = rowShapes[idx];
    if (!shape) return;

    // Trunca o valor pro texto NUNCA estourar a altura da linha — é isso que
    // fazia um card "vazar" visualmente por cima do de baixo (Apps Script não
    // permite configurar "encolher texto para caber" nas formas).
    var newValue = truncateToFit_(valuesByLabel[col.label], col.width, rowHeight);

    // Texto sem negrito por padrão, todos os campos com o mesmo tamanho de fonte.
    var style = {};
    if (col.label === 'Plano de Ação' && planoIsMultiple) {
      style.italic = true;
      style.color = '#9aa0a6';
    }
    // Prioridade High/Highest: sem coluna própria — o ícone (▲/▲▲) já foi
    // anexado ao valor da coluna Key em buildValuesByLabel_; aqui só pinta a
    // célula inteira de vermelho pra destacar (mesmo padrão do painel web).
    if (col.label === 'Key' && isHighPrio) {
      style.color = '#c0392b';
    }

    setShapeText_(shape, newValue, style);

    // Fundo: zebra sutil para legibilidade em todas as linhas (Done ou não) —
    // o verde do Done fica só na borda, nunca no preenchimento.
    shape.getFill().setSolidFill(zebraFill);

    // Borda: verde só na célula de Status quando Done; cor do épico só na
    // célula "Projeto ou Frente" (sinalização discreta, borda fina, mesma cor
    // do épico no painel web); padrão fina nas demais células da linha.
    var isDoneStatusCell = isDone && col.label === 'Status';
    var isEpicCell = col.label === 'Projeto ou Frente' && epicColor;
    var border = shape.getBorder();
    border.setWeight(isDoneStatusCell || isEpicCell ? CONFIG.DONE_BORDER_WEIGHT : CONFIG.DEFAULT_BORDER_WEIGHT);
    if (isDoneStatusCell) {
      border.getLineFill().setSolidFill(CONFIG.DONE_BORDER_COLOR);
    } else if (isEpicCell) {
      border.getLineFill().setSolidFill(epicColor);
    } else {
      border.getLineFill().setSolidFill(CONFIG.DEFAULT_BORDER_COLOR);
    }
  });

  // Links: Key aponta para a Story, Projeto ou Frente aponta para o Epic
  var keyIdx = columns.findIndex(function (c) { return c.label === 'Key'; });
  var epicIdx = columns.findIndex(function (c) { return c.label === 'Projeto ou Frente'; });
  var jiraBase = CONFIG.JIRA_BASE_URL + '/browse/';
  if (rowShapes[keyIdx]) rowShapes[keyIdx].getText().getTextStyle().setLinkUrl(jiraBase + valuesByLabel['Key'].split(' ')[0]);
  if (rowShapes[epicIdx]) rowShapes[epicIdx].getText().getTextStyle().setLinkUrl(jiraBase + valuesByLabel['Projeto ou Frente'].split(' ')[0]);
}

/**
 * Escreve o valor (já truncado) numa forma, aplicando os estilos base
 * (tamanho de fonte, itálico/cor) passados em style. Sem histórico de
 * comparação — sempre mostra só o valor atual.
 */
function setShapeText_(shape, newValue, style) {
  newValue = (newValue === null || newValue === undefined || newValue === '') ? '-' : String(newValue);

  var tr = shape.getText();
  tr.setText('');
  tr.setText(newValue);

  // Remove o espaçamento de parágrafo herdado do modelo original (era pensado
  // para linhas mais altas); sem isso o texto "parece" maior que a caixa mesmo
  // com a linha já comprimida.
  try {
    var ps = tr.getParagraphStyle();
    ps.setLineSpacing(95);
    ps.setSpaceAbove(0);
    ps.setSpaceBelow(0);
  } catch (e) {}

  var fullRange = tr.getRange(0, newValue.length);
  applyBaseStyle_(fullRange, style);
}

function applyBaseStyle_(range, style) {
  if (!range || range.asString().length === 0) return; // range vazio: getTextStyle() vem null
  var ts = range.getTextStyle();
  if (!ts) return;
  ts.setFontSize(CONFIG.FONT_SIZE); // fonte única em todos os campos
  ts.setBold(false); // nunca negrito, em nenhum campo
  if (style.italic) ts.setItalic(true);
  if (style.color) ts.setForegroundColor(style.color);
}

// ======================= CABEÇALHO (DATA) =======================

function ensureReportMarker_(slide, runId) {
  var marker = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, -20, -20, 1, 1);
  marker.getFill().setTransparent();
  marker.getBorder().setTransparent();
  marker.setDescription(CONFIG.REPORT_MARKER_PREFIX + runId);
}

/**
 * Localiza o pill pelo PREFIXO do texto (ex: "DATA APRESENTAÇÃO") e
 * reescreve o texto inteiro com o rótulo + valor atual — em vez de um
 * replaceAllText com regex, que pode falhar SILENCIOSAMENTE (sem erro
 * nenhum) se o texto existente não bater exatamente com o padrão esperado,
 * deixando a data antiga/errada no slide sem avisar ninguém (bug real já
 * visto: pill ficou preso em "25/09" mesmo semanas depois). Preserva a cor
 * do texto original, quando existir, pra não perder a formatação do pill.
 */
function overwritePillText_(shape, label, value) {
  var tr = shape.getText();
  var color = null;
  try {
    var oldLen = tr.asString().length;
    if (oldLen > 0) {
      var oldStyle = tr.getRange(0, oldLen).getTextStyle();
      color = oldStyle && oldStyle.getForegroundColor();
    }
  } catch (e) {}

  var newText = label + '\n' + value;
  tr.setText(newText);

  try {
    var newRange = tr.getRange(0, newText.length);
    if (color) newRange.getTextStyle().setForegroundColor(color.asRgbColor().asHexString());
  } catch (e) {}
}

function updateHeaderDate_(slide) {
  var today = new Date();
  var dd = ('0' + today.getDate()).slice(-2);
  var mm = ('0' + (today.getMonth() + 1)).slice(-2);
  var yyyy = today.getFullYear();

  var mesAno = mm + '/' + yyyy;
  var dataApresentacao = dd + '/' + mm;

  slide.getShapes().forEach(function (shape) {
    var t = safeGetText_(shape);
    if (!t) return;
    if (t.indexOf('DATA APRESENTAÇÃO') === 0) {
      overwritePillText_(shape, 'DATA APRESENTAÇÃO', dataApresentacao);
    } else if (t.indexOf('MÊS/ANO') === 0) {
      overwritePillText_(shape, 'MÊS/ANO', mesAno);
    }
  });
}

// ======================= JIRA =======================

/**
 * Detecta se um item é uma subtarefa (filha de uma história, não de um
 * épico) — mesmo critério usado no painel web (isSubtaskIssue_): primeiro
 * confere o flag oficial do Jira (issuetype.subtask), com fallback pro nome
 * do tipo conter SUB-TASK/SUBTASK/SUBTAREFA, pra cobrir instâncias Jira
 * onde esse flag não vem populado.
 */
function isSubtaskIssue_(f) {
  if (f.issuetype && f.issuetype.subtask === true) return true;
  var typeName = ((f.issuetype && f.issuetype.name) || '').trim().toUpperCase();
  return typeName.indexOf('SUB-TASK') !== -1 || typeName.indexOf('SUBTASK') !== -1 || typeName.indexOf('SUBTAREFA') !== -1;
}

function fetchJiraData_() {
  var creds = getJiraCredentials_();
  var jql = 'project = ' + CONFIG.PROJECT_KEY + ' ORDER BY parent ASC, created ASC';
  var url = CONFIG.JIRA_BASE_URL + '/rest/api/3/search/jql?jql=' + encodeURIComponent(jql) +
    '&maxResults=100&fields=summary,status,assignee,created,issuetype,parent,subtasks,priority,' +
    CONFIG.RISK_CUSTOM_FIELD + ',' + CONFIG.PLANO_ACAO_CUSTOM_FIELD + ',' + CONFIG.EPIC_COLOR_CUSTOM_FIELD;

  var options = {
    method: 'get',
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(creds.email + ':' + creds.token),
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    throw new Error('Erro ao consultar Jira: ' + response.getResponseCode() + ' - ' + response.getContentText());
  }

  var json = JSON.parse(response.getContentText());
  var epics = {};
  var stories = [];

  json.issues.forEach(function (issue) {
    var f = issue.fields;
    if (f.issuetype.name === 'Epic') {
      epics[issue.key] = { key: issue.key, summary: f.summary, colorName: f[CONFIG.EPIC_COLOR_CUSTOM_FIELD] || null };
    } else if (isSubtaskIssue_(f)) {
      // Subtarefas (filhas de uma história, não de um épico) nunca aparecem
      // neste relatório — o board/slide mostra só Épico → História. Mesmo
      // critério usado no painel web (isSubtaskIssue_).
      return;
    } else {
      var planoAcao = buildPlanoAcao_(f[CONFIG.PLANO_ACAO_CUSTOM_FIELD], f.subtasks);

      stories.push({
        key: issue.key,
        summary: f.summary,
        status: f.status.name,
        statusAbbrev: abbreviateStatus_(f.status.name),
        assignee: f.assignee ? f.assignee.displayName : '-',
        created: f.created,
        createdFormatted: formatDate_(f.created),
        epicKey: f.parent ? f.parent.key : null,
        risco: adfToText_(f[CONFIG.RISK_CUSTOM_FIELD]),
        planoAcao: planoAcao,
        priorityName: f.priority ? f.priority.name : ''
      });
    }
  });

  return { epics: epics, stories: stories };
}

/**
 * Monta o texto de Plano de Ação a partir do campo customizado "Plano de Ação"
 * (CONFIG.PLANO_ACAO_CUSTOM_FIELD), criado manualmente no Jira como campo de
 * texto multi-linha (Paragraph). Cada linha do campo vira um item, juntados
 * com " / ". Se o campo estiver vazio, cai para subtasks nativas e por fim
 * para o texto padrão "Refinar para definir".
 */
function buildPlanoAcao_(planoAcaoField, subtasks) {
  var text = adfToText_(planoAcaoField);
  if (text) {
    var items = text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (items.length > 0) return items.join('\n');
  }

  var subtaskNames = (subtasks || []).map(function (st) { return st.fields.summary; });
  if (subtaskNames.length > 0) return subtaskNames.join('\n');

  return 'Refinar para definir';
}

function abbreviateStatus_(statusName) {
  var normalized = statusName.trim().toUpperCase();
  if (normalized === 'DONE' || normalized === 'CONCLUÍDO' || normalized === 'CONCLUIDO') return 'DON';
  return normalized.substring(0, 3);
}

function formatDate_(isoDate) {
  var d = new Date(isoDate);
  var dd = ('0' + d.getDate()).slice(-2);
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  return dd + '/' + mm;
}

/**
 * O Jira devolve alguns campos de texto (como o customfield de Risco Impacto,
 * se configurado como "Paragraph") no formato rico ADF (objeto com content/text),
 * não como string simples. Esta função extrai só o texto puro, recursivamente.
 */
function adfToText_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value !== 'object') return String(value).trim();

  var text = '';
  if (value.text) text += value.text;
  if (Array.isArray(value.content)) {
    value.content.forEach(function (child) {
      text += adfToText_(child);
      if (child && (child.type === 'hardBreak' || child.type === 'paragraph')) text += '\n';
    });
  }
  return text.trim();
}

function safeGetText_(shape) {
  try {
    return shape.getText().asString().trim();
  } catch (e) {
    return null;
  }
}

function safeGetDescription_(shape) {
  try {
    return shape.getDescription();
  } catch (e) {
    return null;
  }
}

/**
 * Reset de credenciais do Jira — use SÓ se o token expirou ou você quer trocar
 * de conta. Fica no mesmo arquivo do script principal (updateSlide), como
 * segunda opção no dropdown de ▶ Executar — não precisa mais colar um arquivo
 * separado nem trocar o conteúdo do Código.gs para resetar.
 */
function resetJiraCredentials() {
  PropertiesService.getScriptProperties().deleteProperty('JIRA_EMAIL');
  PropertiesService.getScriptProperties().deleteProperty('JIRA_API_TOKEN');
  SlidesApp.getUi().alert('Credenciais do Jira apagadas. Na próxima execução de updateSlide, será pedido novamente.');
}

/**
 * Menu "Painel SHM" com a opção de reset, direto na barra de menus do
 * Slides. Recarregue a aba do Slides uma vez depois de colar/atualizar o
 * script para o menu aparecer.
 */
function onOpen() {
  SlidesApp.getUi()
    .createMenu('Painel SHM')
    .addItem('Resetar credenciais do Jira', 'resetJiraCredentials')
    .addToUi();
}
`;

const SCRIPT_HOURS = String.raw`
/**
 * Relatório de Horas — bound ao arquivo da apresentação "Relatório de Horas"
 * (https://docs.google.com/presentation/d/1JZAbooDgZD_zFDxImmcV34zAvWHu87AdUTEphOIMDPM).
 * Só tem a função generateHoursReport() no dropdown de Executar, mesmo
 * padrão do script principal do painel SHM (nunca risco de rodar a função
 * errada). Lê os apontamentos de horas da página Notion "Gestão de Tempo"
 * (sub-páginas por mês), monta até 2 slides (2 semanas por slide) com a
 * tabela Semana / Data / Nome da Atividade / Horas, excluindo linhas
 * HTPC/HTC e texto tachado, e soma o total de horas x R$ 123,00/h na
 * última linha do último slide. Os slides gerados são SEMPRE inseridos no
 * INÍCIO da apresentação (viram slide 1, 2...), empurrando o conteúdo
 * existente pra baixo — toda vez que o script roda de novo, os slides da
 * execução anterior são removidos primeiro (idempotente).
 *
 * IMPORTANTE (validar ao vivo): a página "Gestão de Tempo" usa um formato de
 * GRADE SEMANAL PIVOTADA (uma tabela nativa por semana, colunas = dias tipo
 * "Qui01"/"Sex02", linhas = horários), não "uma linha por atividade". A
 * busca (collectWeeklyTables_) é recursiva, acha TODAS as tabelas da página
 * e tenta achar o texto "Período DD/MM-DD/MM" acima de cada uma pra saber o
 * mês/ano da semana; se não achar esse texto, usa o mês/ano da página com
 * fallback por queda no número do dia (ver resolveColumnDates_). Isso NÃO
 * foi testado contra a página real "Gestão de Tempo" nesta sessão — os
 * erros lançados indicam exatamente onde parou (nenhuma tabela encontrada /
 * cabeçalho não reconhecido / tabelas vazias). Um formato antigo "uma linha
 * por atividade" (via child_database) ainda é aceito como fallback de
 * último recurso (ver parseEntriesLegacyFlat_/detectColumns_), caso a
 * página real use isso em vez da grade.
 */

var HOURS_CONFIG = {
  PRESENTATION_ID: '1JZAbooDgZD_zFDxImmcV34zAvWHu87AdUTEphOIMDPM',
  NOTION_ROOT_PAGE_ID: '3b3a28e6736180f79f34c5db6b4812e6', // página "Gestão de Tempo"
  NOTION_VERSION: '2022-06-28',
  NOTION_API_BASE: 'https://api.notion.com/v1',
  HOUR_VALUE: 123, // R$ por hora, fixo
  MAX_WEEKS_PER_SLIDE: 2,
  // Qualquer uma dessas palavras, isolada (linha inteira classificada assim),
  // faz a linha inteira ser excluída do relatório final (hora extra interna,
  // não aparece pro cliente).
  EXCLUDE_ROW_TAGS: ['HTPC', 'HTC'],
  // Essas mesmas palavras, quando aparecem NO MEIO do texto de uma atividade
  // que não é inteiramente HTPC/HTC, são removidas só do trecho (mantém o
  // resto da descrição).
  INTERNAL_MARKERS_REGEX: /\b(hora\s*extra|htpc|htc)\b[:\-–]?\s*/gi,

  // ----- Visual (layout de referência enviado pelo usuário) -----
  SLIDE_BG: '#ffffff',          // fundo do slide: branco puro
  EYEBROW_TEXT: 'CF5',
  EYEBROW_COLOR: '#c0142e',     // vermelho do "CF5" e do traço sob o título (idêntico ao slide do mês 9)
  TITLE_TEXT: 'Relatorio de Horas',
  TITLE_COLOR: '#1a1a1a',
  TITLE_FONT_FAMILY: 'Impact',  // Impact SEM negrito, igual ao relatório do mês 9
  PILL_FILL: '#243666',         // navy do card MES/ANO do relatório do mês 9
  PILL_TEXT: '#ffffff',
  HEADER_FILL: '#e8e8e8',       // cabeçalho da tabela: cinza-claro
  HEADER_TEXT: '#333333',
  CARD_FILL: '#ffffff',         // fundo da própria tabela (linhas)
  ROW_FILL_EVEN: '#ffffff',
  ROW_FILL_ODD: '#ffffff',      // linhas todas brancas, igual ao mês 9
  BORDER_COLOR: '#e3e5e9',
  ACTIVITY_TEXT_COLOR: '#333333',
  TOTAL_FILL: '#243666',        // navy da linha de total (mesma cor do card MES/ANO)
  TOTAL_TEXT: '#ffffff',
  FONT_FAMILY: 'Calibri',
  FONT_SIZE: 8,                 // fonte do corpo/cabeçalho da tabela — igual ao mês 9
  HEADER_FONT_SIZE: 8,

  // ----- Geometria do relatório do mês 9 (página 960x540pt) — NÃO ALTERAR sem
  // o usuário pedir: todo relatório mensal deve sair idêntico a esse padrão.
  EYEBROW_X: 39.6, EYEBROW_Y: 23, EYEBROW_W: 360, EYEBROW_H: 17.3, EYEBROW_FONT_SIZE: 12,
  TITLE_X: 36, TITLE_Y: 39.6, TITLE_W: 648, TITLE_H: 36,
  TITLE_FONT_SIZE: 20,          // Impact 20pt, sem negrito
  UNDERLINE_X: 39.6, UNDERLINE_Y: 75.6, UNDERLINE_W: 86.4, UNDERLINE_WEIGHT: 2.25,
  PILL_Y: 10.8, PILL_W: 158.4, PILL_H: 39.6, PILL_FONT_SIZE: 9,
  // Borda direita comum do card MES/ANO e da tabela: 960 - 31.2 = 928.8.
  RIGHT_MARGIN: 31.2,
  TABLE_LEFT: 36,
  TABLE_TOP: 100.4,
  // Larguras de coluna (pt): Semana/Data/Horas iguais ao mês 9; "Nome da
  // Atividade" absorve TODO o espaço restante até a borda direita (folga
  // grande pra descrições longas).
  COL_WIDTH_SEMANA: 89.1,
  COL_WIDTH_DATA: 61.7,
  COL_WIDTH_HORAS: 54.9
};

/**
 * Função principal, SEMPRE a primeira função declarada neste arquivo de
 * propósito — o Apps Script usa a primeira função do arquivo como opção
 * padrão (pré-selecionada) no dropdown ao lado de ▶ Executar, então você não
 * precisa abrir a lista toda vez, só clicar em Executar direto. Lista os
 * meses disponíveis em "Gestão de Tempo", sugere o mais recente, confirma
 * com o usuário (não existe UI de dropdown real em Apps Script puro, então
 * usa um prompt de texto simples) e gera os slides desse mês.
 */
function generateHoursReport() {
  var token = getNotionToken_();

  var monthPages = listMonthSubpages_(token);
  if (!monthPages.length) {
    throw new Error('Não encontrei sub-páginas de mês dentro de "Gestão de Tempo" no Notion.');
  }

  var defaultPage = pickDefaultMonthPage_(monthPages);
  var chosen = promptMonthChoice_(monthPages, defaultPage);

  var entries = fetchAndParseMonthEntries_(token, chosen.id, chosen.title);
  var consolidated = consolidateByDay_(entries);
  var weeks = groupEntriesByWeek_(consolidated);

  buildHoursSlides_(chosen.title, weeks);

  SlidesApp.getUi().alert('Relatório de horas gerado para ' + chosen.title + ' (' + weeks.length + ' semana(s)).');
}

/**
 * Autorização em separado (função secundária, só use se generateHoursReport
 * pedir): na PRIMEIRA vez que QUALQUER função deste projeto roda, o Apps
 * Script precisa mostrar a tela de consentimento de permissões (Google, não
 * controlada por este código) — e SlidesApp.getUi() não pode ser chamado
 * durante essa mesma execução de autorização, o que gera o erro "Cannot call
 * SlidesApp.getUi() from this context." Para evitar isso: escolha esta
 * função (authorizeHoursReport) no dropdown ao lado de ▶ Executar e rode-a
 * PRIMEIRO, uma única vez — ela só toca em serviços que não disparam esse
 * erro, forçando a tela de permissões a aparecer sozinha. Depois de aceitar
 * as permissões, troque o dropdown de volta para generateHoursReport (ou só
 * clique em Executar, já que ela é a opção padrão) e rode normalmente.
 */
function authorizeHoursReport() {
  PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  SlidesApp.openById(HOURS_CONFIG.PRESENTATION_ID);
}

/**
 * Credencial do Notion: mesmo padrão de getJiraCredentials_() do script
 * principal — pede uma vez via prompt, salva em PropertiesService, não pede
 * de novo nas próximas execuções.
 */
function getNotionToken_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('NOTION_TOKEN');
  if (!token) {
    var ui;
    try {
      ui = SlidesApp.getUi();
    } catch (e) {
      throw new Error('Antes de gerar o relatório, rode a função "authorizeHoursReport" uma vez (escolha ela no dropdown ao lado de ▶ Executar), aceite as permissões pedidas pelo Google, e depois rode "generateHoursReport" de novo.');
    }
    var resp = ui.prompt(
      'Configuração Notion (só uma vez)',
      'Cole a Notion integration token (criada em www.notion.so/my-integrations, com acesso compartilhado à página "Gestão de Tempo"):',
      ui.ButtonSet.OK_CANCEL
    );
    if (resp.getSelectedButton() !== ui.Button.OK) throw new Error('Configuração cancelada.');
    token = sanitizeNotionToken_(resp.getResponseText());
    if (!token) throw new Error('Token vazio — configuração cancelada.');
    props.setProperty('NOTION_TOKEN', token);
  }
  return sanitizeNotionToken_(token);
}

/**
 * Limpa o token colado: remove espaços/quebras de linha nas pontas, aspas
 * acidentais, e um prefixo "Bearer " caso o usuário tenha colado o cabeçalho
 * inteiro em vez de só o token — qualquer um desses detalhes quebra a
 * validação da API do Notion com o erro 'Authorization header must use the
 * format "Bearer <token>"'.
 */
function sanitizeNotionToken_(raw) {
  var t = (raw || '').replace(/[\r\n]+/g, '').trim();
  t = t.replace(/^["']+|["']+$/g, '').trim();
  t = t.replace(/^bearer\s+/i, '').trim();
  return t;
}

function resetNotionToken() {
  PropertiesService.getScriptProperties().deleteProperty('NOTION_TOKEN');
  SlidesApp.getUi().alert('Token do Notion removido — a próxima execução de generateHoursReport vai pedir de novo.');
}

/**
 * Chamada genérica à API do Notion (REST, via UrlFetchApp — Apps Script não
 * tem SDK oficial do Notion).
 */
function notionFetch_(token, path, method, payload) {
  var options = {
    method: method || 'get',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': HOURS_CONFIG.NOTION_VERSION
    },
    contentType: 'application/json',
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);
  var resp = UrlFetchApp.fetch(HOURS_CONFIG.NOTION_API_BASE + path, options);
  var code = resp.getResponseCode();
  var body = JSON.parse(resp.getContentText() || '{}');
  if (code >= 300) {
    throw new Error('Notion API (' + code + '): ' + (body.message || JSON.stringify(body)));
  }
  return body;
}

/**
 * Lista as sub-páginas diretas (blocos child_page) da página "Gestão de
 * Tempo" — cada uma representa um mês (ex: "Outubro 2026", "10/2026" etc,
 * qualquer formato). Pagina os resultados (Notion devolve no máximo 100
 * blocos por chamada).
 */
function listMonthSubpages_(token) {
  var pages = [];
  var cursor = null;
  do {
    var path = '/blocks/' + HOURS_CONFIG.NOTION_ROOT_PAGE_ID + '/children?page_size=100' +
      (cursor ? '&start_cursor=' + cursor : '');
    var data = notionFetch_(token, path, 'get', null);
    (data.results || []).forEach(function (block) {
      if (block.type === 'child_page') {
        pages.push({ id: block.id, title: block.child_page.title, lastEdited: block.last_edited_time });
      }
    });
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return pages;
}

var MONTH_NAMES_PT_ = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
var MONTH_ABBR_PT_ = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/**
 * Extrai {month (0-11), year} do título de uma página de mês — aceita nome
 * completo ("Outubro 2026"), abreviação ("Out/2026"), numérico com ano de 4
 * dígitos ("10/2026") OU ano de 2 dígitos ("10/26", já visto em títulos reais
 * tipo "1026 / Tempo" → mês 10, ano 26 → 2026). Usada tanto para sugerir o
 * mês padrão quanto como contexto (mês/ano) para interpretar colunas de data
 * que só têm o dia solto (ex. "21") na tabela de apontamentos.
 */
function parseMonthYear_(title) {
  var t = (title || '').toLowerCase();
  for (var i = 0; i < MONTH_NAMES_PT_.length; i++) {
    if (t.indexOf(MONTH_NAMES_PT_[i]) !== -1) {
      var yearMatch = t.match(/(20\d{2})/);
      return { month: i, year: yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear() };
    }
  }
  var numMatch4 = t.match(/(\d{1,2})[\/\-](20\d{2})/);
  if (numMatch4) {
    return { month: parseInt(numMatch4[1], 10) - 1, year: parseInt(numMatch4[2], 10) };
  }
  // Ano de 2 dígitos sem separador claro de "mês completo" — ex "1026" (mês
  // 10, ano 26) ou "10/26". Só aceita mês 01-12 plausível.
  var numMatch2 = t.match(/(\d{1,2})[\/\-]?(\d{2})(?!\d)/);
  if (numMatch2) {
    var mm = parseInt(numMatch2[1], 10);
    if (mm >= 1 && mm <= 12) {
      return { month: mm - 1, year: 2000 + parseInt(numMatch2[2], 10) };
    }
  }
  return null;
}

/**
 * Sugere o mês mais recente: tenta extrair mês/ano do título (ex: "Outubro
 * 2026", "Out/2026", "10/2026", "10/26"); se não conseguir reconhecer nenhum
 * título, cai pra ordenar por last_edited_time (a sub-página mexida mais
 * recentemente).
 */
function pickDefaultMonthPage_(monthPages) {
  var withParsed = monthPages
    .map(function (p) { return { page: p, parsed: parseMonthYear_(p.title) }; })
    .filter(function (x) { return x.parsed; });

  if (withParsed.length) {
    withParsed.sort(function (a, b) {
      if (a.parsed.year !== b.parsed.year) return b.parsed.year - a.parsed.year;
      return b.parsed.month - a.parsed.month;
    });
    return withParsed[0].page;
  }

  // Fallback: mais recentemente editada.
  var byEdited = monthPages.slice().sort(function (a, b) {
    return new Date(b.lastEdited) - new Date(a.lastEdited);
  });
  return byEdited[0];
}

/**
 * Apps Script puro não tem UI de dropdown real num script vinculado ao
 * Slides — Browser.inputBox só existe em contexto de Planilhas, então usa
 * sempre o prompt de UI do próprio Slides, listando as opções numeradas com
 * o mês sugerido já preenchido.
 */
function promptMonthChoice_(monthPages, defaultPage) {
  var listText = monthPages.map(function (p, i) { return (i + 1) + '. ' + p.title; }).join('\n');
  var message = 'Meses disponíveis em "Gestão de Tempo":\n' + listText +
    '\n\nDigite o NÚMERO do mês a gerar (ou deixe em branco para usar o sugerido: ' + defaultPage.title + ').';

  var ui = SlidesApp.getUi();
  var resp = ui.prompt('Relatório de Horas — escolha o mês', message, ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) throw new Error('Geração cancelada.');
  var answer = (resp.getResponseText() || '').trim();

  if (!answer) return defaultPage;
  var idx = parseInt(answer, 10);
  if (!isNaN(idx) && monthPages[idx - 1]) return monthPages[idx - 1];
  return defaultPage;
}

/**
 * FORMATO REAL (descoberto em 2026-10-01, ver memória
 * project_notion_gestao_tempo_schema.md): a página de cada mês NÃO tem uma
 * tabela "uma linha por atividade" — tem VÁRIAS tabelas nativas, uma por
 * semana, em formato de GRADE PIVOTADA: colunas = dias da semana (cabeçalho
 * tipo "Qui01", "Sex02" = abreviação do dia colada com o número do dia do
 * mês), linhas = horários/turnos, e cada célula contém o texto da(s)
 * atividade(s) daquele dia (podendo ter várias, separadas por quebra de
 * linha dentro da própria célula do Notion). Acima de cada tabela
 * normalmente há um texto "Período DD/MM-DD/MM" com o intervalo de datas da
 * semana.
 *
 * collectWeeklyTables_ busca TODAS as tabelas nativas da página
 * recursivamente (entra em qualquer bloco com has_children — toggle,
 * column_list, column etc.) e, pra cada uma, tenta achar o texto "Período"
 * no bloco irmão imediatamente anterior, no mesmo nível. Mantém também o
 * primeiro "child_database" encontrado (formato antigo/alternativo) como
 * fallback de último recurso — ver fetchAndParseMonthEntries_.
 */
function collectWeeklyTables_(token, blockId) {
  var tables = [];
  var database = null;
  var cursor = null;
  var containers = [];
  var lastText = null; // texto do último bloco de parágrafo/heading visto neste nível

  do {
    var path = '/blocks/' + blockId + '/children?page_size=100' + (cursor ? '&start_cursor=' + cursor : '');
    var data = notionFetch_(token, path, 'get', null);
    var results = data.results || [];
    for (var i = 0; i < results.length; i++) {
      var block = results[i];
      if (block.type === 'table') {
        tables.push({ block: block, periodText: lastText });
        lastText = null;
      } else if (block.type === 'child_database') {
        if (!database) database = block;
      } else {
        if (block.has_children) containers.push(block.id);
        var text = blockPlainText_(block);
        if (text) lastText = text;
      }
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  // Desce nos contêineres aninhados DEPOIS de esgotar o nível atual (busca em
  // largura primeiro), acumulando tabelas/database de todos os níveis.
  for (var j = 0; j < containers.length; j++) {
    var nested = collectWeeklyTables_(token, containers[j]);
    tables = tables.concat(nested.tables);
    if (!database) database = nested.database;
  }

  return { tables: tables, database: database };
}

/**
 * Extrai o texto corrido de um bloco "de texto" (paragraph, heading_1/2/3,
 * bulleted/numbered_list_item, quote, callout) — usado pra reconhecer o
 * texto "Período DD/MM-DD/MM" acima de cada tabela de semana. Blocos de
 * outros tipos (table, image, divider etc.) devolvem null.
 */
function blockPlainText_(block) {
  var TEXT_TYPES = ['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'quote', 'callout', 'toggle'];
  if (TEXT_TYPES.indexOf(block.type) === -1) return null;
  var rich = block[block.type] && block[block.type].rich_text;
  if (!rich || !rich.length) return null;
  var text = rich.map(function (rt) { return rt.plain_text || (rt.text && rt.text.content) || ''; }).join('').trim();
  return text || null;
}

/**
 * Busca as "table_row" filhas de um bloco "table" nativo do Notion (não vêm
 * na listagem normal de children da página, só na do próprio bloco table).
 * Devolve as células EM BRUTO (array de rich_text objects, sem converter
 * ainda pra texto) porque o parser de grade precisa inspecionar quebras de
 * linha e strikethrough por célula com mais detalhe que o texto simples.
 */
function fetchTableRowsRaw_(token, tableBlockId) {
  var rows = [];
  var cursor = null;
  do {
    var path = '/blocks/' + tableBlockId + '/children?page_size=100' + (cursor ? '&start_cursor=' + cursor : '');
    var data = notionFetch_(token, path, 'get', null);
    (data.results || []).forEach(function (block) {
      if (block.type === 'table_row') rows.push(block.table_row.cells); // cada cell = array de rich_text cru
    });
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return rows;
}

/**
 * Junta o rich_text de uma célula num texto corrido simples (ignora quebras
 * de linha internas — usada só pra cabeçalho e pro rótulo de linha/horário,
 * onde múltiplas linhas internas não têm significado especial).
 */
function cellPlainText_(richTextArray) {
  return (richTextArray || [])
    .map(function (rt) { return rt.plain_text || (rt.text && rt.text.content) || ''; })
    .join('')
    .replace(/\n/g, ' ')
    .trim();
}

/**
 * Separa o rich_text de uma célula de DIA em uma ou mais "atividades" —
 * cada quebra de linha dentro da célula do Notion (plain_text com \n
 * embutido, de um Shift+Enter dentro da mesma célula) vira uma atividade
 * distinta daquele mesmo dia. Mantém, por atividade, se algum trecho dela
 * estava com annotations.strikethrough (pra exclusão de linha tachada).
 */
function cellToActivities_(richTextArray) {
  var lines = [{ text: '', hasStrikethrough: false }];
  (richTextArray || []).forEach(function (rt) {
    var piece = rt.plain_text || (rt.text && rt.text.content) || '';
    var strike = !!(rt.annotations && rt.annotations.strikethrough);
    var parts = piece.split('\n');
    parts.forEach(function (part, idx) {
      if (idx > 0) lines.push({ text: '', hasStrikethrough: false });
      var cur = lines[lines.length - 1];
      cur.text += part;
      if (strike && part.trim()) cur.hasStrikethrough = true;
    });
  });
  return lines
    .map(function (l) { return { text: l.text.trim(), hasStrikethrough: l.hasStrikethrough }; })
    .filter(function (l) { return l.text; });
}

/**
 * Regex do texto "Período DD/MM-DD/MM" (ex: "Período 28/09-04/10") que
 * normalmente aparece acima de cada tabela de semana. O ano não aparece
 * nesse texto — usa o ano da própria página de mês (pageYear), com virada de
 * ano quando o mês final for menor que o mês inicial (ex: período
 * 29/12-04/01 → fim já é no ano seguinte).
 */
var PERIOD_TEXT_REGEX = /Per[ií]odo\s+(\d{1,2})\/(\d{1,2})\s*[-–]\s*(\d{1,2})\/(\d{1,2})/i;

function parsePeriodText_(text, pageYear) {
  if (!text) return null;
  var m = text.match(PERIOD_TEXT_REGEX);
  if (!m) return null;
  var startDay = parseInt(m[1], 10), startMonth = parseInt(m[2], 10);
  var endDay = parseInt(m[3], 10), endMonth = parseInt(m[4], 10);
  var startYear = pageYear;
  var endYear = (endMonth < startMonth) ? pageYear + 1 : pageYear;
  return { startDay: startDay, startMonth: startMonth, startYear: startYear, endDay: endDay, endMonth: endMonth, endYear: endYear };
}

/**
 * Parseia o cabeçalho de uma tabela de semana: cada coluna (exceto a
 * primeira, que é o rótulo de linha/horário) tem a abreviação do dia da
 * semana colada com o número do dia do mês (ex: "Qui01", "Sex02", "S03",
 * "D04"). Devolve { columns: [{colIndex, weekday, day}], failures: [texto
 * de cabeçalho que não bateu no padrão] } — failures ajuda a diagnosticar
 * rápido se o padrão real mudar.
 */
var WEEKDAY_HEADER_REGEX = /^([A-Za-zÇçÉéÁáÃãÂâÊê]+)\.?\s*(\d{1,2})$/;

function parseWeekHeader_(headerRow) {
  var columns = [];
  var failures = [];
  for (var c = 1; c < headerRow.length; c++) {
    var text = cellPlainText_(headerRow[c]);
    if (!text) continue;
    var m = text.match(WEEKDAY_HEADER_REGEX);
    if (!m) { failures.push(text); continue; }
    columns.push({ colIndex: c, weekday: m[1], day: parseInt(m[2], 10) });
  }
  return { columns: columns, failures: failures };
}

/**
 * Resolve o mês/ano de cada coluna-dia da semana. Preferência: usar o
 * "Período DD/MM-DD/MM" da própria semana (periodParsed) — dia >= dia
 * inicial do período usa o mês inicial, dia < dia inicial usa o mês final
 * (cobre a virada de mês no meio da semana, ex. período 28/09-04/10: dias
 * 28,29,30 = setembro, dias 01..04 = outubro). Se não houver texto
 * "Período" pra essa tabela, cai no fallback: mês/ano da própria página
 * (pageMonthYear) pra todas as colunas, exceto quando o número do dia QUEBRA
 * a ordem crescente Seg→Dom no meio da semana — nesse caso, a partir do
 * ponto de queda, incrementa o mês (e o ano, se necessário).
 */
function resolveColumnDates_(columns, periodParsed, pageMonthYear) {
  if (periodParsed) {
    return columns.map(function (col) {
      var useStart = col.day >= periodParsed.startDay;
      return {
        colIndex: col.colIndex,
        weekday: col.weekday,
        day: col.day,
        month: (useStart ? periodParsed.startMonth : periodParsed.endMonth) - 1,
        year: useStart ? periodParsed.startYear : periodParsed.endYear
      };
    });
  }

  // Fallback sem texto "Período": começa no mês/ano da página e incrementa
  // toda vez que o número do dia não for maior que o da coluna anterior.
  var curMonth = pageMonthYear ? pageMonthYear.month : new Date().getMonth();
  var curYear = pageMonthYear ? pageMonthYear.year : new Date().getFullYear();
  var prevDay = null;
  return columns.map(function (col) {
    if (prevDay !== null && col.day <= prevDay) {
      curMonth++;
      if (curMonth > 11) { curMonth = 0; curYear++; }
    }
    prevDay = col.day;
    return { colIndex: col.colIndex, weekday: col.weekday, day: col.day, month: curMonth, year: curYear };
  });
}

/**
 * Tenta reconhecer um intervalo de horário no rótulo da linha (primeira
 * coluna da tabela, ex. "08:00-12:00" ou "08-12") e devolve a duração em
 * horas (decimal). Devolve null se o rótulo não tiver esse formato — nesse
 * caso o chamador usa o fallback de 1h por atividade (ver consolidateByDay_).
 */
var ROW_TIME_RANGE_REGEX = /(\d{1,2}):?(\d{2})?\s*[-–]\s*(\d{1,2}):?(\d{2})?/;

function parseRowDurationHours_(rowLabelText) {
  if (!rowLabelText) return null;
  var m = rowLabelText.match(ROW_TIME_RANGE_REGEX);
  if (!m) return null;
  var startMin = parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  var endMin = parseInt(m[3], 10) * 60 + (m[4] ? parseInt(m[4], 10) : 0);
  var diff = (endMin - startMin) / 60;
  if (isNaN(diff) || diff <= 0 || diff > 24) return null;
  return diff;
}

/**
 * Orquestra a busca + parse do mês inteiro no novo formato de grade semanal:
 * acha todas as tabelas de semana da página (collectWeeklyTables_), e para
 * cada uma, parseia cabeçalho + linhas + células em entries { dateObj,
 * activity, hours } — o MESMO formato que consolidateByDay_/
 * groupEntriesByWeek_ já esperavam antes, então essas funções downstream não
 * mudam. Se não achar nenhuma tabela nativa mas achar um "child_database"
 * (formato antigo), cai no parser legado flat (parseEntriesLegacyFlat_)
 * como último recurso. Mensagens de erro claras em cada etapa que pode falhar
 * silenciosamente.
 */
function fetchAndParseMonthEntries_(token, pageId, pageTitle) {
  var found = collectWeeklyTables_(token, pageId);

  if (!found.tables.length) {
    if (found.database) {
      // Fallback de último recurso: formato antigo "uma linha por atividade".
      var legacyRows = fetchDatabaseRows_(token, found.database.id);
      return parseEntriesLegacyFlat_(legacyRows, pageTitle);
    }
    throw new Error('Não encontrei nenhuma tabela de apontamentos (grade semanal) na página do mês "' + pageTitle + '". Verifique se as tabelas existem e se a integração do Notion tem acesso a elas.');
  }

  var pageMonthYear = parseMonthYear_(pageTitle);
  var entries = [];
  var tablesWithContent = 0;
  var headerFailuresExample = null;
  var anyColumnParsed = false;

  found.tables.forEach(function (weekTable) {
    var rawRows = fetchTableRowsRaw_(token, weekTable.block.id);
    if (!rawRows.length) return; // tabela sem nenhuma linha, ignora

    var headerRow = rawRows[0];
    var dataRows = rawRows.slice(1);
    var parsedHeader = parseWeekHeader_(headerRow);
    if (parsedHeader.failures.length && headerFailuresExample === null) {
      headerFailuresExample = parsedHeader.failures[0];
    }
    if (!parsedHeader.columns.length) return; // nenhuma coluna reconhecida como dia nessa tabela

    anyColumnParsed = true;
    var periodParsed = parsePeriodText_(weekTable.periodText, pageMonthYear ? pageMonthYear.year : new Date().getFullYear());
    var columnDates = resolveColumnDates_(parsedHeader.columns, periodParsed, pageMonthYear);

    var tableHadContent = false;
    dataRows.forEach(function (row) {
      var rowLabelText = cellPlainText_(row[0]);
      var rowDurationHours = parseRowDurationHours_(rowLabelText);

      columnDates.forEach(function (col) {
        var cell = row[col.colIndex];
        if (!cell || !cell.length) return;
        var activities = cellToActivities_(cell);
        if (!activities.length) return;

        activities.forEach(function (act) {
          var upper = act.text.trim().toUpperCase();
          if (HOURS_CONFIG.EXCLUDE_ROW_TAGS.indexOf(upper) !== -1) return; // atividade inteira é só a tag HTPC/HTC
          if (act.hasStrikethrough) return; // atividade tachada

          var cleanActivity = act.text.replace(HOURS_CONFIG.INTERNAL_MARKERS_REGEX, '').replace(/\s{2,}/g, ' ').trim();
          if (!cleanActivity) return;

          var dateObj = new Date(col.year, col.month, col.day);
          if (isNaN(dateObj.getTime())) return;

          tableHadContent = true;
          entries.push({
            dateObj: dateObj,
            activity: cleanActivity,
            hours: (rowDurationHours !== null) ? rowDurationHours : null
          });
        });
      });
    });

    if (tableHadContent) tablesWithContent++;
  });

  if (!entries.length) {
    if (!anyColumnParsed) {
      throw new Error('Encontrei ' + found.tables.length + ' tabela(s) na página do mês "' + pageTitle + '", mas não consegui reconhecer nenhum cabeçalho de coluna como "abreviação do dia + número" (ex: "Qui01"). Exemplo de texto de cabeçalho que tentei e não bateu: "' +
        (headerFailuresExample || '(vazio)') + '". Confira o formato dos cabeçalhos das tabelas no Notion.');
    }
    throw new Error('Encontrei ' + found.tables.length + ' tabela(s) (semana(s)) na página do mês "' + pageTitle + '", mas nenhuma célula de dia tinha conteúdo em nenhuma delas (ou tudo foi excluído por ser HTPC/HTC ou texto tachado).');
  }

  return entries;
}

/**
 * Consulta um database embutido ("child_database") via /databases/{id}/query
 * e converte cada página resultado num array de células de texto, na mesma
 * ordem das propriedades do schema (Object.keys não garante 100% a ordem
 * visual das colunas no Notion, mas é a melhor aproximação disponível pela
 * API pública — na prática costuma bater com a ordem de criação das
 * propriedades). A primeira linha devolvida é sintetizada como cabeçalho
 * (nomes das propriedades), pra parseEntries_ seguir pulando a linha 0 como
 * nas tabelas nativas.
 */
function fetchDatabaseRows_(token, databaseId) {
  var schema = notionFetch_(token, '/databases/' + databaseId, 'get', null);
  var propNames = Object.keys(schema.properties || {});
  if (!propNames.length) {
    throw new Error('O database embutido encontrado na página do mês não tem nenhuma propriedade/coluna — não dá pra extrair apontamentos dele.');
  }

  var rows = [propNames.map(function (name) { return { text: name, hasStrikethrough: false }; })];
  var cursor = null;
  do {
    var payload = { page_size: 100 };
    if (cursor) payload.start_cursor = cursor;
    var data = notionFetch_(token, '/databases/' + databaseId + '/query', 'post', payload);
    (data.results || []).forEach(function (page) {
      var cells = propNames.map(function (name) {
        return databasePropertyToText_(page.properties[name]);
      });
      rows.push(cells);
    });
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return rows;
}

/**
 * Converte um valor de propriedade de database do Notion (título, rich_text,
 * select, data, checkbox, number etc.) num {text, hasStrikethrough} genérico,
 * pra poder ser tratado igual a uma célula de tabela nativa no resto do
 * pipeline (parseEntries_ não precisa saber a diferença).
 */
function databasePropertyToText_(prop) {
  if (!prop) return { text: '', hasStrikethrough: false };
  switch (prop.type) {
    case 'title':
    case 'rich_text': {
      var arr = prop[prop.type] || [];
      var text = '';
      var hasStrikethrough = false;
      arr.forEach(function (rt) {
        var piece = rt.plain_text || (rt.text && rt.text.content) || '';
        text += piece;
        if (rt.annotations && rt.annotations.strikethrough && piece.trim()) hasStrikethrough = true;
      });
      return { text: text.trim(), hasStrikethrough: hasStrikethrough };
    }
    case 'select':
      return { text: prop.select ? (prop.select.name || '') : '', hasStrikethrough: false };
    case 'multi_select':
      return { text: (prop.multi_select || []).map(function (s) { return s.name; }).join(', '), hasStrikethrough: false };
    case 'date':
      return { text: prop.date ? (prop.date.start || '') : '', hasStrikethrough: false };
    case 'number':
      return { text: (prop.number === null || prop.number === undefined) ? '' : String(prop.number), hasStrikethrough: false };
    case 'checkbox':
      return { text: prop.checkbox ? 'true' : 'false', hasStrikethrough: false };
    default:
      return { text: '', hasStrikethrough: false };
  }
}

/**
 * Junta o rich_text de uma célula (formato de tabela nativa) num texto
 * corrido, SEM aplicar ainda nenhum filtro — e devolve também se alguma
 * parte do texto está com annotations.strikethrough (usado pra excluir a
 * linha inteira).
 */
function cellToText_(richTextArray) {
  var text = '';
  var hasStrikethrough = false;
  (richTextArray || []).forEach(function (rt) {
    var piece = (rt.plain_text || (rt.text && rt.text.content) || '');
    text += piece;
    if (rt.annotations && rt.annotations.strikethrough && piece.trim()) hasStrikethrough = true;
  });
  return { text: text.trim(), hasStrikethrough: hasStrikethrough };
}

/**
 * PROBLEMA 1 (corrigido): antes os índices de coluna eram fixos (0=data,
 * 1=atividade, 2=tipo), e se a ordem real das colunas da tabela "Gestão de
 * Tempo" fosse diferente, TODAS as linhas eram silenciosamente descartadas
 * (nenhuma batia no parse de data, ou todas pareciam cair no filtro de
 * exclusão). Agora a coluna de data é DETECTADA automaticamente por
 * heurística (detectColumns_): testa, linha a linha, qual índice de coluna
 * tem o maior número de valores que casam com um padrão de data
 * (DD/MM, DD/MM/AAAA, DD-MM, ou ISO AAAA-MM-DD — esse último cobre o campo
 * "date" de um database do Notion). As demais colunas são tratadas como
 * texto livre: se uma coluna tiver poucos valores distintos (<=6) IGUAIS a
 * uma das EXCLUDE_ROW_TAGS em algum momento, ela é tratada como coluna de
 * "tipo/legenda" (HTPC/HTC/Normal); se uma coluna parecer numérica/horas
 * (ex. "2h", "1,5", "3") ela é tratada como coluna de horas; todo o resto é
 * concatenado como "Nome da Atividade".
 */
function detectColumns_(dataRows, numCols) {
  var DATE_RE = /^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$|^\d{4}-\d{2}-\d{2}/;
  var HOURS_RE = /^\d+([.,]\d+)?\s*h?$/i;

  var dateScore = [];
  var hoursScore = [];
  var distinctValues = [];
  for (var c = 0; c < numCols; c++) {
    dateScore.push(0);
    hoursScore.push(0);
    distinctValues.push({});
  }

  dataRows.forEach(function (row) {
    for (var c = 0; c < numCols; c++) {
      var cell = row[c];
      var text = cell ? cell.text.trim() : '';
      if (!text) continue;
      if (DATE_RE.test(text)) dateScore[c]++;
      if (HOURS_RE.test(text) && parseFloat(text.replace(',', '.')) <= 24) hoursScore[c]++;
      var key = text.toUpperCase();
      distinctValues[c][key] = (distinctValues[c][key] || 0) + 1;
    }
  });

  function bestIndex_(scores) {
    var bestIdx = -1, bestVal = 0;
    for (var c = 0; c < scores.length; c++) {
      if (scores[c] > bestVal) { bestVal = scores[c]; bestIdx = c; }
    }
    return bestVal > 0 ? bestIdx : -1;
  }

  var dateCol = bestIndex_(dateScore);

  var hoursCol = -1;
  var hoursCandidates = hoursScore.map(function (v, idx) { return { idx: idx, v: v }; })
    .filter(function (x) { return x.idx !== dateCol; });
  var bestHours = hoursCandidates.reduce(function (best, x) { return x.v > (best ? best.v : 0) ? x : best; }, null);
  if (bestHours && bestHours.v > 0) hoursCol = bestHours.idx;

  var typeCol = -1;
  for (var c2 = 0; c2 < numCols; c2++) {
    if (c2 === dateCol || c2 === hoursCol) continue;
    var keys = Object.keys(distinctValues[c2]);
    if (keys.length === 0 || keys.length > 6) continue;
    var matchesTag = keys.some(function (k) { return HOURS_CONFIG.EXCLUDE_ROW_TAGS.indexOf(k) !== -1; });
    if (matchesTag) { typeCol = c2; break; }
  }

  return { dateCol: dateCol, hoursCol: hoursCol, typeCol: typeCol };
}

/**
 * Transforma as linhas cruas do Notion (array de células já convertidas em
 * {text, hasStrikethrough}) em entradas { dateObj, activity, hours,
 * excluded }. Usa detectColumns_ pra achar a coluna de data/horas/tipo
 * automaticamente em vez de índices fixos (ver comentário de
 * detectColumns_). Se a tabela foi encontrada mas NENHUMA linha sobrar após
 * o filtro, lança um erro claro em vez de prosseguir silenciosamente — isso
 * ajuda a diagnosticar rápido se o bug real for outro (ex. heurística de
 * coluna errada, ou a tabela realmente só tem linhas HTPC/HTC nesse mês).
 */
function parseEntriesLegacyFlat_(rawRows, pageTitle) {
  if (!rawRows.length) {
    throw new Error('Encontrei a tabela de apontamentos na página do mês "' + pageTitle + '", mas ela não tem nenhuma linha (nem cabeçalho).');
  }

  var numCols = rawRows[0].length;
  var dataRows = rawRows.slice(1); // linha 0 = cabeçalho
  if (!dataRows.length) {
    throw new Error('Encontrei a tabela de apontamentos na página do mês "' + pageTitle + '", mas ela só tem a linha de cabeçalho, sem apontamentos.');
  }

  var cols = detectColumns_(dataRows, numCols);
  if (cols.dateCol === -1) {
    throw new Error('Encontrei a tabela de apontamentos na página do mês "' + pageTitle + '", mas não consegui identificar qual coluna é a de data (nenhum valor bateu com um padrão DD/MM, DD/MM/AAAA ou AAAA-MM-DD). Confira o formato da coluna de data no Notion.');
  }

  var entries = [];
  var totalDataRows = dataRows.length;
  var excludedByTag = 0, excludedByStrike = 0, excludedByNoDate = 0, excludedEmpty = 0;

  dataRows.forEach(function (cells) {
    var dateCell = cells[cols.dateCol] || { text: '', hasStrikethrough: false };
    var typeCell = cols.typeCol !== -1 ? (cells[cols.typeCol] || { text: '', hasStrikethrough: false }) : { text: '', hasStrikethrough: false };
    var hoursCell = cols.hoursCol !== -1 ? (cells[cols.hoursCol] || { text: '', hasStrikethrough: false }) : null;

    // "Nome da Atividade" = concatenação de todas as colunas que não são
    // data/tipo/horas, na ordem original — cobre o caso de a tabela ter mais
    // de uma coluna de texto livre além da atividade principal.
    var activityParts = [];
    var anyStrike = dateCell.hasStrikethrough;
    for (var c = 0; c < numCols; c++) {
      if (c === cols.dateCol || c === cols.typeCol || c === cols.hoursCol) continue;
      var cell = cells[c];
      if (!cell) continue;
      if (cell.text) activityParts.push(cell.text);
      if (cell.hasStrikethrough && cell.text) anyStrike = true;
    }
    var activityText = activityParts.join(' — ').trim();

    if (!dateCell.text || !activityText) { excludedEmpty++; return; } // linha vazia/mal formada

    var typeUpper = typeCell.text.trim().toUpperCase();
    var isTaggedRow = HOURS_CONFIG.EXCLUDE_ROW_TAGS.indexOf(typeUpper) !== -1;
    if (isTaggedRow) { excludedByTag++; return; }
    if (anyStrike) { excludedByStrike++; return; }

    var dateObj = parseFlexibleDate_(dateCell.text);
    if (!dateObj) { excludedByNoDate++; return; }

    // Limpa menções internas a HTPC/HTC/hora extra NO MEIO do texto (linha
    // que não é inteiramente HTPC/HTC mas cita o termo) — cliente final não
    // deve ver essas marcações.
    var cleanActivity = activityText.replace(HOURS_CONFIG.INTERNAL_MARKERS_REGEX, '').replace(/\s{2,}/g, ' ').trim();
    if (!cleanActivity) { excludedEmpty++; return; }

    var hours = null;
    if (hoursCell && hoursCell.text) {
      var h = parseFloat(hoursCell.text.replace(/h/i, '').replace(',', '.').trim());
      if (!isNaN(h) && h > 0 && h <= 24) hours = h;
    }

    entries.push({ dateObj: dateObj, activity: cleanActivity, hours: hours });
  });

  if (!entries.length) {
    throw new Error('Encontrei a tabela com ' + totalDataRows + ' linha(s) na página do mês "' + pageTitle + '", mas nenhuma linha passou no filtro (excluídas: ' +
      excludedByTag + ' por HTPC/HTC, ' + excludedByStrike + ' tachadas, ' + excludedByNoDate + ' sem data reconhecível, ' + excludedEmpty + ' vazias/mal formadas). Confira a ordem das colunas da tabela no Notion.');
  }

  return entries;
}

/**
 * Reconhece datas em formato BR (DD/MM, DD/MM/AAAA, DD-MM-AAAA) OU ISO
 * (AAAA-MM-DD, formato devolvido pela propriedade "date" de um database do
 * Notion).
 */
function parseFlexibleDate_(text) {
  var isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    var d1 = new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
    return isNaN(d1.getTime()) ? null : d1;
  }
  var m = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (!m) return null;
  var day = parseInt(m[1], 10);
  var month = parseInt(m[2], 10) - 1;
  var year = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : new Date().getFullYear();
  var d = new Date(year, month, day);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Consolida múltiplas atividades do mesmo dia numa única célula de texto
 * corrido (sem quebra de linha), uma atividade após a outra, e soma as horas
 * do dia (1h por atividade quando a linha não tinha uma coluna de horas
 * reconhecida — proxy documentado em buildHoursSlides_/HOURS_CONFIG).
 */
function consolidateByDay_(entries) {
  var byDay = {};
  var order = [];
  entries.forEach(function (e) {
    var key = e.dateObj.getFullYear() + '-' + e.dateObj.getMonth() + '-' + e.dateObj.getDate();
    if (!byDay[key]) {
      byDay[key] = { dateObj: e.dateObj, activities: [], seenActivities: {}, hours: 0 };
      order.push(key);
    }
    // Texto da atividade só entra uma vez no dia, mesmo que a mesma
    // descrição apareça em várias linhas/horários daquele dia (ex: 3 blocos
    // de 1h da mesma atividade) — mas as HORAS de todas as ocorrências são
    // sempre somadas, independente de o texto repetir ou não.
    var normalized = e.activity.trim().toLowerCase();
    if (!byDay[key].seenActivities[normalized]) {
      byDay[key].seenActivities[normalized] = true;
      byDay[key].activities.push(e.activity);
    }
    byDay[key].hours += (e.hours !== null && e.hours !== undefined) ? e.hours : 1;
  });
  return order
    .map(function (key) {
      return { dateObj: byDay[key].dateObj, activity: byDay[key].activities.join(' ') , hours: byDay[key].hours };
    })
    .sort(function (a, b) { return a.dateObj - b.dateObj; });
}

/**
 * Agrupa os dias consolidados em semanas (semana do mês, não semana ISO do
 * ano — simples e previsível: semana 1 = dias 1-7, semana 2 = dias 8-14 etc,
 * numeradas a partir de 1 dentro do mês escolhido).
 */
function groupEntriesByWeek_(consolidatedDays) {
  var byWeek = {};
  var order = [];
  consolidatedDays.forEach(function (day) {
    // Semana Segunda→Domingo (igual ao relatório do mês 9): chave = segunda-feira.
    var d = day.dateObj;
    var monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    var sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    var key = monday.getTime();
    if (!byWeek[key]) {
      byWeek[key] = { weekNum: formatWeekRange_(monday, sunday), days: [] };
      order.push(key);
    }
    byWeek[key].days.push(day);
  });
  return order.sort(function (a, b) { return a - b; }).map(function (w) { return byWeek[w]; });
}

/**
 * Rótulo do intervalo da semana na coluna "Semana" (formato DEFINITIVO, igual
 * ao mês 9): mesmo mês -> "21-27/09"; virada de mês -> "28/09-04/10".
 */
function formatWeekRange_(monday, sunday) {
  if (monday.getMonth() === sunday.getMonth()) {
    return ('0' + monday.getDate()).slice(-2) + '-' + formatDdMm_(sunday);
  }
  return formatDdMm_(monday) + '-' + formatDdMm_(sunday);
}

/**
 * Constrói os slides nativos (Table do Apps Script) na apresentação de
 * Relatório de Horas: até HOURS_CONFIG.MAX_WEEKS_PER_SLIDE semanas por
 * slide, cabeçalho repetido em cada slide, coluna "Semana" mesclada
 * verticalmente quando o número repete, coluna "Horas" com o total do dia, e
 * linha de total só no último slide com a soma de horas e valor
 * (R$ 123,00/h). Layout segue o modelo de referência enviado pelo usuário:
 * eyebrow "CF5" + título grande estilo Impact com traço vermelho, pill
 * navy MÊS/ANO no canto superior direito (mesmo padrão visual da pill
 * MÊS/ANO do script principal, ver updateHeaderDate_ em SCRIPT_CONTENT),
 * cabeçalho de tabela cinza-claro, fundo do slide branco.
 */

/**
 * Adiciona um slide em branco de forma segura. Alguns temas/templates do
 * Google Slides (ex. apresentações com master customizado) não têm o layout
 * predefinido BLANK disponível, o que faz
 * presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK) falhar com
 * "The predefined layout (BLANK) is not present in the current master".
 * Aqui, tenta o layout BLANK normal primeiro e, se não existir, cai para o
 * layout chamado "Blank"/"Branco" entre os layouts reais do master, ou por
 * fim para o primeiro layout disponível — sempre limpando os placeholders
 * herdados do layout em seguida, já que este script desenha tudo do zero.
 */
function appendBlankSlide_(presentation) {
  var slide;
  try {
    slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
  } catch (e) {
    var layouts = presentation.getLayouts();
    var fallback = layouts.filter(function (l) {
      var name = (l.getLayoutName() || '').toUpperCase();
      return name.indexOf('BLANK') !== -1 || name.indexOf('BRANCO') !== -1 || name.indexOf('EM BRANCO') !== -1;
    })[0] || layouts[0];
    slide = presentation.appendSlide(fallback);
  }
  // Remove qualquer placeholder herdado do layout (título, corpo etc.) —
  // este script desenha suas próprias formas/tabelas, não usa placeholders.
  slide.getPlaceholders().forEach(function (ph) {
    try { ph.asShape().remove(); } catch (e2) { /* não é uma forma removível, ignora */ }
  });
  return slide;
}

/**
 * Desenha o cabeçalho visual do slide: eyebrow "CF5" em vermelho, título
 * grande estilo Impact com um traço vermelho curto logo abaixo (só sob a
 * primeira parte do texto, não a largura inteira), e a pill navy MÊS/ANO no
 * canto superior direito — mesmo padrão de forma/texto em duas linhas
 * (rótulo pequeno + valor maior) usado pelas pills do script principal
 * (ver updateHeaderDate_/overwritePillText_ em SCRIPT_CONTENT).
 */
function drawHoursHeader_(slide, monthLabel, pageWidth) {
  var C = HOURS_CONFIG;

  // Todas as caixas de texto são RECTANGLE sem preenchimento e sem borda (igual
  // ao slide do mês 9) — insertTextBox deixava um contorno cinza visível ao
  // redor do título/eyebrow. Alinhamento horizontal é definido explicitamente
  // porque formas (diferente de caixas de texto) vêm centralizadas por padrão.
  function addPlainText_(text, x, y, w, h, fontSize, bold, color, fontFamily) {
    var box = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, w, h);
    box.getFill().setTransparent();
    box.getBorder().setTransparent();
    box.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
    box.getText().setText(text);
    box.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.START);
    var st = box.getText().getTextStyle();
    st.setFontSize(fontSize).setBold(bold).setForegroundColor(color);
    try { st.setFontFamily(fontFamily); } catch (e) { /* fonte indisponível no domínio — mantém a padrão */ }
    return box;
  }

  // Eyebrow "CF5": Calibri 12 bold vermelho.
  addPlainText_(C.EYEBROW_TEXT, C.EYEBROW_X, C.EYEBROW_Y, C.EYEBROW_W, C.EYEBROW_H, C.EYEBROW_FONT_SIZE, true, C.EYEBROW_COLOR, C.FONT_FAMILY);

  // Título: Impact 20pt SEM negrito.
  addPlainText_(C.TITLE_TEXT, C.TITLE_X, C.TITLE_Y, C.TITLE_W, C.TITLE_H, C.TITLE_FONT_SIZE, false, C.TITLE_COLOR, C.TITLE_FONT_FAMILY);

  // Barra vermelha sob o título: linha reta de 2,25pt, 86,4pt de largura.
  var underline = slide.insertLine(
    SlidesApp.LineCategory.STRAIGHT,
    C.UNDERLINE_X, C.UNDERLINE_Y,
    C.UNDERLINE_X + C.UNDERLINE_W, C.UNDERLINE_Y
  );
  underline.setWeight(C.UNDERLINE_WEIGHT);
  underline.getLineFill().setSolidFill(C.EYEBROW_COLOR);

  // Card MES/ANO: colado na borda direita útil (pageWidth - RIGHT_MARGIN), a
  // mesma borda direita da tabela. Duas linhas (rótulo + valor), Calibri 9
  // branco, centralizado, sem negrito — igual ao mês 9.
  var pillRight = pageWidth - C.RIGHT_MARGIN;
  var pill = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, pillRight - C.PILL_W, C.PILL_Y, C.PILL_W, C.PILL_H);
  pill.getFill().setSolidFill(C.PILL_FILL);
  pill.getBorder().setTransparent();
  pill.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
  pill.getText().setText('MES/ANO\n' + monthLabel);
  pill.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  var pillStyle = pill.getText().getTextStyle();
  pillStyle.setFontSize(C.PILL_FONT_SIZE).setBold(false).setForegroundColor(C.PILL_TEXT);
  try { pillStyle.setFontFamily(C.FONT_FAMILY); } catch (e2) { /* ignora */ }
}

/**
 * Rótulo "MM/AAAA" da pill a partir do título da página do mês. Reusa
 * parseMonthYear_ (aceita "Outubro 2026", "10/2026", "10/26" e "1026 / Tempo"
 * — este último é o título real da página). Se nada for reconhecido, usa o
 * próprio título (sempre mostra algo na pill).
 */
function monthLabelFromTitle_(monthTitle) {
  var parsed = parseMonthYear_(monthTitle);
  if (!parsed) return monthTitle;
  return ('0' + (parsed.month + 1)).slice(-2) + '/' + parsed.year;
}
/**
 * Define a largura de cada coluna de uma tabela nativa do Slides.
 * IMPORTANTE: o serviço básico SlidesApp NÃO tem nenhum método pra isso —
 * nem TableColumn.setWidth() nem Table.setColumnWidth() existem nessa API
 * (erro real visto: "table.getColumn(...).setWidth is not a function").
 * A única forma de redimensionar colunas é pela API avançada do Slides
 * (serviço "Slides API", Resources/Serviços -> Serviços avançados do Google
 * no editor do Apps Script) via Slides.Presentations.batchUpdate com
 * updateTableColumnProperties. Se esse serviço avançado não estiver
 * habilitado no projeto, cai no catch e a tabela fica com colunas de largura
 * igual (comportamento padrão do insertTable) em vez de travar a geração do
 * relatório inteiro — funciona, só não fica com a largura customizada até o
 * serviço ser habilitado (ver "Como usar" no painel Controle SHM).
 */
function setTableColumnWidths_(table, widths) {
  try {
    var tableId = table.getObjectId();
    var requests = widths.map(function (w, i) {
      return {
        updateTableColumnProperties: {
          objectId: tableId,
          columnIndices: [i],
          tableColumnProperties: { columnWidth: { magnitude: w, unit: 'PT' } },
          fields: 'columnWidth'
        }
      };
    });
    Slides.Presentations.batchUpdate({ requests: requests }, HOURS_CONFIG.PRESENTATION_ID);
  } catch (e) {
    Logger.log('Não foi possível customizar a largura das colunas (serviço avançado "Slides API" não habilitado neste projeto): ' + e);
  }
}

function buildHoursSlides_(monthTitle, weeks) {
  var presentation = SlidesApp.openById(HOURS_CONFIG.PRESENTATION_ID);
  var pageWidth = presentation.getPageWidth();

  // Remove apenas slides gerados por execuções anteriores deste script
  // (marcados internamente), nunca mexe em slides que o usuário tenha
  // criado manualmente na apresentação. Precisa acontecer ANTES de criar os
  // novos, pra não empilhar relatórios antigos no início a cada execução.
  presentation.getSlides().forEach(function (slide) {
    try {
      if (slideHasHoursMarker_(slide)) slide.remove();
    } catch (e) { /* slide sem shapes, ignora */ }
  });

  var monthLabel = monthLabelFromTitle_(monthTitle);

  // Agrupa semanas em blocos de MAX_WEEKS_PER_SLIDE.
  var slideGroups = [];
  for (var i = 0; i < weeks.length; i += HOURS_CONFIG.MAX_WEEKS_PER_SLIDE) {
    slideGroups.push(weeks.slice(i, i + HOURS_CONFIG.MAX_WEEKS_PER_SLIDE));
  }
  if (slideGroups.length === 0) slideGroups.push([]);

  // Total de horas do mês: soma o campo "hours" já consolidado por dia (que
  // já usa a coluna de horas real quando detectada em detectColumns_, ou o
  // proxy de 1h por atividade consolidada quando a tabela não tem essa
  // coluna — ver consolidateByDay_).
  var totalHours = weeks.reduce(function (sum, w) {
    return sum + w.days.reduce(function (s2, d) { return s2 + d.hours; }, 0);
  }, 0);
  var totalValue = totalHours * HOURS_CONFIG.HOUR_VALUE;

  var createdSlides = [];

  slideGroups.forEach(function (weekGroup, groupIdx) {
    var isLastSlide = groupIdx === slideGroups.length - 1;
    var slide = appendBlankSlide_(presentation);
    tagSlideAsHoursReport_(slide);
    createdSlides.push(slide);
    slide.getBackground().setSolidFill(HOURS_CONFIG.SLIDE_BG);

    drawHoursHeader_(slide, monthLabel, pageWidth);

    var rowsData = [['Semana', 'Data', 'Nome da Atividade', 'Horas']];
    weekGroup.forEach(function (week) {
      week.days.forEach(function (day, dayIdx) {
        rowsData.push([String(week.weekNum), formatDdMm_(day.dateObj), day.activity, formatHours_(day.hours)]);
      });
    });

    var totalRowIdx = -1;
    if (isLastSlide) {
      rowsData.push(['TOTAL', '', 'Valor total: R$ ' + formatBrl_(totalValue), formatHours_(totalHours)]);
      totalRowIdx = rowsData.length - 1;
    }

    var numRows = rowsData.length;
    var numCols = 4;
    // A tabela inteira se estica até a borda direita útil do slide — mesmo
    // limite direito (pageWidth - RIGHT_MARGIN) da pill MÊS/ANO acima dela.
    var tableLeft = HOURS_CONFIG.TABLE_LEFT, tableTop = HOURS_CONFIG.TABLE_TOP;
    var tableRight = pageWidth - HOURS_CONFIG.RIGHT_MARGIN;
    var tableWidth = tableRight - tableLeft;
    var table = slide.insertTable(numRows, numCols, tableLeft, tableTop, tableWidth, 1);

    // Redistribui as larguras das colunas: Semana/Data/Horas compactas (só o
    // necessário pro conteúdo), "Nome da Atividade" absorve todo o espaço
    // sobrando, esticando a coluna até a borda direita da tabela.
    var colWSemana = HOURS_CONFIG.COL_WIDTH_SEMANA;
    var colWData = HOURS_CONFIG.COL_WIDTH_DATA;
    var colWHoras = HOURS_CONFIG.COL_WIDTH_HORAS;
    var colWAtividade = tableWidth - colWSemana - colWData - colWHoras;

    for (var r = 0; r < numRows; r++) {
      for (var c = 0; c < numCols; c++) {
        var cell = table.getCell(r, c);
        var text = rowsData[r][c];
        cell.getText().setText(text);
        var style = cell.getText().getTextStyle();
        try { style.setFontFamily(HOURS_CONFIG.FONT_FAMILY); } catch (eFont) { /* ignora */ }
        if (c === 3) cell.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.END);
        style.setFontSize(r === 0 ? HOURS_CONFIG.HEADER_FONT_SIZE : HOURS_CONFIG.FONT_SIZE);
        style.setBold(r === 0 || r === totalRowIdx);
        if (r === 0) {
          cell.getFill().setSolidFill(HOURS_CONFIG.HEADER_FILL);
          style.setForegroundColor(HOURS_CONFIG.HEADER_TEXT);
        } else if (r === totalRowIdx) {
          cell.getFill().setSolidFill(HOURS_CONFIG.TOTAL_FILL);
          style.setForegroundColor(HOURS_CONFIG.TOTAL_TEXT);
          if (c === 2) cell.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.END);
        } else {
          cell.getFill().setSolidFill((r % 2 === 0) ? HOURS_CONFIG.ROW_FILL_EVEN : HOURS_CONFIG.ROW_FILL_ODD);
          // Decisão de design (ver relatório final): o exemplo de referência
          // mostrava o texto da atividade em cores variando por linha, mas
          // sem uma regra clara de quando usar qual cor — pra não ficar
          // inconsistente, usa sempre a cor neutra/escura padrão do tema
          // (ACTIVITY_TEXT_COLOR) em vez de replicar cores arbitrárias.
          style.setForegroundColor(HOURS_CONFIG.ACTIVITY_TEXT_COLOR);
        }
      }
    }

    // Mescla a linha de total: só "Data" + "Nome da Atividade" viram uma
    // célula (texto "Valor total: R$ X" alinhado à direita); "Semana"
    // mantém "TOTAL" sozinho, "Horas" mantém o total de horas sozinho.
    if (totalRowIdx !== -1) {
      table.getCell(totalRowIdx, 1).merge(table.getCell(totalRowIdx, 2));
    }

    // Mescla verticalmente a coluna "Semana" quando o valor repete (1 célula
    // mesclada mostrando o número da semana uma única vez por grupo).
    var rowCursor = 1; // linha 0 é cabeçalho
    weekGroup.forEach(function (week) {
      var span = week.days.length;
      if (span > 1) {
        var topCell = table.getCell(rowCursor, 0);
        for (var k = 1; k < span; k++) {
          topCell.merge(table.getCell(rowCursor + k, 0));
        }
      }
      rowCursor += span;
    });

    // Largura das colunas por último, DEPOIS de preencher texto e mesclar
    // células: setTableColumnWidths_ usa a API avançada do Slides
    // (Slides.Presentations.batchUpdate), que grava direto na apresentação
    // por fora do objeto SlidesApp em memória — chamando isso ANTES dos
    // merges, o cache de células do SlidesApp ficava desatualizado e os
    // merge() seguintes silenciosamente não faziam efeito nenhum (bug real
    // visto: coluna "Semana" nunca mesclava, mesmo com o código certo).
    setTableColumnWidths_(table, [colWSemana, colWData, colWAtividade, colWHoras]);

    // A tabela nativa do Google Slides já vem com bordas finas por padrão
    // (tom cinza-claro), compatível com o restante do sistema — sem precisar
    // de ajuste manual de borda aqui.
  });

  // PROBLEMA 3 (corrigido): os slides são criados no FINAL da apresentação
  // (appendSlide não tem alternativa de "insert no início" direta), então
  // movemos cada um pro início logo em seguida, na ordem reversa de criação,
  // pra preservar a ordem interna entre eles — mesmo padrão "reverse
  // move(0)" usado no script principal pra reposicionar páginas geradas.
  // Exemplo com 2 slides criados [A, B] (nessa ordem, no final da lista):
  //   move B pra posição 0 primeiro -> [B, ..., A]
  //   move A pra posição 0 depois   -> [A, B, ...]
  // resultado final: A continua antes de B, e os dois ficam logo no início.
  for (var m = createdSlides.length - 1; m >= 0; m--) {
    createdSlides[m].move(0);
  }
}

var HOURS_SLIDE_MARKER_KEY = 'HOURS_REPORT_SLIDE';

function tagSlideAsHoursReport_(slide) {
  // Marca o slide internamente (via registro de objectId em Document
  // Properties) pra próximas execuções saberem que foi gerado por este
  // script e podem ser substituídas sem mexer em slides manuais.
  var props = PropertiesService.getDocumentProperties();
  var ids = JSON.parse(props.getProperty(HOURS_SLIDE_MARKER_KEY) || '[]');
  ids.push(slide.getObjectId());
  props.setProperty(HOURS_SLIDE_MARKER_KEY, JSON.stringify(ids));
}

function slideHasHoursMarker_(slide) {
  var props = PropertiesService.getDocumentProperties();
  var ids = JSON.parse(props.getProperty(HOURS_SLIDE_MARKER_KEY) || '[]');
  return ids.indexOf(slide.getObjectId()) !== -1;
}

function formatDdMm_(dateObj) {
  var dd = ('0' + dateObj.getDate()).slice(-2);
  var mm = ('0' + (dateObj.getMonth() + 1)).slice(-2);
  return dd + '/' + mm;
}

function formatHours_(hours) {
  var rounded = Math.round(hours * 100) / 100;
  var text = (rounded % 1 === 0) ? String(rounded) : String(rounded).replace('.', ',');
  return text + 'h';
}

function formatBrl_(value) {
  var fixed = value.toFixed(2).replace('.', ',');
  var parts = fixed.split(',');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return parts.join(',');
}
`;
