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

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => loadIssues_(true));
}

document.addEventListener('DOMContentLoaded', () => loadIssues_(false));

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
    renderSiteBoard_(issues);
    renderMetrics_(issues);

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
  'Data Surg', 'Projeto ou Frente', 'Key', 'Nome da Atividade',
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
function renderSiteBoard_(issues) {
  const epics = {};
  const stories = [];

  issues.forEach((issue) => {
    const f = issue.fields;
    if (f.issuetype.name === 'Epic') {
      epics[issue.key] = { key: issue.key, summary: f.summary, colorName: jiraEpicColorName_(f), assignee: f.assignee ? f.assignee.displayName : null };
    } else if (isSubtaskIssue_(f)) {
      // Subtarefas não viram card próprio no board.
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

        const epicCell = document.createElement('div');
        epicCell.className = 'kanban-card-cell truncate-cell';
        epicCell.title = epic.key + ' ' + epic.summary;
        const epicLink = document.createElement('a');
        epicLink.href = JIRA_LINK_(epic.key);
        epicLink.target = '_blank';
        epicLink.rel = 'noopener';
        epicLink.textContent = epic.key + ' ' + epic.summary;
        epicCell.appendChild(epicLink);
        card.appendChild(epicCell);

        const keyCell = document.createElement('div');
        keyCell.className = 'kanban-card-cell key-cell truncate-cell';
        keyCell.title = issue.key + (isDone ? ' 🏆' : '');
        const keyLink = linkCell_(JIRA_LINK_(issue.key), issue.key + (isDone ? ' 🏆' : ''));
        keyCell.appendChild(keyLink);
        card.appendChild(keyCell);

        const summaryCell = document.createElement('div');
        summaryCell.className = 'kanban-card-cell truncate-cell';
        summaryCell.textContent = f.summary;
        summaryCell.title = f.summary;
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

        cardsGrid.appendChild(card);
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

  setStatTiles_([Object.keys(epics).length, total, doneCount]);

  renderEpicPieChart_(document.getElementById('metricsEpicPie'), stories, epics, buildEpicColorMap_(epics));

  renderEpicChildrenTable_(document.getElementById('metricsEpicChildrenTable'), stories, subtasksByParentKey, epics, buildEpicColorMap_(epics));

  renderStatusByEpicGroupedChart_(metricsStatusBars, stories, epics, buildEpicColorMap_(epics));

  const cancelledCountEl = document.getElementById('metricsCancelledCount');
  const cancelledSubtaskCount = Object.keys(subtasksByParentKeyCancelled).reduce((sum, k) => sum + subtasksByParentKeyCancelled[k].length, 0);
  if (cancelledCountEl) cancelledCountEl.textContent = (cancelledStories.length + cancelledSubtaskCount) + ' item(ns)';
  renderEpicChildrenTable_(document.getElementById('metricsCancelledTable'), cancelledStories, subtasksByParentKeyCancelled, epics, buildEpicColorMap_(epics), true);

  const byAssigneeToDo = {};
  const byAssigneeOpen = {};
  const byAssigneeDone = {};
  const issuesByAssigneeToDo = {};
  const issuesByAssigneeOpen = {};
  const issuesByAssigneeDone = {};
  stories.filter((i) => !isCancelStatusWeb_(i.fields)).forEach((i) => {
    const f = i.fields;
    const label = f.assignee ? f.assignee.displayName : '-';
    if (isDoneStatusWeb_(f)) {
      const doneDays = daysSince_(doneReferenceDateIso_(f));
      if (doneDays === null || doneDays <= 60) {
        byAssigneeDone[label] = (byAssigneeDone[label] || 0) + 1;
        (issuesByAssigneeDone[label] = issuesByAssigneeDone[label] || []).push(i);
      }
    } else if (isToDoStatusWeb_(f.status.name)) {
      byAssigneeToDo[label] = (byAssigneeToDo[label] || 0) + 1;
      (issuesByAssigneeToDo[label] = issuesByAssigneeToDo[label] || []).push(i);
    } else {
      byAssigneeOpen[label] = (byAssigneeOpen[label] || 0) + 1;
      (issuesByAssigneeOpen[label] = issuesByAssigneeOpen[label] || []).push(i);
    }
  });
  const toDoTotal = Object.values(byAssigneeToDo).reduce((sum, n) => sum + n, 0);
  const openTotal = Object.values(byAssigneeOpen).reduce((sum, n) => sum + n, 0);
  const doneTotal = Object.values(byAssigneeDone).reduce((sum, n) => sum + n, 0);
  renderBarList_(document.getElementById('metricsAssigneeToDoBars'), sortByCountDesc_(byAssigneeToDo), toDoTotal, issuesByAssigneeToDo);
  renderBarList_(document.getElementById('metricsAssigneeOpenBars'), sortByCountDesc_(byAssigneeOpen), openTotal, issuesByAssigneeOpen);
  renderBarList_(document.getElementById('metricsAssigneeDoneBars'), sortByCountDesc_(byAssigneeDone), doneTotal, issuesByAssigneeDone);

  renderFlaggedOpenItems_(document.getElementById('metricsFlaggedItems'), stories, epics);

  renderCreatedVsDoneChart_(document.getElementById('metricsCreatedVsDoneChart'), stories, epics, buildEpicColorMap_(epics));
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

function renderCreatedVsDoneChart_(container, stories, epics, epicColors) {
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
      const doneDate = new Date(doneIso);
      const dk = monthKey_(doneDate.getFullYear(), doneDate.getMonth());
      if (doneByMonthEpic.hasOwnProperty(dk)) {
        doneByMonthEpic[dk][epicKey] = (doneByMonthEpic[dk][epicKey] || 0) + 1;
        if (!doneIssuesByMonthEpic[dk][epicKey]) doneIssuesByMonthEpic[dk][epicKey] = [];
        doneIssuesByMonthEpic[dk][epicKey].push(issue);
      }
    }
  });

  const monthTotal_ = (byMonthEpic, k) => Object.values(byMonthEpic[k]).reduce((sum, n) => sum + n, 0);
  const maxCount = Math.max(1, ...months.map((mo) => {
    const k = monthKey_(mo.year, mo.month);
    return Math.max(monthTotal_(createdByMonthEpic, k), monthTotal_(doneByMonthEpic, k));
  }));

  const barWidth = 20;
  const barGap = 6;
  const groupGap = 26;
  const chartHeight = 160;
  const leftAxisWidth = 22;
  const topPadding = 8;
  const axisLabelHeight = 30;

  const barsWidth = 2 * barWidth + barGap;
  const CHAR_WIDTH_ESTIMATE = 6;
  const groupWidths = months.map((mo) => Math.max(barsWidth, mo.label.length * CHAR_WIDTH_ESTIMATE));

  const width = leftAxisWidth + groupWidths.reduce((sum, w) => sum + w, 0) + (months.length - 1) * groupGap + 12;
  const height = topPadding + chartHeight + axisLabelHeight;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', height);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Itens criados versus itens terminados ao longo dos meses, por frente');
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
  months.forEach((mo, mi) => {
    const groupWidth = groupWidths[mi];
    const groupX = groupXCursor;
    groupXCursor += groupWidth + groupGap;
    const barsStartX = groupX + (groupWidth - barsWidth) / 2;

    const k = monthKey_(mo.year, mo.month);
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
      shortLabel.setAttribute('y', topPadding + chartHeight + 12);
      shortLabel.setAttribute('text-anchor', 'middle');
      shortLabel.setAttribute('class', 'viz-axis-label');
      shortLabel.textContent = series.shortLabel;
      svg.appendChild(shortLabel);
    });

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', groupX + groupWidth / 2);
    label.setAttribute('y', topPadding + chartHeight + 26);
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
    { label: 'Terminados (T) — cor rachurada', hatched: true }
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

function renderBarList_(container, rows, total, issuesByLabel) {
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
