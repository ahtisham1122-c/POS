import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { applyPendingRestoreIfAny } from '../sync/backup';

// Store DB in Electron's userData folder so it survives app updates/reinstalls.
// Older builds created the DB inside the install folder via process.cwd(); copy it once if found.
if (app.getName() === 'Electron') {
  app.setName('Noon Dairy POS');
}

const dataDir = app.getPath('userData');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

applyPendingRestoreIfAny();

const dbPath = path.join(dataDir, 'noon-dairy.db');
const legacyDataDir = path.join(process.cwd(), '.noon-dairy-data');
const legacyDbPath = path.join(legacyDataDir, 'noon-dairy.db');

if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
  fs.copyFileSync(legacyDbPath, dbPath);

  for (const suffix of ['-wal', '-shm']) {
    const legacySidecar = `${legacyDbPath}${suffix}`;
    if (fs.existsSync(legacySidecar)) {
      fs.copyFileSync(legacySidecar, `${dbPath}${suffix}`);
    }
  }
}

const db = new Database(dbPath, { verbose: console.log });

// Production stability PRAGMAs
db.pragma('journal_mode = WAL');       // Prevents database locks under concurrent reads
db.pragma('synchronous = NORMAL');     // Balance speed vs. safety (safe with WAL)
db.pragma('foreign_keys = ON');        // Enforce referential integrity
db.pragma('cache_size = -64000');      // 64MB cache for speed

export default db;
