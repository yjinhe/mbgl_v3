#!/usr/bin/env sh
set -eu

export DATABASE_URL="${DATABASE_URL:-file:/data/prod.db}"
export PORT="${PORT:-3001}"

mkdir -p /data

if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data
  exec gosu node "$0" "$@"
fi

echo "[api] DATABASE_URL=${DATABASE_URL}"
if [ "${BASELINE_INITIAL_MIGRATION:-false}" = "true" ]; then
  echo "[api] Marking the initial migration as applied for an existing database..."
  pnpm --filter @tangji/api exec prisma migrate resolve --applied 20260710000000_initial
fi

echo "[api] Applying Prisma migrations..."
pnpm --filter @tangji/api exec prisma migrate deploy

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
