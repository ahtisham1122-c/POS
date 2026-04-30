const assert = require('node:assert/strict');

const {
  createSyncToken,
  hashSyncToken,
  safeEqualText
} = require('../dist/src/sync/sync-token.util.js');

const token = createSyncToken();
const secondToken = createSyncToken();

assert.equal(token.length, 64);
assert.notEqual(token, secondToken);
assert.match(token, /^[a-f0-9]{64}$/);

const hash = hashSyncToken(token);
assert.equal(hash.length, 64);
assert.equal(safeEqualText(hash, hashSyncToken(token)), true);
assert.equal(safeEqualText(hash, hashSyncToken(secondToken)), false);

console.log('sync token smoke tests passed');
