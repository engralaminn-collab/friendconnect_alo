export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code, message) => new HttpError(400, code, message);
export const unauthorized = (code = 'UNAUTHENTICATED') => new HttpError(401, code);
export const forbidden = (code = 'FORBIDDEN') => new HttpError(403, code);
export const notFound = (code = 'NOT_FOUND') => new HttpError(404, code);
export const conflict = (code = 'CONFLICT') => new HttpError(409, code);
export const unavailable = (code = 'SERVICE_UNAVAILABLE') => new HttpError(503, code);

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function errorHandler(error, req, res, _next) {
  if (res.headersSent) return;
  let status = Number.isInteger(error?.status) ? error.status : 500;
  let code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR';
  if (error?.type === 'entity.too.large') { status = 413; code = 'REQUEST_TOO_LARGE'; }
  if (error?.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; }
  if (status >= 500) req.log?.error({ code: error?.code, requestId: req.id }, 'Request failed');
  res.status(status).json({ error: { code, requestId: req.id } });
}
