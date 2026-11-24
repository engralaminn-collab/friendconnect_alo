import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { AuthRepository } from '../db/auth-repository.js';
import { createPool } from '../db/pool.js';
import { readConfig } from '../config.js';
import { hashPassword, validatePassword } from '../security/passwords.js';

function readHidden(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command from an interactive terminal so the password is not exposed in arguments or logs.'));
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = '';
    process.stdout.write(`${label}: `);
    stdin.setRawMode(true);
    stdin.resume();
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      process.stdout.write('\n');
    };
    const onData = (buffer) => {
      for (const character of buffer.toString('utf8')) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = [...value].slice(0, -1).join('');
          continue;
        }
        if (character >= ' ' && character !== '\u007f') value += character;
      }
    };
    stdin.on('data', onData);
  });
}

const [emailArg, usernameArg] = process.argv.slice(2);
const email = (emailArg || '').trim().toLowerCase();
const username = (usernameArg || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[a-z0-9_]{3,32}$/.test(username)) {
  console.error('Usage: npm run create-admin -- <email> <username>');
  process.exitCode = 2;
} else {
  const firstPassword = await readHidden('Admin password');
  const confirmation = await readHidden('Confirm password');
  if (firstPassword !== confirmation || !validatePassword(firstPassword)) {
    console.error('Passwords must match and be 12–128 characters.');
    process.exitCode = 2;
  } else {
    const config = readConfig();
    const pool = createPool(config.database);
    try {
      const repository = new AuthRepository(pool);
      const created = await repository.createAdmin({
        id: randomUUID(),
        email,
        username,
        displayName: username,
        passwordHash: await hashPassword(firstPassword),
      });
      if (!created) throw new Error('An administrator already exists. Use the existing administrator account.');
      console.info('Initial FriendConnect administrator created.');
    } catch (error) {
      console.error(`Administrator creation failed: ${error?.code === 'ER_DUP_ENTRY' ? 'email or username already exists' : error.message}`);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  }
}
