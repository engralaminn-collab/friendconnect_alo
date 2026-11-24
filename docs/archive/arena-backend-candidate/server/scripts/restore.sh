#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  echo 'Usage: restore.sh /path/to/friendconnect-*.tar.gz.age [--apply]' >&2
  echo 'Default behavior verifies the encrypted archive only; --apply restores to an empty disposable database and new media directory.' >&2
}

[[ $# -ge 1 && $# -le 2 ]] || { usage; exit 2; }
ARCHIVE="$(realpath -e "$1")"
APPLY="${2:-}"
[[ -z "$APPLY" || "$APPLY" == '--apply' ]] || { usage; exit 2; }
: "${BACKUP_AGE_IDENTITY:?Set BACKUP_AGE_IDENTITY to the private age identity file outside the repository}"
: "${BACKUP_SIGNING_PUBLIC_KEY:?Set BACKUP_SIGNING_PUBLIC_KEY to the trusted Ed25519 public key outside the backup store}"
BACKUP_AGE_IDENTITY="$(realpath -e "$BACKUP_AGE_IDENTITY")"
BACKUP_SIGNING_PUBLIC_KEY="$(realpath -e "$BACKUP_SIGNING_PUBLIC_KEY")"
[[ -f "$BACKUP_AGE_IDENTITY" ]] || { echo 'BACKUP_AGE_IDENTITY must be a regular file.' >&2; exit 1; }
[[ -f "$BACKUP_SIGNING_PUBLIC_KEY" ]] || { echo 'BACKUP_SIGNING_PUBLIC_KEY must be a regular trusted public key file.' >&2; exit 1; }
mode="$(stat -c '%a' "$BACKUP_AGE_IDENTITY")"
[[ "$mode" == '600' || "$mode" == '400' ]] || { echo 'BACKUP_AGE_IDENTITY must have mode 0600 or 0400.' >&2; exit 1; }
for command in age tar gzip sha256sum realpath stat openssl python3; do
  command -v "$command" >/dev/null || { echo "Required command is missing: $command" >&2; exit 1; }
done

archive_dir="$(dirname "$ARCHIVE")"
archive_name="$(basename "$ARCHIVE")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
case "$BACKUP_AGE_IDENTITY" in
  "$REPO_ROOT/"*) echo 'BACKUP_AGE_IDENTITY must be stored outside the Git repository.' >&2; exit 1 ;;
esac
case "$BACKUP_SIGNING_PUBLIC_KEY" in
  "$REPO_ROOT/"*|"$archive_dir/"*) echo 'BACKUP_SIGNING_PUBLIC_KEY must be trusted out-of-band, outside the repository and backup directory.' >&2; exit 1 ;;
esac
[[ "$archive_name" == friendconnect-*.tar.gz.age ]] || { echo 'Unexpected backup filename.' >&2; exit 1; }
[[ -f "$ARCHIVE.sha256" ]] || { echo 'Checksum sidecar is required.' >&2; exit 1; }
[[ -f "$ARCHIVE.sig" ]] || { echo 'Backup signature is required.' >&2; exit 1; }
openssl pkeyutl -verify -pubin -rawin -inkey "$BACKUP_SIGNING_PUBLIC_KEY" \
  -in "$ARCHIVE" -sigfile "$ARCHIVE.sig" >/dev/null 2>&1 || {
  echo 'Backup signature is invalid or does not match the trusted signing key.' >&2
  exit 1
}
(
  cd "$archive_dir"
  sha256sum --status -c "$archive_name.sha256"
) || { echo 'Encrypted backup checksum does not match.' >&2; exit 1; }

work="$(mktemp -d)"
chmod 700 "$work"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT
age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "$work/payload.tar.gz" "$ARCHIVE"
python3 "$(dirname "${BASH_SOURCE[0]}")/safe_extract.py" payload "$work/payload.tar.gz" "$work/extracted"
[[ -s "$work/extracted/database.sql.gz" && -s "$work/extracted/media.tar.gz" && -s "$work/extracted/metadata.txt" ]] || {
  echo 'Backup archive is missing a required payload.' >&2
  exit 1
}
gzip -t "$work/extracted/database.sql.gz"
python3 "$(dirname "${BASH_SOURCE[0]}")/safe_extract.py" check-media "$work/extracted/media.tar.gz" unused
grep -qx 'format=friendconnect-backup-v1' "$work/extracted/metadata.txt"

