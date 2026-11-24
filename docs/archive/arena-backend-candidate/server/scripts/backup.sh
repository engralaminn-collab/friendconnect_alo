#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${BACKUP_ROOT:?Set BACKUP_ROOT to a private backup directory outside the release/repository}"
: "${MEDIA_ROOT:?Set MEDIA_ROOT to the FriendConnect private media directory}"
: "${MYSQL_CNF_FILE:?Set MYSQL_CNF_FILE to a 0600 MySQL client option file outside the repository}"
: "${DB_NAME:?Set DB_NAME to the FriendConnect database}"
: "${BACKUP_AGE_RECIPIENT:?Set BACKUP_AGE_RECIPIENT to the age recipient public key}"
: "${BACKUP_SIGNING_PRIVATE_KEY:?Set BACKUP_SIGNING_PRIVATE_KEY to a protected Ed25519 private key outside the repository}"
: "${BACKUP_REMOTE:?Set BACKUP_REMOTE to a configured off-host rclone destination}"

for command in mysqldump tar gzip age sha256sum rclone realpath stat openssl; do
  command -v "$command" >/dev/null || { echo "Required command is missing: $command" >&2; exit 1; }
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_ROOT="$(realpath -m "$BACKUP_ROOT")"
MEDIA_ROOT="$(realpath -e "$MEDIA_ROOT")"
MYSQL_CNF_FILE="$(realpath -e "$MYSQL_CNF_FILE")"
BACKUP_SIGNING_PRIVATE_KEY="$(realpath -e "$BACKUP_SIGNING_PRIVATE_KEY")"
case "$BACKUP_ROOT/" in
  "$REPO_ROOT/"*) echo 'BACKUP_ROOT must be outside the Git repository.' >&2; exit 1 ;;
esac
case "$MEDIA_ROOT/" in
  "$REPO_ROOT/"*) echo 'MEDIA_ROOT must be outside the Git repository.' >&2; exit 1 ;;
esac
case "$MYSQL_CNF_FILE" in
  "$REPO_ROOT/"*) echo 'MYSQL_CNF_FILE must be stored outside the Git repository.' >&2; exit 1 ;;
esac
case "$BACKUP_SIGNING_PRIVATE_KEY" in
  "$REPO_ROOT/"*|"$BACKUP_ROOT/"*) echo 'The signing private key must be stored outside the repository and backup directory.' >&2; exit 1 ;;
esac
[[ -d "$BACKUP_ROOT" ]] || { mkdir -p -- "$BACKUP_ROOT"; chmod 700 -- "$BACKUP_ROOT"; }
[[ "$(stat -c '%a' "$BACKUP_ROOT")" == '700' ]] || { echo 'BACKUP_ROOT must have mode 0700 because it holds temporary plaintext exports.' >&2; exit 1; }
[[ -d "$MEDIA_ROOT/objects" ]] || { echo 'MEDIA_ROOT/objects is missing.' >&2; exit 1; }
[[ -f "$MYSQL_CNF_FILE" ]] || { echo 'MYSQL_CNF_FILE must be a regular file.' >&2; exit 1; }
mode="$(stat -c '%a' "$MYSQL_CNF_FILE")"
[[ "$mode" == '600' || "$mode" == '400' ]] || { echo 'MYSQL_CNF_FILE must have mode 0600 or 0400.' >&2; exit 1; }
[[ -f "$BACKUP_SIGNING_PRIVATE_KEY" ]] || { echo 'BACKUP_SIGNING_PRIVATE_KEY must be a regular file.' >&2; exit 1; }
mode="$(stat -c '%a' "$BACKUP_SIGNING_PRIVATE_KEY")"
[[ "$mode" == '600' || "$mode" == '400' ]] || { echo 'BACKUP_SIGNING_PRIVATE_KEY must have mode 0600 or 0400.' >&2; exit 1; }
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || { echo 'DB_NAME contains invalid characters.' >&2; exit 1; }
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
[[ "$BACKUP_KEEP_DAYS" =~ ^[0-9]+$ ]] || { echo 'BACKUP_KEEP_DAYS must be an integer.' >&2; exit 1; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
work="$(mktemp -d "$BACKUP_ROOT/.friendconnect-backup.XXXXXX")"
archive="$BACKUP_ROOT/friendconnect-${stamp}.tar.gz.age"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT

mysqldump \
  --defaults-extra-file="$MYSQL_CNF_FILE" \
  --single-transaction --routines --triggers --events --hex-blob \
  --default-character-set=utf8mb4 --set-gtid-purged=OFF \
  "$DB_NAME" | gzip -n -c > "$work/database.sql.gz"

tar --numeric-owner --xattrs --acls -czf "$work/media.tar.gz" -C "$MEDIA_ROOT" objects
cat > "$work/metadata.txt" <<EOF
format=friendconnect-backup-v1
created_utc=$stamp
database=$DB_NAME
media_archive=media.tar.gz
EOF
tar -czf "$work/payload.tar.gz" -C "$work" database.sql.gz media.tar.gz metadata.txt
age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$work/encrypted.age" "$work/payload.tar.gz"
mv -- "$work/encrypted.age" "$archive"
openssl pkeyutl -sign -rawin -inkey "$BACKUP_SIGNING_PRIVATE_KEY" \
  -in "$archive" -out "$archive.sig"
(
  cd "$BACKUP_ROOT"
  sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256"
)

remote_base="${BACKUP_REMOTE%/}"
rclone copyto "$archive" "$remote_base/$(basename "$archive")"
rclone copyto "$archive.sha256" "$remote_base/$(basename "$archive").sha256"
rclone copyto "$archive.sig" "$remote_base/$(basename "$archive").sig"

find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'friendconnect-*.tar.gz.age' -mtime "+$BACKUP_KEEP_DAYS" -delete
find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'friendconnect-*.tar.gz.age.sha256' -mtime "+$BACKUP_KEEP_DAYS" -delete
find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'friendconnect-*.tar.gz.age.sig' -mtime "+$BACKUP_KEEP_DAYS" -delete
printf 'Encrypted and signed database/media backup created and copied off-host: %s\n' "$(basename "$archive")"
