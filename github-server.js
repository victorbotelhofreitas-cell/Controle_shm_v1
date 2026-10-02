/**
 * Backend do painel público "Controle SHM" — busca issues do projeto Jira
 * SHMB direto via API REST v3 do Jira (Basic Auth com e-mail + API token,
 * nunca hardcoded, sempre via variável de ambiente) e serve a página
 * estática (github-index.html / github-style.css / github-app.js).
 *
 * NUNCA testado contra o Jira real (sem credenciais disponíveis em sessão de
 * desenvolvimento) — ver comentários "VALIDAR AO VIVO" abaixo para os pontos
 * que podem precisar de ajuste na primeira execução com credenciais reais.
 */

const path = require('path');
const express = require('express');

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
// Página Notion "Controle SHM / Acessos" (tabela nativa, não database) — ver
// github-README.md para como gerar e compartilhar o NOTION_TOKEN com ela.
const NOTION_ACCESS_PAGE_ID = '3e9a28e673618090b07dffaec0729641';

const JIRA_SITE = 'https://cf5empresa.atlassian.net';
const PROJECT_KEY = 'SHMB';
const JQL = `project = ${PROJECT_KEY} ORDER BY parent ASC, created ASC`;

// IDs de campo customizado já confirmados (reaproveitados do Artifact original).
const CONFIRMED_CUSTOM_FIELD_IDS = {
  'Risco Impacto': 'customfield_10048',
  'Plano de Ação': 'customfield_10082',
  'Issue color': 'customfield_10017'
};

// Nomes possíveis para os 2 campos que precisam ser descobertos em tempo de
// execução via /rest/api/3/field (não há como saber o ID sem consultar o
// Jira real — VALIDAR AO VIVO assim que houver credenciais).
const START_DATE_FIELD_NAMES = ['Start date'];
const FLAGGED_FIELD_NAMES = ['Flagged', 'Sinalizado', 'Sinalizador', 'Sinalizadores'];

const BASE_FIELDS = [
  'summary', 'status', 'assignee', 'created', 'issuetype', 'parent',
  'subtasks', 'priority'
];

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Notion (abas Utilidades/Acesso — login + lista somente leitura). Usa um
// token de integração NOVO guardado em NOTION_TOKEN (diferente do Jira),
// mesmo padrão de chamada do relatorio-horas.gs (Bearer + Notion-Version),
// mas via fetch nativo em vez de UrlFetchApp. NUNCA testado contra o Notion
// real nesta sessão — VALIDAR AO VIVO assim que NOTION_TOKEN for configurado
// no Render: confirme que a tabela é encontrada de primeira e que a ordem
// das colunas bate com o esperado (Usuário | Tipo de Acesso | Senha | ...).
// ---------------------------------------------------------------------------
async function notionFetch_(urlPath, options) {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    const err = new Error('NOTION_TOKEN não configurado nas variáveis de ambiente do servidor.');
    err.code = 'NOTION_TOKEN_MISSING';
    throw err;
  }
  const res = await fetch(`${NOTION_API_BASE}${urlPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options && options.headers)
    }
  });
  const bodyText = await res.text().catch(() => '');
  let body = {};
  try { body = bodyText ? JSON.parse(bodyText) : {}; } catch (e) { /* ignora corpo não-JSON */ }
  if (!res.ok) {
    const err = new Error(`Notion API (${res.status}): ${body.message || bodyText.slice(0, 300) || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// Extrai o texto puro de uma célula de tabela nativa do Notion (array de
// rich_text objects), ignorando formatação — igual cellPlainText_ do
// relatorio-horas.gs. Também desfaz o auto-link que o Notion aplica a
// e-mails soltos ("[texto](url)" -> "texto"), igual stripMarkdownLink_ do
// controle-shm-painel.html original.
function cellPlainText_(richTextArray) {
  const text = (richTextArray || [])
    .map((rt) => rt.plain_text || (rt.text && rt.text.content) || '')
    .join('')
    .trim();
  const linkMatch = /^\[([^\]]+)\]\([^)]*\)$/.exec(text);
  return linkMatch ? linkMatch[1] : text;
}