if [[ "$APPLY" != '--apply' ]]; then
  echo 'Backup verification passed: checksum, decryption, database gzip, media tar, and metadata are valid.'
  echo 'No database or media files were changed. Run with --apply only for an empty, disposable restore target.'
  exit 0
fi

: "${MYSQL_CNF_FILE:?Set MYSQL_CNF_FILE to a 0600 MySQL client option file outside the repository}"
: "${RESTORE_DATABASE:?Set RESTORE_DATABASE to an already-created, empty disposable MySQL database}"
: "${RESTORE_MEDIA_ROOT:?Set RESTORE_MEDIA_ROOT to a new media directory that does not exist}"
for command in mysql; do
  command -v "$command" >/dev/null || { echo "Required command is missing: $command" >&2; exit 1; }
done
MYSQL_CNF_FILE="$(realpath -e "$MYSQL_CNF_FILE")"
[[ -f "$MYSQL_CNF_FILE" ]] || { echo 'MYSQL_CNF_FILE must be a regular file.' >&2; exit 1; }
mode="$(stat -c '%a' "$MYSQL_CNF_FILE")"
[[ "$mode" == '600' || "$mode" == '400' ]] || { echo 'MYSQL_CNF_FILE must have mode 0600 or 0400.' >&2; exit 1; }
[[ "$RESTORE_DATABASE" =~ ^[A-Za-z0-9_]+$ ]] || { echo 'RESTORE_DATABASE contains invalid characters.' >&2; exit 1; }
RESTORE_MEDIA_ROOT="$(realpath -m "$RESTORE_MEDIA_ROOT")"
[[ ! -e "$RESTORE_MEDIA_ROOT" ]] || { echo 'RESTORE_MEDIA_ROOT must not already exist; refusing to overwrite files.' >&2; exit 1; }

case "$RESTORE_MEDIA_ROOT/" in
  "$REPO_ROOT/"*) echo 'RESTORE_MEDIA_ROOT must be outside the Git repository.' >&2; exit 1 ;;
esac
if [[ -n "${DB_NAME:-}" && "$RESTORE_DATABASE" == "$DB_NAME" ]]; then
  echo 'Restore to the configured live DB_NAME is refused. Use a disposable database for restore verification.' >&2
  exit 1
fi
[[ "${RESTORE_CONFIRM:-}" == "RESTORE_TO_${RESTORE_DATABASE}" ]] || {
  echo "Set RESTORE_CONFIRM=RESTORE_TO_${RESTORE_DATABASE} to confirm this disposable restore target." >&2
  exit 1
}

table_count="$(mysql --defaults-extra-file="$MYSQL_CNF_FILE" --database="$RESTORE_DATABASE" --batch --skip-column-names \
  --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()")"
[[ "$table_count" == '0' ]] || { echo 'RESTORE_DATABASE is not empty; refusing to overwrite it.' >&2; exit 1; }

python3 "$(dirname "${BASH_SOURCE[0]}")/safe_extract.py" media "$work/extracted/media.tar.gz" "$RESTORE_MEDIA_ROOT"
gzip -dc "$work/extracted/database.sql.gz" | mysql --defaults-extra-file="$MYSQL_CNF_FILE" --database="$RESTORE_DATABASE"
restored_tables="$(mysql --defaults-extra-file="$MYSQL_CNF_FILE" --database="$RESTORE_DATABASE" --batch --skip-column-names \
  --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()")"
[[ "$restored_tables" =~ ^[0-9]+$ && "$restored_tables" -gt 0 ]] || { echo 'Restore import completed but no database tables were found.' >&2; exit 1; }
[[ -d "$RESTORE_MEDIA_ROOT/objects" ]] || { echo 'Restore import completed but media/objects is missing.' >&2; exit 1; }
chmod 700 "$RESTORE_MEDIA_ROOT" "$RESTORE_MEDIA_ROOT/objects"
echo "Disposable restore verified: database '$RESTORE_DATABASE' has $restored_tables tables and media objects were extracted to the new path."
