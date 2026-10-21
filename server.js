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
const { google } = require('googleapis');

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
// Página Notion "Controle SHM / Acessos" (tabela nativa, não database) — ver
// github-README.md para como gerar e compartilhar o NOTION_TOKEN com ela.
const NOTION_ACCESS_PAGE_ID = '3e9a28e673618090b07dffaec0729641';
// Página Notion "Controle SHM / Registro de Snaps" — toda subpágina criada
// pelo botão "Export Snap Notion" vai dentro dela (histórico, nunca sobrescrita).
const NOTION_SNAPS_PARENT_PAGE_ID = '3e8a28e673618086adc6e3b13dae1240';
// Página Notion "BotDesign (Gravações)" — lista de vídeos tl;dv, atualizada
// pelo botão "Sincronizar Gravações BotDesign".
const NOTION_GRAVACOES_PAGE_ID = '3e4a28e6736180d8b945da0582398774';

const JIRA_SITE = 'https://cf5empresa.atlassian.net';
const PROJECT_KEY = 'SHMB';
const JQL = `project = ${PROJECT_KEY} ORDER BY parent ASC, created ASC`;

// IDs de campo customizado já confirmados (reaproveitados do Artifact original).
const CONFIRMED_CUSTOM_FIELD_IDS = {
  'Risco Impacto': 'customfield_10048',
  'Plano de Ação': 'customfield_10082',
  'Issue color': 'customfield_10017',
  // Data de entrega usada pela aba Entregas (campo só de data, AAAA-MM-DD).
  'Done Date': 'customfield_10083'
};

// Nomes possíveis para os 2 campos que precisam ser descobertos em tempo de
// execução via /rest/api/3/field (não há como saber o ID sem consultar o
// Jira real — VALIDAR AO VIVO assim que houver credenciais).
const START_DATE_FIELD_NAMES = ['Start date'];
const FLAGGED_FIELD_NAMES = ['Flagged', 'Sinalizado', 'Sinalizador', 'Sinalizadores'];

// statuscategorychangedate: data em que o item entrou na categoria Done. É a
// data de entrega usada pela aba Entregas e pelo filtro de 60 dias das
// Métricas (o workflow do SHMB não preenche resolutiondate, confirmado no Jira).
const BASE_FIELDS = [
  'summary', 'status', 'assignee', 'created', 'issuetype', 'parent',
  'subtasks', 'priority', 'statuscategorychangedate'
];

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Login com Google: só entra quem tem o e-mail cadastrado na tabela Notion
// "Controle SHM / Acessos" (a mesma da aba Acesso). A sessão fica num cookie
// assinado (HMAC), e toda rota /api confere de novo se o e-mail continua na
// lista, então remover alguém da tabela corta o acesso em até ~1 minuto
// (cache da lista). A página em public/ é servida pela CDN da Vercel sem
// passar por aqui; quem protege os dados são as rotas /api, e a página só
// mostra a tela de entrada quando /api/me responde sem sessão.
// ---------------------------------------------------------------------------
const crypto = require('crypto');

const SESSION_COOKIE = 'shm_session';
const LOGIN_STATE_COOKIE = 'shm_login_state';
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 dias
const LOGIN_SCOPES = ['openid', 'email', 'profile'];

// SESSION_SECRET (variável de ambiente) assina o cookie. Sem ela, deriva uma
// chave do GOOGLE_CLIENT_SECRET, que já existe na Vercel.
function sessionSecret_() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.GOOGLE_CLIENT_SECRET) {
    return crypto.createHash('sha256').update('shm-session:' + process.env.GOOGLE_CLIENT_SECRET).digest('hex');
  }
  throw new Error('SESSION_SECRET (ou GOOGLE_CLIENT_SECRET) não configurado nas variáveis de ambiente do servidor.');
}

function signValue_(value) {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret_()).update(body).digest('base64url');
  return body + '.' + sig;
}

function readSignedValue_(token) {
  if (!token || token.indexOf('.') === -1) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', sessionSecret_()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!value || !value.exp || value.exp < Date.now()) return null;
    return value;
  } catch (e) {
    return null;
  }
}

function readCookies_(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isHttps_(req) {
  return (req.headers['x-forwarded-proto'] || req.protocol) === 'https';
}

function setCookie_(req, res, name, value, maxAgeS) {
  const parts = [name + '=' + encodeURIComponent(value), 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + maxAgeS];
  if (isHttps_(req)) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', (prev ? [].concat(prev) : []).concat(parts.join('; ')));
}

function publicBaseUrl_(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  return proto + '://' + req.headers.host;
}

function loginOAuthClient_(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados nas variáveis de ambiente do servidor.');
  }
  return new google.auth.OAuth2(clientId, clientSecret, publicBaseUrl_(req) + '/auth/login/callback');
}

