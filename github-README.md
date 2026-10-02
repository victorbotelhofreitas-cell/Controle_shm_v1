# Controle SHM — Painel Público (Board Jira + Métricas)

Painel somente-leitura do projeto Jira **SHMB**, com dados ao vivo via API REST do Jira, pensado para rodar como um pequeno backend Node (Express) no [Render](https://render.com) e gerar um link público (`https://*.onrender.com`) que não depende da conta Claude.

Arquivos deste repositório (todos soltos nesta mesma pasta, sem subpasta):

- `github-server.js` — backend Express: busca as issues do Jira e serve a página.
- `github-index.html` / `github-style.css` / `github-app.js` — frontend (Board Jira + Métricas).
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
git add package.json .gitignore github-server.js github-index.html github-style.css github-app.js github-README.md

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
9. Clique em **Create Web Service** / **Deploy**. O Render builda e sobe o serviço automaticamente.
10. Ao final, o Render gera uma URL pública no formato `https://<nome-do-serviço>.onrender.com` — esse é o link para compartilhar.

## 4. Sobre o plano Free do Render

O plano Free "dorme" o serviço depois de alguns minutos sem acesso. O primeiro acesso depois disso demora cerca de **30–60 segundos** para o serviço acordar (o Render mostra uma tela de carregamento nesse meio-tempo) — depois disso, a navegação volta ao normal até o próximo período de inatividade.

## Pontos a validar na primeira execução com credenciais reais

`github-server.js` nunca foi testado contra o Jira real nesta sessão de desenvolvimento (sem credenciais disponíveis). Os pontos marcados com comentários "VALIDAR AO VIVO" no código são:

- **Descoberta dos campos "Start date" e "Flagged"**: o ID desses dois campos customizados é descoberto em tempo de execução via `GET /rest/api/3/field`, procurando pelo nome exato (`START_DATE_FIELD_NAMES` / `FLAGGED_FIELD_NAMES`). Se o nome do campo no site Jira for diferente do esperado, o painel simplesmente não encontra esses dados (sem quebrar) — ajuste as listas de nomes em `github-server.js` se for o caso.
- **Paginação do endpoint `/rest/api/3/search/jql`**: o código espera um `nextPageToken` na resposta (padrão mais recente do Jira Cloud) — se o site ainda usar o formato antigo (`startAt`/`total`), a paginação precisa ser ajustada.
