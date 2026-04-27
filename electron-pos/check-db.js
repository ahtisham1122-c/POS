const Database = require('better-sqlite3');
const now = new Date().toISOString();

function updateDb(path) {
  try {
    const db = new Database(path);
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    stmt.run('APP_API_URL', 'https://mngkltbsnpyouaerykzo.supabase.co/rest/v1', now);
    stmt.run('SYNC_DEVICE_SECRET', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZ2tsdGJzbnB5b3VhZXJ5a3pvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNzAxOTIsImV4cCI6MjA5Mjg0NjE5Mn0.5Ms9js_weCom4vY-SHhqQWlynb-TSmaOJ1WB9ZYI5Aw', now);

    console.log('Successfully updated:', path);
    db.close();
  } catch (e) {
    console.error('Failed to update:', path, e.message);
  }
}

updateDb('.noon-dairy-data/noon-dairy.db');
updateDb('C:\\Users\\Ahtisham Ul Haq\\AppData\\Roaming\\noon-dairy-pos-electron\\noon-dairy.db');