// Busca recursivamente (largura primeiro) o primeiro bloco tipo "table"
// dentro de um bloco/página — reaproveita a lógica de collectWeeklyTables_ do
// relatorio-horas.gs, simplificada para parar na primeira tabela encontrada
// (a página de Acessos deve ter só uma tabela com a lista de usuários).
async function findFirstTable_(blockId) {
  let cursor = null;
  const containers = [];
  do {
    const path = `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const data = await notionFetch_(path, { method: 'GET' });
    const results = data.results || [];
    for (const block of results) {
      if (block.type === 'table') return block;
      if (block.has_children) containers.push(block.id);
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  for (const containerId of containers) {
    const found = await findFirstTable_(containerId);
    if (found) return found;
  }
  return null;
}

async function fetchTableRows_(tableBlockId) {
  const rows = [];
  let cursor = null;
  do {
    const path = `/blocks/${tableBlockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const data = await notionFetch_(path, { method: 'GET' });
    (data.results || []).forEach((block) => {
      if (block.type === 'table_row') rows.push(block.table_row.cells);
    });
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return rows;
}

function normalizeEmail_(email) {
  return (email || '').trim().toLowerCase();
}

// Colunas confirmadas no original (accessTableMarkdown_ do
// controle-shm-painel.html): Usuário (e-mail) | Tipo de Acesso | Senha |
// Visualiza | Quantidade de acessos totais. Só as 3 primeiras interessam aqui.
async function fetchAccessListFromNotion_() {
  const table = await findFirstTable_(NOTION_ACCESS_PAGE_ID);
  if (!table) throw new Error('Tabela de acessos não encontrada na página Notion (VALIDAR AO VIVO — pode precisar ajustar a busca recursiva).');
  const rows = await fetchTableRows_(table.id);
  const hasHeader = table.table && table.table.has_column_header;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows
    .map((cells) => {
      const email = normalizeEmail_(cellPlainText_(cells[0]));
      const tipoRaw = cellPlainText_(cells[1] || []).toLowerCase();
      const role = tipoRaw.indexOf('admin') !== -1 ? 'administrador' : 'comum';
      const password = cellPlainText_(cells[2] || []);
      return { email, role, password };
    })
    .filter((entry) => entry.email);
}

// Cache em memória de ~60s, mesmo padrão do cache de issues.
let accessListCache = null;
const ACCESS_CACHE_TTL_MS = 60 * 1000;

async function getAccessList_(forceRefresh) {
  if (!forceRefresh && accessListCache && Date.now() - accessListCache.fetchedAt < ACCESS_CACHE_TTL_MS) {
    return accessListCache.list;
  }
  const list = await fetchAccessListFromNotion_();
  accessListCache = { list, fetchedAt: Date.now() };
  return list;
}

// ---------------------------------------------------------------------------
// Autenticação Jira (Basic Auth com e-mail + API token via env vars)
// ---------------------------------------------------------------------------
function jiraAuthHeader_() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    throw new Error('JIRA_EMAIL/JIRA_API_TOKEN não configurados nas variáveis de ambiente.');
  }
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
}

