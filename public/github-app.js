/**
 * Frontend do painel público "Controle SHM" (Board Jira + Métricas).
 *
 * As funções de renderização abaixo são reaproveitadas quase sem alteração
 * do painel original (controle-shm-painel.html, Artifact publicado no
 * claude.ai) — recebem a lista de issues já em memória e só manipulam o DOM,
 * sem chamada de rede própria. A única mudança estrutural real é a busca de
 * dados: no lugar de `claude.use('mcp')` + `mcp.callTool(...)` (que só
 * funciona dentro do claude.ai), aqui usamos `fetch('/api/issues')`, rota
 * servida pelo próprio github-server.js deste repositório.
 *
 * Removido do original: seletor de workspace, filtro de épico, modal de
 * comentários do Plano de Ação (dependia de MCP), e tudo de
 * Acesso/Utilidades/Notion/senha — este painel é só leitura pública do board
 * e das métricas.
 */

// ============================================================================
// Navegação entre abas (Board Jira / Métricas)
// ============================================================================
// Abas protegidas por senha (Utilidades, Acesso) são geridas por
// github-protected.js, que define window.PASSWORD_PROTECTED_SECTIONS_ /
// window.protectedSectionsUnlocked_ / window.openLockGate_ antes deste
// listener rodar (ambos os scripts são carregados de forma síncrona antes de
// qualquer clique do usuário ser possível).
function activateSection_(target) {
  document.querySelectorAll('.topbar-nav-item').forEach((b) => b.removeAttribute('aria-current'));
  const navBtn = document.querySelector('.topbar-nav-item[data-section="' + target + '"]');
  if (navBtn) navBtn.setAttribute('aria-current', 'page');
  document.querySelectorAll('.app-section').forEach((section) => {
    section.hidden = section.id !== 'section-' + target;
  });
  if (target === 'utilidades' && window.onActivateUtilidades_) window.onActivateUtilidades_();
  if (target === 'acesso' && window.onActivateAcesso_) window.onActivateAcesso_();
  // O link #entregas/AAAA-MM só faz sentido na aba Entregas — sai dele ao
  // trocar de aba para que recarregar a página não volte pra Entregas.
  if (target !== 'entregas' && /^#entregas/.test(location.hash)) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}
window.activateSection_ = activateSection_;

document.querySelectorAll('.topbar-nav-item').forEach((navBtn) => {
  navBtn.addEventListener('click', () => {
    const target = navBtn.dataset.section;
    const protectedSections = window.PASSWORD_PROTECTED_SECTIONS_ || [];
    const unlocked = window.protectedSectionsUnlocked_ || {};
    if (protectedSections.indexOf(target) !== -1 && !unlocked[target]) {
      if (window.openLockGate_) window.openLockGate_(target);
      return;
    }
    activateSection_(target);
  });
});

const syncStatus = document.getElementById('syncStatus');
const siteKanban = document.getElementById('siteKanban');
const metricsStats = document.getElementById('metricsStats');
const metricsStatusBars = document.getElementById('metricsStatusBars');
const refreshBtn = document.getElementById('refreshBtn');

let cachedIssues_ = null;
let lastSyncAt_ = null;

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => loadIssues_(true));
}

document.addEventListener('DOMContentLoaded', bootSession_);

// ============================================================================
// Login com Google: antes de buscar qualquer dado, confere a sessão em
// /api/me. Sem sessão, mostra a tela de entrada; e-mail fora da lista de
// Acesso, mostra "sem acesso". Utilidades e Acesso ficam com cadeado para todos.
// ============================================================================
window.sessionUser_ = null;

async function bootSession_() {
  const params = new URLSearchParams(window.location.search);
  const loginResult = params.get('login');
  if (loginResult) window.history.replaceState(null, '', window.location.pathname);

  if (loginResult === 'negado') {
    showLoginGate_('denied', params.get('email'));
    return;
  }
  try {
    const res = await fetch('/api/me');
    const me = await res.json().catch(() => null);
    if (res.ok && me && me.ok) {
      startApp_(me);
      return;
    }
    if (res.status === 403 && me) {
      showLoginGate_('denied', me.email);
      return;
    }
    if (res.status === 401) {
      showLoginGate_(loginResult === 'erro' ? 'error' : 'login');
      return;
    }
    showLoginGate_('unavailable', null, me && me.error);
  } catch (err) {
    console.error(err);
    showLoginGate_('unavailable');
  }
}

function showLoginGate_(kind, email, detail) {
  const gate = document.getElementById('loginGate');
  const shell = document.getElementById('appShell');
  if (shell) shell.hidden = true;
  if (!gate) return;
  gate.hidden = false;
  const texts = {
    login: ['Entre para ver o painel', 'Use a sua conta Google. Só entra quem tem o e-mail cadastrado no Controle SHM.', 'Entrar com Google'],
    error: ['Não foi possível entrar', 'O login com o Google não foi concluído. Tente de novo.', 'Entrar com Google'],
    denied: ['Sem acesso ainda', 'Este e-mail não está cadastrado no Controle SHM. Peça ao administrador para incluir o seu e-mail na aba Acesso, ou entre com outra conta.', 'Entrar com outra conta'],
    unavailable: ['Não foi possível conferir o acesso', detail || 'O servidor não respondeu agora. Recarregue a página em instantes.', 'Tentar entrar de novo']
  };
  const t = texts[kind] || texts.login;
  document.getElementById('loginGateSpinner').hidden = true;
  document.getElementById('loginGateTitle').textContent = t[0];
  document.getElementById('loginGateDesc').textContent = t[1];
  const emailEl = document.getElementById('loginGateEmail');
  emailEl.hidden = !email;
  emailEl.textContent = email || '';
  document.getElementById('loginGoogleLabel').textContent = t[2];
  document.getElementById('loginGoogleBtn').hidden = false;
}

function startApp_(me) {
  window.sessionUser_ = me;
  const gate = document.getElementById('loginGate');
  const shell = document.getElementById('appShell');
  if (gate) gate.hidden = true;
  if (shell) shell.hidden = false;
  const userBox = document.getElementById('topbarUser');
  const userEmail = document.getElementById('topbarUserEmail');
  if (userBox && userEmail) {
    userEmail.textContent = me.name || me.email;
    userEmail.title = me.email;
    userBox.hidden = false;
  }
  // Utilidades e Acesso aparecem para todos com o cadeado; o clique confere
  // se é administrador (ver openLockGate_ em github-protected.js).
  loadIssues_(false);
}

// ============================================================================
// Busca de dados (substitui o antigo mcp.callTool pelo endpoint próprio)
// ============================================================================
async function loadIssues_(forceRefresh) {
  setSyncState_('loading', 'Conectando ao Jira…');
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.classList.add('syncing'); }

  try {
    const url = '/api/issues' + (forceRefresh ? '?refresh=1' : '');
    const res = await fetch(url);
    const payload = await res.json().catch(() => null);

    if (!res.ok) {
      if (payload && payload.loginRequired) {
        showLoginGate_('login');
        return;
      }
      const message = (payload && payload.error) || errorMessageFor_(res.status);
      setSyncState_('error', message);
      console.error('Erro ao buscar /api/issues:', payload);
      return;
    }

    const issues = extractIssues_(payload);
    if (!issues) {
      setSyncState_('error', 'Não entendi o formato da resposta do servidor. Veja o console para detalhes.');
      console.error('Resposta inesperada de /api/issues:', payload);
      return;
    }

    cachedIssues_ = issues;
    lastSyncAt_ = new Date();
    renderSiteBoard_(issues);
    renderMetrics_(issues);
    renderDeliveries_(issues);

    const now = new Date();
    const storyCount = issues.filter((i) => i.fields.issuetype.name !== 'Epic').length;
    setSyncState_('ok', 'Atualizado às ' + now.toLocaleTimeString('pt-BR') + ' — ' + storyCount + ' itens.');
  } catch (err) {
    console.error(err);
    setSyncState_('error', 'Não foi possível buscar os dados: ' + (err && err.message ? err.message : 'erro desconhecido') + '.');
  } finally {
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.classList.remove('syncing'); }
  }
}

function errorMessageFor_(status) {
  if (status === 401) return 'Credenciais do Jira inválidas ou expiradas (401).';
  if (status === 403) return 'Acesso negado pelo Jira (403).';
  if (status === 429) return 'Muitas requisições — tente novamente em instantes (429).';
  if (status >= 500) return 'Servidor/Jira indisponível no momento.';
  return 'Não foi possível buscar os dados do Jira.';
}

function setSyncState_(kind, message) {
  if (!syncStatus) return;
  syncStatus.textContent = message;
  syncStatus.classList.remove('is-error', 'is-ok');
  if (kind === 'error') syncStatus.classList.add('is-error');
  if (kind === 'ok') syncStatus.classList.add('is-ok');
}

function extractIssues_(payload) {
  if (!payload) return null;
  if (Array.isArray(payload.issues)) return payload.issues;
  if (payload.data && Array.isArray(payload.data.issues)) return payload.data.issues;
  return null;
}

// ============================================================================
// Helpers de status/data/lead-time — copiados do painel original sem
// alteração de lógica (ver controle-shm-painel.html para o histórico das
// decisões de design documentadas nos comentários originais).
// ============================================================================

