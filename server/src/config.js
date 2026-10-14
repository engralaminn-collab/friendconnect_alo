import path from 'node:path';
import { z } from 'zod';

const commaSeparated = (value) => value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
const originList = z.string().optional().transform(commaSeparated).pipe(z.array(z.string().url()));
const turnList = z.string().optional().transform(commaSeparated).pipe(
  z.array(z.string().regex(/^(stun|stuns|turn|turns):/i, 'TURN URLs must use stun:, stuns:, turn:, or turns:')),
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3210),
  HOST: z.string().default('0.0.0.0'),
  APP_ORIGIN: z.string().url().refine((value) => new URL(value).origin === value, 'APP_ORIGIN must be an origin without a path').default('http://localhost:3000'),
  CORS_ORIGINS: originList,
  TRUST_PROXY: z.string().default('false'),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default('friendconnect_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  SESSION_CSRF_SECRET: z.string().optional(),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().regex(/^[A-Za-z0-9_]+$/).default('friendconnect'),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  MEDIA_ROOT: z.string().default(new URL('../var/media', import.meta.url).pathname),
  MEDIA_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(100 * 1024 * 1024).default(25 * 1024 * 1024),
  USER_STORAGE_QUOTA_BYTES: z.coerce.number().int().min(1024 * 1024).default(1024 * 1024 * 1024),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_SECURE: z.enum(['true', 'false']).default('true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),
  TURN_URLS: turnList,
  TURN_SHARED_SECRET: z.string().optional(),
  TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

function parseTrustProxy(value) {
  if (value === 'true') return true;
  if (value === 'false' || value === '') return false;
  if (/^\d+$/.test(value)) return Number(value);
  throw new Error('TRUST_PROXY must be true, false, or a numeric hop count.');
}

export function readConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid server configuration: ${details}`);
  }

  const value = parsed.data;
  const isProduction = value.NODE_ENV === 'production';
  const corsOrigins = value.CORS_ORIGINS?.length ? value.CORS_ORIGINS : [value.APP_ORIGIN];
  const productionRequirements = isProduction ? [
    ['PORT (must be explicitly assigned after checking the target host)', env.PORT],
    ['DB_HOST', env.DB_HOST],
    ['DB_NAME', env.DB_NAME],
    ['DB_USER', value.DB_USER],
    ['DB_PASSWORD', value.DB_PASSWORD],
    ['MEDIA_ROOT (outside the release directory)', env.MEDIA_ROOT],
    ['TRUST_PROXY (set to the verified Caddy hop count)', env.TRUST_PROXY],
    ['SESSION_CSRF_SECRET', value.SESSION_CSRF_SECRET],
    ['SMTP_HOST', value.SMTP_HOST],
    ['SMTP_PORT', value.SMTP_PORT],
    ['SMTP_USER', value.SMTP_USER],
    ['SMTP_PASSWORD', value.SMTP_PASSWORD],
    ['SMTP_FROM', value.SMTP_FROM],
    ['CLAMAV_HOST', value.CLAMAV_HOST],
    ['TURN_URLS', value.TURN_URLS?.length ? 'configured' : undefined],
    ['TURN_SHARED_SECRET', value.TURN_SHARED_SECRET],
    ['VAPID_PUBLIC_KEY', value.VAPID_PUBLIC_KEY],
    ['VAPID_PRIVATE_KEY', value.VAPID_PRIVATE_KEY],
    ['VAPID_SUBJECT', value.VAPID_SUBJECT],
  ] : [];
  const missing = productionRequirements.filter(([, configured]) => !configured).map(([name]) => name);
  if (isProduction && value.CORS_ORIGINS?.some((origin) => new URL(origin).origin !== origin || !origin.startsWith('https://'))) {
    missing.push('CORS_ORIGINS (each entry must be an HTTPS origin without a path)');
  }
  if (isProduction && (!/^\d+$/.test(value.TRUST_PROXY) || Number(value.TRUST_PROXY) < 1)) {
    missing.push('TRUST_PROXY (positive, verified Caddy hop count required)');
  }
  if (isProduction && value.HOST !== '127.0.0.1') {
    missing.push('HOST=127.0.0.1 (bind the API privately behind Caddy)');
  }
  if (isProduction) {
    const resolvedMediaRoot = path.resolve(value.MEDIA_ROOT);
    const resolvedWorkingDirectory = path.resolve(process.cwd());
    if (!path.isAbsolute(value.MEDIA_ROOT) || resolvedMediaRoot === path.parse(resolvedMediaRoot).root
      || resolvedMediaRoot === resolvedWorkingDirectory || resolvedMediaRoot.startsWith(`${resolvedWorkingDirectory}${path.sep}`)) {
      missing.push('MEDIA_ROOT (absolute private data path outside the release directory)');
    }
  }
  if (isProduction && !value.TURN_URLS?.some((url) => /^turns?:/i.test(url))) {
    missing.push('TURN_URLS (at least one TURN or TURNS URL required)');
  }
  if (isProduction && value.SESSION_CSRF_SECRET
    && (value.SESSION_CSRF_SECRET.length < 32 || /development|replace|placeholder/i.test(value.SESSION_CSRF_SECRET))) {
    missing.push('SESSION_CSRF_SECRET (must be a unique random secret of at least 32 characters)');
  }
  if (isProduction && value.TURN_SHARED_SECRET
    && (value.TURN_SHARED_SECRET.length < 32 || /development|replace|placeholder|change.?me/i.test(value.TURN_SHARED_SECRET))) {
    missing.push('TURN_SHARED_SECRET (must be a unique random secret of at least 32 characters)');
  }
  if (isProduction && value.DB_PASSWORD
    && (value.DB_PASSWORD.length < 16 || /development|replace|placeholder|change.?me|password/i.test(value.DB_PASSWORD))) {
    missing.push('DB_PASSWORD (must be a strong unique password of at least 16 characters)');
  }
  if (isProduction && value.SMTP_PASSWORD && /development|replace|placeholder|change.?me/i.test(value.SMTP_PASSWORD)) {
    missing.push('SMTP_PASSWORD (replace the example value)');
  }
  if (isProduction && (value.SMTP_HOST?.includes('.invalid') || value.SMTP_FROM?.endsWith('.invalid') || value.VAPID_SUBJECT?.endsWith('.invalid'))) {
    missing.push('SMTP/VAPID contact values must not use the example.invalid domain');
  }
  if (isProduction && (!value.CORS_ORIGINS?.length || value.CORS_ORIGINS.includes('*'))) {
    missing.push('CORS_ORIGINS (explicit HTTPS origins required; wildcard is forbidden)');
  }
  if (isProduction && !value.APP_ORIGIN.startsWith('https://')) {
    missing.push('APP_ORIGIN (HTTPS required)');
  }
  if (isProduction && value.SMTP_SECURE !== 'true') {
    missing.push('SMTP_SECURE=true');
  }
  if (isProduction && missing.length) {
    throw new Error(`Production configuration is incomplete: ${[...new Set(missing)].join(', ')}`);
  }

  return Object.freeze({
    mode: value.NODE_ENV,
    isProduction,
    port: value.PORT,
    host: value.HOST,
    appOrigin: value.APP_ORIGIN,
    corsOrigins,
    trustProxy: parseTrustProxy(value.TRUST_PROXY),
    sessionCookieName: value.SESSION_COOKIE_NAME,
    sessionTtlDays: value.SESSION_TTL_DAYS,
    csrfSecret: value.SESSION_CSRF_SECRET || 'development-only-csrf-secret-change-before-deploy',
    database: Object.freeze({
      host: value.DB_HOST,
      port: value.DB_PORT,
      name: value.DB_NAME,
      user: value.DB_USER || 'friendconnect_dev',
      password: value.DB_PASSWORD || '',
      connectionLimit: value.DB_CONNECTION_LIMIT,
    }),
    media: Object.freeze({
      root: value.MEDIA_ROOT,
      maxUploadBytes: value.MEDIA_MAX_UPLOAD_BYTES,
      userQuotaBytes: value.USER_STORAGE_QUOTA_BYTES,
    }),
    clamav: Object.freeze({
      host: value.CLAMAV_HOST,
      port: value.CLAMAV_PORT,
      timeoutMs: value.CLAMAV_TIMEOUT_MS,
    }),
    smtp: Object.freeze({
      host: value.SMTP_HOST,
      port: value.SMTP_PORT,
      secure: value.SMTP_SECURE === 'true',
      user: value.SMTP_USER,
      password: value.SMTP_PASSWORD,
      from: value.SMTP_FROM,
    }),
    turn: Object.freeze({
      urls: value.TURN_URLS ?? [],
      sharedSecret: value.TURN_SHARED_SECRET,
      credentialTtlSeconds: value.TURN_CREDENTIAL_TTL_SECONDS,
    }),
    webPush: Object.freeze({
      publicKey: value.VAPID_PUBLIC_KEY,
      privateKey: value.VAPID_PRIVATE_KEY,
      subject: value.VAPID_SUBJECT,
    }),
    logLevel: value.LOG_LEVEL,
  });
}
