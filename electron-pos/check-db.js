const Database = require('better-sqlite3');
const now = new Date().toISOString();

function updateDb(path) {
  try {
    const syncSecret = String(process.env.SYNC_DEVICE_SECRET || '').trim();
    if (!syncSecret || syncSecret === 'noon-dairy-local-sync-secret-change-me' || syncSecret.length < 24) {
      throw new Error('Set a strong SYNC_DEVICE_SECRET env value before updating the local database');
    }

    const db = new Database(path);
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    stmt.run('APP_API_URL', process.env.APP_API_URL || 'http://localhost:3001/api', now);
    stmt.run('SYNC_DEVICE_SECRET', syncSecret, now);

    console.log('Successfully updated:', path);
    db.close();
  } catch (e) {
    console.error('Failed to update:', path, e.message);
  }
}

updateDb('.noon-dairy-data/noon-dairy.db');
updateDb('C:\\Users\\Ahtisham Ul Haq\\AppData\\Roaming\\noon-dairy-pos-electron\\noon-dairy.db');
