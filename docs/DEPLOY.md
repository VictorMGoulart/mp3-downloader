# Deploy

## Onde hospedar

O app precisa de **processo Node rodando continuamente**, **disco temporário** (para os MP3/ZIP) e dos binários **yt-dlp + ffmpeg + deno**. Por isso:

- ✅ Funciona: qualquer host que rode o `Dockerfile` — Render, Railway, Fly.io, Koyeb, uma VPS (Hetzner, DigitalOcean, Oracle Free Tier) com Docker.
- ❌ Não funciona: Vercel, Netlify, Cloudflare Pages e outras plataformas serverless (sem binários externos, timeouts curtos, sem SSE longo).

Com uma réplica só. Jobs, progresso e rate limit ficam em memória.

## Produção: VM da AWS + Cloudflare (junto do Dashboard BTC)

O app roda na mesma EC2 do Dashboard BTC (`apps-server`, sa-east-1), no mesmo modelo:

```
navegador ─► Cloudflare (público, sem login) ─► Tunnel apps-server ─► cloudflared ─► mp3-app:3000
                                                                 (rede Docker apps-net)
push na main ─► GitHub Actions (CI) ─► OIDC ─► SSM Run Command ─► deploy/deploy.sh na VM
```

Nenhuma porta da VM fica aberta. O endereço fica num subdomínio próprio, por exemplo `mp3.<domínio>`, e é **público**: diferente do BTC, não passa pelo Cloudflare Access.

| Arquivo | Para quê |
|---|---|
| `deploy/compose.yml` | Container `mp3-app` na rede `apps-net`, com limite de memória e CPU |
| `deploy/deploy.sh` | Publica um commit, espera ficar saudável e reverte se não ficar |
| `deploy/env.production.example` | Modelo do `/opt/apps/mp3/.env` |
| `.github/workflows/ci-cd.yml` | CI em todo push; deploy via SSM em push na `main` |

### 1. Preparar a VM (uma vez)

No Session Manager da `apps-server`, como root (`sudo -i`). O repositório é público, então não precisa de chave de acesso:

```bash
git clone https://github.com/VictorMGoulart/mp3-downloader.git /opt/apps/mp3/repo
mkdir -p /opt/apps/mp3/data && chown 10001:10001 /opt/apps/mp3/data
cp /opt/apps/mp3/repo/deploy/env.production.example /opt/apps/mp3/.env && chmod 600 /opt/apps/mp3/.env
docker network inspect apps-net >/dev/null && echo "apps-net ok"
```

### 2. Primeiro build e teste do YouTube (antes de publicar)

```bash
cd /opt/apps/mp3/repo
docker compose -f deploy/compose.yml up -d --build      # 5 a 10 min na primeira vez
docker compose -f deploy/compose.yml ps                 # mp3-app (healthy)
curl -s http://127.0.0.1:3001/api/status; echo
# O YouTube aceita o IP da AWS? Precisa imprimir o título, não "Sign in to confirm you're not a bot".
docker exec mp3-app yt-dlp --simulate --print title -- "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
free -m && df -h /
```

Se aparecer o erro de bot, configure cookies ou proxy no `/opt/apps/mp3/.env` (seção "Fazendo o yt-dlp funcionar no servidor" abaixo) e rode `docker compose -f deploy/compose.yml up -d --force-recreate`.

Para abrir o app no seu PC antes do domínio, pelo túnel do Session Manager:

```bash
aws ssm start-session --region sa-east-1 --target i-XXXX \
  --document-name AWS-StartPortForwardingSession --parameters "portNumber=3001,localPortNumber=3001"
# depois abra http://localhost:3001
```

### 3. Cloudflare: publicar o subdomínio

1. **Networks → Tunnels → `apps-server` → Public hostname → Add a public hostname**
   - Subdomain `mp3`, Domain o seu domínio, Type `HTTP`, URL `mp3-app:3000`
2. Abra `https://mp3.<domínio>`. O app abre direto, sem login.
3. Confira que **não** existe uma aplicação do Access cobrindo `mp3.<domínio>` (por exemplo, uma regra com curinga `*.<domínio>`). Se existir, o site vai pedir login.

O `cloudflared` que já roda na VM atende o novo subdomínio sem reiniciar.

**Proteções de um site público.** Qualquer pessoa pode usar o app, e ele roda na mesma VM do BTC. Por isso:
- **No app** (`/opt/apps/mp3/.env`): 20 buscas/downloads por visitante a cada 15 min, identificado pelo `CF-Connecting-IP`; 1 download por vez no servidor inteiro; nenhum download começa ou continua com menos de 3 GB livres no disco; o container fica limitado a 900 MB de memória e 1,5 CPU.
- **Na Cloudflare (opcional, plano Free):**
  - **Security → WAF → Rate limiting rules**: uma regra para `mp3.<domínio>` com caminho começando em `/api/`, por exemplo 30 requisições em 10 s por IP → Block. Barra abuso antes de chegar à VM.
  - **Security → Bots → Bot Fight Mode**: desafia robôs conhecidos.
- **Acompanhe** o uso de disco (`df -h /`), memória (`docker stats mp3-app`) e os logs (`docker logs mp3-app --tail 50`). Muitos downloads saindo do mesmo IP também aumentam a chance de o YouTube bloquear a VM.

### 4. Esteira (GitHub Actions → AWS)

O provedor OIDC do GitHub já existe na conta (criado para o BTC).

