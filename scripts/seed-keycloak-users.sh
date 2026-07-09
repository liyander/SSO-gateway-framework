#!/usr/bin/env sh
set -eu

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

REALM="${KEYCLOAK_REALM:-platform}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin_password}"

create_or_update_user() {
  username="$1"
  password="$2"
  roles_csv="$3"

  docker compose exec -T \
    -e REALM="$REALM" \
    -e ADMIN_USER="$ADMIN_USER" \
    -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    -e USERNAME="$username" \
    -e PASSWORD="$password" \
    -e ROLES_CSV="$roles_csv" \
    keycloak /bin/sh <<'EOS'
set -eu
KCADM=/opt/keycloak/bin/kcadm.sh

$KCADM config credentials \
  --server http://127.0.0.1:8080/auth \
  --realm master \
  --user "$ADMIN_USER" \
  --password "$ADMIN_PASSWORD" >/dev/null

USER_ID="$($KCADM get users -r "$REALM" -q username="$USERNAME" --fields id | sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' | head -n 1)"

if [ -z "$USER_ID" ]; then
  $KCADM create users -r "$REALM" \
    -s "username=$USERNAME" \
    -s enabled=true \
    -s emailVerified=true >/dev/null
  USER_ID="$($KCADM get users -r "$REALM" -q username="$USERNAME" --fields id | sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' | head -n 1)"
fi

$KCADM set-password -r "$REALM" --userid "$USER_ID" --new-password "$PASSWORD" --temporary=false

OLD_IFS="$IFS"
IFS=","
for role in $ROLES_CSV; do
  role="$(echo "$role" | tr -d ' ')"
  [ -n "$role" ] || continue
  $KCADM get roles/"$role" -r "$REALM" >/dev/null 2>&1 || $KCADM create roles -r "$REALM" -s "name=$role" >/dev/null
  $KCADM add-roles -r "$REALM" --uusername "$USERNAME" --rolename "$role" >/dev/null 2>&1 || true
done
IFS="$OLD_IFS"

echo "Ready: $USERNAME / $PASSWORD / $ROLES_CSV"
EOS
}

create_or_update_user "admin1" "Admin123!" "admin,student,ctf_user,app1_user,app2_user,app3_user"
create_or_update_user "student1" "Student123!" "student"
create_or_update_user "ctfuser1" "CtfUser123!" "ctf_user"

echo
echo "Keycloak users seeded:"
echo "  admin1   / Admin123!"
echo "  student1 / Student123!"
echo "  ctfuser1 / CtfUser123!"
