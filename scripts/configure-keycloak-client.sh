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
HOST="${PLATFORM_HOST:-platform.com}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin_password}"
CLIENT_SECRET="${OAUTH2_PROXY_CLIENT_SECRET:-change_this_keycloak_client_secret}"

PUBLIC_ORIGIN="https://${HOST}"
REDIRECT_URI="${PUBLIC_ORIGIN}/oauth2/callback"
LOGOUT_URI="${PUBLIC_ORIGIN}/*"

echo "Configuring Keycloak client '${CLIENT_ID}' in realm '${REALM}'"
echo "Allowed redirect URI: ${REDIRECT_URI}"
echo "Allowed web origin: ${PUBLIC_ORIGIN}"

docker compose exec -T \
  -e REALM="$REALM" \
  -e CLIENT_ID="$CLIENT_ID" \
  -e ADMIN_USER="$ADMIN_USER" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e CLIENT_SECRET="$CLIENT_SECRET" \
  -e PUBLIC_ORIGIN="$PUBLIC_ORIGIN" \
  -e REDIRECT_URI="$REDIRECT_URI" \
  -e LOGOUT_URI="$LOGOUT_URI" \
  keycloak /bin/sh <<'EOS'
set -eu

KCADM=/opt/keycloak/bin/kcadm.sh

$KCADM config credentials \
  --server http://127.0.0.1:8080/auth \
  --realm master \
  --user "$ADMIN_USER" \
  --password "$ADMIN_PASSWORD" >/dev/null

CLIENT_JSON="$($KCADM get clients -r "$REALM" -q clientId="$CLIENT_ID" --fields id,clientId)"
CLIENT_UUID="$(printf '%s\n' "$CLIENT_JSON" | sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' | head -n 1)"

if [ -z "$CLIENT_UUID" ]; then
  echo "Client not found: $CLIENT_ID" >&2
  exit 1
fi

$KCADM update "clients/$CLIENT_UUID" -r "$REALM" \
  -s "secret=$CLIENT_SECRET" \
  -s 'publicClient=false' \
  -s 'standardFlowEnabled=true' \
  -s 'directAccessGrantsEnabled=false' \
  -s 'serviceAccountsEnabled=false' \
  -s "redirectUris=[\"$REDIRECT_URI\"]" \
  -s "webOrigins=[\"$PUBLIC_ORIGIN\"]" \
  -s "attributes.\"post.logout.redirect.uris\"=\"$LOGOUT_URI\""

echo "Updated client $CLIENT_ID ($CLIENT_UUID)"
EOS
