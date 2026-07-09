#!/usr/bin/env sh
set -eu

HOST_PORT="${HTTPS_HOST_PORT:-7846}"

echo "== Docker services =="
docker compose ps || true

echo
echo "== Host listeners =="
if command -v ss >/dev/null 2>&1; then
  sudo ss -ltnp | grep -E ":(${HOST_PORT}|443)\\b" || true
else
  netstat -ltnp 2>/dev/null | grep -E ":(${HOST_PORT}|443)\\b" || true
fi

echo
echo "== Certificate files =="
ls -l ./certs/fullchain.pem ./certs/privkey.pem 2>/dev/null || true

echo
echo "== Local HTTPS checks =="
curl -vk --max-time 8 "https://127.0.0.1:${HOST_PORT}/health" || true
echo
curl -vk --max-time 8 "https://127.0.0.1:${HOST_PORT}/" || true

echo
echo "== Recent nginx logs =="
docker compose logs --tail=80 nginx || true

echo
echo "== Recent admin-panel logs =="
docker compose logs --tail=80 admin-panel || true

echo
echo "== Recent oauth2-proxy logs =="
docker compose logs --tail=80 oauth2-proxy || true

echo
echo "== Recent keycloak logs =="
docker compose logs --tail=80 keycloak || true
