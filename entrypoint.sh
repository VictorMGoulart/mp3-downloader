#!/bin/sh
set -e

# O YouTube muda com frequência e versões antigas do yt-dlp param de funcionar.
# Com YTDLP_AUTO_UPDATE=true (padrão), atualiza a cada start do container.
if [ "${YTDLP_AUTO_UPDATE:-true}" = "true" ]; then
  echo "Atualizando yt-dlp..."
  pip install -q -U "yt-dlp[default]" || echo "Aviso: falha ao atualizar o yt-dlp, seguindo com a versão instalada."
fi

echo "yt-dlp $(yt-dlp --version 2>/dev/null || echo 'não encontrado')"

# Cookies (COOKIES_PATH / COOKIES_BASE64 / COOKIES_TXT) são tratados pela aplicação — ver src/config.ts.
exec "$@"
