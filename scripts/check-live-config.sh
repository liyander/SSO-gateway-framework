#!/usr/bin/env sh
set -eu

echo "== compose-rendered oauth2-proxy issuer =="
docker compose config | sed -n '/oauth2-proxy:/,/admin-panel:/p' | grep -E 'OAUTH2_PROXY_OIDC_ISSUER_URL|OAUTH2_PROXY_REDIRECT_URL|OAUTH2_PROXY_INSECURE|OAUTH2_PROXY_SSL|OAUTH2_PROXY_COOKIE_SECRET|OAUTH2_PROXY_COOKIE_DOMAINS|OAUTH2_PROXY_CODE_CHALLENGE_METHOD|OAUTH2_PROXY_USER_ID_CLAIM|OAUTH2_PROXY_OIDC_EMAIL_CLAIM|OAUTH2_PROXY_OIDC_GROUPS_CLAIM|OAUTH2_PROXY_SKIP_CLAIMS_FROM_PROFILE_URL|OAUTH2_PROXY_SHOW_DEBUG_ON_ERROR' || true

echo
echo "== live oauth2-proxy environment =="
docker inspect platform-oauth2-proxy \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sort \
  | grep -E 'OAUTH2_PROXY_OIDC_ISSUER_URL|OAUTH2_PROXY_REDIRECT_URL|OAUTH2_PROXY_INSECURE|OAUTH2_PROXY_SSL|OAUTH2_PROXY_COOKIE_SECRET|OAUTH2_PROXY_COOKIE_DOMAINS|OAUTH2_PROXY_CODE_CHALLENGE_METHOD|OAUTH2_PROXY_USER_ID_CLAIM|OAUTH2_PROXY_OIDC_EMAIL_CLAIM|OAUTH2_PROXY_OIDC_GROUPS_CLAIM|OAUTH2_PROXY_SKIP_CLAIMS_FROM_PROFILE_URL|OAUTH2_PROXY_SHOW_DEBUG_ON_ERROR' || true

echo
echo "== keycloak from nginx =="
docker compose exec nginx /bin/sh -lc 'wget -qO- http://keycloak:8080/auth/realms/platform/.well-known/openid-configuration | head -c 240; echo' || true
