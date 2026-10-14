import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function newToken(byteLength = 32) {
  return randomBytes(byteLength).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function deriveCsrfToken(sessionToken, secret) {
  return createHmac('sha256', secret).update(`friendconnect-csrf:${sessionToken}`, 'utf8').digest('base64url');
}

export function safeStringEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
