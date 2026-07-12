#!/usr/bin/env sh
set -eu

root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$root"

compose_file="${COMPOSE_FILE:-docker-compose.yml}"
env_file="${ENV_FILE:-.env.docker}"
backup_dir="${BACKUP_DIR:-${HOME:?HOME must be set}/tangji-backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="${1:-$backup_dir/tangji-$timestamp.tar.gz}"

compose() {
  if [ -f "$env_file" ]; then
    docker compose --env-file "$env_file" -f "$compose_file" "$@"
  else
    docker compose -f "$compose_file" "$@"
  fi
}

sha256_value() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

wait_for_healthy() {
  wait_container="$1"
  attempts=0
  while [ "$attempts" -lt 30 ]; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$wait_container")"
    [ "$status" = "healthy" ] && return 0
    [ "$status" = "running" ] && return 0
    [ "$status" = "unhealthy" ] && return 1
    attempts=$((attempts + 1))
    sleep 2
  done
  return 1
}

validate_database() {
  validator_container="$1"
  validator_image="$2"
  docker run --rm \
    --volumes-from "$validator_container" \
    --env DATABASE_URL=file:/data/prod.db \
    --workdir /app/apps/api \
    --entrypoint node \
    "$validator_image" \
    --input-type=module \
    --eval 'import { PrismaClient } from "@prisma/client"; const db = new PrismaClient(); try { await db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE);"); const quick = await db.$queryRawUnsafe("PRAGMA quick_check;"); const values = quick.flatMap(Object.values); if (values.length !== 1 || values[0] !== "ok") throw new Error(`quick_check failed: ${JSON.stringify(quick)}`); const foreignKeys = await db.$queryRawUnsafe("PRAGMA foreign_key_check;"); if (foreignKeys.length > 0) throw new Error(`foreign_key_check failed: ${JSON.stringify(foreignKeys)}`); } finally { await db.$disconnect(); }'
}

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar is required" >&2; exit 1; }

container_id="$(compose ps -a -q tangji-api)"
if [ -z "$container_id" ]; then
  echo "Tangji API container does not exist; start or create the deployment first." >&2
  exit 1
fi

mkdir -p "$(dirname "$archive")"
tmp_dir="$(mktemp -d)"
was_running="$(docker inspect --format '{{.State.Running}}' "$container_id")"

cleanup() {
  exit_code=$?
  trap - EXIT INT TERM
  if [ "$was_running" = "true" ] && [ "$(docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null || true)" != "true" ]; then
    docker start "$container_id" >/dev/null || true
  fi
  rm -rf "$tmp_dir"
  exit "$exit_code"
}
trap 'exit 130' INT
trap 'exit 143' TERM
trap cleanup EXIT

if [ "$was_running" = "true" ]; then
  docker stop -t 30 "$container_id" >/dev/null
fi

image_id="$(docker inspect --format '{{.Image}}' "$container_id")"
validate_database "$container_id" "$image_id"

docker cp "$container_id:/data/prod.db" "$tmp_dir/prod.db"
database_hash="$(sha256_value "$tmp_dir/prod.db")"
printf '%s  prod.db\n' "$database_hash" > "$tmp_dir/prod.db.sha256"

image_version="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image_id" 2>/dev/null || true)"
build_sha="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id" 2>/dev/null || true)"
printf 'created_at=%s\nimage_id=%s\napp_version=%s\nbuild_sha=%s\n' \
  "$timestamp" "$image_id" "$image_version" "$build_sha" > "$tmp_dir/metadata.env"

tar -czf "$archive" -C "$tmp_dir" prod.db prod.db.sha256 metadata.env
printf '%s  %s\n' "$(sha256_value "$archive")" "$(basename "$archive")" > "$archive.sha256"
chmod 600 "$archive" "$archive.sha256"

if [ "$was_running" = "true" ]; then
  docker start "$container_id" >/dev/null
  if ! wait_for_healthy "$container_id"; then
    echo "Backup succeeded, but the API did not become healthy after restart." >&2
    exit 1
  fi
  was_running=false
fi

trap - EXIT INT TERM
rm -rf "$tmp_dir"
echo "Backup written to $archive"
