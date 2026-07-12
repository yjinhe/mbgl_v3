#!/usr/bin/env sh
set -eu

root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$root"

archive="${1:-}"
compose_file="${COMPOSE_FILE:-docker-compose.yml}"
env_file="${ENV_FILE:-.env.docker}"

if [ -z "$archive" ] || [ ! -f "$archive" ]; then
  echo "Usage: CONFIRM_RESTORE=YES docker/restore-sqlite.sh /path/to/backup.tar.gz" >&2
  exit 2
fi
if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
  echo "Restore replaces the live database. Re-run with CONFIRM_RESTORE=YES." >&2
  exit 2
fi

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

if [ -f "$archive.sha256" ]; then
  expected_archive_hash="$(awk '{print $1}' "$archive.sha256")"
  actual_archive_hash="$(sha256_value "$archive")"
  if [ "$expected_archive_hash" != "$actual_archive_hash" ]; then
    echo "Backup archive checksum mismatch." >&2
    exit 1
  fi
fi

entries="$(tar -tzf "$archive")"
for entry in $entries; do
  case "$entry" in
    prod.db|prod.db.sha256|metadata.env) ;;
    *) echo "Unexpected path in backup archive: $entry" >&2; exit 1 ;;
  esac
done

tmp_dir="$(mktemp -d)"
tar -xzf "$archive" -C "$tmp_dir"
expected_database_hash="$(awk '{print $1}' "$tmp_dir/prod.db.sha256")"
actual_database_hash="$(sha256_value "$tmp_dir/prod.db")"
if [ "$expected_database_hash" != "$actual_database_hash" ]; then
  echo "Database checksum mismatch." >&2
  rm -rf "$tmp_dir"
  exit 1
fi

container_id="$(compose ps -a -q tangji-api)"
if [ -z "$container_id" ]; then
  compose create tangji-api >/dev/null
  container_id="$(compose ps -a -q tangji-api)"
fi
if [ -z "$container_id" ]; then
  echo "Could not create the Tangji API container." >&2
  rm -rf "$tmp_dir"
  exit 1
fi

was_running="$(docker inspect --format '{{.State.Running}}' "$container_id")"
safety_database="$tmp_dir/pre-restore.db"
had_database=false
replacement_installed=false

cleanup() {
  exit_code=$?
  trap - EXIT INT TERM
  if [ "$exit_code" -ne 0 ] && [ "$replacement_installed" = "true" ]; then
    docker stop -t 30 "$container_id" >/dev/null 2>&1 || true
    if [ "$had_database" = "true" ]; then
      docker cp "$safety_database" "$container_id:/data/prod.db" >/dev/null || true
    else
      image_id="$(docker inspect --format '{{.Image}}' "$container_id" 2>/dev/null || true)"
      [ -z "$image_id" ] || docker run --rm --volumes-from "$container_id" --entrypoint sh "$image_id" -c 'rm -f /data/prod.db' >/dev/null 2>&1 || true
    fi
  fi
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
if docker cp "$container_id:/data/prod.db" "$safety_database" >/dev/null 2>&1; then
  had_database=true
fi

docker cp "$tmp_dir/prod.db" "$container_id:/data/prod.db"
replacement_installed=true
image_id="$(docker inspect --format '{{.Image}}' "$container_id")"
validate_database "$container_id" "$image_id"

docker start "$container_id" >/dev/null
if ! wait_for_healthy "$container_id"; then
  echo "Restored database did not pass the API health check; restoring the pre-restore copy." >&2
  exit 1
fi
was_running=false

replacement_installed=false
trap - EXIT INT TERM
rm -rf "$tmp_dir"
echo "Database restored from $archive"
