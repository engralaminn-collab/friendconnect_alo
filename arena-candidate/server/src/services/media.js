import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, rename, rm, stat } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileTypeFromFile } from 'file-type';
import { badRequest, forbidden, notFound, unavailable } from '../http/errors.js';

const allowedMimeTypes = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export function sanitizeFilename(input) {
  const name = path.basename(String(input || 'file').replaceAll('\\', '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return name || 'file';
}

async function writeChunk(socket, buffer) {
  if (!socket.write(buffer)) await once(socket, 'drain');
}

export async function scanWithClamAv(filePath, scannerConfig) {
  if (!scannerConfig.host) throw unavailable('MALWARE_SCANNER_NOT_CONFIGURED');
  const socket = net.createConnection({ host: scannerConfig.host, port: scannerConfig.port });
  socket.setTimeout(scannerConfig.timeoutMs);
  let response = '';
  let settled = false;
  let resolveResponse;
  let rejectResponse;
  const verdict = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  const fail = (error) => {
    if (settled) return;
    settled = true;
    rejectResponse(error);
  };
  socket.on('data', (chunk) => {
    response += chunk.toString('utf8');
    if (response.includes('\0') || response.includes('\n')) {
      if (settled) return;
      settled = true;
      resolveResponse(response.trim().replace(/\0/g, ''));
    }
  });
  socket.on('error', fail);
  socket.on('timeout', () => fail(new Error('ClamAV scan timed out')));

  try {
    await once(socket, 'connect');
    await writeChunk(socket, Buffer.from('zINSTREAM\0', 'ascii'));
    for await (const chunk of createReadStream(filePath)) {
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(chunk.length);
      await writeChunk(socket, length);
      await writeChunk(socket, chunk);
    }
    await writeChunk(socket, Buffer.alloc(4));
    const result = await verdict;
    if (/FOUND\s*$/.test(result)) throw badRequest('INFECTED_FILE');
    if (!/OK\s*$/.test(result)) throw unavailable('MALWARE_SCAN_FAILED');
    return true;
  } catch (error) {
    if (error?.status) throw error;
    throw unavailable('MALWARE_SCANNER_UNAVAILABLE');
  } finally {
    socket.destroy();
  }
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest();
}

function kindForMime(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

export async function createMediaService({ repository, config, logger = console }) {
  const mediaRoot = path.resolve(config.media.root);
  if (mediaRoot === path.parse(mediaRoot).root) throw new Error('MEDIA_ROOT cannot be a filesystem root.');
  const quarantineRoot = path.join(mediaRoot, '.quarantine');
  const objectRoot = path.join(mediaRoot, 'objects');

  let rootInfo = await lstat(mediaRoot).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!rootInfo) {
    await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
    rootInfo = await lstat(mediaRoot);
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('MEDIA_ROOT must be a real directory, not a symlink.');
  if ((rootInfo.mode & 0o077) !== 0) throw new Error('MEDIA_ROOT must be private (mode 0700 or stricter).');
  for (const directory of [quarantineRoot, objectRoot]) {
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('Media subdirectories must be real directories.');
    await chmod(directory, 0o700);
  }

  return Object.freeze({
    quarantineRoot,
    maxUploadBytes: config.media.maxUploadBytes,

    async storeUpload(userId, conversationId, uploadedFile) {
      if (!uploadedFile?.path) throw badRequest('FILE_REQUIRED');
      let finalPath;
      let sourcePath;
      try {
        sourcePath = path.resolve(uploadedFile.path);
        if (!sourcePath.startsWith(`${quarantineRoot}${path.sep}`)) throw badRequest('INVALID_UPLOAD_TEMP_PATH');
        const info = await stat(sourcePath);
        if (!info.isFile() || info.size < 1 || info.size > config.media.maxUploadBytes) throw badRequest('INVALID_FILE_SIZE');
        await scanWithClamAv(uploadedFile.path, config.clamav);
        const detected = await fileTypeFromFile(uploadedFile.path);
        if (!detected || !allowedMimeTypes.has(detected.mime)) throw badRequest('UNSUPPORTED_FILE_TYPE');
        const originalName = sanitizeFilename(uploadedFile.originalname);
        const byteSize = info.size;
        const sha256 = await sha256File(uploadedFile.path);
        const id = randomUUID();
        const storageKey = randomUUID();
        finalPath = path.join(objectRoot, storageKey);
        await rename(sourcePath, finalPath);
        await chmod(finalPath, 0o600);
        const result = await repository.createAttachment({
          id,
          storageKey,
          conversationId,
          uploaderId: userId,
          originalName,
          detectedMime: detected.mime,
          byteSize,
          sha256,
        });
        if (result.error) {
          await rm(finalPath, { force: true });
          if (result.error === 'NOT_A_MEMBER') throw forbidden(result.error);
          if (result.error === 'QUOTA_EXCEEDED') throw badRequest(result.error);
          throw badRequest(result.error);
        }
        return { ...result.attachment, kind: kindForMime(detected.mime) };
      } catch (error) {
        if (finalPath && error?.status) await rm(finalPath, { force: true }).catch(() => {});
        if (error?.status) throw error;
        logger.error?.({ code: error?.code }, 'Private media upload failed');
        throw unavailable('MEDIA_UPLOAD_FAILED');
      } finally {
        if (sourcePath?.startsWith(`${quarantineRoot}${path.sep}`)) await rm(sourcePath, { force: true }).catch(() => {});
      }
    },

    async openDownload(userId, attachmentId) {
      const attachment = await repository.getAuthorizedAttachment(userId, attachmentId);
      if (!attachment) throw notFound('ATTACHMENT_NOT_FOUND');
      const storageKey = attachment.storageKey;
      if (!/^[0-9a-f-]{36}$/i.test(storageKey)) throw unavailable('MEDIA_STORAGE_ERROR');
      const absolutePath = path.join(objectRoot, storageKey);
      try {
        const info = await stat(absolutePath);
        if (!info.isFile() || info.size !== Number(attachment.byteSize)) throw new Error('Media object integrity mismatch');
      } catch {
        throw notFound('ATTACHMENT_NOT_FOUND');
      }
      return { attachment, absolutePath };
    },
  });
}
