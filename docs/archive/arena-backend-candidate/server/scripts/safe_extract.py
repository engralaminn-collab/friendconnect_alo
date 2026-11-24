#!/usr/bin/env python3
"""Safely inspect/extract only the archive layouts produced by backup.sh."""
from __future__ import annotations

import os
import re
import shutil
import sys
import tarfile
from pathlib import Path

MAX_ARCHIVE_ENTRIES = 250_000
MAX_TOTAL_BYTES = 100 * 1024 * 1024 * 1024
PAYLOAD_FILES = {"database.sql.gz", "media.tar.gz", "metadata.txt"}
OBJECT_NAME = re.compile(r"^objects/([0-9a-f-]{36})$")


def copy_member(archive: tarfile.TarFile, member: tarfile.TarInfo, destination: Path) -> None:
    source = archive.extractfile(member)
    if source is None:
        raise ValueError("Archive member could not be read")
    with source, destination.open("xb") as output:
        shutil.copyfileobj(source, output, length=1024 * 1024)
    os.chmod(destination, 0o600)


def payload_members(archive: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members = archive.getmembers()
    if len(members) != len(PAYLOAD_FILES) or {member.name for member in members} != PAYLOAD_FILES:
        raise ValueError("Unexpected backup payload entries")
    if any(not member.isfile() or member.size > MAX_TOTAL_BYTES for member in members):
        raise ValueError("Backup payload contains a non-regular or oversized entry")
    if sum(member.size for member in members) > MAX_TOTAL_BYTES:
        raise ValueError("Backup payload is larger than the restore safety limit")
    return members


def safe_payload(archive_path: Path, destination: Path) -> None:
    with tarfile.open(archive_path, mode="r:gz") as archive:
        members = payload_members(archive)
        destination.mkdir(mode=0o700, parents=True, exist_ok=False)
        for member in members:
            copy_member(archive, member, destination / member.name)


def media_members(archive: tarfile.TarFile) -> list[tuple[tarfile.TarInfo, str]]:
    members = archive.getmembers()
    if not members or len(members) > MAX_ARCHIVE_ENTRIES:
        raise ValueError("Media archive entry count is invalid")
    total = sum(member.size for member in members if member.isfile())
    if total > MAX_TOTAL_BYTES:
        raise ValueError("Media archive is larger than the restore safety limit")
    saw_objects_dir = False
    seen_keys: set[str] = set()
    files: list[tuple[tarfile.TarInfo, str]] = []
    for member in members:
        normalized = member.name.rstrip("/")
        if normalized == "objects":
            if not member.isdir() or saw_objects_dir:
                raise ValueError("Media archive contains an invalid objects directory")
            saw_objects_dir = True
            continue
        match = OBJECT_NAME.fullmatch(normalized)
        if not match or not member.isfile():
            raise ValueError("Media archive contains an unexpected path or file type")
        key = match.group(1)
        if key in seen_keys:
            raise ValueError("Media archive contains a duplicate object key")
        seen_keys.add(key)
        files.append((member, key))
    if not saw_objects_dir:
        raise ValueError("Media archive is missing its objects directory")
    return files


def check_media(archive_path: Path) -> None:
    with tarfile.open(archive_path, mode="r:gz") as archive:
        media_members(archive)


def safe_media(archive_path: Path, destination: Path) -> None:
    with tarfile.open(archive_path, mode="r:gz") as archive:
        files = media_members(archive)
        destination.mkdir(mode=0o700, parents=True, exist_ok=False)
        objects = destination / "objects"
        objects.mkdir(mode=0o700)
        for member, key in files:
            copy_member(archive, member, objects / key)


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[1] not in {"payload", "media", "check-media"}:
        print("Usage: safe_extract.py payload|media|check-media ARCHIVE DESTINATION", file=sys.stderr)
        return 2
    mode, archive, destination = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    try:
        if mode == "payload":
            safe_payload(archive, destination)
        elif mode == "media":
            safe_media(archive, destination)
        else:
            check_media(archive)
    except (OSError, tarfile.TarError, ValueError) as error:
        print(f"Safe archive inspection failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
