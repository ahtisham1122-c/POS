import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function createSyncToken() {
  return randomBytes(32).toString('hex');
}

export function hashSyncToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqualText(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
