import { randomUUID } from 'node:crypto';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { createApiRouter } from './http/routes.js';
import { errorHandler, forbidden, notFound } from './http/errors.js';

export function createApp(dependencies) {
  const { config, logger } = dependencies;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(pinoHttp({
    logger,
    genReqId: () => randomUUID(),
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        path: (req.url || '').split('?')[0],
        remoteAddress: req.remoteAddress,
      }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: { ignore: (req) => req.url === '/health/live' },
  }));

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    maxAge: 600,
  }));
  app.use((req, _res, next) => {
    const origin = req.get('origin');
    if (origin && !config.corsOrigins.includes(origin)) return next(forbidden('ORIGIN_NOT_ALLOWED'));
    if (req.get('sec-fetch-site') === 'cross-site') return next(forbidden('CROSS_SITE_REQUEST_BLOCKED'));
    next();
  });
  app.use(cookieParser());
  app.use(express.json({ limit: '64kb', strict: true, type: ['application/json', 'application/*+json'] }));
  app.use((req, res, next) => {
    req.id ||= randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  });

  app.get('/health/live', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'live' });
  });
  app.use('/api', createApiRouter(dependencies));
  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}
