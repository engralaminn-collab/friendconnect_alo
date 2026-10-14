import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanWithClamAv, createMediaService, sanitizeFilename } from '../src/services/media.js';

function startFakeClamAv(verdict) {
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let commandRead = false;
    let expectedLength = null;
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!commandRead) {
        const end = buffer.indexOf(0);
        if (end === -1) return;
        assert.equal(buffer.subarray(0, end).toString('ascii'), 'zINSTREAM');
        buffer = buffer.subarray(end + 1);
        commandRead = true;
      }
      while (commandRead) {
        if (expectedLength === null) {
          if (buffer.length < 4) return;
          expectedLength = buffer.readUInt32BE(0);
          buffer = buffer.subarray(4);
          if (expectedLength === 0) {
            socket.end(verdict);
            return;
          }
        }
        if (buffer.length < expectedLength) return;
        buffer = buffer.subarray(expectedLength);
        expectedLength = null;
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

const scannerConfig = (port) => ({ host: '127.0.0.1', port, timeoutMs: 3000 });

test('ClamAV scanner fails closed when it is not configured', async () => {
  await assert.rejects(scanWithClamAv('/not/used', { host: undefined }), (error) => error.code === 'MALWARE_SCANNER_NOT_CONFIGURED');
});

test('ClamAV INSTREAM protocol streams content and rejects infected files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'friendconnect-clam-'));
  const file = path.join(root, 'sample.bin');
  await writeFile(file, Buffer.from('test upload content'));
  const ok = await startFakeClamAv('stream: OK\0');
  const infected = await startFakeClamAv('stream: Eicar-Test-Signature FOUND\0');
  try {
    assert.equal(await scanWithClamAv(file, scannerConfig(ok.port)), true);
    await assert.rejects(
      scanWithClamAv(file, scannerConfig(infected.port)),
      (error) => error.code === 'INFECTED_FILE',
    );
  } finally {
    await Promise.all([
      new Promise((resolve) => ok.server.close(resolve)),
      new Promise((resolve) => infected.server.close(resolve)),
    ]);
    await rm(root, { recursive: true, force: true });
  }
});

test('private media uses magic MIME detection, randomized object keys, and restrictive permissions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'friendconnect-media-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWf8AAAAASUVORK5CYII=', 'base64');
  const fakeClam = await startFakeClamAv('stream: OK\0');
  const repoCalls = [];
  const repository = {
    async createAttachment(attachment) {
      repoCalls.push(attachment);
      return { attachment: { id: attachment.id, storageKey: attachment.storageKey, byteSize: attachment.byteSize, detectedMime: attachment.detectedMime } };
    },
    async getAuthorizedAttachment() { return null; },
  };
  const service = await createMediaService({
    repository,
    config: {
      media: { root, maxUploadBytes: 1024 * 1024 },
      clamav: scannerConfig(fakeClam.port),
    },
    logger: { error() {} },
  });
  const quarantine = path.join(service.quarantineRoot, 'random.incoming');
  await mkdir(service.quarantineRoot, { recursive: true });
  await writeFile(quarantine, png);
  try {
    const result = await service.storeUpload(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      { path: quarantine, originalname: '../../unsafe.exe' },
    );
    assert.equal(result.kind, 'image');
    assert.equal(repoCalls[0].detectedMime, 'image/png');
    assert.equal(repoCalls[0].originalName, 'unsafe.exe');
    assert.equal(repoCalls[0].sha256.length, 32);
    assert.match(repoCalls[0].storageKey, /^[0-9a-f-]{36}$/i);
    const storedPath = path.join(root, 'objects', repoCalls[0].storageKey);
    assert.deepEqual(await readFile(storedPath), png);
    assert.equal((await stat(storedPath)).mode & 0o777, 0o600);
    assert.equal(sanitizeFilename('../../..'), 'file');
  } finally {
    await new Promise((resolve) => fakeClam.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
