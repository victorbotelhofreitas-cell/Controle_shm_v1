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

// SEM subpasta public/ desta vez — serve só os 3 arquivos estáticos
// explicitamente (NÃO use express.static(__dirname), isso exporia
// github-server.js e qualquer outro arquivo do repo pra qualquer visitante).
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'github-index.html')));
app.get('/github-style.css', (req, res) => res.sendFile(path.join(__dirname, 'github-style.css')));
app.get('/github-app.js', (req, res) => res.sendFile(path.join(__dirname, 'github-app.js')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Controle SHM (painel público) escutando na porta ${PORT}`);
});