// Devolve { email, name, role } se o cookie é válido e o e-mail continua
// cadastrado; null se não há sessão; { denied: email } se o e-mail saiu da lista.
async function currentUser_(req) {
  const session = readSignedValue_(readCookies_(req)[SESSION_COOKIE]);
  if (!session || !session.email) return null;
  const list = await getAccessList_();
  const entry = list.find((e) => e.email === session.email);
  if (!entry) return { denied: session.email };
  return { email: entry.email, name: session.name || entry.name || '', role: entry.role };
}

app.get('/auth/login', (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    setCookie_(req, res, LOGIN_STATE_COOKIE, state, 10 * 60);
    const url = loginOAuthClient_(req).generateAuthUrl({
      scope: LOGIN_SCOPES,
      prompt: 'select_account',
      state
    });
    res.redirect(url);
  } catch (err) {
    res.status(500).send('<pre>' + err.message + '</pre>');
  }
});

app.get('/auth/login/callback', async (req, res) => {
  try {
    const expectedState = readCookies_(req)[LOGIN_STATE_COOKIE];
    setCookie_(req, res, LOGIN_STATE_COOKIE, '', 0);
    if (req.query.error) return res.redirect('/?login=cancelado');
    if (!req.query.code || !req.query.state || req.query.state !== expectedState) {
      return res.redirect('/?login=erro');
    }
    const client = loginOAuthClient_(req);
    const { tokens } = await client.getToken(String(req.query.code));
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const profile = ticket.getPayload() || {};
    const email = normalizeEmail_(profile.email);
    if (!email || profile.email_verified === false) return res.redirect('/?login=erro');

    const list = await getAccessList_(true);
    if (!list.some((e) => e.email === email)) {
      return res.redirect('/?login=negado&email=' + encodeURIComponent(email));
    }
    const session = { email, name: profile.name || '', exp: Date.now() + SESSION_MAX_AGE_S * 1000 };
    setCookie_(req, res, SESSION_COOKIE, signValue_(session), SESSION_MAX_AGE_S);
    res.redirect('/');
  } catch (err) {
    console.error('[auth/login/callback] erro:', err.message);
    res.redirect('/?login=erro');
  }
});

app.get('/auth/logout', (req, res) => {
  setCookie_(req, res, SESSION_COOKIE, '', 0);
  res.redirect('/');
});

