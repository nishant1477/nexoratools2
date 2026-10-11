#!/bin/sh
# Creates .env from .env.example with freshly generated secrets. Never overwrites an existing .env.
#   sh scripts/init-env.sh                      -> no admin account is bootstrapped
#   sh scripts/init-env.sh you@example.com      -> also bootstraps an admin with a generated password (printed once)
set -eu
cd "$(dirname "$0")/.."

[ -f .env ] && { echo ".env already exists - not touching it. Delete it first if you really want new secrets."; exit 0; }
TEMPLATE="${ENV_TEMPLATE:-.env.example}"
[ -f "$TEMPLATE" ] || { echo "$TEMPLATE not found"; exit 1; }

rand() { # $1 = bytes of entropy -> hex string
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"
  else head -c "$1" /dev/urandom | od -An -vtx1 | tr -d ' \n'; fi
}

JWT=$(rand 48)
PG=$(rand 24)
ADMIN_EMAIL_VALUE="${1:-}"
ADMIN_PW=""
[ -n "$ADMIN_EMAIL_VALUE" ] && ADMIN_PW=$(rand 12)

# Values are hex, so they are safe inside sed replacements.
sed -e "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://nexora:$PG@localhost:5432/nexora|" \
    -e "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=$ADMIN_EMAIL_VALUE|" \
    -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$ADMIN_PW|" \
    "$TEMPLATE" > .env
chmod 600 .env 2>/dev/null || true

echo "Created .env with generated JWT_SECRET and POSTGRES_PASSWORD."
if [ -n "$ADMIN_PW" ]; then
  echo "Admin account will be created on first API start:"
  echo "  email:    $ADMIN_EMAIL_VALUE"
  echo "  password: $ADMIN_PW   (also stored in .env as ADMIN_PASSWORD - remove it after first login if you like)"
fi
echo "Review .env (PUBLIC_URL/HTTP_PORT, or API_DOMAIN/WEB_ORIGIN for the backend template), then:  docker compose up -d --build   (backend: docker compose -f docker-compose.backend.yml up -d --build)"
