import 'dotenv/config';
import { createServer } from 'node:http';
import pino from 'pino';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { AuthRepository } from './db/auth-repository.js';
import { CallRepository } from './db/call-repository.js';
import { ChatRepository } from './db/chat-repository.js';
import { createPool, checkDatabase } from './db/pool.js';
import { MediaRepository } from './db/media-repository.js';
import { NotificationRepository } from './db/notification-repository.js';
import { createAuthService } from './services/auth.js';
import { createCallService } from './services/calls.js';
import { createChatService } from './services/chat.js';
import { createMailer } from './services/mailer.js';
import { createMediaService } from './services/media.js';
import { createNotificationService } from './services/notifications.js';
import { createRealtimeGateway } from './realtime/socket.js';

const config = readConfig();
const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.x-csrf-token',
      'res.headers.set-cookie',
      '*.password',
      '*.sessionToken',
      '*.token',
      '*.credential',
    ],
    censor: '[REDACTED]',
  },
});
const pool = createPool(config.database);
const authRepository = new AuthRepository(pool);
const chatRepository = new ChatRepository(pool);
const callRepository = new CallRepository(pool);
const mediaRepository = new MediaRepository(pool, config.media.userQuotaBytes);
const notificationRepository = new NotificationRepository(pool);
const gateway = createRealtimeGateway();
const mailer = createMailer(config.smtp, config.appOrigin);
const notificationService = createNotificationService({ repository: notificationRepository, config, gateway, logger });
const mediaService = await createMediaService({ repository: mediaRepository, config, logger });
const chatService = createChatService({ repository: chatRepository, notificationService, gateway });
const callService = createCallService({ repository: callRepository, notificationService, gateway, turnConfig: config.turn, logger });
const authService = await createAuthService({ repository: authRepository, mailer, config, gateway, logger });
const dependencies = {
  config,
  logger,
  pool,
  authRepository,
  chatRepository,
  authService,
  chatService,
  callService,
  notificationService,
  mediaService,
  gateway,
};

await checkDatabase(pool);
const app = createApp(dependencies);
const httpServer = createServer(app);
gateway.attach(httpServer, dependencies);
await new Promise((resolve, reject) => {
  httpServer.once('error', reject);
  httpServer.listen(config.port, config.host, resolve);
});
logger.info({ host: config.host, port: config.port, mode: config.mode }, 'FriendConnect API listening');

await callService.expireCalls();
const expiryTimer = setInterval(() => { void callService.expireCalls(); }, 5000);
expiryTimer.unref();

let stopping;
async function shutdown(signal) {
  if (stopping) return stopping;
  stopping = (async () => {
    logger.info({ signal }, 'Graceful shutdown started');
    clearInterval(expiryTimer);
    await gateway.close();
    await pool.end();
  })();
  return stopping;
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    void shutdown(signal).then(() => process.exit(0)).catch((error) => {
      logger.error({ code: error?.code }, 'Graceful shutdown failed');
      process.exit(1);
    });
  });
}

process.on('unhandledRejection', (error) => {
  logger.fatal({ code: error?.code }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection').finally(() => process.exit(1));
});