app.get('/api/me', async (req, res) => {
  try {
    const user = await currentUser_(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Faça login para continuar.' });
    if (user.denied) {
      setCookie_(req, res, SESSION_COOKIE, '', 0);
      return res.status(403).json({ ok: false, email: user.denied, error: 'Este e-mail não tem mais acesso ao painel.' });
    }
    res.json({ ok: true, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    console.error('[api/me] erro:', err.message);
    res.status(502).json({ ok: false, error: 'Não foi possível conferir o acesso agora. Tente de novo em instantes.' });
  }
});

// Toda rota /api (e a autorização do Gmail) exige sessão de alguém cadastrado.
async function requireSession_(req, res, next) {
  try {
    const user = await currentUser_(req);
    if (!user || user.denied) return res.status(401).json({ ok: false, error: 'Faça login para continuar.', loginRequired: true });
    req.user = user;
    next();
  } catch (err) {
    console.error('[requireSession_] erro:', err.message);
    res.status(502).json({ ok: false, error: 'Não foi possível conferir o acesso agora. Tente de novo em instantes.' });
  }
}
app.use('/api', requireSession_);
app.use('/auth/gmail', requireSession_, (req, res, next) => {
  if (req.user.role !== 'administrador') return res.status(403).send('<pre>Só administradores podem autorizar o Gmail.</pre>');
  next();
});

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

// Variante de fetchTableRows_ que também devolve o id de cada bloco
// table_row — necessário para dar PATCH (atualizar/arquivar) numa linha
// específica. fetchTableRows_ reaproveita esta função internamente, sem
// duplicar a paginação.
async function fetchTableRowBlocks_(tableBlockId) {
  const rowBlocks = [];
  let cursor = null;
  do {
    const path = `/blocks/${tableBlockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const data = await notionFetch_(path, { method: 'GET' });
    (data.results || []).forEach((block) => {
      if (block.type === 'table_row') rowBlocks.push({ id: block.id, cells: block.table_row.cells });
    });
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return rowBlocks;
}

async function fetchTableRows_(tableBlockId) {
  const rowBlocks = await fetchTableRowBlocks_(tableBlockId);
  return rowBlocks.map((rb) => rb.cells);
}

function normalizeEmail_(email) {
  return (email || '').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Export Snap Notion — monta o markdown do board (mesma lógica de
// buildNotionReportMarkdown_ do controle-shm-painel.html / github-app.js,
// portada para rodar no Node em vez do browser) e converte para blocos da
// API REST do Notion (sem backticks neste bloco de texto — já conferido).
// ---------------------------------------------------------------------------
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

function isDoneStatusWeb_(f) {
  if (f.status && f.status.statusCategory && f.status.statusCategory.key === 'done') return true;
  const name = (f.status && f.status.name || '').trim().toUpperCase();
  return name === 'DONE' || name === 'CONCLUÍDO' || name === 'CONCLUIDO';
}

function doneReferenceDateIso_(f) {
  return isDoneStatusWeb_(f) ? f.statuscategorychangedate : null;
}

function customLeadTimeDays_(createdIso, referenceIso) {
  return daysSince_(createdIso, referenceIso);
}

function leadTimeDays_(startDateIso, referenceIso) {
  return daysSince_(startDateIso, referenceIso);
}

const FLAGGED_FIELD_NAMES_MD = ['Flagged', 'Sinalizado', 'Sinalizador', 'Sinalizadores'];

function isFlagged_(customFields) {
  if (!customFields) return false;
  return FLAGGED_FIELD_NAMES_MD.some((name) => {
    const field = customFields[name];
    const value = field && field.value;
    if (!value) return false;
    return Array.isArray(value) ? value.length > 0 : true;
  });
}

const CANONICAL_STATUS_LABELS_MD = ['Backlog', 'Aprovado Comprometido', 'Fazendo', 'Teste Validação', 'Done'];

function buildStatusBuckets_(byStatus) {
  const usedKeys = new Set();
  const buckets = CANONICAL_STATUS_LABELS_MD.map((label) => {
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

const JIRA_COLOR_NAME_TO_HEX_MD = {
  yellow: '#ffc400', dark_yellow: '#a37200', orange: '#ff8f00', dark_orange: '#a35a00',
  red: '#de350b', dark_red: '#bf2600', magenta: '#e774bb', pink: '#e774bb',
  dark_magenta: '#943d73', dark_pink: '#943d73', purple: '#6554c0', dark_purple: '#403294',
  blue: '#0052cc', dark_blue: '#253858', teal: '#00b8d9', dark_teal: '#008da6',
  green: '#36b37e', dark_green: '#006644', light_green: '#79f2c0', lime: '#79f2c0',
  dark_lime: '#0e6245', brown: '#816a5b', gray: '#97a0af', grey: '#97a0af',
  dark_gray: '#5e6c84', dark_grey: '#5e6c84', 'blue-gray': '#8993a4', blue_gray: '#8993a4'
};

function jiraEpicColorName_(f) {
  const field = f.customFields && f.customFields['Issue color'];
  return (field && field.value) || null;
}

function JIRA_LINK_(key) {
  return 'https://cf5empresa.atlassian.net/browse/' + key;
}

function formatDateWeb_(isoDate) {
  const d = new Date(isoDate);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return dd + '/' + mm;
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

function jiraCustomFieldText_(field) {
  if (!field) return '';
  const value = field.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.content) return adfToTextWeb_(value);
  return String(value);
}

// Monta o markdown do board agrupado por status/época — mesma lógica (e
// mesmos rótulos) de buildNotionReportMarkdown_ no controle-shm-painel.html.
function buildNotionReportMarkdown_(issues) {
  const epics = {};
  const stories = [];
  issues.forEach((issue) => {
    const f = issue.fields;
    if (f.issuetype.name === 'Epic') {
      epics[issue.key] = { key: issue.key, summary: f.summary, colorName: jiraEpicColorName_(f), assignee: f.assignee ? f.assignee.displayName : null };
    } else {
      stories.push(issue);
    }
  });

  const byStatus = {};
  stories.forEach((issue) => {
    const statusName = issue.fields.status.name;
    if (!byStatus[statusName]) byStatus[statusName] = [];
    byStatus[statusName].push(issue);
  });

  const buckets = buildStatusBuckets_(byStatus);

  let md = '';
  md += '> **CLT (Custom Lead Time):** Created (Data Surg) -> hoje, ou -> data de entrada em Done se ja concluido. ' +
    'Mede ha quanto tempo o item existe desde que foi registrado - a "idade" do item no fluxo como um todo.\n' +
    '> \n' +
    '> **LT (Lead Time):** Start date -> hoje, ou -> data de entrada em Done se ja concluido. ' +
    'Mede o tempo efetivo de execucao, a partir do momento em que o trabalho de fato comecou - nao inclui o tempo parado antes de iniciar.\n\n';

  buckets.forEach((bucket) => {
    md += '## ' + bucket.label + ' (' + bucket.items.length + ')\n\n';
    if (bucket.items.length === 0) {
      md += '_Nenhum item._\n\n';
      return;
    }
    bucket.items
      .slice()
      .sort((a, b) => new Date(a.fields.created) - new Date(b.fields.created))
      .forEach((issue) => {
        const f = issue.fields;
        const epic = (f.parent && epics[f.parent.key]) || { key: (f.parent && f.parent.key) || '-', summary: '' };
        const planoAcaoRaw = jiraCustomFieldText_(f.customFields && f.customFields['Plano de Ação']);
        const planoAcaoItems = planoAcaoRaw ? planoAcaoRaw.split('\n').map((s) => s.trim()).filter(Boolean) : [];
        const subtaskNames = (f.subtasks || []).map((st) => st.fields.summary);
        const planoAcao = planoAcaoItems.length > 0
          ? planoAcaoItems.join(' / ')
          : (subtaskNames.length > 0 ? subtaskNames.join(' / ') : 'Refinar para definir');
        const risco = jiraCustomFieldText_(f.customFields && f.customFields['Risco Impacto']) || '-';
        const priorityName = f.priority ? f.priority.name : '-';
        const flagged = isFlagged_(f.customFields);
        const referenceIso = doneReferenceDateIso_(f);
        const cltDays = customLeadTimeDays_(f.created, referenceIso);
        const startDateIso = jiraCustomFieldText_(f.customFields && f.customFields['Start date']);
        const ltDays = leadTimeDays_(startDateIso, referenceIso);

        md += '### [' + issue.key + '](' + JIRA_LINK_(issue.key) + ') - ' + f.summary + '\n';
        md += '- **Epico:** ' + epic.key + ' ' + epic.summary + '\n';
        md += '- **Prioridade:** ' + priorityName + (flagged ? ' - Bloqueado' : '') + '\n';
        md += '- **Responsavel:** ' + (f.assignee ? f.assignee.displayName : '-') + '\n';
        md += '- **Data Surg:** ' + formatDateWeb_(f.created) + ' (CLT: ' + (cltDays === null ? '-' : cltDays + 'd') + ', LT: ' + (ltDays === null ? '-' : ltDays + 'd') + ')\n';
        md += '- **Plano de Acao:** ' + planoAcao + '\n';
        md += '- **Risco Impacto:** ' + risco + '\n\n';
      });
  });

  return md;
}

// Parser leve de markdown inline (**negrito** e [texto](url)) para o formato
// rich_text da API do Notion.
function richTextForLine_(text) {
  const tokens = [];
  const regex = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let m;
  while ((m = regex.exec(text))) {
    if (m.index > lastIndex) tokens.push({ type: 'text', text: { content: text.slice(lastIndex, m.index) } });
    if (m[1] !== undefined) {
      tokens.push({ type: 'text', text: { content: m[1] }, annotations: { bold: true } });
    } else {
      tokens.push({ type: 'text', text: { content: m[2], link: { url: m[3] } } });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) tokens.push({ type: 'text', text: { content: text.slice(lastIndex) } });
  if (!tokens.length) tokens.push({ type: 'text', text: { content: '' } });
  // Notion limita cada rich_text.text.content a 2000 caracteres.
  return tokens.map((t) => {
    if (t.text.content.length > 2000) t.text.content = t.text.content.slice(0, 2000);
    return t;
  });
}

function mdLineToBlock_(line) {
  if (line.startsWith('## ')) {
    return { object: 'block', type: 'heading_2', heading_2: { rich_text: richTextForLine_(line.slice(3)) } };
  }
  if (line.startsWith('### ')) {
    return { object: 'block', type: 'heading_3', heading_3: { rich_text: richTextForLine_(line.slice(4)) } };
  }
  if (line.startsWith('- ')) {
    return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richTextForLine_(line.slice(2)) } };
  }
  if (line.startsWith('> ')) {
    return { object: 'block', type: 'quote', quote: { rich_text: richTextForLine_(line.slice(2)) } };
  }
  if (line === '_Nenhum item._') {
    return { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Nenhum item.' }, annotations: { italic: true } }] } };
  }
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richTextForLine_(line) } };
}

// Converte o markdown inteiro em blocos Notion, ignorando linhas em branco
// (o Notion não precisa de bloco vazio para dar espaçamento entre blocos).
function buildNotionBlocksFromMarkdown_(markdown) {
  return markdown
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map(mdLineToBlock_);
}

// Cria a subpágina de snap dentro de "Controle SHM / Registro de Snaps".
// A API do Notion aceita no máximo 100 blocos filhos por chamada — por isso
// o restante (se houver) é anexado em lotes via PATCH /blocks/{id}/children.
async function createSnapPage_(title, markdown) {
  const blocks = buildNotionBlocksFromMarkdown_(markdown);
  const firstChunk = blocks.slice(0, 100);
  const rest = blocks.slice(100);

  const page = await notionFetch_('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { page_id: NOTION_SNAPS_PARENT_PAGE_ID },
      properties: { title: { title: [{ text: { content: title } }] } },
      children: firstChunk
    })
  });

  for (let i = 0; i < rest.length; i += 100) {
    const chunk = rest.slice(i, i + 100);
    await notionFetch_(`/blocks/${page.id}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children: chunk })
    });
  }

  return page;
}

