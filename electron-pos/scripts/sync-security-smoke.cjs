const assert = require('node:assert/strict');

const {
  MIN_SYNC_SECRET_LENGTH,
  getSyncSecretValidationError,
  isKnownWeakSyncSecret,
  isUsableSyncSecret,
  normalizeSyncSecret
} = require('../dist-electron/sync/secretValidation.js');

assert.equal(MIN_SYNC_SECRET_LENGTH, 24);
assert.equal(normalizeSyncSecret('  abc  '), 'abc');

assert.equal(isKnownWeakSyncSecret('noon-dairy-local-sync-secret-change-me'), true);
assert.equal(isKnownWeakSyncSecret('change-this-to-a-long-random-secret'), true);
assert.equal(isKnownWeakSyncSecret('PASTE_A_STRONG_RANDOM_SYNC_SECRET_HERE'), true);
assert.equal(isKnownWeakSyncSecret('your-sync-secret-goes-here'), true);

assert.equal(isUsableSyncSecret('noon-dairy-local-sync-secret-change-me'), false);
assert.equal(isUsableSyncSecret('short'), false);
assert.equal(isUsableSyncSecret('a-real-random-sync-secret-32-chars'), true);

assert.equal(getSyncSecretValidationError('', true), null);
assert.match(getSyncSecretValidationError('', false), /required/);
assert.match(getSyncSecretValidationError('short', true), /at least/);
assert.match(getSyncSecretValidationError('noon-dairy-local-sync-secret-change-me', true), /default/);
assert.equal(getSyncSecretValidationError('a-real-random-sync-secret-32-chars', true), null);

console.log('sync security smoke tests passed');