function toCalendarDay_(isoDate) {
  if (!isoDate) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (dateOnly) return { y: +dateOnly[1], m: +dateOnly[2], d: +dateOnly[3] };
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return null;
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

function daysSince_(isoDate, toIso) {
  const day = toCalendarDay_(isoDate);
  if (!day) return null;
  const dateUTC = Date.UTC(day.y, day.m - 1, day.d);
  let toUTC;
  if (toIso) {
    const toDay = toCalendarDay_(toIso);
    if (!toDay) return null;
    toUTC = Date.UTC(toDay.y, toDay.m - 1, toDay.d);
  } else {
    const now = new Date();
    toUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  }
  return Math.round((toUTC - dateUTC) / 86400000);
}

function doneReferenceDateIso_(f) {
  return isDoneStatusWeb_(f) ? f.statuscategorychangedate : null;
}

function isDoneStatusWeb_(f) {
  if (f.status && f.status.statusCategory && f.status.statusCategory.key === 'done') return true;
  const name = (f.status && f.status.name || '').trim().toUpperCase();
  return name === 'DONE' || name === 'CONCLUÍDO' || name === 'CONCLUIDO';
}

function isCancelStatusWeb_(f) {
  const name = (f.status && f.status.name || '').trim().toUpperCase();
  return name.indexOf('CANCEL') !== -1;
}

function isToDoStatusWeb_(statusName) {
  const u = (statusName || '').trim().toUpperCase();
  return u === 'BACKLOG' || u === 'COMPROMETIDO' || u.indexOf('APROVADO') !== -1;
}

function customLeadTimeDays_(createdIso, referenceIso) {
  return daysSince_(createdIso, referenceIso);
}

function leadTimeDays_(startDateIso, referenceIso) {
  return daysSince_(startDateIso, referenceIso);
}

const FLAGGED_FIELD_NAMES = ['Flagged', 'Sinalizado', 'Sinalizador', 'Sinalizadores'];

function isFlagged_(customFields) {
  if (!customFields) return false;
  return FLAGGED_FIELD_NAMES.some((name) => {
    const field = customFields[name];
    const value = field && field.value;
    if (!value) return false;
    return Array.isArray(value) ? value.length > 0 : true;
  });
}

function priorityIcon_(priorityName) {
  const key = (priorityName || '').trim().toUpperCase();
  if (key === 'HIGHEST') return '▲▲';
  if (key === 'HIGH') return '▲';
  return '';
}

function isHighPriority_(priorityName) {
  const key = (priorityName || '').trim().toUpperCase();
  return key === 'HIGH' || key === 'HIGHEST';
}

function isSubtaskIssue_(f) {
  if (f.issuetype && f.issuetype.subtask === true) return true;
  const name = (f.issuetype && f.issuetype.name || '').trim().toUpperCase();
  return name.indexOf('SUB-TASK') !== -1 || name.indexOf('SUBTASK') !== -1 || name.indexOf('SUBTAREFA') !== -1;
}

const CANONICAL_STATUS_LABELS = ['Backlog', 'Aprovado Comprometido', 'Fazendo', 'Teste Validação', 'Done'];

function buildStatusBuckets_(byStatus) {
  const usedKeys = new Set();
  const buckets = CANONICAL_STATUS_LABELS.map((label) => {
    const matchKey = Object.keys(byStatus).find((k) => k.trim().toUpperCase() === label.trim().toUpperCase());
    if (matchKey) {
      usedKeys.add(matchKey);
      return { label: matchKey, items: byStatus[matchKey] };
    }
    return { label: label, items: [] };
  });

  const backlogIdx = buckets.findIndex((b) => b.label.trim().toUpperCase() === 'BACKLOG');
  let afterBacklogInsertAt = backlogIdx === -1 ? 0 : backlogIdx + 1;
  let foundAprovado = false;
  Object.keys(byStatus).forEach((k) => {
    if (usedKeys.has(k)) return;
    if (k.trim().toUpperCase().indexOf('APROVADO') !== -1) {
      buckets.splice(afterBacklogInsertAt, 0, { label: k, items: byStatus[k] });
      afterBacklogInsertAt++;
      foundAprovado = true;
    } else {
      buckets.push({ label: k, items: byStatus[k] });
    }
  });

  if (foundAprovado) {
    return buckets.filter((b) => !(b.label.trim().toUpperCase() === 'COMPROMETIDO' && b.items.length === 0));
  }

  return buckets;
}

const GROUPED_CHART_STATUS_ORDER = ['Backlog', 'Aprovado Comprometido', 'Fazendo', 'Teste Validação', 'Done'];

const HEADER_LABELS_WEB = [
  'Data Surg', 'Épico', 'História · Nome da Atividade',
  'Status', 'Prioridade', 'Plano de Ação', 'Responsável', 'Risco Impacto', 'CLT', 'LT'
];

const COLUMN_TOOLTIPS_WEB = {
  'CLT': 'CLT (Custom Lead Time)\n\n' +
    'Base de cálculo: Created (Data Surg) → hoje, ou → data de entrada em Done (se o card já estiver concluído).\n\n' +
    'Racional: mede há quanto tempo o item existe desde que foi registrado no Jira — a "idade" do item no fluxo como um todo, do surgimento da demanda até a conclusão (ou até agora, se ainda em andamento).',
  'LT': 'LT (Lead Time)\n\n' +
    'Base de cálculo: Start date → hoje, ou → data de entrada em Done (se o card já estiver concluído).\n\n' +
    'Racional: mede o tempo efetivo de execução, contado a partir do momento em que o trabalho de fato começou (Start date) — diferente do CLT, não inclui o tempo que o item ficou parado antes de iniciar.'
};

function buildHeaderRow_() {
  const headerRow = document.createElement('div');
  headerRow.className = 'kanban-header-row kanban-row-grid';
  HEADER_LABELS_WEB.forEach((label) => {
    const cell = document.createElement('div');
    cell.className = 'kanban-header-cell';
    cell.textContent = label === 'Prioridade' ? 'P' : label;
    cell.title = COLUMN_TOOLTIPS_WEB[label] || label;
    headerRow.appendChild(cell);
  });
  return headerRow;
}

// Cor do épico: usa a cor REAL escolhida no Jira (campo "Issue color",
// customfield_10017 nesse site) sempre que vier na sincronização; só cai pro
// fallback determinístico abaixo pra qualquer épico sem essa cor definida.
const EPIC_COLOR_PALETTE = ['#4c9aff', '#ff8f73', '#36b37e', '#6554c0', '#ffab00', '#00b8d9', '#e34948', '#8993a4', '#c2185b', '#8d6e63'];

const JIRA_COLOR_NAME_TO_HEX = {
  yellow: '#ffc400',
  dark_yellow: '#a37200',
  orange: '#ff8f00',
  dark_orange: '#a35a00',
  red: '#de350b',
  dark_red: '#bf2600',
  magenta: '#e774bb',
  pink: '#e774bb',
  dark_magenta: '#943d73',
  dark_pink: '#943d73',
  purple: '#6554c0',
  dark_purple: '#403294',
  blue: '#0052cc',
  dark_blue: '#253858',
  teal: '#00b8d9',
  dark_teal: '#008da6',
  green: '#36b37e',
  dark_green: '#006644',
  light_green: '#79f2c0',
  lime: '#79f2c0',
  dark_lime: '#0e6245',
  brown: '#816a5b',
  gray: '#97a0af',
  grey: '#97a0af',
  dark_gray: '#5e6c84',
  dark_grey: '#5e6c84',
  'blue-gray': '#8993a4',
  blue_gray: '#8993a4'
};

function jiraEpicColorName_(f) {
  const field = f.customFields && f.customFields['Issue color'];
  return (field && field.value) || null;
}

function buildEpicColorMap_(epics) {
  const map = {};
  let fallbackIdx = 0;
  Object.keys(epics).sort().forEach((key) => {
    const colorName = epics[key] && epics[key].colorName;
    const hex = colorName && JIRA_COLOR_NAME_TO_HEX[colorName.toLowerCase()];
    if (hex) {
      map[key] = hex;
    } else {
      map[key] = EPIC_COLOR_PALETTE[fallbackIdx % EPIC_COLOR_PALETTE.length];
      fallbackIdx++;
    }
  });
  return map;
}

function JIRA_LINK_(key) {
  return 'https://cf5empresa.atlassian.net/browse/' + key;
}

function td_(content) {
  const cell = document.createElement('td');
  if (content instanceof Node) cell.appendChild(content);
  else cell.textContent = content;
  return cell;
}

function linkCell_(href, content) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  if (content instanceof Node) a.appendChild(content);
  else a.textContent = content;
  return a;
}

function formatDateWeb_(isoDate) {
  const d = new Date(isoDate);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return dd + '/' + mm;
}

function jiraCustomFieldText_(field) {
  if (!field) return '';
  const value = field.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.content) return adfToTextWeb_(value);
  return String(value);
}

function adfToTextWeb_(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  let text = node.text || '';
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => {
      text += adfToTextWeb_(child);
      if (child && (child.type === 'paragraph' || child.type === 'hardBreak')) text += '\n';
    });
  }
  return text.trim();
}

function sortByCountDesc_(counts) {
  return Object.keys(counts)
    .map((label) => ({ label: label, count: counts[label] }))
    .sort((a, b) => b.count - a.count);
}

// ============================================================================
// Tooltip customizado pra elementos SVG (o <title> nativo do SVG é pouco
// confiável em alguns browsers) — reaproveitado em todos os gráficos.
// ============================================================================
let vizTooltipEl_ = null;
function ensureVizTooltipEl_() {
  if (!vizTooltipEl_) {
    vizTooltipEl_ = document.createElement('div');
    vizTooltipEl_.className = 'viz-custom-tooltip';
    document.body.appendChild(vizTooltipEl_);
  }
  return vizTooltipEl_;
}

function strikeText_(str) {
  return (str || '').split('').join('̶') + '̶';
}

function buildTooltipItemLines_(issues, maxItems) {
  const MAX = maxItems || 12;
  const list = (issues || []).slice().sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const lines = list.slice(0, MAX).map((it) => {
    const isDone = isDoneStatusWeb_(it.fields);
    const isCancel = isCancelStatusWeb_(it.fields);
    const keyPart = it.key + (isDone ? ' 🏆' : '');
    let summaryPart = it.fields.summary;
    if (isDone || isCancel) summaryPart = strikeText_(summaryPart);
    if (isCancel) summaryPart += ' (cancelado)';
    return keyPart + ' — ' + summaryPart;
  });
  if (list.length > MAX) lines.push('… + ' + (list.length - MAX) + ' item(ns)');
  return lines;
}

function attachVizTooltip_(el, text) {
  el.addEventListener('mouseenter', (evt) => {
    const tip = ensureVizTooltipEl_();
    tip.textContent = text;
    tip.style.display = 'block';
    positionVizTooltip_(evt);
  });
  el.addEventListener('mousemove', positionVizTooltip_);
  el.addEventListener('mouseleave', () => {
    if (vizTooltipEl_) vizTooltipEl_.style.display = 'none';
  });
}

function positionVizTooltip_(evt) {
  if (!vizTooltipEl_) return;
  vizTooltipEl_.style.left = (evt.clientX + 12) + 'px';
  vizTooltipEl_.style.top = (evt.clientY + 12) + 'px';
}

function monthLabel_(date) {
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return months[date.getMonth()] + '/' + String(date.getFullYear()).slice(-2);
}

function wrapAxisLabel_(text, maxCharsPerLine) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const candidate = current ? current + ' ' + word : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  if (lines.length > 2) {
    lines[1] = lines.slice(1).join(' ');
    lines.length = 2;
  }
  return lines;
}

// ============================================================================
// Board Jira (Kanban)
// ============================================================================
// Legenda das frentes no topo do Board: cor de cada épico (a mesma da borda
// dos cards), chave + nome e quantos itens a frente tem no board.
function buildEpicLegend_(epics, epicColors, stories) {
  const countByEpic = {};
  stories.forEach((s) => {
    const k = s.fields.parent ? s.fields.parent.key : '(sem frente)';
    countByEpic[k] = (countByEpic[k] || 0) + 1;
  });

  const box = document.createElement('div');
  box.className = 'board-epic-legend';
  const title = document.createElement('span');
  title.className = 'board-epic-legend-title';
  title.textContent = 'Frentes (épicos)';
  box.appendChild(title);

  const list = document.createElement('div');
  list.className = 'board-epic-legend-list';
  Object.keys(epics)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .forEach((key) => {
      const chip = document.createElement('div');
      chip.className = 'board-epic-chip';
      chip.style.setProperty('--epic-color', epicColors[key] || 'var(--border)');
      const dot = document.createElement('span');
      dot.className = 'board-epic-dot';
      chip.appendChild(dot);
      const link = linkCell_(JIRA_LINK_(key), key);
      link.className = 'board-epic-key';
      chip.appendChild(link);
      const name = document.createElement('span');
      name.className = 'board-epic-name';
      name.textContent = epics[key].summary;
      chip.appendChild(name);
      const count = document.createElement('span');
      count.className = 'board-epic-count';
      const n = countByEpic[key] || 0;
      count.textContent = n + (n === 1 ? ' item' : ' itens');
      chip.appendChild(count);
      list.appendChild(chip);
    });
  box.appendChild(list);
  return box;
}

// Subtarefas de um item no Board: lista recolhível logo abaixo do card. A
// subtarefa concluída ganha a borda verde do Done, mas continua aqui, no
// status do item; só o item concluído vai para a coluna Done.
function buildSubtaskBlock_(subs, epicColor) {
  const doneCount = subs.filter((s) => isDoneStatusWeb_(s.fields) && !isCancelStatusWeb_(s.fields)).length;
  const block = document.createElement('div');
  block.className = 'kanban-subtasks-block';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'kanban-subtasks-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  const chevron = document.createElement('span');
  chevron.className = 'kanban-chevron';
  chevron.textContent = '▾';
  toggle.appendChild(chevron);
  toggle.appendChild(document.createTextNode(
    subs.length + (subs.length === 1 ? ' subtarefa' : ' subtarefas') +
    (doneCount ? ' · ' + doneCount + (doneCount === 1 ? ' concluída' : ' concluídas') : '')
  ));

  const list = document.createElement('div');
  list.className = 'kanban-subtasks';
  list.hidden = true;
  subs.forEach((sub) => list.appendChild(buildSubtaskRow_(sub, epicColor)));

  toggle.addEventListener('click', () => {
    const willShow = list.hidden;
    list.hidden = !willShow;
    toggle.setAttribute('aria-expanded', String(willShow));
  });

  block.appendChild(toggle);
  block.appendChild(list);
  return block;
}

// Mesmas 11 colunas do card do item, para a subtarefa ficar alinhada.
function buildSubtaskRow_(sub, epicColor) {
  const f = sub.fields;
  const isCancel = isCancelStatusWeb_(f);
  const isDone = isDoneStatusWeb_(f) && !isCancel;
  const row = document.createElement('div');
  row.className = 'kanban-card kanban-row-grid is-subtask' + (isDone ? ' is-done' : '') + (isCancel ? ' is-cancelled' : '');
  row.style.setProperty('--epic-color', epicColor || 'var(--border)');

  const cell = (content, extraClass) => {
    const c = document.createElement('div');
    c.className = 'kanban-card-cell truncate-cell' + (extraClass ? ' ' + extraClass : '');
    if (content instanceof Node) c.appendChild(content);
    else { c.textContent = content; c.title = content; }
    return c;
  };

  const priorityName = f.priority ? f.priority.name : '';
  const referenceIso = doneReferenceDateIso_(f);
  const cltDays = customLeadTimeDays_(f.created, referenceIso);
  const startDateIso = jiraCustomFieldText_(f.customFields && f.customFields['Start date']);
  const ltDays = leadTimeDays_(startDateIso, referenceIso);

  row.appendChild(cell(formatDateWeb_(f.created)));
  row.appendChild(cell('↳ Subtarefa', 'subtask-tag-cell'));
  // História · Nome da Atividade: key (link) + espaço + nome da subtarefa
  const nameCell = document.createElement('div');
  nameCell.className = 'kanban-card-cell truncate-cell';
  nameCell.title = sub.key + (isDone ? ' (concluída)' : '') + ' ' + f.summary;
  const subKeyLink = linkCell_(JIRA_LINK_(sub.key), sub.key + (isDone ? ' ✓' : ''));
  subKeyLink.className = 'story-key';
  nameCell.appendChild(subKeyLink);
  nameCell.appendChild(document.createTextNode(f.summary));
  row.appendChild(nameCell);
  row.appendChild(cell(f.status.name));
  const priorityCell = document.createElement('div');
  priorityCell.className = 'kanban-card-cell priority-cell' + (isHighPriority_(priorityName) ? ' is-high-priority' : '');
  priorityCell.title = priorityName || '-';
  priorityCell.textContent = priorityIcon_(priorityName);
  row.appendChild(priorityCell);
  row.appendChild(cell(jiraCustomFieldText_(f.customFields && f.customFields['Plano de Ação']) || '-'));
  row.appendChild(cell(f.assignee ? f.assignee.displayName : '-'));
  row.appendChild(cell(jiraCustomFieldText_(f.customFields && f.customFields['Risco Impacto']) || '-'));
  row.appendChild(cell(cltDays === null ? '-' : cltDays + 'd'));
  row.appendChild(cell(ltDays === null ? '-' : ltDays + 'd'));
  return row;
}