// Lê recursivamente o texto plano de todos os blocos filhos de uma página —
// usado para comparar o conteúdo atual de "BotDesign (Gravações)" contra os
// vídeos encontrados no Gmail, evitando duplicatas.
async function fetchNotionPageText_(blockId) {
  let cursor = null;
  let text = '';
  do {
    const urlPath = `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const data = await notionFetch_(urlPath, { method: 'GET' });
    const results = data.results || [];
    for (const block of results) {
      const richText = block[block.type] && block[block.type].rich_text;
      if (richText) text += richText.map((rt) => rt.plain_text || '').join('') + '\n';
      if (block.has_children) text += await fetchNotionPageText_(block.id);
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return text;
}

// Tabela "Lista de usuários do sistema" da página Notion "Controle SHM /
// Acessos": Usuário (nome) | E-mail | Tipo de Acesso (Administrador/Comum).
// As colunas são achadas pelo cabeçalho e, se ele estiver vazio, pelo
// conteúdo (a do e-mail é a que tem "@"), para a tabela continuar sendo lida
// se alguém mudar a ordem ou o nome das colunas no Notion.
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function accessTableLayout_(headerTexts, dataRows, width) {
  const layout = { width, name: -1, email: -1, role: -1 };
  headerTexts.forEach((h, i) => {
    const t = h.toLowerCase();
    if (layout.email === -1 && t.indexOf('mail') !== -1) layout.email = i;
    else if (layout.role === -1 && (t.indexOf('tipo') !== -1 || t.indexOf('acesso') !== -1 || t.indexOf('papel') !== -1)) layout.role = i;
    else if (layout.name === -1 && (t.indexOf('usu') !== -1 || t.indexOf('nome') !== -1)) layout.name = i;
  });
  if (layout.email === -1) {
    for (let i = 0; i < width && layout.email === -1; i++) {
      if (dataRows.some((cells) => EMAIL_RE.test(cellPlainText_(cells[i] || [])))) layout.email = i;
    }
  }
  // Uma coluna "Usuário" cheia de e-mails (formato antigo) é a do e-mail.
  if (layout.name === layout.email) layout.name = -1;
  return layout;
}

// Monta { name, email, role, rowBlockId } a partir de uma linha. rowBlockId é
// o id do bloco table_row, usado para remover aquela linha.
function parseAccessRow_(rowBlock, layout) {
  const texts = rowBlock.cells.map((c) => cellPlainText_(c || []));
  let emailText = layout.email !== -1 ? texts[layout.email] : '';
  if (!EMAIL_RE.test(emailText || '')) emailText = texts.find((t) => EMAIL_RE.test(t)) || '';
  const match = (emailText || '').match(EMAIL_RE);
  const email = normalizeEmail_(match ? match[0] : '');
  const roleText = layout.role !== -1 ? texts[layout.role] : texts.join(' ');
  const role = (roleText || '').toLowerCase().indexOf('admin') !== -1 ? 'administrador' : 'comum';
  const name = layout.name !== -1 ? (texts[layout.name] || '').trim() : '';
  return { name, email, role, rowBlockId: rowBlock.id };
}

// Devolve { tableId, layout, entries }. Usada pela leitura (login, lista) e
// pelas rotas de escrita (adicionar, remover).
async function fetchAccessTableRaw_() {
  const table = await findFirstTable_(NOTION_ACCESS_PAGE_ID);
  if (!table) throw new Error('Tabela de usuários não encontrada na página Notion "Controle SHM / Acessos".');
  const rowBlocks = await fetchTableRowBlocks_(table.id);
  const hasHeader = table.table && table.table.has_column_header;
  const width = (table.table && table.table.table_width) || (rowBlocks[0] ? rowBlocks[0].cells.length : 3);
  const headerTexts = hasHeader && rowBlocks[0] ? rowBlocks[0].cells.map((c) => cellPlainText_(c || [])) : [];
  const dataRowBlocks = hasHeader ? rowBlocks.slice(1) : rowBlocks;
  const layout = accessTableLayout_(headerTexts, dataRowBlocks.map((rb) => rb.cells), width);
  const entries = dataRowBlocks.map((rb) => parseAccessRow_(rb, layout)).filter((entry) => entry.email);
  return { tableId: table.id, layout, entries };
}

async function fetchAccessListFromNotion_() {
  const raw = await fetchAccessTableRaw_();
  return raw.entries;
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

function invalidateAccessListCache_() {
  accessListCache = null;
}

// Áreas só de administrador (Utilidades e Acesso): quem decide é o login com
// Google (req.user, preenchido por requireSession_), sem senha.
function requireAdmin_(req, res, next) {
  if (req.user && req.user.role === 'administrador') return next();
  res.status(403).json({ ok: false, error: 'Área restrita a administradores.' });
}

// Monta as cells (rich_text) de uma linha nova no formato da tabela:
// Usuário | E-mail | Tipo de Acesso (colunas que não existirem ficam de fora).
function buildAccessRowCells_(entry, layout) {
  const texts = new Array(layout.width).fill('');
  const emailCol = layout.email !== -1 ? layout.email : 0;
  texts[emailCol] = entry.email;
  if (layout.name !== -1) texts[layout.name] = entry.name || '';
  if (layout.role !== -1) texts[layout.role] = entry.role === 'administrador' ? 'Administrador' : 'Comum';
  return texts.map((t) => (t ? [{ type: 'text', text: { content: t } }] : []));
}

// Cria uma linha nova na tabela de usuários.
async function createAccessRow_(tableId, layout, entry) {
  await notionFetch_(`/blocks/${tableId}/children`, {
    method: 'POST',
    body: JSON.stringify({
      children: [{ object: 'block', type: 'table_row', table_row: { cells: buildAccessRowCells_(entry, layout) } }]
    })
  });
}

// Remove uma linha (archived:true é como a API do Notion apaga um bloco).
async function archiveAccessRow_(rowBlockId) {
  await notionFetch_(`/blocks/${rowBlockId}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true })
  });
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
// Acesso (aba Acesso, só administrador): lista, adicionar e remover usuários
// da tabela Notion. O login em si é feito com o Google (ver /auth/login).
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

