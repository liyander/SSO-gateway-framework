#!/usr/bin/env sh
set -eu

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

REALM="${KEYCLOAK_REALM:-platform}"
CLIENT_ID="${OAUTH2_PROXY_CLIENT_ID:-platform-gateway}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin_password}"

echo "== containers =="
docker compose ps

echo
echo "== oauth2-proxy env =="
docker inspect platform-oauth2-proxy --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sort \
  | grep -E 'OAUTH2_PROXY_OIDC_ISSUER_URL|OAUTH2_PROXY_REDIRECT_URL|OAUTH2_PROXY_INSECURE|OAUTH2_PROXY_SSL|OAUTH2_PROXY_COOKIE|OAUTH2_PROXY_CLIENT|OAUTH2_PROXY_CODE_CHALLENGE_METHOD|OAUTH2_PROXY_USER_ID_CLAIM|OAUTH2_PROXY_OIDC_EMAIL_CLAIM|OAUTH2_PROXY_OIDC_GROUPS_CLAIM|OAUTH2_PROXY_SKIP_CLAIMS_FROM_PROFILE_URL|OAUTH2_PROXY_SHOW_DEBUG_ON_ERROR' || true

echo
echo "== oauth2-proxy logs =="
docker compose logs --tail=80 oauth2-proxy || true

echo
echo "== keycloak client =="
docker compose exec -T \
  -e REALM="$REALM" \
  -e CLIENT_ID="$CLIENT_ID" \
  -e ADMIN_USER="$ADMIN_USER" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  keycloak /bin/sh <<'EOS' || true
set -eu
KCADM=/opt/keycloak/bin/kcadm.sh
$KCADM config credentials --server http://127.0.0.1:8080/auth --realm master --user "$ADMIN_USER" --password "$ADMIN_PASSWORD" >/dev/null
CLIENT_UUID="$($KCADM get clients -r "$REALM" -q clientId="$CLIENT_ID" --fields id | sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' | head -n 1)"
if [ -z "$CLIENT_UUID" ]; then
  echo "client not found"
  exit 0
fi
$KCADM get "clients/$CLIENT_UUID" -r "$REALM" --fields clientId,redirectUris,webOrigins,attributes
EOS

echo
echo "== local endpoints =="
curl -sk https://127.0.0.1:7846/keycloak-ready | head -c 240 || true
echo
curl -sk https://127.0.0.1:7846/debug/sso | head -c 500 || true
echo