function renderSiteBoard_(issues) {
  const epics = {};
  const stories = [];
  const subtasksByParentKey = {};

  issues.forEach((issue) => {
    const f = issue.fields;
    if (f.issuetype.name === 'Epic') {
      epics[issue.key] = { key: issue.key, summary: f.summary, colorName: jiraEpicColorName_(f), assignee: f.assignee ? f.assignee.displayName : null };
    } else if (isSubtaskIssue_(f)) {
      // Subtarefa não vira card próprio: aparece recolhível embaixo do item.
      const parentKey = f.parent ? f.parent.key : null;
      if (parentKey) (subtasksByParentKey[parentKey] = subtasksByParentKey[parentKey] || []).push(issue);
    } else {
      stories.push(issue);
    }
  });

  siteKanban.innerHTML = '';

  if (stories.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'kanban-empty';
    empty.textContent = 'Nenhuma Story encontrada no projeto SHMB (Epics sozinhos, sem Stories filhas, não aparecem no board).';
    siteKanban.appendChild(empty);
    return;
  }

  const epicColors = buildEpicColorMap_(epics);

  siteKanban.appendChild(buildEpicLegend_(epics, epicColors, stories));

  const byStatus = {};
  stories.forEach((issue) => {
    const f = issue.fields;
    const statusName = f.status.name;
    const isDone = isDoneStatusWeb_(f);
    if (isDone) {
      const doneDays = daysSince_(doneReferenceDateIso_(f));
      if (doneDays !== null && doneDays > 60) return;
    }
    if (!byStatus[statusName]) byStatus[statusName] = [];
    byStatus[statusName].push(issue);
  });

  const buckets = buildStatusBuckets_(byStatus);

  buckets.forEach((bucket) => {
    const statusName = bucket.label;
    byStatus[statusName] = bucket.items;
    const isCancelCol = statusName.trim().toUpperCase().indexOf('CANCEL') !== -1;

    const col = document.createElement('div');
    col.className = 'kanban-col' +
      (statusName.trim().toUpperCase() === 'DONE' ? ' is-done-col' : '') +
      (isCancelCol ? ' is-cancel-col' : '');

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'kanban-col-header';
    header.setAttribute('aria-expanded', isCancelCol ? 'false' : 'true');
    const chevron = document.createElement('span');
    chevron.className = 'kanban-chevron';
    chevron.textContent = '▾';
    const title = document.createElement('span');
    title.className = 'kanban-col-title';
    title.textContent = statusName;
    if (statusName.trim().toUpperCase() === 'DONE') {
      const desc = document.createElement('span');
      desc.className = 'kanban-col-desc';
      desc.textContent = '(últimos 60 dias)';
      title.appendChild(desc);
    }
    const count = document.createElement('span');
    count.className = 'kanban-count';
    count.textContent = byStatus[statusName].length;
    header.appendChild(chevron);
    header.appendChild(title);
    header.appendChild(count);
    col.appendChild(header);

    const cardsGrid = document.createElement('div');
    cardsGrid.className = 'kanban-cards-grid';
    if (isCancelCol) cardsGrid.hidden = true;
    col.appendChild(cardsGrid);

    cardsGrid.appendChild(buildHeaderRow_());

    header.addEventListener('click', () => {
      const willShow = cardsGrid.hidden;
      cardsGrid.hidden = !willShow;
      header.setAttribute('aria-expanded', String(willShow));
    });

    byStatus[statusName]
      .slice()
      .sort((a, b) => new Date(a.fields.created) - new Date(b.fields.created))
      .forEach((issue) => {
        const f = issue.fields;
        const epic = (f.parent && epics[f.parent.key]) || { key: (f.parent && f.parent.key) || '-', summary: '(épico não encontrado)' };
        const planoAcaoRaw = jiraCustomFieldText_(f.customFields && f.customFields['Plano de Ação']);
        const planoAcaoItems = planoAcaoRaw ? planoAcaoRaw.split('\n').map((s) => s.trim()).filter(Boolean) : [];
        const subtaskNames = (f.subtasks || []).map((st) => st.fields.summary);
        const planoAcao = planoAcaoItems.length > 0
          ? planoAcaoItems.join('\n')
          : (subtaskNames.length > 0 ? subtaskNames.join('\n') : 'Refinar para definir');
        const risco = jiraCustomFieldText_(f.customFields && f.customFields['Risco Impacto']) || '-';
        const isDone = statusName.trim().toUpperCase() === 'DONE';
        const priorityName = f.priority ? f.priority.name : '';

        const card = document.createElement('div');
        card.className = 'kanban-card kanban-row-grid' + (isDone ? ' is-done' : '');
        card.style.setProperty('--epic-color', epicColors[epic.key] || 'var(--border)');

        const dataCell = document.createElement('div');
        dataCell.className = 'kanban-card-cell truncate-cell';
        dataCell.textContent = formatDateWeb_(f.created);
        dataCell.title = formatDateWeb_(f.created);
        card.appendChild(dataCell);

        // Épico: chave + nome da frente, com a bolinha na cor dela.
        const epicCell = document.createElement('div');
        epicCell.className = 'kanban-card-cell truncate-cell epic-cell';
        epicCell.title = epic.key + ' ' + epic.summary;
        epicCell.appendChild(linkCell_(JIRA_LINK_(epic.key), epic.key + ' ' + epic.summary));
        card.appendChild(epicCell);

        // História · Nome da Atividade: key (link) + espaço + nome da história
        const summaryCell = document.createElement('div');
        summaryCell.className = 'kanban-card-cell truncate-cell';
        summaryCell.title = issue.key + (isDone ? ' 🏆' : '') + ' ' + f.summary;
        const keyLink = linkCell_(JIRA_LINK_(issue.key), issue.key + (isDone ? ' 🏆' : ''));
        keyLink.className = 'story-key';
        summaryCell.appendChild(keyLink);
        summaryCell.appendChild(document.createTextNode(f.summary));
        card.appendChild(summaryCell);

        const statusCell = document.createElement('div');
        statusCell.className = 'kanban-card-cell truncate-cell';
        statusCell.textContent = statusName;
        statusCell.title = statusName;
        card.appendChild(statusCell);

        const priorityCell = document.createElement('div');
        priorityCell.className = 'kanban-card-cell priority-cell' + (isHighPriority_(priorityName) ? ' is-high-priority' : '');
        priorityCell.title = priorityName || '-';
        priorityCell.textContent = priorityIcon_(priorityName);
        card.appendChild(priorityCell);

        const planoCell = document.createElement('div');
        planoCell.className = 'kanban-card-cell truncate-cell';
        planoCell.textContent = planoAcao;
        planoCell.title = planoAcao;
        card.appendChild(planoCell);

        const respName = f.assignee ? f.assignee.displayName : '-';
        const respCell = document.createElement('div');
        respCell.className = 'kanban-card-cell truncate-cell';
        respCell.textContent = respName;
        respCell.title = respName;
        card.appendChild(respCell);

        const riscoCell = document.createElement('div');
        riscoCell.className = 'kanban-card-cell truncate-cell';
        riscoCell.textContent = risco;
        riscoCell.title = risco;
        card.appendChild(riscoCell);

        const flagged = isFlagged_(f.customFields);
        const referenceIso = doneReferenceDateIso_(f);

        const cltDays = customLeadTimeDays_(f.created, referenceIso);
        const cltCell = document.createElement('div');
        cltCell.className = 'kanban-card-cell truncate-cell';
        cltCell.textContent = cltDays === null ? '-' : cltDays + 'd';
        cltCell.title = 'Custom Lead Time: ' + (cltDays === null ? '-' : cltDays + ' dia(s), de ' + formatDateWeb_(f.created) + ' até ' + (referenceIso ? formatDateWeb_(referenceIso) + ' (Done)' : 'hoje'));
        card.appendChild(cltCell);

        const startDateIso = jiraCustomFieldText_(f.customFields && f.customFields['Start date']);
        const ltDays = leadTimeDays_(startDateIso, referenceIso);
        const ltCell = document.createElement('div');
        ltCell.className = 'kanban-card-cell truncate-cell';
        ltCell.textContent = (ltDays === null ? '-' : ltDays + 'd') + (flagged ? ' ⏳' : '');
        ltCell.title = 'Lead Time: ' + (ltDays === null ? '-' : ltDays + ' dia(s), de ' + formatDateWeb_(startDateIso) + ' até ' + (referenceIso ? formatDateWeb_(referenceIso) + ' (Done)' : 'hoje')) +
          (flagged ? '\nBloqueado (flag)' : '');
        card.appendChild(ltCell);

        const subs = (subtasksByParentKey[issue.key] || [])
          .slice()
          .sort((a, b) => new Date(a.fields.created) - new Date(b.fields.created));
        if (subs.length === 0) {
          cardsGrid.appendChild(card);
          return;
        }
        const itemWrap = document.createElement('div');
        itemWrap.className = 'kanban-item';
        itemWrap.appendChild(card);
        itemWrap.appendChild(buildSubtaskBlock_(subs, epicColors[epic.key]));
        cardsGrid.appendChild(itemWrap);
      });

    siteKanban.appendChild(col);
  });
}

// ============================================================================
// Métricas
// ============================================================================
function renderMetrics_(issues) {
  const epics = {};
  const stories = [];
  const subtasksByParentKey = {};

  issues.forEach((issue) => {
    const f = issue.fields;
    if (f.issuetype.name === 'Epic') {
      epics[issue.key] = { key: issue.key, summary: f.summary, colorName: jiraEpicColorName_(f), assignee: f.assignee ? f.assignee.displayName : null };
    } else if (isSubtaskIssue_(f)) {
      const parentKey = f.parent ? f.parent.key : null;
      if (parentKey) {
        if (!subtasksByParentKey[parentKey]) subtasksByParentKey[parentKey] = [];
        subtasksByParentKey[parentKey].push(issue);
      }
    } else {
      stories.push(issue);
    }
  });

  const cancelledStories = stories.filter((i) => isCancelStatusWeb_(i.fields));
  const subtasksByParentKeyCancelled = {};
  Object.keys(subtasksByParentKey).forEach((parentKey) => {
    const cancelledSubs = subtasksByParentKey[parentKey].filter((s) => isCancelStatusWeb_(s.fields));
    if (cancelledSubs.length) subtasksByParentKeyCancelled[parentKey] = cancelledSubs;
  });

  const total = stories.length;
  const doneCount = stories.filter((i) => {
    const f = i.fields;
    const isDone = isDoneStatusWeb_(f);
    if (!isDone) return false;
    const doneDays = daysSince_(doneReferenceDateIso_(f));
    return doneDays === null || doneDays <= 60;
  }).length;

  // Subtarefas: total e concluídas nos últimos 60 dias (mesma regra das
  // histórias, sem contar canceladas).
  const subtaskList = Object.keys(subtasksByParentKey).reduce((list, k) => list.concat(subtasksByParentKey[k]), []);
  const subtaskDoneCount = subtaskList.filter((s) => {
    const doneDate = deliveryDate_(s.fields);
    if (!doneDate) return false;
    return (Date.now() - doneDate.getTime()) / 86400000 <= 60;
  }).length;

  setStatTiles_([Object.keys(epics).length, total, doneCount, subtaskList.length, subtaskDoneCount]);

  renderEpicPieChart_(document.getElementById('metricsEpicPie'), stories, epics, buildEpicColorMap_(epics));

  renderEpicChildrenTable_(document.getElementById('metricsEpicChildrenTable'), stories, subtasksByParentKey, epics, buildEpicColorMap_(epics));

  renderStatusByEpicGroupedChart_(metricsStatusBars, stories, epics, buildEpicColorMap_(epics));

  const cancelledCountEl = document.getElementById('metricsCancelledCount');
  const cancelledSubtaskCount = Object.keys(subtasksByParentKeyCancelled).reduce((sum, k) => sum + subtasksByParentKeyCancelled[k].length, 0);
  if (cancelledCountEl) cancelledCountEl.textContent = (cancelledStories.length + cancelledSubtaskCount) + ' item(ns)';
  renderEpicChildrenTable_(document.getElementById('metricsCancelledTable'), cancelledStories, subtasksByParentKeyCancelled, epics, buildEpicColorMap_(epics), true);

  renderPeopleSummary_(document.getElementById('metricsPeopleSummary'), stories, subtaskList);

  renderFlaggedOpenItems_(document.getElementById('metricsFlaggedItems'), stories, epics);

  renderCreatedVsDoneChart_(document.getElementById('metricsCreatedVsDoneChart'), stories, epics, buildEpicColorMap_(epics), subtaskList);
}