// Lista de usuários do sistema (aba Acesso, só administrador).
app.get('/api/access/list', requireAdmin_, async (req, res) => {
  try {
    const list = await getAccessList_(true);
    res.json({ ok: true, users: list.map((e) => ({ name: e.name, email: e.email, role: e.role })) });
  } catch (err) {
    console.error('[api/access/list] erro:', err.message);
    const friendly = friendlyNotionError_(err);
    res.status(friendly.status).json(Object.assign({ ok: false }, friendly.body));
  }
});

// Adicionar usuário: cria uma linha nova na tabela "Lista de usuários do
// sistema" com o e-mail e o tipo Comum. O nome e o tipo podem ser ajustados
// direto no Notion depois.
app.post('/api/access/add', requireAdmin_, async (req, res) => {
  try {
    const email = normalizeEmail_((req.body || {}).email);
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ ok: false, error: 'Digite um e-mail válido.' });
    }
    const raw = await fetchAccessTableRaw_();
    if (raw.entries.some((e) => e.email === email)) {
      return res.status(409).json({ ok: false, error: email + ' já está cadastrado.' });
    }
    await createAccessRow_(raw.tableId, raw.layout, { email, role: 'comum' });
    invalidateAccessListCache_();
    res.json({ ok: true, email, role: 'comum' });
  } catch (err) {
    console.error('[api/access/add] erro:', err.message);
    const friendly = friendlyNotionError_(err);
    res.status(friendly.status).json(Object.assign({ ok: false }, friendly.body));
  }
});

