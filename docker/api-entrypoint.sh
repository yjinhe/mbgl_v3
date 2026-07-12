#!/usr/bin/env sh
set -eu

umask 077

export DATABASE_URL="${DATABASE_URL:-file:/data/prod.db}"
export PORT="${PORT:-3001}"

mkdir -p /data

if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data
  exec gosu node "$0" "$@"
fi

echo "[api] version=${APP_VERSION:-unknown} build=${BUILD_SHA:-unknown}"
echo "[api] DATABASE_URL=${DATABASE_URL}"

/app/docker/migration-preflight.sh before

echo "[api] Applying Prisma migrations..."
pnpm --filter @tangji/api exec prisma migrate deploy
/app/docker/migration-preflight.sh after

if [ "${SEED_ON_BOOT:-false}" = "true" ]; then
  if [ "${ALLOW_DESTRUCTIVE_SEED:-false}" != "true" ]; then
    echo "[api] Refusing destructive seed. Also set ALLOW_DESTRUCTIVE_SEED=true for a disposable demo database."
    exit 1
  fi
  echo "[api] WARNING: SEED_ON_BOOT=true resets all application data before seeding."
  pnpm --filter @tangji/api seed
else
  echo "[api] Skipping destructive demo seed."
fi

echo "[api] Starting Tangji API on port ${PORT}..."
exec "$@"
