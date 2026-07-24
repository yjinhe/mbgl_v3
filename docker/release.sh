#!/usr/bin/env sh
set -eu

root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$root"

compose_file="${COMPOSE_FILE:-docker-compose.yml}"
env_file="${ENV_FILE:-.env.docker}"

compose() {
  if [ -f "$env_file" ]; then
    docker compose --env-file "$env_file" -f "$compose_file" "$@"
  else
    docker compose -f "$compose_file" "$@"
  fi
}

dotenv_value() {
  awk -v name="$1" '
    index($0, name "=") == 1 { value = substr($0, length(name) + 2) }
    END { sub(/\r$/, "", value); print value }
  ' "$env_file"
}

validate_release_env() {
  jwt_secret="$(dotenv_value JWT_SECRET)"
  if [ "$(dotenv_value WECHAT_MOCK)" != "false" ]; then
    echo "WECHAT_MOCK must be false for a release." >&2
    exit 1
  fi
  mini_app_id="$(dotenv_value WECHAT_APPID)"
  mini_secret="$(dotenv_value WECHAT_SECRET)"
  if { [ -z "$mini_app_id" ] && [ -n "$mini_secret" ]; } || { [ -n "$mini_app_id" ] && [ -z "$mini_secret" ]; }; then
    echo "WECHAT_APPID and WECHAT_SECRET must either both be set or both be empty." >&2
    exit 1
  fi
  if [ "${#jwt_secret}" -lt 32 ] || printf '%s' "$jwt_secret" | grep -q 'change-me'; then
    echo "JWT_SECRET must be a unique production secret with at least 32 characters." >&2
    exit 1
  fi
  if [ "$(dotenv_value SEED_ON_BOOT)" != "false" ] || [ "$(dotenv_value ALLOW_DESTRUCTIVE_SEED)" != "false" ]; then
    echo "SEED_ON_BOOT and ALLOW_DESTRUCTIVE_SEED must both be false for a release." >&2
    exit 1
  fi

  if grep -Eq '^[[:space:]]+tangji-frontends:[[:space:]]*$' "$compose_file"; then
    web_app_id="$(dotenv_value WECHAT_WEB_APPID)"
    web_secret="$(dotenv_value WECHAT_WEB_SECRET)"
    redirect_uri="$(dotenv_value WECHAT_WEB_REDIRECT_URI)"
    app_origin="$(dotenv_value APP_ORIGIN)"
    web_origins="$(dotenv_value WEB_ORIGIN)"

    if { [ -z "$web_app_id" ] && [ -n "$web_secret" ]; } || { [ -n "$web_app_id" ] && [ -z "$web_secret" ]; }; then
      echo "WECHAT_WEB_APPID and WECHAT_WEB_SECRET must either both be set or both be empty." >&2
      exit 1
    fi
    app_origin="${app_origin%/}"
    case "$app_origin" in
      https://*) ;;
      *) echo "APP_ORIGIN must be an HTTPS origin for a full-stack release." >&2; exit 1 ;;
    esac
    origin_authority="${app_origin#https://}"
    case "$origin_authority" in
      ''|*/*|*\?*|*\#*) echo "APP_ORIGIN must contain only scheme and authority, without a path, query, or fragment." >&2; exit 1 ;;
    esac
    if [ -n "$web_app_id" ]; then
      case "$redirect_uri" in
        "$app_origin"|"$app_origin"/*) ;;
        *) echo "WECHAT_WEB_REDIRECT_URI must use HTTPS and have the same origin as APP_ORIGIN." >&2; exit 1 ;;
      esac
    fi
    if ! printf '%s' "$web_origins" | tr ',' '\n' | awk -v expected="$app_origin" '
      { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0); if ($0 == expected) found = 1 }
      END { exit(found ? 0 : 1) }
    '; then
      echo "WEB_ORIGIN must include APP_ORIGIN exactly." >&2
      exit 1
    fi
  fi
}

if [ ! -f "$env_file" ]; then
  echo "Missing $env_file; create it from .env.docker.example first." >&2
  exit 1
fi
if grep -Eq '^(APP_VERSION|BUILD_SHA)=' "$env_file"; then
  echo "Remove APP_VERSION and BUILD_SHA from $env_file; release metadata must come from the immutable image." >&2
  exit 1
fi
validate_release_env
if [ "${ALLOW_DIRTY_RELEASE:-false}" != "true" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "Refusing to release a dirty worktree. Commit changes or set ALLOW_DIRTY_RELEASE=true explicitly." >&2
    exit 1
  fi
fi

head_sha="$(git rev-parse HEAD)"
if [ -n "${BUILD_SHA:-}" ] && [ "$BUILD_SHA" != "$head_sha" ]; then
  echo "BUILD_SHA does not match the checked-out commit." >&2
  exit 1
fi
build_sha="$head_sha"
image_tag="${1:-${IMAGE_TAG:-$(git rev-parse --short=12 HEAD)}}"
case "$image_tag" in
  latest|dev|*[!A-Za-z0-9._-]*|'')
    echo "Release tag must be immutable and contain only letters, digits, dot, underscore, or dash." >&2
    exit 2
    ;;
esac

tag_commit="$(git rev-parse -q --verify "refs/tags/${image_tag}^{commit}" 2>/dev/null || true)"
if [ -n "$tag_commit" ]; then
  if [ "$tag_commit" != "$head_sha" ]; then
    echo "Git tag ${image_tag} does not point to the checked-out commit." >&2
    exit 1
  fi
else
  case "$head_sha" in
    "$image_tag"*) ;;
    *)
      echo "Image tag must be a Git tag at HEAD or a prefix of the current commit SHA." >&2
      exit 1
      ;;
  esac
fi

export BUILD_SHA="$build_sha"
export IMAGE_TAG="$image_tag"
export APP_VERSION="${APP_VERSION:-$image_tag}"

if [ "${RELEASE_VALIDATE_ONLY:-false}" = "true" ]; then
  echo "Release configuration is valid for ${IMAGE_TAG} (${BUILD_SHA})."
  exit 0
fi

compose config --quiet

if [ -n "$(compose ps -a -q tangji-api)" ]; then
  COMPOSE_FILE="$compose_file" ENV_FILE="$env_file" "$root/docker/backup-sqlite.sh"
fi

echo "Building Tangji ${APP_VERSION} (${BUILD_SHA}) as image tag ${IMAGE_TAG}..."
compose build --pull
if [ "${PUSH_IMAGES:-false}" = "true" ]; then
  compose push
fi
compose up -d --no-build --remove-orphans --wait
compose ps

echo "Release ${IMAGE_TAG} is healthy. Keep the pre-release backup until the release is accepted."