app.post('/api/access/remove', requireAdmin_, async (req, res) => {
  try {
    const email = normalizeEmail_((req.body || {}).email);
    const raw = await fetchAccessTableRaw_();
    const existing = raw.entries.find((e) => e.email === email);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
    }
    if (existing.role === 'administrador') {
      // Administrador nunca é removido pela interface (só direto no Notion).
      return res.status(400).json({ ok: false, error: 'Administradores não podem ser removidos pela interface.' });
    }
    await archiveAccessRow_(existing.rowBlockId);
    invalidateAccessListCache_();
    res.json({ ok: true, email });
  } catch (err) {
    console.error('[api/access/remove] erro:', err.message);
    const friendly = friendlyNotionError_(err);
    res.status(friendly.status).json(Object.assign({ ok: false }, friendly.body));
  }
});

// ---------------------------------------------------------------------------
// Export Snap Notion — cria uma subpágina nova (histórico, nunca sobrescreve)
// dentro de "Controle SHM / Registro de Snaps" com uma foto do board atual.
// NUNCA testado ao vivo nesta sessão (sem NOTION_TOKEN disponível) — VALIDAR
// AO VIVO: se a página pai aceita filhos via /pages com parent.page_id (deve
// aceitar, é o comportamento padrão da API), e se o markdown->blocos cobre
// bem o conteúdo real dos issues.
// ---------------------------------------------------------------------------
app.post('/api/export-snap', requireAdmin_, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1';
    const payload = await getIssuesPayload_(forceRefresh);
    const markdown = buildNotionReportMarkdown_(payload.issues);

    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const title = `${dd}${mm}${yyyy} / Snap do Board`;
    const syncedAt = `Sincronizado em: ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR')}\n\n`;

    const page = await createSnapPage_(title, syncedAt + markdown);
    res.json({ ok: true, url: page.url, title });
  } catch (err) {
    console.error('[api/export-snap] erro:', err.message);
    if (err.code === 'NOTION_TOKEN_MISSING') {
      return res.status(500).json({ ok: false, error: err.message });
    }
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ ok: false, error: 'Não foi possível exportar o snap para o Notion: ' + err.message });
  }
});

