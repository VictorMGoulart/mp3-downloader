#!/bin/sh

COOKIE_FILE="/app/cookies.txt"

if [ -n "$COOKIES_TXT" ]; then
  if [ -f "$COOKIE_FILE" ]; then
    rm "$COOKIE_FILE"
    echo "Arquivo $COOKIE_FILE antigo deletado."
  fi

  echo "Gerando cookies.txt a partir da variável de ambiente COOKIES_TXT..."
  printf "%s\n" "$COOKIES_TXT" > "$COOKIE_FILE"
  echo "cookies.txt criado com sucesso."
else
  echo "Variável COOKIES_TXT não definida. Prosseguindo sem cookies adicionais."
fi

exec "$@"