// Itens por responsável: uma linha por pessoa e, em cada etapa (Para fazer,
// Em andamento, Finalizados nos últimos 60 dias), quantas histórias e quantas
// subtarefas ela tem. Cancelados ficam de fora.
const PEOPLE_STAGES = [
  { key: 'todo', label: 'Para fazer', desc: 'Backlog + Aprovado Comprometido' },
  { key: 'open', label: 'Em andamento', desc: 'Fazendo + Teste Validação' },
  { key: 'done', label: 'Finalizados', desc: 'últimos 60 dias' }
];
const NO_ASSIGNEE_LABEL = 'Sem responsável';

function peopleStageOf_(f) {
  if (isCancelStatusWeb_(f)) return null;
  if (isDoneStatusWeb_(f)) {
    const doneDays = daysSince_(doneReferenceDateIso_(f));
    return doneDays === null || doneDays <= 60 ? 'done' : null;
  }
  return isToDoStatusWeb_(f.status.name) ? 'todo' : 'open';
}

function personInitials_(name) {
  if (name === NO_ASSIGNEE_LABEL) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function renderPeopleSummary_(container, stories, subtasks) {
  if (!container) return;
  container.innerHTML = '';

  const people = {};
  const add = (issue, kind) => {
    const stage = peopleStageOf_(issue.fields);
    if (!stage) return;
    const name = issue.fields.assignee ? issue.fields.assignee.displayName : NO_ASSIGNEE_LABEL;
    if (!people[name]) {
      people[name] = { name, total: 0 };
      PEOPLE_STAGES.forEach((s) => { people[name][s.key] = { stories: [], subtasks: [] }; });
    }
    people[name][stage][kind].push(issue);
    people[name].total++;
  };
  stories.forEach((i) => add(i, 'stories'));
  subtasks.forEach((i) => add(i, 'subtasks'));

  // Quem tem mais itens primeiro; "Sem responsável" sempre por último.
  const rows = Object.values(people).sort((a, b) =>
    (a.name === NO_ASSIGNEE_LABEL) - (b.name === NO_ASSIGNEE_LABEL) || b.total - a.total || a.name.localeCompare(b.name));
  if (rows.length === 0) {
    container.appendChild(el_('p', 'metrics-empty', 'Sem dados.'));
    return;
  }

  // A barrinha de cada etapa usa como escala o maior total daquela etapa.
  const maxByStage = {};
  const totals = {};
  PEOPLE_STAGES.forEach((s) => {
    maxByStage[s.key] = Math.max(1, ...rows.map((r) => r[s.key].stories.length + r[s.key].subtasks.length));
    totals[s.key] = { stories: [], subtasks: [] };
  });

  const table = el_('div', 'people-summary');
  const head = el_('div', 'ps-row ps-head');
  head.appendChild(el_('span', 'ps-person-head', 'Pessoa'));
  PEOPLE_STAGES.forEach((s) => {
    const h = el_('span', null, s.label);
    h.appendChild(el_('small', null, s.desc));
    head.appendChild(h);
  });
  table.appendChild(head);

  rows.forEach((p) => {
    const row = el_('div', 'ps-row');
    row.style.setProperty('--person-color', assigneeColor_(p.name));
    const person = el_('div', 'ps-person');
    person.title = p.name;
    person.appendChild(el_('span', 'ps-avatar', personInitials_(p.name)));
    person.appendChild(el_('span', 'ps-name', p.name));
    row.appendChild(person);
    PEOPLE_STAGES.forEach((s) => {
      totals[s.key].stories.push(...p[s.key].stories);
      totals[s.key].subtasks.push(...p[s.key].subtasks);
      row.appendChild(buildPeopleCell_(s, p[s.key], maxByStage[s.key], p.name));
    });
    table.appendChild(row);
  });

  const foot = el_('div', 'ps-row ps-total');
  foot.appendChild(el_('div', 'ps-person ps-total-label', 'Total'));
  PEOPLE_STAGES.forEach((s) => foot.appendChild(buildPeopleCell_(s, totals[s.key], 0, 'Total')));
  table.appendChild(foot);

  container.appendChild(table);
}

// Célula de uma etapa: "X histórias  Y subtarefas", a barrinha dividida
// (histórias na cor da pessoa, subtarefas na mesma cor mais clara) e o
// tooltip com os itens.
function buildPeopleCell_(stage, items, max, name) {
  const nStories = items.stories.length;
  const nSubs = items.subtasks.length;
  const cell = el_('div', 'ps-cell' + (nStories + nSubs === 0 ? ' is-empty' : ''));
  cell.dataset.stage = stage.label;

  const nums = el_('div', 'ps-nums');
  const part = (n, one, many, cls) => {
    const span = el_('span', 'ps-part ' + cls + (n === 0 ? ' is-zero' : ''));
    span.appendChild(el_('b', null, String(n)));
    span.appendChild(document.createTextNode(' ' + (n === 1 ? one : many)));
    return span;
  };
  nums.appendChild(part(nStories, 'história', 'histórias', 'is-story'));
  nums.appendChild(part(nSubs, 'subtarefa', 'subtarefas', 'is-sub'));
  cell.appendChild(nums);

  if (max) {
    const bar = el_('div', 'ps-bar');
    const storyBar = el_('span', 'ps-bar-story');
    storyBar.style.width = (nStories / max) * 100 + '%';
    const subBar = el_('span', 'ps-bar-sub');
    subBar.style.width = (nSubs / max) * 100 + '%';
    if (nStories) subBar.style.marginLeft = '2px';
    bar.appendChild(storyBar);
    bar.appendChild(subBar);
    cell.appendChild(bar);
  }

  if (nStories + nSubs > 0) {
    const lines = [name + ' · ' + stage.label + ' (' + stage.desc + ')'];
    if (nStories) lines.push('', 'Histórias: ' + nStories, ...buildTooltipItemLines_(items.stories, 8));
    if (nSubs) lines.push('', 'Subtarefas: ' + nSubs, ...buildTooltipItemLines_(items.subtasks, 8));
    attachVizTooltip_(cell, lines.join('\n'));
  }
  return cell;
}

function setStatTiles_(values) {
  const tiles = metricsStats.querySelectorAll('.stat-value');
  tiles.forEach((el, i) => { if (values[i] !== undefined) el.textContent = values[i]; });
}

function renderFlaggedOpenItems_(container, stories, epics) {
  container.innerHTML = '';

  const flaggedOpen = stories.filter((i) => {
    if (!isFlagged_(i.fields.customFields)) return false;
    if (isDoneStatusWeb_(i.fields)) return false;
    const statusUpper = (i.fields.status.name || '').trim().toUpperCase();
    if (statusUpper.indexOf('CANCEL') !== -1) return false;
    return true;
  });

  if (flaggedOpen.length === 0) {
    const p = document.createElement('p');
    p.className = 'metrics-empty';
    p.textContent = 'Nenhum item sinalizado em aberto. 🎉';
    container.appendChild(p);
    return;
  }

  flaggedOpen
    .slice()
    .sort((a, b) => new Date(a.fields.created) - new Date(b.fields.created))
    .forEach((issue) => {
      const f = issue.fields;
      const epic = f.parent && epics[f.parent.key];

      const item = document.createElement('div');
      item.className = 'flagged-item';

      const icon = document.createElement('span');
      icon.textContent = '⏳';
      item.appendChild(icon);

      const body = document.createElement('div');
      body.className = 'flagged-item-body';

      const title = document.createElement('div');
      title.className = 'flagged-item-title';
      const link = document.createElement('a');
      link.href = JIRA_LINK_(issue.key);
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = issue.key;
      title.appendChild(link);
      title.appendChild(document.createTextNode(' — ' + f.summary));
      body.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'flagged-item-meta';
      meta.textContent = f.status.name + (epic ? ' · ' + f.parent.key + ' ' + epic.summary : '') +
        (f.assignee ? ' · ' + f.assignee.displayName : '');
      body.appendChild(meta);

      item.appendChild(body);
      container.appendChild(item);
    });
}

function renderStatusByEpicGroupedChart_(container, stories, epics, epicColors) {
  container.innerHTML = '';

  if (!stories || stories.length === 0) {
    const p = document.createElement('p');
    p.className = 'metrics-empty';
    p.textContent = 'Sem dados.';
    container.appendChild(p);
    return;
  }

  const epicKeys = Object.keys(epics)
    .filter((k) => stories.some((i) => i.fields.parent && i.fields.parent.key === k))
    .sort((a, b) => a.localeCompare(b));
  if (stories.some((i) => !i.fields.parent)) epicKeys.push('(sem frente)');

  const statusesFound = new Set(stories.map((i) => i.fields.status.name));
  let categories = GROUPED_CHART_STATUS_ORDER.slice();
  const backlogIdx = categories.findIndex((c) => c.trim().toUpperCase() === 'BACKLOG');
  let afterBacklogInsertAt = backlogIdx === -1 ? 0 : backlogIdx + 1;
  let foundAprovado = false;
  statusesFound.forEach((s) => {
    if (categories.some((c) => c.trim().toUpperCase() === s.trim().toUpperCase())) return;
    if (s.trim().toUpperCase().indexOf('APROVADO') !== -1) {
      categories.splice(afterBacklogInsertAt, 0, s);
      afterBacklogInsertAt++;
      foundAprovado = true;
    } else {
      categories.push(s);
    }
  });

  let matrix = {};
  let issueMatrix = {};
  categories.forEach((c) => { matrix[c] = {}; issueMatrix[c] = {}; });
  stories.forEach((i) => {
    const epicKey = i.fields.parent ? i.fields.parent.key : '(sem frente)';
    const statusName = i.fields.status.name;
    const cat = categories.find((c) => c.trim().toUpperCase() === statusName.trim().toUpperCase()) || statusName;
    if (!matrix[cat]) { matrix[cat] = {}; issueMatrix[cat] = {}; categories.push(cat); }
    matrix[cat][epicKey] = (matrix[cat][epicKey] || 0) + 1;
    if (!issueMatrix[cat][epicKey]) issueMatrix[cat][epicKey] = [];
    issueMatrix[cat][epicKey].push(i);
  });

  if (foundAprovado) {
    const comprometidoTotal = Object.values(matrix['Comprometido'] || {}).reduce((sum, n) => sum + n, 0);
    if (comprometidoTotal === 0) {
      categories = categories.filter((c) => c.trim().toUpperCase() !== 'COMPROMETIDO');
      delete matrix['Comprometido'];
    }
  }

  const maxCount = Math.max(1, ...categories.map((c) =>
    Math.max(0, ...epicKeys.map((e) => matrix[c][e] || 0))
  ));

  const barWidth = 14;
  const barGap = 3;
  const groupGap = 42;
  const chartHeight = 160;
  const leftAxisWidth = 22;
  const topPadding = 8;

  const MAX_LABEL_LINE_CHARS = 10;
  const CHAR_WIDTH_ESTIMATE = 6;
  const barsWidth = epicKeys.length * barWidth + (epicKeys.length - 1) * barGap;
  const categoryLines = categories.map((cat) => wrapAxisLabel_(cat, MAX_LABEL_LINE_CHARS));
  const groupWidths = categoryLines.map((lines) => {
    const labelWidth = Math.max(...lines.map((l) => l.length)) * CHAR_WIDTH_ESTIMATE;
    return Math.max(barsWidth, labelWidth);
  });
  const maxLabelLines = Math.max(1, ...categoryLines.map((lines) => lines.length));
  const axisLabelHeight = 6 + maxLabelLines * 11;

  const width = leftAxisWidth + groupWidths.reduce((sum, w) => sum + w, 0) + (categories.length - 1) * groupGap + 12;
  const height = topPadding + chartHeight + axisLabelHeight;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', height);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Itens por status, agrupados por frente (Epic)');
  svg.style.maxWidth = (width * 1.4) + 'px';

  [0, 0.5, 1].forEach((frac) => {
    const y = topPadding + chartHeight * (1 - frac);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', leftAxisWidth);
    line.setAttribute('x2', width - 4);
    line.setAttribute('y1', y);
    line.setAttribute('y2', y);
    line.setAttribute('class', 'viz-gridline');
    svg.appendChild(line);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', leftAxisWidth - 4);
    label.setAttribute('y', y + 3);
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('class', 'viz-axis-label');
    label.textContent = Math.round(frac * maxCount);
    svg.appendChild(label);
  });

  let groupXCursor = leftAxisWidth;
  categories.forEach((cat, ci) => {
    const groupWidth = groupWidths[ci];
    const groupX = groupXCursor;
    groupXCursor += groupWidth + groupGap;
    const barsStartX = groupX + (groupWidth - barsWidth) / 2;

    epicKeys.forEach((epicKey, ei) => {
      const count = matrix[cat][epicKey] || 0;
      const ZERO_TICK_HEIGHT = 3;
      const barHeightPx = count > 0 ? (count / maxCount) * chartHeight : ZERO_TICK_HEIGHT;
      const x = barsStartX + ei * (barWidth + barGap);
      const y = topPadding + chartHeight - barHeightPx;

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', barWidth);
      rect.setAttribute('height', Math.max(0, barHeightPx));
      rect.setAttribute('rx', 2);
      rect.setAttribute('fill', epicColors[epicKey] || 'var(--border)');
      if (count === 0) rect.setAttribute('opacity', '0.55');
      const segIssues = (issueMatrix[cat] && issueMatrix[cat][epicKey]) || [];
      const issueLines = buildTooltipItemLines_(segIssues);
      const tooltipText = (epics[epicKey] ? epicKey + ' ' + epics[epicKey].summary : epicKey) + ' — ' + cat + ': ' + count +
        (issueLines.length ? '\n' + issueLines.join('\n') : '');
      attachVizTooltip_(rect, tooltipText);
      svg.appendChild(rect);

      if (count > 0) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x + barWidth / 2);
        text.setAttribute('y', y - 3);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'viz-axis-label');
        text.textContent = count;
        svg.appendChild(text);
      }
    });

    const lines = categoryLines[ci];
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', groupX + groupWidth / 2);
    label.setAttribute('y', topPadding + chartHeight + 12);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'viz-axis-label');
    lines.forEach((line, li) => {
      const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tspan.setAttribute('x', groupX + groupWidth / 2);
      tspan.setAttribute('dy', li === 0 ? '0' : '11');
      tspan.textContent = line;
      label.appendChild(tspan);
    });
    svg.appendChild(label);
  });

  const scrollWrap = document.createElement('div');
  scrollWrap.style.overflowX = 'auto';
  scrollWrap.appendChild(svg);

  const legend = document.createElement('div');
  legend.className = 'viz-legend';
  epicKeys.forEach((epicKey) => {
    const item = document.createElement('div');
    item.className = 'viz-legend-item';
    const dot = document.createElement('span');
    dot.className = 'viz-legend-dot';
    dot.style.background = epicColors[epicKey] || 'var(--border)';
    const text = document.createElement('span');
    text.textContent = epics[epicKey] ? epicKey + ' ' + epics[epicKey].summary : epicKey;
    item.appendChild(dot);
    item.appendChild(text);
    legend.appendChild(item);
  });

  const wrap = document.createElement('div');
  wrap.className = 'viz-root';
  wrap.appendChild(scrollWrap);
  wrap.appendChild(legend);

  container.appendChild(wrap);
}

