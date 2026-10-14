import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/safe_extract.py', import.meta.url));
const validKey = '11111111-1111-4111-8111-111111111111';

function runSafeExtract(mode, archive, destination) {
  return spawnSync('python3', [script, mode, archive, destination], { encoding: 'utf8' });
}

test('backup extractor accepts only the signed backup payload layout and writes private files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'friendconnect-backup-test-'));
  try {
    const source = path.join(root, 'source');
    await mkdir(source);
    await writeFile(path.join(source, 'database.sql.gz'), 'gzip placeholder');
    await writeFile(path.join(source, 'media.tar.gz'), 'tar placeholder');
    await writeFile(path.join(source, 'metadata.txt'), 'format=friendconnect-backup-v1\n');
    const payload = path.join(root, 'payload.tar.gz');
    execFileSync('tar', ['-czf', payload, '-C', source, 'database.sql.gz', 'media.tar.gz', 'metadata.txt']);
    const extracted = path.join(root, 'extracted');
    const result = runSafeExtract('payload', payload, extracted);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(path.join(extracted, 'metadata.txt'), 'utf8'), 'format=friendconnect-backup-v1\n');
    assert.equal((await stat(path.join(extracted, 'metadata.txt'))).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('media extractor accepts UUID-keyed objects and rejects traversal and symlink members', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'friendconnect-media-archive-'));
  try {
    const mediaRoot = path.join(root, 'media');
    await mkdir(path.join(mediaRoot, 'objects'), { recursive: true });
    await writeFile(path.join(mediaRoot, 'objects', validKey), 'private attachment');
    const validArchive = path.join(root, 'valid-media.tar.gz');
    execFileSync('tar', ['-czf', validArchive, '-C', mediaRoot, 'objects']);
    const check = runSafeExtract('check-media', validArchive, 'unused');
    assert.equal(check.status, 0, check.stderr);
    const extracted = path.join(root, 'restored-media');
    const restore = runSafeExtract('media', validArchive, extracted);
    assert.equal(restore.status, 0, restore.stderr);
    assert.equal(await readFile(path.join(extracted, 'objects', validKey), 'utf8'), 'private attachment');

    const malicious = path.join(root, 'malicious.tar.gz');
    const python = [
      'import io, sys, tarfile',
      'with tarfile.open(sys.argv[1], "w:gz") as archive:',
      '  info = tarfile.TarInfo("objects/../../escape")',
      '  data = b"must not be extracted"',
      '  info.size = len(data)',
      '  archive.addfile(info, io.BytesIO(data))',
    ].join('\n');
    execFileSync('python3', ['-c', python, malicious]);
    const rejected = runSafeExtract('check-media', malicious, 'unused');
    assert.notEqual(rejected.status, 0);

    const symlink = path.join(root, 'symlink.tar.gz');
    const symlinkScript = [
      'import sys, tarfile',
      'with tarfile.open(sys.argv[1], "w:gz") as archive:',
      '  directory = tarfile.TarInfo("objects/")',
      '  directory.type = tarfile.DIRTYPE',
      '  archive.addfile(directory)',
      '  link = tarfile.TarInfo("objects/11111111-1111-4111-8111-111111111111")',
      '  link.type = tarfile.SYMTYPE',
      '  link.linkname = "/tmp/escape"',
      '  archive.addfile(link)',
    ].join('\n');
    execFileSync('python3', ['-c', symlinkScript, symlink]);
    const rejectedLink = runSafeExtract('check-media', symlink, 'unused');
    assert.notEqual(rejectedLink.status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
