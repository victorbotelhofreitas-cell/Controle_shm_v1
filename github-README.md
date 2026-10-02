# Controle SHM — Painel Público (Board Jira + Métricas)

Painel somente-leitura do projeto Jira **SHMB**, com dados ao vivo via API REST do Jira, pensado para rodar como um pequeno backend Node (Express) no [Render](https://render.com) e gerar um link público (`https://*.onrender.com`) que não depende da conta Claude.

Arquivos deste repositório (todos soltos nesta mesma pasta, sem subpasta):

- `github-server.js` — backend Express: busca as issues do Jira, fala com a API do Notion (abas protegidas) e serve a página.
- `github-index.html` / `github-style.css` / `github-app.js` — frontend (Board Jira + Métricas).
- `github-protected.js` — frontend das abas protegidas por senha (Utilidades + Acesso): lock gate, cards de copiar script e lista de usuários.
- `package.json` / `.gitignore` — **sem prefixo `github-`, de propósito**: `npm` só reconhece `package.json` nesse nome exato na raiz do projeto, e `git` só lê `.gitignore` nesse nome exato — renomear qualquer um dos dois quebra a ferramenta correspondente. Todos os outros arquivos do deploy usam o prefixo `github-` só para ficarem identificáveis entre os arquivos já existentes na pasta (`.gs`, `controle-shm-painel.html`, `CLAUDE.md`, `aprendizados.md`), que não têm nada a ver com este deploy.

## 1. Rodar localmente

```bash
npm install
```

Defina as variáveis de ambiente com o e-mail e o API token do Jira (nunca hardcode essas credenciais em nenhum arquivo):

```bash
# PowerShell
$env:JIRA_EMAIL = "seu-email@exemplo.com"
$env:JIRA_API_TOKEN = "seu-token-aqui"

# bash
export JIRA_EMAIL="seu-email@exemplo.com"
export JIRA_API_TOKEN="seu-token-aqui"
```

Depois:

```bash
npm start
```

O servidor sobe em `http://localhost:3000` (ou na porta definida em `PORT`).

## 2. Subir para o GitHub

Como todos os arquivos do deploy já estão soltos na raiz desta mesma pasta (`CF5 SHM Sistema Controle SHM v1/`), não precisa mover nada — é só inicializar (ou usar) o repositório Git direto aqui:

```bash
# Se esta pasta ainda não é um repositório Git:
git init

# Adicione só os arquivos do deploy — NUNCA use "git add ." ou "git add -A"
# sem revisar antes, porque a pasta também tem outros arquivos que não têm
# nada a ver com este site (atualiza-slide.gs, relatorio-horas.gs,
# controle-shm-painel.html, CLAUDE.md, aprendizados.md). Esses arquivos
# podem ir para o repositório também, se você quiser — a decisão é sua —
# mas não é necessário para o deploy funcionar.
git add package.json .gitignore github-server.js github-index.html github-style.css github-app.js github-protected.js github-README.md

git commit -m "Painel público Controle SHM (Board Jira + Métricas)"

# Crie o repositório no GitHub (via site ou gh CLI) e então:
git remote add origin <url-do-seu-repositorio>
git push -u origin main
```

Se você já tem um repositório GitHub existente apontando para esta pasta, basta repetir o `git add` dos arquivos novos/alterados, `git commit` e `git push`.

## 3. Deploy no Render (Web Service)

**Importante: use "Web Service", não "Static Site"** — este painel depende de um backend rodando (consulta o Jira e expõe `/api/issues`), não é só HTML estático.

1. Acesse [render.com](https://render.com) → **New +** → **Web Service**.
2. Conecte o repositório GitHub criado no passo 2.
3. **Root Directory**: deixe em branco / raiz do repositório (todos os arquivos já estão soltos ali, sem subpasta).
4. **Environment**: `Node`.
5. **Build Command**: `npm install`.
6. **Start Command**: `npm start`.
7. **Instance Type**: `Free` (suficiente para este painel).
8. Na aba **Environment** do serviço, adicione as variáveis:
   - `JIRA_EMAIL` — o e-mail da conta Jira usada para autenticar.
   - `JIRA_API_TOKEN` — gerado em [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
   - `NOTION_TOKEN` — necessário para as abas **Utilidades** e **Acesso** (login + lista de usuários) e para o card **Export Snap Notion**. Ver seção "Configurar NOTION_TOKEN" abaixo.
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` / `GMAIL_REFRESH_TOKEN` — necessárias só para o card **Sincronizar Gravações BotDesign**. Ver seção "Configurar Gmail (Export Gravações BotDesign)" abaixo — **bem mais trabalhoso** que o Notion/Jira, e nunca testado ao vivo (nem na versão original do Artifact).
9. Clique em **Create Web Service** / **Deploy**. O Render builda e sobe o serviço automaticamente.
10. Ao final, o Render gera uma URL pública no formato `https://<nome-do-serviço>.onrender.com` — esse é o link para compartilhar.

## 3.1 Configurar `NOTION_TOKEN` (abas Utilidades e Acesso)

As abas **Board Jira** e **Métricas** funcionam normalmente sem essa variável. Sem `NOTION_TOKEN` configurado, só as abas **Utilidades** e **Acesso** ficam indisponíveis — ao tentar fazer login (o modal de senha que abre ao clicar em qualquer uma delas), o servidor responde com erro claro: `NOTION_TOKEN não configurado nas variáveis de ambiente do servidor.`

**Importante**: a aba Acesso agora GRAVA na página de Acessos (adicionar/atualizar/remover usuário, trocar senha), não só lê. Ao criar a integração no passo 1 abaixo, confirme nas permissões da integração (seção **Capabilities** em notion.so/my-integrations) que **"Insert content"** e **"Update content"** estão marcadas, além da leitura padrão — sem isso, as rotas `POST /api/access/upsert`, `POST /api/access/remove` e `POST /api/access/change-password` falham com 403 mesmo com o token certo e a página compartilhada.

Para habilitar essas duas abas:

1. Acesse [notion.so/my-integrations](https://www.notion.so/my-integrations) e crie uma **nova integração interna** (pode ser um token dedicado a este site, separado de qualquer integração já usada em outro script/Apps Script deste projeto).
2. Copie o **"Internal Integration Secret"** gerado — é o valor que vai na variável `NOTION_TOKEN`.
3. **Muito importante**: abra a página Notion **"Controle SHM / Acessos"** (a mesma que contém a tabela de usuários/senhas) e compartilhe-a com essa integração (botão "..." no canto superior direito da página → **Connections** → adicione a integração pelo nome). Sem esse passo, a API do Notion devolve 404/403 mesmo com o token certo — a integração só enxerga páginas que foram explicitamente conectadas a ela, exatamente como já documentado para o script de Relatório de Horas (`relatorio-horas.gs`).
4. No Render, aba **Environment** do serviço, adicione `NOTION_TOKEN` com o valor copiado no passo 2.
5. Redeploy (o Render costuma reiniciar o serviço automaticamente ao salvar uma nova env var).

**Pontos a validar na primeira execução com um `NOTION_TOKEN` real** (nunca testado nesta sessão de desenvolvimento, sem credenciais disponíveis):

- Se a tabela de acessos é encontrada de primeira pela busca recursiva de blocos (`findFirstTable_` em `github-server.js`), ou se está aninhada em algum bloco (toggle, coluna etc.) que precise de ajuste.
- Se a ordem das colunas da tabela bate com o esperado: **Usuário (e-mail) | Tipo de Acesso | Senha | Visualiza | Quantidade de acessos totais** (só as 3 primeiras são lidas).
- Se o endpoint `POST /api/access/login` reconhece corretamente e-mails/senhas reais cadastrados na tabela.
- Se `archived: true` num bloco `table_row` (usado por `POST /api/access/remove`, função `archiveAccessRow_` em `github-server.js`) realmente remove a linha da visualização da tabela — é o padrão documentado da API do Notion para deletar qualquer bloco, mas nunca testado contra esta tabela específica.
- Se o `PATCH /v1/blocks/{id}` de `POST /api/access/upsert`/`change-password` (função `updateAccessRow_`) aceita reenviar as 5 cells na mesma ordem de leitura (Usuário | Tipo de Acesso | Senha | Visualiza | Quantidade de acessos totais) sem precisar de nenhum campo adicional.
- Se `POST /api/access/upsert` com um e-mail novo (função `createAccessRow_`, `POST /v1/blocks/{tableId}/children`) insere a linha corretamente no fim da tabela.

## 3.2 Export Snap Notion (card em Utilidades)

Usa o mesmo `NOTION_TOKEN` da seção acima — nenhuma configuração extra. Ao clicar no card **Export Snap Notion**, o backend (rota `POST /api/export-snap` em `github-server.js`) busca os issues do Jira (reaproveitando o mesmo cache de `/api/issues`), monta um markdown do board agrupado por status (função `buildNotionReportMarkdown_`) e cria uma **subpágina nova** (nunca sobrescreve) dentro de "Controle SHM / Registro de Snaps" (ID fixo `3e8a28e673618086adc6e3b13dae1240`) via `POST /v1/pages` da API do Notion, com título `DDMMAAAA / Snap do Board`.

**Pontos a validar na primeira execução real** (nunca testado nesta sessão):

- Se a conversão markdown → blocos Notion (`buildNotionBlocksFromMarkdown_`/`mdLineToBlock_`/`richTextForLine_` em `github-server.js`) cobre bem o conteúdo real — ela suporta `##`/`###` (headings), `- ` (bullets), `> ` (quote), `**negrito**` e `[texto](url)` (links), o resto vira parágrafo simples.
- Se a página pai aceita filhos de primeira via `parent.page_id` (comportamento padrão documentado da API do Notion, mas nunca chamado ao vivo aqui).
- Boards muito grandes (mais de 100 blocos) são enviados em lotes (100 na criação + lotes de 100 via `PATCH /blocks/{id}/children`) — validar que o encadeamento de chamadas não estoura rate limit do Notion.

## 3.3 Configurar Gmail (Export Gravações BotDesign)

**Isto é bem mais trabalhoso que configurar Notion/Jira, e nunca foi testado ao vivo — nem na versão original do Artifact (`controle-shm-painel.html`), que usava um conector MCP Gmail nunca validado em sessão real.** O card **Sincronizar Gravações BotDesign** da aba Utilidades depende desse fluxo.

Diferente do Jira/Notion (um token simples), a Gmail API exige um fluxo OAuth2 completo. Resumo do que você vai fazer **uma única vez**:

1. **Criar um projeto no Google Cloud Console**: acesse [console.cloud.google.com](https://console.cloud.google.com), crie um projeto novo (ou reaproveite um existente).
2. **Ativar a Gmail API**: no projeto, vá em "APIs e serviços" → "Biblioteca" → procure "Gmail API" → "Ativar".
3. **Criar credenciais OAuth 2.0**: "APIs e serviços" → "Credenciais" → "Criar credenciais" → "ID do cliente OAuth" → tipo de aplicativo **"Aplicativo da Web"**.
   - Em "URIs de redirecionamento autorizados", adicione: `https://<seu-app>.onrender.com/auth/gmail/callback` (troque `<seu-app>` pelo nome real do serviço no Render — ou `http://localhost:3000/auth/gmail/callback` se for testar localmente primeiro).
   - Ao salvar, o Google mostra o **Client ID** e o **Client Secret** — são os valores de `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
4. **Configurar a "tela de consentimento OAuth"** (se o Google pedir, geralmente na primeira vez): tipo "Externo" é suficiente, só precisa autorizar o escopo `.../auth/gmail.readonly` e adicionar a própria conta Gmail (a que recebe os e-mails com marcador "# SHM") como usuário de teste, se o app ficar em modo de teste.
5. **Variáveis de ambiente no Render** (aba Environment do serviço):
   - `GOOGLE_CLIENT_ID` — o Client ID do passo 3.
   - `GOOGLE_CLIENT_SECRET` — o Client Secret do passo 3.
   - `GOOGLE_REDIRECT_URI` — exatamente a mesma URL cadastrada no passo 3 (ex: `https://<seu-app>.onrender.com/auth/gmail/callback`).
   - `GMAIL_REFRESH_TOKEN` — **ainda não existe neste ponto**, vem do passo 6.
6. **Obter o refresh token (passo manual, uma vez só)**: depois do deploy com as 3 variáveis acima já configuradas, abra no navegador `https://<seu-app>.onrender.com/auth/gmail`, **logado na conta Gmail certa** (a que recebe os e-mails com marcador "# SHM"). Você será redirecionado para a tela de consentimento do Google — autorize. Você volta para `/auth/gmail/callback`, que mostra na própria página (texto simples) o valor do `GMAIL_REFRESH_TOKEN`. Copie esse valor e salve como a 4ª variável de ambiente no Render (`GMAIL_REFRESH_TOKEN`), depois pode fechar a aba.
   - Se a página disser que nenhum `refresh_token` foi retornado, normalmente é porque essa conta já autorizou esse app antes (o Google só entrega refresh_token na primeira autorização). Revogue o acesso em [myaccount.google.com/permissions](https://myaccount.google.com/permissions) e repita o passo 6.
7. Redeploy/reinicie o serviço no Render para carregar `GMAIL_REFRESH_TOKEN`.

Depois disso, o botão **Sincronizar Gravações BotDesign** chama `POST /api/sync-gravacoes` (`github-server.js`), que: busca no Gmail (`gmail.users.messages.list` com query `"# SHM" tldv.io`) as mensagens candidatas, extrai data/assunto/link tl;dv de cada uma (`extractGmailBodyText_`/regex), busca o texto atual da página Notion "BotDesign (Gravações)" (ID fixo `3e4a28e6736180d8b945da0582398774`), filtra só os vídeos ainda não listados lá, e anexa um bloco divisor + um parágrafo por vídeo novo ao final da página via `PATCH /v1/blocks/{page_id}/children` (a API REST do Notion não tem um "substituir conteúdo" nativo como o MCP original usava — por isso vira "anexar ao final" em vez de reescrever a página inteira).

**Pontos a validar na primeira execução real** (nunca testado, nem no original):

- Se a query de busca `"# SHM" tldv.io` encontra os e-mails certos — "# SHM" pode ser um **label** do Gmail em vez de um termo de busca em texto livre; se não funcionar, tente trocar por `label:shm tldv.io` ou o nome exato do label/marcador usado na caixa de entrada.
- Se o link tl;dv está mesmo no corpo `text/plain` do e-mail (`extractGmailBodyText_` em `github-server.js`) — se só aparecer em HTML, o código precisa ser ajustado para decodificar a parte `text/html` em vez de (ou além de) `text/plain`.
- Se o refresh token da Gmail API expira por inatividade (tokens de apps em "modo de teste" no Google Cloud podem expirar em 7 dias) — se o card passar a dar erro de token inválido depois de um tempo sem uso, pode ser necessário publicar o app ("em produção") na tela de consentimento OAuth, ou repetir o passo 6.

## 4. Sobre o plano Free do Render

O plano Free "dorme" o serviço depois de alguns minutos sem acesso. O primeiro acesso depois disso demora cerca de **30–60 segundos** para o serviço acordar (o Render mostra uma tela de carregamento nesse meio-tempo) — depois disso, a navegação volta ao normal até o próximo período de inatividade.

## Pontos a validar na primeira execução com credenciais reais

`github-server.js` nunca foi testado contra o Jira real nesta sessão de desenvolvimento (sem credenciais disponíveis). Os pontos marcados com comentários "VALIDAR AO VIVO" no código são:

- **Descoberta dos campos "Start date" e "Flagged"**: o ID desses dois campos customizados é descoberto em tempo de execução via `GET /rest/api/3/field`, procurando pelo nome exato (`START_DATE_FIELD_NAMES` / `FLAGGED_FIELD_NAMES`). Se o nome do campo no site Jira for diferente do esperado, o painel simplesmente não encontra esses dados (sem quebrar) — ajuste as listas de nomes em `github-server.js` se for o caso.
- **Paginação do endpoint `/rest/api/3/search/jql`**: o código espera um `nextPageToken` na resposta (padrão mais recente do Jira Cloud) — se o site ainda usar o formato antigo (`startAt`/`total`), a paginação precisa ser ajustada.
