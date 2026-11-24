#!/usr/bin/env bash
# Publica um commit na VM. Chamado pela esteira (GitHub Actions -> SSM Run Command), como root:
#   bash /opt/apps/mp3/repo/deploy/deploy.sh <sha>
#
# Reconstrói a imagem, espera o app ficar saudável e, se não ficar, volta para o último commit
# que funcionou (guardado em /opt/apps/mp3/.deployed-sha).
set -euo pipefail

APP_DIR=/opt/apps/mp3
REPO="$APP_DIR/repo"
STATE="$APP_DIR/.deployed-sha"
CONTAINER=mp3-app
COMPOSE=(docker compose -f "$REPO/deploy/compose.yml")
TARGET="${1:?informe o commit a publicar}"
PREV="$(cat "$STATE" 2>/dev/null || true)"

# O start atualiza o yt-dlp antes de subir o servidor, então dá mais tempo que o BTC (até 4 min).
wait_healthy() {
  local status
  for _ in $(seq 1 80); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo ausente)"
    if [ "$status" = "healthy" ]; then return 0; fi
    if [ "$status" = "unhealthy" ]; then return 1; fi
    sleep 3
  done
  return 1
}

publish() {
  git -C "$REPO" fetch --quiet origin
  git -C "$REPO" checkout --quiet --force "$1"
  "${COMPOSE[@]}" up -d --build --remove-orphans
}

echo "==> Publicando $TARGET (anterior: ${PREV:-nenhum})"
publish "$TARGET"

if wait_healthy; then
  echo "$TARGET" > "$STATE"
  docker image prune -f > /dev/null
  echo "==> OK: $TARGET no ar"
  exit 0
fi

echo "==> ERRO: o app não ficou saudável. Últimas linhas do log:"
docker logs "$CONTAINER" --tail 60 2>&1 || true

if [ -n "$PREV" ] && [ "$PREV" != "$TARGET" ]; then
  echo "==> Revertendo para $PREV"
  publish "$PREV"
  if wait_healthy; then echo "==> Revertido para $PREV"; else echo "==> ATENÇÃO: o rollback também não ficou saudável"; fi
fi
exit 1