1. **IAM → Funções → Criar função → Identidade web**: provedor `token.actions.githubusercontent.com`, público `sts.amazonaws.com`, organização `VictorMGoulart`, repositório `mp3-downloader`. Sem permissões. Nome `github-deploy-mp3-downloader`.
2. **Relações de confiança**: o mesmo JSON da role do BTC, trocando o `sub` para `repo:VictorMGoulart/mp3-downloader:environment:production`.
3. **Política em linha** `deploy-apps-server`: a mesma da role do BTC (`ssm:SendCommand` só para a instância e o documento `AWS-RunShellScript`, mais `ssm:GetCommandInvocation`).
4. **GitHub → Settings → Environments → `production`** (criado na primeira execução da esteira):
   - Deployment branches: só `main`
   - Variables: `AWS_ROLE_ARN` (`arn:aws:iam::<conta>:role/github-deploy-mp3-downloader`), `EC2_INSTANCE_ID` (o mesmo do BTC), `AWS_REGION` = `sa-east-1`
5. Primeiro deploy: **Actions → CI/CD → Run workflow**. Depois, todo push na `main` publica sozinho.

### Recursos da VM

A `t4g.small` (2 GB) é dividida com o BTC. O `deploy/compose.yml` limita o app a 900 MB e 1,5 CPU, e o `.env` de produção usa 1 download por vez com 2 faixas em paralelo. Se ficar apertado, suba a instância para `t4g.medium` (4 GB). Cada faixa ocupa cerca de 8 MB em disco até o ZIP ser descartado; acompanhe com `df -h /`.

## Passo a passo (Docker)

```bash
cp .env.example .env      # ajuste o que precisar
docker compose up -d --build
curl localhost:3000/api/status
```

Em PaaS, aponte para o `Dockerfile` do repositório e configure as variáveis no painel. O `NODE_ENV=production` já vem definido na imagem.

## Fazendo o yt-dlp funcionar no servidor

Em casa o yt-dlp funciona, mas em servidor de nuvem o YouTube costuma bloquear com *"Sign in to confirm you're not a bot"*. Em ordem de esforço:

1. **Mantenha o yt-dlp atualizado.** `YTDLP_AUTO_UPDATE=true` (padrão) atualiza a cada start do container. Reinicie o serviço quando parar de funcionar.
2. **Runtime JS.** As versões atuais do yt-dlp precisam de um runtime JS para o YouTube. A imagem já instala o **deno**.
3. **Cookies.** Exporte os cookies de uma conta **descartável** logada no YouTube (extensão "Get cookies.txt LOCALLY", formato Netscape) e configure **uma** das opções:
   - `COOKIES_BASE64`: `base64 -w0 cookies.txt` (Linux) ou `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cookies.txt"))` (PowerShell). É a opção mais prática em PaaS.
   - `COOKIES_PATH`: monte o arquivo como volume (veja o `docker-compose.yml`).
   - `COOKIES_TXT`: conteúdo bruto, aceitando `\n` literal.

   Os cookies expiram; quando voltar o erro de bot, exporte de novo.
4. **Proxy.** IPs de datacenter (AWS, GCP, Azure) são os mais bloqueados. Um proxy **residencial** resolve na maioria dos casos: `YTDLP_PROXY=http://user:pass@host:port`.
   - Use **sessão fixa (sticky)**, de 10 minutos ou mais. O link do áudio que o YouTube entrega vale só para o IP que o pediu; se o proxy trocar de IP a cada requisição, os downloads falham com 403.
   - Use proxy **HTTP/HTTPS**. Ele também é usado na consulta ao YouTube Music (troca de faixas indisponíveis), que não aceita SOCKS.
   - O tráfego é cobrado por GB: cada faixa usa cerca de 1 a 2 MB de consulta e 4 a 8 MB de áudio.
   - Teste antes de colocar no `.env`: `docker exec mp3-app yt-dlp --proxy "http://..." --simulate --print title -- "https://www.youtube.com/watch?v=dQw4w9WgXcQ"`.
5. **PO token.** Para casos persistentes, veja o [guia de PO Token do yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide) e use `YTDLP_PO_TOKEN=mweb.gvs+TOKEN` (com `YTDLP_PLAYER_CLIENT=default,mweb`).
6. **Reduza o volume.** `YTDLP_TOPIC_LOOKUP=false` elimina uma busca por faixa ao listar; `YTDLP_SLEEP_BETWEEN_MS=2000` espaça os downloads; `YTDLP_EXTRA_ARGS=--sleep-requests 1` espaça as requisições.

O `GET /api/status` mostra a versão do yt-dlp e se há cookies configurados. O frontend exibe uma mensagem clara quando o YouTube bloqueia.

## Site público: limites

Os padrões em produção já limitam abuso: `RATE_LIMIT_MAX=20` requisições por IP a cada 15 min, `MAX_CONCURRENT_JOBS=2`. Não há limite de músicas por download nem de faixas por playlist; se precisar, defina `MAX_TRACKS_PER_JOB` e `MAX_PLAYLIST_ITEMS` (0 = sem limite). Playlists grandes ocupam disco proporcional (~8 MB por faixa) até o ZIP ser descartado. Os ZIPs expiram após `JOB_TTL_MINUTES` sem uso. Ajuste conforme a máquina.

Atrás de proxy reverso (padrão em PaaS), `TRUST_PROXY=true` (padrão em produção) garante que o rate limit use o IP real do visitante.

## Aviso

Baixar conteúdo do YouTube pode violar os Termos de Serviço da plataforma e direitos autorais, dependendo do conteúdo e da jurisdição. Um site público aumenta essa exposição; avalie antes de abrir para terceiros.
