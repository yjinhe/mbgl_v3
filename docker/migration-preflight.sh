#!/usr/bin/env sh
set -eu

phase="${1:-before}"
app_root="${APP_ROOT:-/app}"
schema_path="${app_root}/apps/api/prisma/schema.prisma"
migrations_path="${app_root}/apps/api/prisma/migrations"
initial_migration="20260710000000_initial"
initial_sql="${migrations_path}/${initial_migration}/migration.sql"

case "${DATABASE_URL:-}" in
  file:*) ;;
  *)
    echo "[migration] DATABASE_URL must be a SQLite file URL in this image." >&2
    exit 1
    ;;
esac

database_url_without_query="${DATABASE_URL%%\?*}"
database_path="${database_url_without_query#file:}"
case "$database_path" in
  /*) ;;
  *) database_path="$(dirname "$schema_path")/$database_path" ;;
esac

if [ "$phase" = "before" ] && [ ! -f "$database_path" ]; then
  mkdir -p "$(dirname "$database_path")"
  sqlite3 "$database_path" 'PRAGMA user_version;' >/dev/null
  echo "[migration] Initialized an empty SQLite database file."
fi

run_diff() {
  pnpm --filter @tangji/api exec prisma migrate diff "$@" --exit-code
}

verify_sqlite() {
  [ -f "$database_path" ] || return 0

  quick_check="$(sqlite3 "$database_path" 'PRAGMA quick_check;')"
  if [ "$quick_check" != "ok" ]; then
    echo "[migration] SQLite quick_check failed: $quick_check" >&2
    exit 1
  fi

  foreign_key_errors="$(sqlite3 "$database_path" 'PRAGMA foreign_key_check;')"
  if [ -n "$foreign_key_errors" ]; then
    echo "[migration] SQLite foreign-key validation failed:" >&2
    echo "$foreign_key_errors" >&2
    exit 1
  fi
}

verify_sqlite

if [ "$phase" = "after" ]; then
  echo "[migration] Verifying migration status and drift against migration history..."
  pnpm --filter @tangji/api exec prisma migrate status
  shadow_directory="$(mktemp -d /tmp/tangji-shadow.XXXXXX)"
  trap 'rm -rf "$shadow_directory"' EXIT INT TERM
  if ! run_diff \
    --from-url "$DATABASE_URL" \
    --to-migrations "$migrations_path" \
    --shadow-database-url "file:$shadow_directory/shadow.db"; then
    echo "[migration] Database schema differs from the checked-in migration history." >&2
    exit 1
  fi
  verify_sqlite
  exit 0
fi

if [ "$phase" != "before" ]; then
  echo "Usage: migration-preflight.sh [before|after]" >&2
  exit 2
fi

[ -f "$database_path" ] || exit 0

managed="$(sqlite3 "$database_path" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='_prisma_migrations';")"
application_tables="$(sqlite3 "$database_path" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations';")"

pharmacy_customer_table="$(sqlite3 "$database_path" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='PharmacyCustomer';")"
if [ "$pharmacy_customer_table" = "1" ]; then
  user_id_column="$(sqlite3 "$database_path" "SELECT count(*) FROM pragma_table_info('PharmacyCustomer') WHERE name='userId';")"
  unbound_at_column="$(sqlite3 "$database_path" "SELECT count(*) FROM pragma_table_info('PharmacyCustomer') WHERE name='unboundAt';")"
  if [ "$user_id_column" = "1" ] && [ "$unbound_at_column" = "1" ]; then
    duplicate_active_users="$(sqlite3 "$database_path" "SELECT count(*) FROM (SELECT userId FROM PharmacyCustomer WHERE unboundAt IS NULL GROUP BY userId HAVING count(*) > 1);")"
    if [ "$duplicate_active_users" != "0" ]; then
      echo "[migration] Refusing migration: ${duplicate_active_users} user(s) have multiple active pharmacy bindings." >&2
      echo "[migration] Inspect with: SELECT userId, count(*) FROM PharmacyCustomer WHERE unboundAt IS NULL GROUP BY userId HAVING count(*) > 1;" >&2
      echo "[migration] After business review, keep one active binding per user and set unboundAt on the others, then back up and retry." >&2
      exit 1
    fi
  fi
fi

if [ "$managed" = "1" ]; then
  if [ "${BASELINE_INITIAL_MIGRATION:-false}" = "true" ]; then
    echo "[migration] Database is already migration-managed; ignoring the one-time baseline flag."
  fi
  exit 0
fi

if [ "$application_tables" = "0" ]; then
  if [ "${BASELINE_INITIAL_MIGRATION:-false}" = "true" ]; then
    echo "[migration] Database is empty; no baseline is needed."
  fi
  exit 0
fi

if [ "${BASELINE_INITIAL_MIGRATION:-false}" != "true" ]; then
  echo "[migration] Existing unmanaged tables detected." >&2
  echo "[migration] Back up the database, validate it, then explicitly set BASELINE_INITIAL_MIGRATION=true once." >&2
  exit 1
fi

baseline_database="$(mktemp /tmp/tangji-baseline.XXXXXX.db)"
trap 'rm -f "$baseline_database"' EXIT INT TERM
sqlite3 "$baseline_database" < "$initial_sql"

echo "[migration] Comparing the existing schema with the initial migration..."
if ! run_diff --from-url "$DATABASE_URL" --to-url "file:$baseline_database"; then
  echo "[migration] Refusing to baseline: the existing schema is not an exact match for the initial migration." >&2
  exit 1
fi

echo "[migration] Schema matches; recording the initial migration as applied."
pnpm --filter @tangji/api exec prisma migrate resolve --applied "$initial_migration"
