# ---------- Build (frontend + backend) ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json vitest.config.mts ./
COPY src ./src
COPY web ./web
RUN npm run build && npm prune --omit=dev


# ---------- Runtime ----------
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PATH="/opt/venv/bin:/usr/local/bin:$PATH" \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# ffmpeg para conversão em MP3; python para o yt-dlp; deno como runtime JS
# (o yt-dlp precisa de um runtime JS para resolver os desafios do YouTube).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg python3 python3-venv ca-certificates curl unzip \
    && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && apt-get purge -y unzip && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# venv gravável pelo usuário da aplicação para permitir auto-update no start
RUN python3 -m venv /opt/venv \
    && pip install -U "yt-dlp[default]" \
    && useradd --create-home --uid 10001 app \
    && chown -R app:app /opt/venv

WORKDIR /app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/public ./public
COPY --chown=app:app package.json entrypoint.sh ./
RUN chmod +x entrypoint.sh

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/server.js"]
