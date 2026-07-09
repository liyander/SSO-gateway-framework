#!/usr/bin/env sh
set -eu

if command -v openssl >/dev/null 2>&1; then
  openssl rand -base64 32
  exit 0
fi

python3 - <<'PY'
import base64
import os
print(base64.b64encode(os.urandom(32)).decode())
PY