// Acima do zero: Criados (C) e Terminados (T) por mês, empilhados por frente.
// Abaixo do zero, embaixo da coluna T: subtarefas terminadas no mês, na
// frente da história-mãe, na mesma escala do eixo positivo.
function renderCreatedVsDoneChart_(container, stories, epics, epicColors, subtasks) {
  container.innerHTML = '';

  if (!stories || stories.length === 0) {
    const p = document.createElement('p');
    p.className = 'metrics-empty';
    p.textContent = 'Sem dados.';
    container.appendChild(p);
    return;
  }

  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth(), label: monthLabel_(d) });
  }
  const monthKey_ = (y, m) => y + '-' + m;

  const epicKeys = Object.keys(epics)
    .filter((k) => stories.some((i) => i.fields.parent && i.fields.parent.key === k))
    .sort((a, b) => a.localeCompare(b));
  if (stories.some((i) => !i.fields.parent)) epicKeys.push('(sem frente)');

  const createdByMonthEpic = {};
  const doneByMonthEpic = {};
  const createdIssuesByMonthEpic = {};
  const doneIssuesByMonthEpic = {};
  months.forEach((mo) => {
    createdByMonthEpic[monthKey_(mo.year, mo.month)] = {};
    doneByMonthEpic[monthKey_(mo.year, mo.month)] = {};
    createdIssuesByMonthEpic[monthKey_(mo.year, mo.month)] = {};
    doneIssuesByMonthEpic[monthKey_(mo.year, mo.month)] = {};
  });

  stories.forEach((issue) => {
    const f = issue.fields;
    const epicKey = f.parent ? f.parent.key : '(sem frente)';

    const createdDate = new Date(f.created);
    const ck = monthKey_(createdDate.getFullYear(), createdDate.getMonth());
    if (createdByMonthEpic.hasOwnProperty(ck)) {
      createdByMonthEpic[ck][epicKey] = (createdByMonthEpic[ck][epicKey] || 0) + 1;
      if (!createdIssuesByMonthEpic[ck][epicKey]) createdIssuesByMonthEpic[ck][epicKey] = [];
      createdIssuesByMonthEpic[ck][epicKey].push(issue);
    }

    if (isDoneStatusWeb_(f)) {
      const doneIso = doneReferenceDateIso_(f) || f.created;
      // "AAAA-MM-DD" sozinho seria lido como UTC e cairia no dia anterior no
      // fuso do Brasil (01/10 viraria setembro); lê como dia local.
      const doneDate = /^\d{4}-\d{2}-\d{2}$/.test(doneIso) ? new Date(doneIso + 'T00:00:00') : new Date(doneIso);
      const dk = monthKey_(doneDate.getFullYear(), doneDate.getMonth());
      if (doneByMonthEpic.hasOwnProperty(dk)) {
        doneByMonthEpic[dk][epicKey] = (doneByMonthEpic[dk][epicKey] || 0) + 1;
        if (!doneIssuesByMonthEpic[dk][epicKey]) doneIssuesByMonthEpic[dk][epicKey] = [];
        doneIssuesByMonthEpic[dk][epicKey].push(issue);
      }
    }
  });

  // Subtarefas (eixo negativo), na frente da história-mãe: criadas no mês
  // (embaixo do C) e terminadas no mês (embaixo do T).
  const storyEpicByKey = {};
  stories.forEach((s) => { storyEpicByKey[s.key] = s.fields.parent ? s.fields.parent.key : '(sem frente)'; });
  const subCreatedByMonthEpic = {};
  const subCreatedIssuesByMonthEpic = {};
  const subDoneByMonthEpic = {};
  const subDoneIssuesByMonthEpic = {};
  months.forEach((mo) => {
    const k = monthKey_(mo.year, mo.month);
    subCreatedByMonthEpic[k] = {};
    subCreatedIssuesByMonthEpic[k] = {};
    subDoneByMonthEpic[k] = {};
    subDoneIssuesByMonthEpic[k] = {};
  });
  const addSub_ = (byMonthEpic, issuesByMonthEpic, date, sub) => {
    const mk = monthKey_(date.getFullYear(), date.getMonth());
    if (!byMonthEpic.hasOwnProperty(mk)) return;
    const parentKey = sub.fields.parent ? sub.fields.parent.key : null;
    const epicKey = (parentKey && storyEpicByKey[parentKey]) || '(sem frente)';
    if (epicKeys.indexOf(epicKey) === -1) epicKeys.push(epicKey);
    byMonthEpic[mk][epicKey] = (byMonthEpic[mk][epicKey] || 0) + 1;
    if (!issuesByMonthEpic[mk][epicKey]) issuesByMonthEpic[mk][epicKey] = [];
    issuesByMonthEpic[mk][epicKey].push(sub);
  };
  (subtasks || []).forEach((sub) => {
    const createdDate = parseJiraDate_(sub.fields.created);
    if (createdDate) addSub_(subCreatedByMonthEpic, subCreatedIssuesByMonthEpic, createdDate, sub);
    const doneDate = deliveryDate_(sub.fields);
    if (doneDate) addSub_(subDoneByMonthEpic, subDoneIssuesByMonthEpic, doneDate, sub);
  });

  const monthTotal_ = (byMonthEpic, k) => Object.values(byMonthEpic[k]).reduce((sum, n) => sum + n, 0);
  const maxSubCount = Math.max(0, ...months.map((mo) => {
    const k = monthKey_(mo.year, mo.month);
    return Math.max(monthTotal_(subCreatedByMonthEpic, k), monthTotal_(subDoneByMonthEpic, k));
  }));
  const maxCount = Math.max(1, maxSubCount, ...months.map((mo) => {
    const k = monthKey_(mo.year, mo.month);
    return Math.max(monthTotal_(createdByMonthEpic, k), monthTotal_(doneByMonthEpic, k));
  }));

  const barWidth = 20;
  const barGap = 6;
  const groupGap = 26;
  const chartHeight = 160;
  // Com subtarefas, o eixo ganha espaço para os rótulos "ITENS" / "SUBTAREFAS".
  const leftAxisWidth = maxSubCount > 0 ? 84 : 22;
  const topPadding = 8;
  const axisLabelHeight = 30;

  // Área abaixo do zero: mesma escala do eixo positivo + respiro pro total.
  const zeroY = topPadding + chartHeight;
  const negChartHeight = maxSubCount > 0 ? (maxSubCount / maxCount) * chartHeight : 0;
  const negAreaHeight = negChartHeight > 0 ? negChartHeight + 14 : 0;
  const labelsTop = zeroY + negAreaHeight;

  const barsWidth = 2 * barWidth + barGap;
  const CHAR_WIDTH_ESTIMATE = 6;
  const groupWidths = months.map((mo) => Math.max(barsWidth, mo.label.length * CHAR_WIDTH_ESTIMATE));

  const width = leftAxisWidth + groupWidths.reduce((sum, w) => sum + w, 0) + (months.length - 1) * groupGap + 12;
  const height = labelsTop + axisLabelHeight;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', height);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Itens criados x terminados por mês e por frente, com as subtarefas terminadas abaixo do zero');
  svg.style.maxWidth = (width * 1.4) + 'px';

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
  pattern.setAttribute('id', 'doneHatchPattern');
  pattern.setAttribute('width', 5);
  pattern.setAttribute('height', 5);
  pattern.setAttribute('patternTransform', 'rotate(45)');
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  const hatchLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  hatchLine.setAttribute('x1', 0);
  hatchLine.setAttribute('y1', 0);
  hatchLine.setAttribute('x2', 0);
  hatchLine.setAttribute('y2', 5);
  hatchLine.setAttribute('stroke', 'rgba(255,255,255,0.55)');
  hatchLine.setAttribute('stroke-width', 2);
  pattern.appendChild(hatchLine);
  defs.appendChild(pattern);
  svg.appendChild(defs);

  // Faixas alternadas (branco / cinza claro) na altura toda do gráfico,
  // marcando onde começa e termina cada mês.
  let bandCursor = leftAxisWidth;
  months.forEach((mo, mi) => {
    const bandStart = mi === 0 ? leftAxisWidth : bandCursor - groupGap / 2;
    const bandEnd = mi === months.length - 1 ? width - 4 : bandCursor + groupWidths[mi] + groupGap / 2;
    bandCursor += groupWidths[mi] + groupGap;
    if (mi % 2 === 0) return;
    const band = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    band.setAttribute('x', bandStart);
    band.setAttribute('y', 0);
    band.setAttribute('width', bandEnd - bandStart);
    band.setAttribute('height', height);
    band.setAttribute('fill', '#8993a4');
    band.setAttribute('opacity', '0.1');
    band.setAttribute('pointer-events', 'none');
    svg.appendChild(band);
  });

  [0, 0.5, 1].forEach((frac) => {
    const y = topPadding + chartHeight * (1 - frac);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', leftAxisWidth);
    line.setAttribute('x2', width - 4);
    line.setAttribute('y1', y);
    line.setAttribute('y2', y);
    line.setAttribute('class', 'viz-gridline');
    svg.appendChild(line);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', leftAxisWidth - 4);
    label.setAttribute('y', y + 3);
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('class', 'viz-axis-label');
    label.textContent = Math.round(frac * maxCount);
    svg.appendChild(label);
  });

  // Eixo negativo: linha de base mais forte no zero + marca do maior valor.
  if (negChartHeight > 0) {
    const baseline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    baseline.setAttribute('x1', leftAxisWidth);
    baseline.setAttribute('x2', width - 4);
    baseline.setAttribute('y1', zeroY);
    baseline.setAttribute('y2', zeroY);
    baseline.setAttribute('stroke', 'var(--viz-baseline)');
    baseline.setAttribute('stroke-width', 1);
    svg.appendChild(baseline);

    const negLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    negLine.setAttribute('x1', leftAxisWidth);
    negLine.setAttribute('x2', width - 4);
    negLine.setAttribute('y1', zeroY + negChartHeight);
    negLine.setAttribute('y2', zeroY + negChartHeight);
    negLine.setAttribute('class', 'viz-gridline');
    svg.appendChild(negLine);

    const negLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    negLabel.setAttribute('x', leftAxisWidth - 4);
    negLabel.setAttribute('y', zeroY + negChartHeight + 3);
    negLabel.setAttribute('text-anchor', 'end');
    negLabel.setAttribute('class', 'viz-axis-label');
    negLabel.textContent = '−' + maxSubCount;
    svg.appendChild(negLabel);

    // Identifica as duas metades do gráfico, junto da linha do zero.
    [['ITENS ▲', zeroY - 12], ['SUBTAREFAS ▼', zeroY + 16]].forEach((entry) => {
      const sideLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      sideLabel.setAttribute('x', leftAxisWidth - 16);
      sideLabel.setAttribute('y', entry[1]);
      sideLabel.setAttribute('text-anchor', 'end');
      sideLabel.setAttribute('class', 'viz-axis-label');
      sideLabel.setAttribute('font-weight', '700');
      sideLabel.setAttribute('letter-spacing', '0.06em');
      sideLabel.textContent = entry[0];
      svg.appendChild(sideLabel);
    });
  }

  let groupXCursor = leftAxisWidth;
  months.forEach((mo, mi) => {
    const groupWidth = groupWidths[mi];
    const groupX = groupXCursor;
    groupXCursor += groupWidth + groupGap;
    const barsStartX = groupX + (groupWidth - barsWidth) / 2;

    const k = monthKey_(mo.year, mo.month);

    // Barras de subtarefas, para baixo: criadas sob o C, terminadas sob o T.
    [
      { byEpic: subCreatedByMonthEpic[k], issuesByEpic: subCreatedIssuesByMonthEpic[k], label: 'Subtarefas criadas', hatched: false },
      { byEpic: subDoneByMonthEpic[k], issuesByEpic: subDoneIssuesByMonthEpic[k], label: 'Subtarefas terminadas', hatched: true }
    ].forEach((subSeries, si) => {
    const subTotal = Object.values(subSeries.byEpic).reduce((sum, n) => sum + n, 0);
    if (subTotal > 0) {
      const subX = barsStartX + si * (barWidth + barGap);
      const subBarHeight = (subTotal / maxCount) * chartHeight;
      let subCursor = zeroY;
      epicKeys.forEach((epicKey) => {
        const count = subSeries.byEpic[epicKey] || 0;
        if (count <= 0) return;
        const segHeight = (count / subTotal) * subBarHeight;
        const segY = subCursor;
        subCursor += segHeight;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', subX);
        rect.setAttribute('y', segY);
        rect.setAttribute('width', barWidth);
        rect.setAttribute('height', Math.max(0, segHeight));
        rect.setAttribute('fill', epicColors[epicKey] || 'var(--border)');
        rect.setAttribute('opacity', '0.8');
        const epicLabel = epics[epicKey] ? epicKey + ' ' + epics[epicKey].summary : epicKey;
        const issueLines = (subSeries.issuesByEpic[epicKey] || [])
          .slice()
          .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
          .map((it) => it.key + ' — ' + it.fields.summary);
        attachVizTooltip_(rect, mo.label + ' — ' + subSeries.label + ' — ' + epicLabel + ': ' + count +
          (issueLines.length ? '\n' + issueLines.join('\n') : ''));
        svg.appendChild(rect);

        if (subSeries.hatched) {
          const hatchRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          hatchRect.setAttribute('x', subX);
          hatchRect.setAttribute('y', segY);
          hatchRect.setAttribute('width', barWidth);
          hatchRect.setAttribute('height', Math.max(0, segHeight));
          hatchRect.setAttribute('fill', 'url(#doneHatchPattern)');
          hatchRect.setAttribute('pointer-events', 'none');
          svg.appendChild(hatchRect);
        }

        if (segHeight >= 13) {
          const segLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          segLabel.setAttribute('x', subX + barWidth / 2);
          segLabel.setAttribute('y', segY + segHeight / 2 + 3);
          segLabel.setAttribute('text-anchor', 'middle');
          segLabel.setAttribute('fill', '#ffffff');
          segLabel.setAttribute('font-size', '9');
          segLabel.setAttribute('font-weight', '700');
          segLabel.setAttribute('pointer-events', 'none');
          segLabel.textContent = count;
          svg.appendChild(segLabel);
        }
      });

      const subOutline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      subOutline.setAttribute('x', subX);
      subOutline.setAttribute('y', zeroY);
      subOutline.setAttribute('width', barWidth);
      subOutline.setAttribute('height', Math.max(0, subBarHeight));
      subOutline.setAttribute('rx', 2);
      subOutline.setAttribute('fill', 'none');
      subOutline.setAttribute('class', 'viz-stack-outline');
      svg.appendChild(subOutline);

      const subTotalLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      subTotalLabel.setAttribute('x', subX + barWidth / 2);
      subTotalLabel.setAttribute('y', zeroY + subBarHeight + 10);
      subTotalLabel.setAttribute('text-anchor', 'middle');
      subTotalLabel.setAttribute('class', 'viz-axis-label');
      subTotalLabel.textContent = subTotal;
      svg.appendChild(subTotalLabel);
    }
    });

    [
      { byEpic: createdByMonthEpic[k], issuesByEpic: createdIssuesByMonthEpic[k], label: 'Criados', shortLabel: 'C' },
      { byEpic: doneByMonthEpic[k], issuesByEpic: doneIssuesByMonthEpic[k], label: 'Terminados', shortLabel: 'T' }
    ].forEach((series, si) => {
      const total = Object.values(series.byEpic).reduce((sum, n) => sum + n, 0);
      const barHeightPx = total > 0 ? (total / maxCount) * chartHeight : 0;
      const x = barsStartX + si * (barWidth + barGap);
      const barTop = topPadding + chartHeight - barHeightPx;

      let stackYCursor = topPadding + chartHeight;
      epicKeys.forEach((epicKey) => {
        const count = series.byEpic[epicKey] || 0;
        if (count <= 0) return;
        const segHeight = (count / total) * barHeightPx;
        const segY = stackYCursor - segHeight;
        stackYCursor = segY;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', segY);
        rect.setAttribute('width', barWidth);
        rect.setAttribute('height', Math.max(0, segHeight));
        rect.setAttribute('fill', epicColors[epicKey] || 'var(--border)');
        const pct = Math.round((count / total) * 100);
        const epicLabel = epics[epicKey] ? epicKey + ' ' + epics[epicKey].summary : epicKey;
        const segIssues = (series.issuesByEpic && series.issuesByEpic[epicKey]) || [];
        const MAX_TOOLTIP_ITEMS = 12;
        const issueLines = segIssues
          .slice()
          .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
          .slice(0, MAX_TOOLTIP_ITEMS)
          .map((it) => it.key + ' — ' + it.fields.summary);
        if (segIssues.length > MAX_TOOLTIP_ITEMS) {
          issueLines.push('… + ' + (segIssues.length - MAX_TOOLTIP_ITEMS) + ' item(ns)');
        }
        const tooltipText = mo.label + ' — ' + series.label + ' — ' + epicLabel + ': ' + count + ' (' + pct + '%)' +
          (issueLines.length ? '\n' + issueLines.join('\n') : '');
        attachVizTooltip_(rect, tooltipText);
        svg.appendChild(rect);

        if (si === 1) {
          const hatchRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          hatchRect.setAttribute('x', x);
          hatchRect.setAttribute('y', segY);
          hatchRect.setAttribute('width', barWidth);
          hatchRect.setAttribute('height', Math.max(0, segHeight));
          hatchRect.setAttribute('fill', 'url(#doneHatchPattern)');
          hatchRect.setAttribute('pointer-events', 'none');
          svg.appendChild(hatchRect);
        }

        if (segHeight >= 13) {
          const segLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          segLabel.setAttribute('x', x + barWidth / 2);
          segLabel.setAttribute('y', segY + segHeight / 2 + 3);
          segLabel.setAttribute('text-anchor', 'middle');
          segLabel.setAttribute('fill', '#ffffff');
          segLabel.setAttribute('font-size', '9');
          segLabel.setAttribute('font-weight', '700');
          segLabel.setAttribute('pointer-events', 'none');
          segLabel.textContent = count;
          svg.appendChild(segLabel);
        }
      });
      if (total > 0) {
        const rectOutline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rectOutline.setAttribute('x', x);
        rectOutline.setAttribute('y', barTop);
        rectOutline.setAttribute('width', barWidth);
        rectOutline.setAttribute('height', Math.max(0, barHeightPx));
        rectOutline.setAttribute('rx', 2);
        rectOutline.setAttribute('fill', 'none');
        rectOutline.setAttribute('class', 'viz-stack-outline');
        svg.appendChild(rectOutline);
      }

      const totalLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      totalLabel.setAttribute('x', x + barWidth / 2);
      totalLabel.setAttribute('y', barTop - 3);
      totalLabel.setAttribute('text-anchor', 'middle');
      totalLabel.setAttribute('class', 'viz-axis-label');
      totalLabel.textContent = total > 0 ? total : '';
      svg.appendChild(totalLabel);

      const shortLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      shortLabel.setAttribute('x', x + barWidth / 2);
      shortLabel.setAttribute('y', labelsTop + 12);
      shortLabel.setAttribute('text-anchor', 'middle');
      shortLabel.setAttribute('class', 'viz-axis-label');
      shortLabel.textContent = series.shortLabel;
      svg.appendChild(shortLabel);
    });

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', groupX + groupWidth / 2);
    label.setAttribute('y', labelsTop + 26);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'viz-axis-label');
    label.textContent = mo.label;
    svg.appendChild(label);
  });

  const scrollWrap = document.createElement('div');
  scrollWrap.style.overflowX = 'auto';
  scrollWrap.appendChild(svg);

  const patternLegend = document.createElement('div');
  patternLegend.className = 'viz-legend';
  [
    { label: 'Criados (C) — cor sólida', hatched: false },
    { label: 'Terminados (T) — cor rachurada', hatched: true },
    { label: 'Acima do zero: itens · abaixo do zero: subtarefas', hatched: false }
  ].forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'viz-legend-item';
    const dot = document.createElement('span');
    dot.className = 'viz-legend-dot' + (entry.hatched ? ' viz-legend-dot-hatched' : '');
    dot.style.background = '#9aa0a8';
    const text = document.createElement('span');
    text.textContent = entry.label;
    item.appendChild(dot);
    item.appendChild(text);
    patternLegend.appendChild(item);
  });

  const legend = document.createElement('div');
  legend.className = 'viz-legend';
  epicKeys.forEach((epicKey) => {
    const item = document.createElement('div');
    item.className = 'viz-legend-item';
    const dot = document.createElement('span');
    dot.className = 'viz-legend-dot';
    dot.style.background = epicColors[epicKey] || 'var(--border)';
    const text = document.createElement('span');
    text.textContent = epics[epicKey] ? epicKey + ' ' + epics[epicKey].summary : epicKey;
    item.appendChild(dot);
    item.appendChild(text);
    legend.appendChild(item);
  });

  const wrap = document.createElement('div');
  wrap.className = 'viz-root';
  wrap.appendChild(scrollWrap);
  wrap.appendChild(patternLegend);
  wrap.appendChild(legend);

  container.appendChild(wrap);
}

