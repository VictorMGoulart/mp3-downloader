# Deploy

## Onde hospedar

O app precisa de **processo Node rodando continuamente**, **disco temporário** (para os MP3/ZIP) e dos binários **yt-dlp + ffmpeg + deno**. Por isso:

- ✅ Funciona: qualquer host que rode o `Dockerfile` — Render, Railway, Fly.io, Koyeb, uma VPS (Hetzner, DigitalOcean, Oracle Free Tier) com Docker.
- ❌ Não funciona: Vercel, Netlify, Cloudflare Pages e outras plataformas serverless (sem binários externos, timeouts curtos, sem SSE longo).

Com uma réplica só. Jobs, progresso e rate limit ficam em memória.

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
4. **Proxy.** IPs de datacenter são os mais bloqueados. `YTDLP_PROXY=http://user:pass@host:port` com um proxy residencial resolve na maioria dos casos.
5. **PO token.** Para casos persistentes, veja o [guia de PO Token do yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide) e use `YTDLP_PO_TOKEN=mweb.gvs+TOKEN` (com `YTDLP_PLAYER_CLIENT=default,mweb`).
6. **Reduza o volume.** `YTDLP_TOPIC_LOOKUP=false` elimina uma busca por faixa ao listar; `YTDLP_SLEEP_BETWEEN_MS=2000` espaça os downloads; `YTDLP_EXTRA_ARGS=--sleep-requests 1` espaça as requisições.

O `GET /api/status` mostra a versão do yt-dlp e se há cookies configurados. O frontend exibe uma mensagem clara quando o YouTube bloqueia.

## Site público: limites

Os padrões em produção já limitam abuso: `RATE_LIMIT_MAX=20` requisições por IP a cada 15 min, `MAX_CONCURRENT_JOBS=2`. Não há limite de músicas por download nem de faixas por playlist; se precisar, defina `MAX_TRACKS_PER_JOB` e `MAX_PLAYLIST_ITEMS` (0 = sem limite). Playlists grandes ocupam disco proporcional (~8 MB por faixa) até o ZIP ser descartado. Os ZIPs expiram após `JOB_TTL_MINUTES` sem uso. Ajuste conforme a máquina.

Atrás de proxy reverso (padrão em PaaS), `TRUST_PROXY=true` (padrão em produção) garante que o rate limit use o IP real do visitante.

## Aviso

Baixar conteúdo do YouTube pode violar os Termos de Serviço da plataforma e direitos autorais, dependendo do conteúdo e da jurisdição. Um site público aumenta essa exposição; avalie antes de abrir para terceiros.
