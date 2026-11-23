import webpush from 'web-push';
import { badRequest, forbidden } from '../http/errors.js';

const trustedPushHosts = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);

function validateEndpoint(endpoint) {
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw badRequest('INVALID_PUSH_ENDPOINT');
  }
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password || !trustedPushHosts.has(parsed.hostname)) {
    throw badRequest('INVALID_PUSH_ENDPOINT');
  }
  return parsed.toString();
}

export function createNotificationService({ repository, config, gateway, logger = console }) {
  const pushEnabled = Boolean(config.webPush.publicKey && config.webPush.privateKey && config.webPush.subject);
  if (pushEnabled) webpush.setVapidDetails(config.webPush.subject, config.webPush.publicKey, config.webPush.privateKey);

  async function dispatchPush(userId, notification) {
    if (!pushEnabled) return;
    const subscriptions = await repository.listSubscriptions(userId);
    await Promise.allSettled(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, JSON.stringify({
          title: notification.title,
          body: notification.body,
          tag: notification.id,
          data: notification.data,
        }), { TTL: 300, urgency: 'normal', contentEncoding: 'aes128gcm' });
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await repository.removeSubscriptionByEndpoint(subscription.endpoint);
          return;
        }
        logger.warn?.({ statusCode: error?.statusCode, notificationId: notification.id }, 'Web push delivery failed');
      }
    }));
  }

  return Object.freeze({
    async publish(userId, kind, payload, pushCopy) {
      let notification;
      try {
        notification = await repository.create(userId, kind, payload);
      } catch (error) {
        logger.error?.({ code: error?.code, userId, kind }, 'Notification persistence failed');
        return null;
      }
      gateway?.emitToUser(userId, 'notification:new', notification);
      if (pushCopy) {
        try {
          await dispatchPush(userId, {
            id: notification.id,
            title: pushCopy.title,
            body: pushCopy.body,
            data: pushCopy.data,
          });
        } catch (error) {
          logger.warn?.({ code: error?.code, notificationId: notification.id }, 'Notification fanout failed');
        }
      }
      return notification;
    },

    async list(userId, cursor, limit) {
      return repository.list(userId, cursor?.createdAt, cursor?.id, limit);
    },

    async markRead(userId, notificationId) {
      return repository.markRead(userId, notificationId);
    },

    async saveSubscription(userId, subscription) {
      if (!subscription || typeof subscription !== 'object') throw badRequest('INVALID_PUSH_SUBSCRIPTION');
      const endpoint = validateEndpoint(subscription.endpoint);
      const p256dh = subscription.keys?.p256dh;
      const auth = subscription.keys?.auth;
      if (typeof p256dh !== 'string' || !/^[A-Za-z0-9_-]{30,200}$/.test(p256dh)
        || typeof auth !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(auth)) {
        throw badRequest('INVALID_PUSH_SUBSCRIPTION');
      }
      const result = await repository.upsertSubscription(userId, endpoint, p256dh, auth);
      if (result.error === 'SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT') throw forbidden(result.error);
      return { subscribed: true };
    },

    async removeSubscription(userId, endpoint) {
      const safeEndpoint = validateEndpoint(endpoint);
      const removed = await repository.removeSubscription(userId, safeEndpoint);
      return { removed };
    },
  });
}
