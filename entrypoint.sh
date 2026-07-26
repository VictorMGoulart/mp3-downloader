#!/bin/sh

COOKIE_FILE="/app/cookies.txt"

if [ -n "$COOKIES_TXT" ]; then
  if [ -f "$COOKIE_FILE" ]; then
    rm "$COOKIE_FILE"
    echo "Arquivo $COOKIE_FILE deletado."
  fi

  echo "Gerando cookies.txt a partir da variável de ambiente..."
  echo "$COOKIES_TXT" > "$COOKIE_FILE"
else
  echo "Variável COOKIES_TXT não definida. Prosseguindo sem cookies."
fi
