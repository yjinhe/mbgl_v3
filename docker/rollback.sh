#!/usr/bin/env sh
set -eu

root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$root"

target_tag="${1:-}"
compose_file="${COMPOSE_FILE:-docker-compose.yml}"
env_file="${ENV_FILE:-.env.docker}"

if [ -z "$target_tag" ]; then
  echo "Usage: docker/rollback.sh <previous-immutable-image-tag>" >&2
  exit 2
fi
case "$target_tag" in
  latest|dev|*[!A-Za-z0-9._-]*) echo "Refusing a mutable or invalid rollback tag." >&2; exit 2 ;;
esac

compose() {
  if [ -f "$env_file" ]; then
    docker compose --env-file "$env_file" -f "$compose_file" "$@"
  else
    docker compose -f "$compose_file" "$@"
  fi
}

if [ -f "$env_file" ] && grep -Eq '^(APP_VERSION|BUILD_SHA)=' "$env_file"; then
  echo "Remove APP_VERSION and BUILD_SHA from $env_file; they would hide the rollback image metadata." >&2
  exit 1
fi

export IMAGE_TAG="$target_tag"
images="$(compose config --images)"
for image in $images; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "Rollback image is not present locally: $image" >&2
    echo "Pull the immutable tag first, then retry." >&2
    exit 1
  fi
done

if [ -n "$(compose ps -a -q tangji-api)" ]; then
  COMPOSE_FILE="$compose_file" ENV_FILE="$env_file" "$root/docker/backup-sqlite.sh"
fi

echo "Rolling back application containers to ${target_tag}..."
compose up -d --no-build --remove-orphans --wait
compose ps
echo "Rollback to ${target_tag} is healthy. If the old release is schema-incompatible, restore its matching database backup explicitly."
