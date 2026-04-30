export const MIN_SYNC_SECRET_LENGTH = 24;

const KNOWN_WEAK_SYNC_SECRETS = new Set([
  'noon-dairy-local-sync-secret-change-me',
  'change-this-to-a-long-random-secret',
  'change-this-refresh-secret'
]);

export function normalizeSyncSecret(value: unknown) {
  return String(value || '').trim();
}

export function isKnownWeakSyncSecret(value: unknown) {
  const normalized = normalizeSyncSecret(value).toLowerCase();
  return (
    KNOWN_WEAK_SYNC_SECRETS.has(normalized) ||
    normalized.includes('change-this') ||
    normalized.includes('paste_') ||
    normalized.includes('paste-') ||
    normalized.includes('generate_random') ||
    normalized.includes('your_') ||
    normalized.includes('your-')
  );
}

export function isUsableSyncSecret(value: unknown) {
  const normalized = normalizeSyncSecret(value);
  return normalized.length >= MIN_SYNC_SECRET_LENGTH && !isKnownWeakSyncSecret(normalized);
}

export function getSyncSecretValidationError(value: unknown, allowBlank = false) {
  const normalized = normalizeSyncSecret(value);
  if (!normalized) {
    return allowBlank ? null : 'Sync device secret is required';
  }

  if (normalized.length < MIN_SYNC_SECRET_LENGTH) {
    return `Sync device secret must be at least ${MIN_SYNC_SECRET_LENGTH} characters`;
  }

  if (isKnownWeakSyncSecret(normalized)) {
    return 'Sync device secret cannot use the default/example value';
  }

  return null;
}