// Cor fixa por colaborador nos gráficos "por responsável": a mesma pessoa tem
// sempre a mesma cor em todos os gráficos, e cada pessoa uma cor diferente,
// todas em tons de azul/marinho que combinam com o painel.
const ASSIGNEE_PALETTE = ['#23406e', '#0f8a8c', '#5b4bc4', '#2a78d6', '#0e7490', '#7c5cd6', '#3b82c4', '#155e75', '#6366a8', '#2f9bd1'];
const ASSIGNEE_FIXED_COLOR_IDX = { 'victor freitas': 0, 'nestor rodrigues rocha': 1, 'flavia azevedo': 2 };
function assigneeColor_(name) {
  const key = (name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  if (!key || key === '-' || key === 'sem responsavel') return '#97a0af';
  if (ASSIGNEE_FIXED_COLOR_IDX.hasOwnProperty(key)) return ASSIGNEE_PALETTE[ASSIGNEE_FIXED_COLOR_IDX[key]];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const free = ASSIGNEE_PALETTE.length - 3;
  return ASSIGNEE_PALETTE[3 + (hash % free)];
}

function renderBarList_(container, rows, total, issuesByLabel, colorForLabel) {
  container.innerHTML = '';
  if (rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'metrics-empty';
    p.textContent = 'Sem dados.';
    container.appendChild(p);
    return;
  }

  rows.forEach((row) => {
    const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;

    const rowEl = document.createElement('div');
    rowEl.className = 'bar-row';

    const label = document.createElement('span');
    label.className = 'bar-row-label';
    label.textContent = row.label;
    label.title = row.label;

    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = pct + '%';
    if (colorForLabel) {
      const color = colorForLabel(row.label);
      fill.style.background = 'linear-gradient(90deg, color-mix(in srgb, ' + color + ' 25%, transparent), ' + color + ')';
      const dot = document.createElement('span');
      dot.className = 'bar-row-dot';
      dot.style.background = color;
      label.prepend(dot);
    }
    track.appendChild(fill);

    const countEl = document.createElement('span');
    countEl.className = 'bar-row-count';
    countEl.textContent = row.count;

    rowEl.appendChild(label);
    rowEl.appendChild(track);
    rowEl.appendChild(countEl);

    if (issuesByLabel) {
      const rowIssues = issuesByLabel[row.label] || [];
      const issueLines = buildTooltipItemLines_(rowIssues);
      const tooltipText = row.label + ': ' + row.count + ' (' + pct + '%)' +
        (issueLines.length ? '\n' + issueLines.join('\n') : '');
      attachVizTooltip_(rowEl, tooltipText);
    }

    container.appendChild(rowEl);
  });
}

function renderEpicPieChart_(container, stories, epics, epicColors) {
  container.innerHTML = '';
  if (!stories || stories.length === 0) {
    const p = document.createElement('p');
    p.className = 'metrics-empty';
    p.textContent = 'Sem dados.';
    container.appendChild(p);
    return;
  }

  const byEpicKey = {};
  stories.forEach((i) => {
    const epicKey = i.fields.parent ? i.fields.parent.key : '(sem frente)';
    if (!byEpicKey[epicKey]) byEpicKey[epicKey] = [];
    byEpicKey[epicKey].push(i);
  });

  const total = stories.length;
  const rows = Object.keys(byEpicKey)
    .sort((a, b) => a.localeCompare(b))
    .map((epicKey) => ({
      epicKey: epicKey,
      label: epics[epicKey] ? epicKey + ' ' + epics[epicKey].summary : epicKey,
      count: byEpicKey[epicKey].length,
      items: byEpicKey[epicKey]
        .slice()
        .sort((a, b) => new Date(a.fields.created) - new Date(b.fields.created))
    }));

  const size = 168;
  const strokeWidth = 30;
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Distribuição de stories por frente (Epic)');

  const sliceEls = [];
  let offset = 0;
  rows.forEach((row) => {
    const fraction = row.count / total;
    const dash = fraction * circumference;
    const gap = 2;
    const color = epicColors[row.epicKey] || 'var(--border)';
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', radius);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', strokeWidth);
    circle.setAttribute('stroke-dasharray', Math.max(0, dash - gap) + ' ' + (circumference - dash + gap));
    circle.setAttribute('stroke-dashoffset', -offset);
    circle.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
    circle.style.transition = 'opacity 0.15s ease, stroke-width 0.15s ease';
    circle.style.cursor = 'pointer';
    const pieIssueLines = buildTooltipItemLines_(row.items);
    const tooltipText = row.label + ': ' + row.count + ' (' + Math.round(fraction * 100) + '%)' +
      (pieIssueLines.length ? '\n' + pieIssueLines.join('\n') : '');
    attachVizTooltip_(circle, tooltipText);
    sliceEls.push(circle);
    svg.appendChild(circle);

    circle.addEventListener('mouseenter', () => {
      sliceEls.forEach((s) => {
        if (s === circle) {
          s.setAttribute('stroke-width', strokeWidth + 4);
          s.style.opacity = '1';
        } else {
          s.style.opacity = '0.35';
        }
      });
    });
    circle.addEventListener('mouseleave', () => {
      sliceEls.forEach((s) => {
        s.setAttribute('stroke-width', strokeWidth);
        s.style.opacity = '1';
      });
    });

    if (fraction >= 0.08) {
      const midAngle = (offset / circumference) * 2 * Math.PI + (fraction * 2 * Math.PI) / 2 - Math.PI / 2;
      const lx = cx + Math.cos(midAngle) * radius;
      const ly = cy + Math.sin(midAngle) * radius;
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', lx);
      text.setAttribute('y', ly);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', '#ffffff');
      text.setAttribute('font-size', '10');
      text.setAttribute('font-weight', '700');
      text.textContent = row.count;
      svg.appendChild(text);
    }

    offset += dash;
  });

  const centerValue = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  centerValue.setAttribute('x', cx);
  centerValue.setAttribute('y', cy - 4);
  centerValue.setAttribute('text-anchor', 'middle');
  centerValue.setAttribute('class', 'viz-pie-center-value');
  centerValue.textContent = total;
  svg.appendChild(centerValue);

  const centerLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  centerLabel.setAttribute('x', cx);
  centerLabel.setAttribute('y', cy + 14);
  centerLabel.setAttribute('text-anchor', 'middle');
  centerLabel.setAttribute('class', 'viz-pie-center-label');
  centerLabel.textContent = 'STORIES';
  svg.appendChild(centerLabel);

  const wrap = document.createElement('div');
  wrap.className = 'viz-pie-wrap';
  wrap.appendChild(svg);

  const legend = document.createElement('div');
  legend.className = 'viz-legend viz-legend-vertical';
  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = 'viz-legend-item';
    const dot = document.createElement('span');
    dot.className = 'viz-legend-dot';
    dot.style.background = epicColors[row.epicKey] || 'var(--border)';
    item.appendChild(dot);
    const text = document.createElement('span');
    text.textContent = row.label + ' — ' + row.count + ' (' + Math.round((row.count / total) * 100) + '%)';
    item.appendChild(text);
    legend.appendChild(item);
  });
  wrap.appendChild(legend);

  container.appendChild(wrap);
}

