import argon2 from 'argon2';

export const ARGON2ID_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});

export function validatePassword(password) {
  if (typeof password !== 'string') return false;
  const length = [...password].length;
  return length >= 12 && length <= 128 && Buffer.byteLength(password, 'utf8') <= 1024;
}

export async function hashPassword(password) {
  if (!validatePassword(password)) {
    const error = new Error('Password must be 12–128 characters.');
    error.code = 'INVALID_PASSWORD';
    throw error;
  }
  return argon2.hash(password, ARGON2ID_OPTIONS);
}

export async function verifyPassword(hash, password) {
  if (typeof hash !== 'string' || typeof password !== 'string') return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
