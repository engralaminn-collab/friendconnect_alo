import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { badRequest } from './errors.js';

export function createUploadMiddleware(mediaService) {
  const storage = multer.diskStorage({
    destination: (req, _file, callback) => callback(null, mediaService.quarantineRoot),
    filename: (_req, _file, callback) => callback(null, `${randomUUID()}.incoming`),
  });
  const parser = multer({
    storage,
    limits: { fileSize: mediaService.maxUploadBytes, files: 1, fields: 0, parts: 1 },
  }).single('file');

  return (req, res, next) => parser(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      error.status = 413;
      error.code = 'FILE_TOO_LARGE';
      return next(error);
    }
    if (error instanceof multer.MulterError) return next(badRequest('INVALID_MULTIPART_UPLOAD'));
    return next(error);
  });
}