// ---------------------------------------------------------------------------
// Gmail (fluxo de setup OAuth2, rodado manualmente uma vez pelo usuário) —
// ver github-README.md seção "Configurar Gmail (Export Gravações BotDesign)".
// NUNCA testado ao vivo (nem na versão original, que usava um conector MCP
// diferente) — VALIDAR AO VIVO: nomes de escopo, formato do refresh_token, e
// se a Gmail API devolve mesmo um refresh_token na primeira autorização
// (só devolve se access_type=offline + prompt=consent, já inclusos abaixo).
// ---------------------------------------------------------------------------
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TLDV_LINK_REGEX = /https?:\/\/(?:www\.)?tldv\.io\/\S+/i;

function gmailOAuthClient_() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    const err = new Error('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI não configurados nas variáveis de ambiente do servidor — veja github-README.md seção "Configurar Gmail (Export Gravações BotDesign)".');
    err.code = 'GOOGLE_OAUTH_MISSING';
    throw err;
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

app.get('/auth/gmail', (req, res) => {
  try {
    const oauth2Client = gmailOAuthClient_();
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GMAIL_SCOPES
    });
    res.redirect(url);
  } catch (err) {
    res.status(500).send(`<pre>${err.message}</pre>`);
  }
});

app.get('/auth/gmail/callback', async (req, res) => {
  try {
    const oauth2Client = gmailOAuthClient_();
    const code = req.query.code;
    if (!code) throw new Error('Parâmetro "code" ausente na URL de callback — a autorização pode ter sido cancelada.');
    const { tokens } = await oauth2Client.getToken(code);
    const refreshToken = tokens.refresh_token;
    if (refreshToken) {
      res.send(
        '<html><body style="font-family: monospace; padding: 24px; line-height: 1.6;">' +
        '<h2>Autorização concluída</h2>' +
        '<p>Copie este valor e salve como variável de ambiente <strong>GMAIL_REFRESH_TOKEN</strong> no Render/Vercel, depois pode fechar esta aba:</p>' +
        '<pre style="background:#eee;padding:12px;word-break:break-all;">' + refreshToken + '</pre>' +
        '</body></html>'
      );
    } else {
      res.send(
        '<html><body style="font-family: monospace; padding: 24px; line-height: 1.6;">' +
        '<h2 style="color:#b00;">Nenhum refresh_token retornado pelo Google</h2>' +
        '<p>Isso costuma acontecer quando esta conta já autorizou este app antes (o Google só entrega refresh_token na primeira autorização de cada app/conta).</p>' +
        '<p>Revogue o acesso em <a href="https://myaccount.google.com/permissions" target="_blank">myaccount.google.com/permissions</a> e acesse <a href="/auth/gmail">/auth/gmail</a> de novo.</p>' +
        '</body></html>'
      );
    }
  } catch (err) {
    res.status(500).send(`<pre>Erro ao trocar o código por tokens: ${err.message}</pre>`);
  }
});

