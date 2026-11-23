import { unauthorized, forbidden } from './errors.js';
import { deriveCsrfToken, safeStringEqual } from '../security/tokens.js';

export function authenticate(authService, config) {
  return async (req, _res, next) => {
    try {
      const authorization = req.get('authorization');
      const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
      const cookieToken = req.cookies?.[config.sessionCookieName];
      const token = bearerToken || cookieToken;
      if (!token) throw unauthorized();
      const session = await authService.authenticateSessionToken(token);
      req.auth = {
        ...session,
        authMethod: bearerToken ? 'bearer' : 'cookie',
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireCsrf(config) {
  return (req, _res, next) => {
    if (req.auth?.authMethod === 'bearer') return next();
    const provided = req.get('x-csrf-token');
    const expected = req.auth?.sessionToken
      ? createExpectedCsrf(req.auth.sessionToken, config.csrfSecret)
      : '';
    if (!provided || !safeStringEqual(provided, expected)) return next(forbidden('CSRF_VALIDATION_FAILED'));
    if (config.isProduction) {
      const origin = req.get('origin');
      if (!origin || !config.corsOrigins.includes(origin)) return next(forbidden('ORIGIN_NOT_ALLOWED'));
    }
    next();
  };
}

function createExpectedCsrf(sessionToken, secret) {
  return deriveCsrfToken(sessionToken, secret);
}

export function requireAdmin(req, _res, next) {
  if (req.auth?.user?.role !== 'admin') return next(forbidden('ADMIN_REQUIRED'));
  next();
}

export function setSessionCookie(res, config, session) {
  res.cookie(config.sessionCookieName, session.sessionToken, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
    expires: new Date(session.expiresAt),
    priority: 'high',
  });
}

export function clearSessionCookie(res, config) {
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
  });
}