async function jiraFetch_(urlPath, options) {
  const url = urlPath.startsWith('http') ? urlPath : `${JIRA_SITE}${urlPath}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: jiraAuthHeader_(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options && options.headers)
    }
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    const err = new Error(`Jira respondeu ${res.status} ${res.statusText} em ${urlPath}`);
    err.status = res.status;
    err.bodyText = bodyText.slice(0, 500);
    throw err;
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Mapa de campos (id -> nome amigável), cacheado por ~30 minutos — a lista de
// campos de um site Jira muda raramente, não precisa buscar a cada request.
// ---------------------------------------------------------------------------
let fieldMapCache = null; // { idToName: {...}, startDateFieldId, flaggedFieldId, fetchedAt }
const FIELD_MAP_TTL_MS = 30 * 60 * 1000;

async function getFieldMap_() {
  if (fieldMapCache && Date.now() - fieldMapCache.fetchedAt < FIELD_MAP_TTL_MS) {
    return fieldMapCache;
  }
  const fields = await jiraFetch_('/rest/api/3/field');
  const idToName = {};
  fields.forEach((f) => { idToName[f.id] = f.name; });

  const findIdByNames = (names) => {
    const found = fields.find((f) => names.some((n) => (f.name || '').trim().toLowerCase() === n.trim().toLowerCase()));
    return found ? found.id : null;
  };
  const startDateFieldId = findIdByNames(START_DATE_FIELD_NAMES);
  const flaggedFieldId = findIdByNames(FLAGGED_FIELD_NAMES);

  fieldMapCache = { idToName, startDateFieldId, flaggedFieldId, fetchedAt: Date.now() };
  return fieldMapCache;
}

// ---------------------------------------------------------------------------
// Busca de issues com paginação. Jira Cloud (endpoint novo /search/jql) usa
// nextPageToken em vez de startAt/total — VALIDAR AO VIVO.
// ---------------------------------------------------------------------------
async function fetchAllIssues_(fields) {
  const issues = [];
  let nextPageToken = null;
  let guard = 0;
  do {
    guard++;
    if (guard > 200) throw new Error('Paginação do Jira não terminou após 200 páginas — possível loop, abortando.');
    const body = {
      jql: JQL,
      fields,
      maxResults: 100
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const payload = await jiraFetch_('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    const pageIssues = payload.issues || [];
    issues.push(...pageIssues);

    nextPageToken = payload.nextPageToken || null;
    if (payload.isLast === true) nextPageToken = null;
    if (pageIssues.length === 0) nextPageToken = null;
  } while (nextPageToken);

  return issues;
}

// ---------------------------------------------------------------------------
// Monta issue.fields.customFields = { 'Nome do Campo': { value: ... }, ... }
// ---------------------------------------------------------------------------
function attachCustomFields_(issue, idToName) {
  const customFields = {};
  Object.keys(issue.fields || {}).forEach((key) => {
    if (!key.startsWith('customfield_')) return;
    const friendlyName = idToName[key];
    if (!friendlyName) return;
    customFields[friendlyName] = { value: issue.fields[key] };
  });
  issue.fields.customFields = customFields;
  return issue;
}

// ---------------------------------------------------------------------------
// Cache em memória de ~60s para /api/issues.
// ---------------------------------------------------------------------------
let issuesCache = null;
const ISSUES_CACHE_TTL_MS = 60 * 1000;

async function getIssuesPayload_(forceRefresh) {
  if (!forceRefresh && issuesCache && Date.now() - issuesCache.fetchedAt < ISSUES_CACHE_TTL_MS) {
    return issuesCache.payload;
  }

  const fieldMap = await getFieldMap_();
  const extraFieldIds = [fieldMap.startDateFieldId, fieldMap.flaggedFieldId].filter(Boolean);
  const fields = [
    ...BASE_FIELDS,
    ...Object.values(CONFIRMED_CUSTOM_FIELD_IDS),
    ...extraFieldIds
  ];
  const uniqueFields = Array.from(new Set(fields));

  const rawIssues = await fetchAllIssues_(uniqueFields);
  const issues = rawIssues.map((issue) => attachCustomFields_(issue, fieldMap.idToName));

  const payload = { issues };
  issuesCache = { payload, fetchedAt: Date.now() };
  return payload;
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------
app.get('/api/issues', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1';
    const payload = await getIssuesPayload_(forceRefresh);
    res.json(payload);
  } catch (err) {
    console.error('[api/issues] erro ao buscar issues do Jira:', err.message);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    let friendlyMessage = 'Não foi possível buscar os dados do Jira.';
    if (status === 401) friendlyMessage = 'Credenciais do Jira inválidas ou expiradas (401).';
    else if (status === 403) friendlyMessage = 'Acesso negado pelo Jira (403) — confira as permissões do usuário do token.';
    else if (status === 429) friendlyMessage = 'Jira limitou as requisições (429) — tente novamente em instantes.';
    else if (status >= 500) friendlyMessage = 'Jira indisponível no momento (erro 5xx).';
    res.status(status).json({ error: friendlyMessage, detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// Acesso (abas Utilidades/Acesso): login por e-mail+senha contra a tabela
// Notion, e lista somente-leitura (sem senha) dos usuários cadastrados.
// ---------------------------------------------------------------------------
function friendlyNotionError_(err) {
  if (err && err.code === 'NOTION_TOKEN_MISSING') {
    return { status: 500, body: { error: 'NOTION_TOKEN não configurado nas variáveis de ambiente do servidor.' } };
  }
  const status = err && err.status;
  let message = 'Não foi possível consultar a lista de acesso no Notion.';
  if (status === 404 || status === 403) {
    message = 'Notion recusou o acesso à página de Acessos (404/403) — confira se a integração foi compartilhada com a página "Controle SHM / Acessos".';
  } else if (status === 401) {
    message = 'NOTION_TOKEN inválido ou expirado (401).';
  }
  return { status: 502, body: { error: message, detail: err && err.message } };
}

app.post('/api/access/login', async (req, res) => {
  try {
    const { email, password } = (req.body || {});
    if (!email || !password) {
      return res.status(401).json({ ok: false, error: 'E-mail ou senha incorretos.' });
    }
    const list = await getAccessList_();
    const norm = normalizeEmail_(email);
    const entry = list.find((e) => e.email === norm);
    // Mensagem genérica de propósito nos dois casos (e-mail não encontrado OU
    // senha errada) — nunca revelar qual dos dois foi o motivo.
    if (entry && entry.password && entry.password === password) {
      res.json({ ok: true, role: entry.role });
    } else {
      res.status(401).json({ ok: false, error: 'E-mail ou senha incorretos.' });
    }
  } catch (err) {
    console.error('[api/access/login] erro:', err.message);
    const friendly = friendlyNotionError_(err);
    res.status(friendly.status).json(Object.assign({ ok: false }, friendly.body));
  }
});

app.get('/api/access/list', async (req, res) => {
  try {
    const list = await getAccessList_();
    // NUNCA inclua a senha nesta resposta.
    res.json({ users: list.map((e) => ({ email: e.email, role: e.role })) });
  } catch (err) {
    console.error('[api/access/list] erro:', err.message);
    const friendly = friendlyNotionError_(err);
    res.status(friendly.status).json(friendly.body);
  }
});

// SEM subpasta public/ desta vez — serve só os arquivos estáticos
// explicitamente (NÃO use express.static(__dirname), isso exporia
// github-server.js e qualquer outro arquivo do repo pra qualquer visitante).
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'github-index.html')));
app.get('/github-style.css', (req, res) => res.sendFile(path.join(__dirname, 'github-style.css')));
app.get('/github-app.js', (req, res) => res.sendFile(path.join(__dirname, 'github-app.js')));
app.get('/github-protected.js', (req, res) => res.sendFile(path.join(__dirname, 'github-protected.js')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Controle SHM (painel público) escutando na porta ${PORT}`);
});
