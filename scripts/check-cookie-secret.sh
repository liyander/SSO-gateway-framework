#!/usr/bin/env sh
set -eu

secret="${1:-${OAUTH2_PROXY_COOKIE_SECRET:-}}"

if [ -z "$secret" ]; then
  echo "missing OAUTH2_PROXY_COOKIE_SECRET" >&2
  exit 1
fi

SECRET="$secret" python3 - <<'PY'
import base64
import os
import sys

secret = os.environ["SECRET"].strip()

decoded = None
try:
    decoded = base64.b64decode(secret, validate=True)
except Exception:
    decoded = secret.encode()

length = len(decoded)
print(f"decoded cookie secret length: {length} bytes")
if length not in (16, 24, 32):
    print("invalid: oauth2-proxy requires 16, 24, or 32 bytes", file=sys.stderr)
    sys.exit(1)
print("ok")
PY
