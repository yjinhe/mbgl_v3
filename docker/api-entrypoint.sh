#!/usr/bin/env sh
set -eu

export DATABASE_URL="${DATABASE_URL:-file:/data/prod.db}"
export PORT="${PORT:-3001}"

mkdir -p /data

echo "[api] DATABASE_URL=${DATABASE_URL}"
echo "[api] Running Prisma schema sync..."
pnpm --filter @tangji/api exec prisma db push --skip-generate

if [ "${SEED_ON_BOOT:-false}" = "true" ]; then
  echo "[api] SEED_ON_BOOT=true, seeding demo data..."
  pnpm --filter @tangji/api seed
else
  echo "[api] Skip seed. Set SEED_ON_BOOT=true for first demo initialization."
fi

echo "[api] Starting Tangji API on port ${PORT}..."
exec "$@"