function gmailClient_() {
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!refreshToken) {
    const err = new Error('GMAIL_REFRESH_TOKEN não configurado — veja github-README.md seção "Configurar Gmail (Export Gravações BotDesign)".');
    err.code = 'GMAIL_REFRESH_TOKEN_MISSING';
    throw err;
  }
  const oauth2Client = gmailOAuthClient_();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function decodeBase64Url_(data) {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Busca recursivamente a primeira parte text/plain do corpo de uma mensagem
// Gmail (payload.parts aninhado) — cai para o snippet se não achar nenhuma.
function extractGmailBodyText_(payload) {
  if (!payload) return '';
  if (payload.body && payload.body.data) return decodeBase64Url_(payload.body.data);
  if (Array.isArray(payload.parts)) {
    const plainPart = payload.parts.find((p) => p.mimeType === 'text/plain' && p.body && p.body.data);
    if (plainPart) return decodeBase64Url_(plainPart.body.data);
    for (const part of payload.parts) {
      const nested = extractGmailBodyText_(part);
      if (nested) return nested;
    }
  }
  return '';
}

function gmailHeaderValue_(headers, name) {
  const h = (headers || []).find((hdr) => (hdr.name || '').toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

// ---------------------------------------------------------------------------
// Sincronizar Gravações BotDesign — busca no Gmail (marcador "# SHM") os
// e-mails com link tl;dv, compara com o conteúdo atual da página Notion
// "BotDesign (Gravações)" e anexa só os vídeos ainda não listados.
// NUNCA testado ao vivo (nem na versão original) — VALIDAR AO VIVO: a query
// de busca (`"# SHM" tldv.io`, adaptada do marcador original — pode precisar
// virar `label:shm` ou outra sintaxe se "# SHM" for um label e não um termo
// de busca em texto livre), e se o corpo da mensagem realmente contém o link
// tl;dv em texto puro (ou só em HTML, o que exigiria decodificar text/html
// em vez de text/plain em extractGmailBodyText_).
// ---------------------------------------------------------------------------
app.post('/api/sync-gravacoes', requireAdmin_, async (req, res) => {
  try {
    const gmail = gmailClient_();

    const listResp = await gmail.users.messages.list({
      userId: 'me',
      q: '"# SHM" tldv.io',
      maxResults: 50
    });
    const messages = listResp.data.messages || [];
    if (!messages.length) {
      return res.json({ ok: true, added: 0, message: 'Nenhum e-mail encontrado no Gmail com o marcador "# SHM" e link tl;dv.' });
    }

    const videosEncontrados = [];
    const emailsComErro = [];
    for (const m of messages) {
      try {
        const msgResp = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
        const headers = (msgResp.data.payload && msgResp.data.payload.headers) || [];
        const subject = gmailHeaderValue_(headers, 'Subject') || '(sem assunto)';
        const dateHeader = gmailHeaderValue_(headers, 'Date');
        const bodyText = extractGmailBodyText_(msgResp.data.payload) || msgResp.data.snippet || '';
        const linkMatch = bodyText.match(TLDV_LINK_REGEX) || subject.match(TLDV_LINK_REGEX);
        if (!linkMatch) {
          emailsComErro.push(subject + ' (link tl;dv não encontrado no corpo)');
          continue;
        }
        const link = linkMatch[0];
        const emailDate = dateHeader ? new Date(dateHeader) : new Date();
        const dd = String(emailDate.getDate()).padStart(2, '0');
        const mm = String(emailDate.getMonth() + 1).padStart(2, '0');
        const yyyy = emailDate.getFullYear();
        const dataFormatada = isNaN(emailDate.getTime()) ? '00000000' : (dd + mm + yyyy);
        videosEncontrados.push({ data: dataFormatada, titulo: subject.trim(), link });
      } catch (parseErr) {
        emailsComErro.push((m.id || 'e-mail desconhecido') + ' (' + parseErr.message + ')');
      }
    }

    if (!videosEncontrados.length) {
      const msg = emailsComErro.length
        ? 'Nenhum vídeo válido extraído. Problemas encontrados: ' + emailsComErro.join('; ') + '.'
        : 'Nenhum vídeo novo encontrado — tudo já está sincronizado.';
      return res.json({ ok: true, added: 0, message: msg });
    }

    const notionTextAtual = await fetchNotionPageText_(NOTION_GRAVACOES_PAGE_ID);
    const videosNovos = videosEncontrados.filter((v) => notionTextAtual.indexOf(v.link) === -1 && notionTextAtual.indexOf(v.titulo) === -1);

    if (!videosNovos.length) {
      return res.json({ ok: true, added: 0, message: 'Nenhum vídeo novo encontrado — tudo já está sincronizado.' });
    }

    const newBlocks = [
      { object: 'block', type: 'divider', divider: {} },
      ...videosNovos.map((v) => ({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: `${v.data} / ${v.titulo} / ${v.link}` } }] }
      }))
    ];
    for (let i = 0; i < newBlocks.length; i += 100) {
      await notionFetch_(`/blocks/${NOTION_GRAVACOES_PAGE_ID}/children`, {
        method: 'PATCH',
        body: JSON.stringify({ children: newBlocks.slice(i, i + 100) })
      });
    }

    let message = `${videosNovos.length} vídeo(s) novo(s) adicionado(s) no Notion.`;
    if (emailsComErro.length) message += ' Alguns e-mails não puderam ser processados: ' + emailsComErro.join('; ') + '.';
    res.json({ ok: true, added: videosNovos.length, message, url: `https://www.notion.so/${NOTION_GRAVACOES_PAGE_ID}` });
  } catch (err) {
    console.error('[api/sync-gravacoes] erro:', err.message);
    if (err.code === 'GMAIL_REFRESH_TOKEN_MISSING' || err.code === 'GOOGLE_OAUTH_MISSING') {
      return res.status(500).json({ ok: false, error: err.message });
    }
    if (err.code === 'NOTION_TOKEN_MISSING') {
      return res.status(500).json({ ok: false, error: err.message });
    }
    res.status(502).json({ ok: false, error: 'Não foi possível sincronizar: ' + err.message });
  }
});

// Página (HTML/CSS/JS) fica em public/: na Vercel ela é servida direto pela
// CDN (express.static é ignorado lá); no Render, por este express.static.
// Só a pasta public/ é exposta — nunca o servidor nem o resto do repo.
app.use(express.static(path.join(__dirname, 'public')));

// Na Vercel (preset Express) o "/" chega aqui no servidor, não na CDN:
// entrega a página e, se o arquivo não estiver no pacote da função, manda
// para /index.html, que a CDN serve.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err && !res.headersSent) res.redirect(302, '/index.html');
  });
});

module.exports = app;

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Controle SHM (painel público) escutando na porta ${PORT}`);
});