function renderEpicChildrenTable_(container, stories, subtasksByParentKey, epics, epicColors, isCancelledTable) {
  container.innerHTML = '';

  if (!stories || stories.length === 0) {
    const p = document.createElement('p');
    p.className = 'metrics-empty';
    p.textContent = 'Sem dados.';
    container.appendChild(p);
    return;
  }

  const byEpicKey = {};
  stories.forEach((i) => {
    const epicKey = i.fields.parent ? i.fields.parent.key : '(sem frente)';
    if (!byEpicKey[epicKey]) byEpicKey[epicKey] = [];
    byEpicKey[epicKey].push(i);
  });

  const table = document.createElement('table');
  table.className = 'site-table epic-children-table' + (isCancelledTable ? ' cancel-children-table' : '');
  const tbody = document.createElement('tbody');

  function assigneeSuffix_(displayName) {
    if (!displayName) return null;
    const em = document.createElement('em');
    em.className = 'epic-children-assignee';
    em.textContent = ' (' + displayName + ')';
    return em;
  }

  Object.keys(byEpicKey).sort((a, b) => a.localeCompare(b)).forEach((epicKey) => {
    const epic = epics[epicKey];
    const epicRow = document.createElement('tr');
    epicRow.className = 'epic-children-row epic-children-row-epic';
    const epicCell = document.createElement('td');
    const dot = document.createElement('span');
    dot.className = 'viz-legend-dot';
    dot.style.background = epicColors[epicKey] || 'var(--border)';
    dot.style.marginRight = '6px';
    epicCell.appendChild(dot);
    const epicLabel = epic ? epicKey + ' ' + epic.summary : epicKey;
    if (epic) {
      const link = document.createElement('a');
      link.href = JIRA_LINK_(epicKey);
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = epicLabel;
      epicCell.appendChild(link);
    } else {
      epicCell.appendChild(document.createTextNode(epicLabel));
    }
    const epicAssignee = assigneeSuffix_(epic && epic.assignee);
    if (epicAssignee) epicCell.appendChild(epicAssignee);
    epicRow.appendChild(epicCell);
    tbody.appendChild(epicRow);

    byEpicKey[epicKey]
      .slice()
      .sort((a, b) => new Date(a.fields.created) - new Date(b.fields.created))
      .forEach((issue) => {
        const f = issue.fields;
        const isDone = isDoneStatusWeb_(f);
        const isCancel = isCancelStatusWeb_(f);
        const storyRow = document.createElement('tr');
        storyRow.className = 'epic-children-row epic-children-row-story' + ((isDone || isCancel) ? ' is-done-child' : '');
        const storyCell = document.createElement('td');
        const storyLink = document.createElement('a');
        storyLink.href = JIRA_LINK_(issue.key);
        storyLink.target = '_blank';
        storyLink.rel = 'noopener';
        storyLink.textContent = issue.key + (isDone ? ' 🏆' : '');
        storyCell.appendChild(storyLink);
        storyCell.appendChild(document.createTextNode(' — ' + f.summary));
        const storyAssignee = assigneeSuffix_(f.assignee ? f.assignee.displayName : null);
        if (storyAssignee) storyCell.appendChild(storyAssignee);
        storyRow.appendChild(storyCell);
        tbody.appendChild(storyRow);

        (subtasksByParentKey[issue.key] || [])
          .slice()
          .sort((a, b) => new Date(a.fields.created) - new Date(b.fields.created))
          .forEach((sub) => {
            const sf = sub.fields;
            const subIsDone = isDoneStatusWeb_(sf);
            const subIsCancel = isCancelStatusWeb_(sf);
            const subRow = document.createElement('tr');
            subRow.className = 'epic-children-row epic-children-row-subtask' + ((subIsDone || subIsCancel) ? ' is-done-child' : '');
            const subCell = document.createElement('td');
            const subLink = document.createElement('a');
            subLink.href = JIRA_LINK_(sub.key);
            subLink.target = '_blank';
            subLink.rel = 'noopener';
            subLink.textContent = sub.key + (subIsDone ? ' 🏆' : '');
            subCell.appendChild(subLink);
            subCell.appendChild(document.createTextNode(' — ' + sf.summary));
            const subAssignee = assigneeSuffix_(sf.assignee ? sf.assignee.displayName : null);
            if (subAssignee) subCell.appendChild(subAssignee);
            subRow.appendChild(subCell);
            tbody.appendChild(subRow);
          });
      });
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

// ============================================================================
// Entregas do mês (aba Entregas) — tela pensada para print e slide da
// cadência com a diretoria. Uma linha por entrega: Épico → Item → Subtarefa,
// com 🏆 no card que foi de fato entregue. Cada mês tem link próprio
// (#entregas/AAAA-MM), então os meses anteriores continuam acessíveis.
// ============================================================================
const MONTH_NAMES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

let deliveriesMonthKey_ = null; // 'AAAA-MM' do mês exibido; null = mês atual

function monthKeyOf_(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

function monthKeyLabel_(monthKey) {
  const parts = monthKey.split('-');
  return MONTH_NAMES_PT[+parts[1] - 1] + ' ' + parts[0];
}

function previousMonthKey_(monthKey) {
  const parts = monthKey.split('-');
  return monthKeyOf_(new Date(+parts[0], +parts[1] - 2, 1));
}

// O Jira devolve "2026-10-16T11:49:05.599-0300"; o fuso sem ":" não é ISO
// estrito e alguns navegadores (Safari) recusam, então normaliza antes.
function parseJiraDate_(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return isNaN(d.getTime()) ? null : d;
}

// Data de entrega: campo "Done Date" do Jira (só data, lida como dia local
// pra não voltar um dia no fuso do Brasil); sem ele, a data em que o item
// entrou na categoria Done. "CANCELAR" fica na categoria Done, mas não é entrega.
function deliveryDate_(f) {
  if (!isDoneStatusWeb_(f) || isCancelStatusWeb_(f)) return null;
  const doneDate = jiraCustomFieldText_(f.customFields && f.customFields['Done Date']);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(doneDate || '');
  if (dateOnly) return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]);
  return parseJiraDate_(f.statuscategorychangedate);
}

function collectDeliveries_(issues) {
  const byKey = {};
  const epics = {};
  issues.forEach((issue) => {
    byKey[issue.key] = issue;
    const f = issue.fields;
    if (f.issuetype.name === 'Epic') {
      epics[issue.key] = { key: issue.key, summary: f.summary, colorName: jiraEpicColorName_(f) };
    }
  });

  const deliveries = [];
  issues.forEach((issue) => {
    const f = issue.fields;
    if (f.issuetype.name === 'Epic') return;
    const date = deliveryDate_(f);
    if (!date) return;

    let story = issue;
    let subtask = null;
    if (isSubtaskIssue_(f)) {
      subtask = issue;
      const parentKey = f.parent ? f.parent.key : null;
      story = (parentKey && byKey[parentKey]) || (f.parent ? { key: parentKey, fields: f.parent.fields || {} } : null);
    }
    const epicKey = story && story.fields.parent ? story.fields.parent.key : null;
    deliveries.push({ date, monthKey: monthKeyOf_(date), epicKey, story, subtask });
  });

  return { deliveries, epics };
}

// Do mês da entrega mais antiga até o mês atual — inclui meses sem entrega,
// para a sequência de links não pular mês.
function deliveryMonthKeys_(deliveries) {
  const current = monthKeyOf_(new Date());
  const oldest = deliveries.reduce((min, d) => (d.monthKey < min ? d.monthKey : min), current);
  const keys = [];
  let key = current;
  while (key >= oldest) {
    keys.push(key);
    key = previousMonthKey_(key);
  }
  return keys;
}

function deliveriesMonthFromHash_() {
  const match = /^#entregas(?:\/(\d{4}-\d{2}))?$/.exec(location.hash);
  if (!match) return null;
  return match[1] || '';
}

function el_(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function deliveryKeyLink_(key, suffix) {
  const a = el_('a', 'dcard-key', key + (suffix ? ' · ' + suffix : ''));
  a.href = JIRA_LINK_(key);
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function plural_(count, singular, pluralText) {
  return count + ' ' + (count === 1 ? singular : pluralText);
}

// Card mesclado (ocupa várias linhas): conteúdo no topo + contador, para a
// altura extra não parecer um card vazio.
function buildEpicCard_(epicKey, epic, deliveryCount, merged) {
  const card = el_('div', 'dcard dcard-epic has-next' + (merged ? ' is-merged' : ''));
  const body = el_('div', 'dcard-body');
  if (epicKey) body.appendChild(deliveryKeyLink_(epicKey));
  body.appendChild(el_('span', 'dcard-title', epic ? epic.summary : 'Sem frente definida'));
  body.appendChild(el_('span', 'dcard-count', plural_(deliveryCount, 'entrega', 'entregas')));
  card.appendChild(body);
  return card;
}

function buildIssueCard_(issue, typeLabel, delivered, date, hasNext, deliveredChildren) {
  const merged = deliveredChildren > 1;
  const card = el_('div', 'dcard dcard-item' + (delivered ? ' is-delivered' : '') + (hasNext ? ' has-next' : '') + (merged ? ' is-merged' : ''));
  if (!issue) {
    card.appendChild(el_('span', 'dcard-title', '—'));
    return card;
  }
  const f = issue.fields;
  if (delivered) card.appendChild(el_('span', 'dcard-trophy', '🏆'));
  const body = el_('div', 'dcard-body');
  body.appendChild(deliveryKeyLink_(issue.key, typeLabel));
  body.appendChild(el_('span', 'dcard-title', f.summary || issue.key));
  if (delivered) {
    // Risco/Impacto em itálico, menor, logo depois do nome do colaborador.
    const meta = el_('span', 'dcard-meta');
    meta.appendChild(el_('span', 'dcard-badge', 'Entregue'));
    meta.appendChild(el_('span', null, formatDateWeb_(date)));
    if (f.assignee) meta.appendChild(el_('span', 'dcard-who', '· ' + f.assignee.displayName));
    const risco = jiraCustomFieldText_(f.customFields && f.customFields['Risco Impacto']);
    if (risco) meta.appendChild(el_('em', 'dcard-risk', '· ' + risco));
    body.appendChild(meta);
  } else if (deliveredChildren) {
    body.appendChild(el_('span', 'dcard-count', plural_(deliveredChildren, 'subtarefa entregue', 'subtarefas entregues')));
  }
  card.appendChild(body);
  return card;
}

// Posição explícita no grid via variáveis CSS, para o media query mobile
// conseguir desfazer o "mesclado" e empilhar os cards.
function placeCell_(node, column, rowStart, rowSpan) {
  node.style.setProperty('--c', column);
  node.style.setProperty('--r', rowStart);
  node.style.setProperty('--s', rowSpan);
  return node;
}

// Épico → histórias → subtarefas entregues, na ordem em que chegam
// (já ordenadas por épico e data). A história entregue sem subtarefa
// traz a própria data; a que só tem subtarefas entregues fica sem data.
function groupDeliveries_(monthDeliveries) {
  const groups = [];
  const groupByEpic = {};
  monthDeliveries.forEach((d) => {
    const epicId = d.epicKey || '-';
    let group = groupByEpic[epicId];
    if (!group) {
      group = { epicKey: d.epicKey, stories: [], storyByKey: {} };
      groupByEpic[epicId] = group;
      groups.push(group);
    }
    const storyId = d.story ? d.story.key : '-';
    let story = group.storyByKey[storyId];
    if (!story) {
      story = { story: d.story, date: null, subtasks: [] };
      group.storyByKey[storyId] = story;
      group.stories.push(story);
    }
    if (d.subtask) story.subtasks.push({ subtask: d.subtask, date: d.date });
    else story.date = d.date;
  });
  return groups;
}

// Pódio do mês: top 5 por número de entregas da lista recebida (só
// histórias ou só subtarefas). Empate desempata pelo nome, para a ordem ser
// estável.
function buildPodium_(deliveriesList, title, emptyText) {
  const counts = {};
  deliveriesList.forEach((d) => {
    const f = (d.subtask || d.story).fields;
    const name = f.assignee ? f.assignee.displayName : 'Sem responsável';
    counts[name] = (counts[name] || 0) + 1;
  });
  const ranking = Object.keys(counts)
    .map((name) => ({ name, count: counts[name] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);

  const section = el_('div', 'delivery-podium');
  section.appendChild(el_('span', 'delivery-podium-title', title));
  if (ranking.length === 0) {
    section.appendChild(el_('span', 'delivery-podium-empty', emptyText));
    return section;
  }

  // 5 degraus, 1º no centro e descendo para as pontas: 4º, 2º, 1º, 3º, 5º.
  // Posição sem ninguém continua desenhada, vazia, sinalizando que o time
  // ainda não está completo.
  const stage = el_('div', 'podium-stage');
  [3, 1, 0, 2, 4].forEach((idx) => {
    const entry = ranking[idx];
    const step = el_('div', 'podium-step podium-place-' + (idx + 1) + (entry ? '' : ' is-vacant'));
    // 1º a 3º: medalhas 🥇🥈🥉; 4º e 5º: medalha desenhada com o número dentro.
    if (idx < 3) step.appendChild(el_('span', 'podium-medal', ['🥇', '🥈', '🥉'][idx]));
    else step.appendChild(el_('span', 'podium-medal podium-medal-num', String(idx + 1)));
    step.appendChild(el_('span', 'podium-name', entry ? entry.name : 'Posição em aberto'));
    if (!entry) step.appendChild(el_('span', 'podium-count', 'time em formação'));
    // O degrau mostra a quantidade de itens entregues, não a posição.
    const count = entry ? entry.count : 0;
    const block = el_('div', 'podium-block');
    block.appendChild(el_('span', 'podium-block-value', String(count)));
    block.appendChild(el_('span', 'podium-block-label', count === 1 ? 'entrega' : 'entregas'));
    step.appendChild(block);
    stage.appendChild(step);
  });
  section.appendChild(stage);
  return section;
}

function renderDeliveries_(issues) {
  const board = document.getElementById('deliveriesBoard');
  const monthsNav = document.getElementById('deliveriesMonths');
  if (!board || !monthsNav) return;

  const { deliveries, epics } = collectDeliveries_(issues);
  const epicColors = buildEpicColorMap_(epics);
  const monthKeys = deliveryMonthKeys_(deliveries);
  const monthKey = monthKeys.indexOf(deliveriesMonthKey_) !== -1 ? deliveriesMonthKey_ : monthKeys[0];

  // Links dos meses (atual primeiro, depois os anteriores)
  monthsNav.innerHTML = '';
  monthKeys.forEach((key) => {
    const count = deliveries.filter((d) => d.monthKey === key).length;
    const pill = el_('a', 'month-pill');
    pill.href = '#entregas/' + key;
    pill.textContent = monthKeyLabel_(key);
    pill.appendChild(el_('span', 'month-pill-count', String(count)));
    if (key === monthKey) pill.setAttribute('aria-current', 'page');
    monthsNav.appendChild(pill);
  });

  // Agrupa por frente (ordem do épico) e, dentro dela, pela data de entrega.
  const monthDeliveries = deliveries
    .filter((d) => d.monthKey === monthKey)
    .sort((a, b) => (a.epicKey || '~').localeCompare(b.epicKey || '~', undefined, { numeric: true }) || a.date - b.date);

  const storyCount = monthDeliveries.filter((d) => !d.subtask).length;
  const subtaskCount = monthDeliveries.length - storyCount;
  const frontCount = monthDeliveries.length ? new Set(monthDeliveries.map((d) => d.epicKey || '-')).size : 0;

  const parts = monthKey.split('-');
  const isCurrentMonth = monthKey === monthKeyOf_(new Date());
  const lastDay = isCurrentMonth ? new Date() : new Date(+parts[0], +parts[1], 0);
  const periodText = '01/' + parts[1] + ' a ' + formatDateWeb_(lastDay) + '/' + parts[0];

  board.innerHTML = '';
  const frame = el_('div', 'delivery-frame');

  // Cabeçalho
  const hero = el_('div', 'delivery-hero');
  const heroText = el_('div', 'delivery-hero-text');
  heroText.appendChild(el_('span', 'delivery-eyebrow', 'Controle SHM · Cadência com a diretoria'));
  const title = el_('h2', 'delivery-title', 'Entregas de ');
  title.appendChild(el_('em', null, monthKeyLabel_(monthKey)));
  heroText.appendChild(title);
  heroText.appendChild(el_('p', 'delivery-sub', (isCurrentMonth ? 'Parcial do mês, ' : 'Fechamento do mês, ') + periodText + '. Itens concluídos no Jira (projeto SHMB).'));
  hero.appendChild(heroText);

  const kpis = el_('div', 'delivery-kpis');
  [[monthDeliveries.length, 'Entregas'], [storyCount, 'Histórias'], [subtaskCount, 'Subtarefas'], [frontCount, 'Frentes']].forEach((kpi) => {
    const tile = el_('div', 'delivery-kpi' + (kpi[1] === 'Entregas' ? ' is-main' : ''));
    tile.appendChild(el_('span', 'delivery-kpi-value', String(kpi[0])));
    tile.appendChild(el_('span', 'delivery-kpi-label', kpi[1]));
    kpis.appendChild(tile);
  });
  hero.appendChild(kpis);
  frame.appendChild(hero);

  if (monthDeliveries.length === 0) {
    const empty = el_('div', 'delivery-empty');
    empty.appendChild(el_('span', 'delivery-empty-icon', '🗓️'));
    empty.appendChild(el_('span', null, isCurrentMonth ? 'Nenhuma entrega concluída neste mês até agora.' : 'Nenhuma entrega concluída neste mês.'));
    frame.appendChild(empty);
  } else {
    const heads = el_('div', 'delivery-grid delivery-colheads');
    ['Frente (Épico)', 'Item', 'Subtarefa'].forEach((label) => heads.appendChild(el_('span', null, label)));
    frame.appendChild(heads);

    // Épico e história aparecem uma vez só: o card ocupa a altura de todas as
    // linhas filhas (como célula mesclada), e a página cresce na vertical.
    const rows = el_('div', 'delivery-rows');
    groupDeliveries_(monthDeliveries).forEach((group) => {
      const grid = el_('div', 'delivery-grid delivery-group');
      grid.style.setProperty('--epic-color', epicColors[group.epicKey] || '#97a0af');
      const totalRows = group.stories.reduce((sum, s) => sum + Math.max(1, s.subtasks.length), 0);
      const groupDeliveryCount = group.stories.reduce((sum, s) => sum + s.subtasks.length + (s.date ? 1 : 0), 0);
      grid.appendChild(placeCell_(buildEpicCard_(group.epicKey, epics[group.epicKey], groupDeliveryCount, totalRows > 1), 1, 1, totalRows));

      let row = 1;
      group.stories.forEach((s) => {
        const span = Math.max(1, s.subtasks.length);
        const storyCard = buildIssueCard_(s.story, 'História', !!s.date, s.date, s.subtasks.length > 0, s.subtasks.length);
        grid.appendChild(placeCell_(storyCard, 2, row, span));
        if (s.subtasks.length === 0) {
          grid.appendChild(placeCell_(el_('div', 'dcard-empty'), 3, row, 1));
        }
        s.subtasks.forEach((st, i) => {
          grid.appendChild(placeCell_(buildIssueCard_(st.subtask, 'Subtarefa', true, st.date, false), 3, row + i, 1));
        });
        row += span;
      });
      rows.appendChild(grid);
    });
    frame.appendChild(rows);
  }

  // Dois pódios: um só de histórias (itens de trabalho), outro só de subtarefas.
  if (monthDeliveries.length > 0) {
    frame.appendChild(buildPodium_(monthDeliveries.filter((d) => !d.subtask),
      'Quantidade de entregas do mês - Histórias (itens de trabalho)', 'Nenhuma história concluída neste mês.'));
    frame.appendChild(buildPodium_(monthDeliveries.filter((d) => d.subtask),
      'Quantidade de entregas do mês - Subtarefas', 'Nenhuma subtarefa concluída neste mês.'));
  }

  const foot = el_('div', 'delivery-foot');
  const syncText = lastSyncAt_
    ? 'atualizado em ' + lastSyncAt_.toLocaleDateString('pt-BR') + ' às ' + lastSyncAt_.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '';
  foot.appendChild(el_('span', null, 'Fonte: Jira, projeto SHMB' + (syncText ? ', ' + syncText : '')));
  foot.appendChild(el_('span', 'delivery-foot-brand', 'CF5 · SHM'));
  frame.appendChild(foot);

  board.appendChild(frame);
}

// Links por mês: abrir #entregas ou #entregas/AAAA-MM leva direto para a aba.
function syncDeliveriesFromHash_() {
  const fromHash = deliveriesMonthFromHash_();
  if (fromHash === null) return;
  deliveriesMonthKey_ = fromHash || null;
  activateSection_('entregas');
  if (cachedIssues_) renderDeliveries_(cachedIssues_);
}
window.addEventListener('hashchange', syncDeliveriesFromHash_);
syncDeliveriesFromHash_();

// Modo apresentação: esconde menu, botões e rodapé para o print sair limpo.
function setPresenting_(on) {
  document.body.classList.toggle('is-presenting', on);
  const exitBtn = document.getElementById('presentExitBtn');
  if (exitBtn) exitBtn.hidden = !on;
}
const deliveriesPresentBtn = document.getElementById('deliveriesPresentBtn');
if (deliveriesPresentBtn) deliveriesPresentBtn.addEventListener('click', () => setPresenting_(true));
const presentExitBtn = document.getElementById('presentExitBtn');
if (presentExitBtn) presentExitBtn.addEventListener('click', () => setPresenting_(false));
document.addEventListener('keydown', (evt) => {
  if (evt.key === 'Escape' && document.body.classList.contains('is-presenting')) setPresenting_(false);
});
