import fs from 'fs';
import path from 'path';
import { app, dialog } from 'electron';
import log from '../utils/logger';

export function getBackupDir() {
  return path.join(app.getPath('documents'), 'NoonDairyBackup');
}

export function getDatabasePath() {
  return path.join(app.getPath('userData'), 'noon-dairy.db');
}

function getPendingRestorePath() {
  return path.join(app.getPath('userData'), 'pending-restore.json');
}

function copySqliteFileWithSidecars(source: string, target: string) {
  fs.copyFileSync(source, target);
  for (const suffix of ['-wal', '-shm']) {
    const sourceSidecar = `${source}${suffix}`;
    const targetSidecar = `${target}${suffix}`;
    if (fs.existsSync(sourceSidecar)) {
      fs.copyFileSync(sourceSidecar, targetSidecar);
    }
  }
}

// Verify a file is a valid SQLite database by checking the magic header.
// Throws if the file is missing, too small, or doesn't start with the SQLite
// format-3 signature. Use before overwriting the live DB with a restore source.
function assertValidSqliteFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SQLite file not found: ${filePath}`);
  }
  const stats = fs.statSync(filePath);
  if (stats.size < 100) {
    throw new Error(`SQLite file too small (${stats.size} bytes) — likely corrupt: ${filePath}`);
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const headerBuf = Buffer.alloc(16);
    fs.readSync(fd, headerBuf, 0, 16, 0);
    if (!headerBuf.toString('ascii').startsWith('SQLite format 3')) {
      throw new Error(`Not a valid SQLite database (bad header): ${filePath}`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function performBackup(isManual = false) {
  try {
    const dbPath = getDatabasePath();
    const backupDir = getBackupDir();
    
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const type = isManual ? 'manual' : 'auto';
    const backupFile = path.join(backupDir, `${type}-backup-${stamp}.db`);
    
    copySqliteFileWithSidecars(dbPath, backupFile);

    // Verify the backup is a readable, valid SQLite file
    const stats = fs.statSync(backupFile);
    if (stats.size < 100) {
      throw new Error(`Backup file is too small (${stats.size} bytes) — likely corrupt`);
    }
    const fd = fs.openSync(backupFile, 'r');
    const headerBuf = Buffer.alloc(16);
    fs.readSync(fd, headerBuf, 0, 16, 0);
    fs.closeSync(fd);
    if (!headerBuf.toString('ascii').startsWith('SQLite format 3')) {
      throw new Error('Backup verification failed: file does not have a valid SQLite header');
    }

    log.info(`Local backup created and verified at ${backupFile} (${stats.size} bytes)`);

    cleanupOldBackups(backupDir);

    if (isManual) {
      dialog.showMessageBox({ type: 'info', title: 'Backup Successful', message: `Database backed up to ${backupFile}` });
    }

    return backupFile;
  } catch (err: any) {
    log.error('Backup failed:', err.message);
    if (isManual) dialog.showErrorBox('Backup Failed', err.message);
    return null;
  }
}

export function requestRestoreOnRestart(source: string) {
  // Validate the user-supplied restore file BEFORE staging it. If we don't,
  // a corrupted .db could overwrite the live database on next startup and
  // wipe out all sales/khata data.
  assertValidSqliteFile(source);

  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const safetyBackup = performBackup(false);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stagedRestore = path.join(backupDir, `pending-restore-${stamp}.db`);
  copySqliteFileWithSidecars(source, stagedRestore);

  // Re-verify the staged copy actually wrote correctly before we trust it.
  assertValidSqliteFile(stagedRestore);

  fs.writeFileSync(getPendingRestorePath(), JSON.stringify({
    source: stagedRestore,
    safetyBackup,
    requestedAt: new Date().toISOString()
  }, null, 2));

  return { stagedRestore, safetyBackup };
}

export function applyPendingRestoreIfAny() {
  const markerPath = getPendingRestorePath();
  if (!fs.existsSync(markerPath)) return null;

  // Marker file may have been hand-edited or partially written. If we can't
  // parse it, the safest action is to drop it and continue with the existing DB.
  let marker: { source: string; safetyBackup?: string };
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch (err: any) {
    log.error(`Pending-restore marker is corrupted, ignoring: ${err?.message || err}`);
    try { fs.rmSync(markerPath, { force: true }); } catch {}
    return null;
  }

  // Verify the staged file is a real SQLite DB before overwriting the live one.
  // If it isn't, abort the restore — keeping the existing DB is far better
  // than replacing it with garbage.
  try {
    assertValidSqliteFile(marker.source);
  } catch (err: any) {
    log.error(`Refusing to restore from invalid file: ${err?.message || err}`);
    try { fs.rmSync(markerPath, { force: true }); } catch {}
    return null;
  }

  const target = getDatabasePath();

  for (const suffix of ['', '-wal', '-shm']) {
    const targetFile = `${target}${suffix}`;
    if (fs.existsSync(targetFile)) {
      fs.rmSync(targetFile, { force: true });
    }
  }

  copySqliteFileWithSidecars(marker.source, target);
  fs.rmSync(markerPath, { force: true });
  log.info(`Pending restore applied from ${marker.source}`);

  return marker;
}

export function listBackups() {
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  return fs.readdirSync(backupDir)
    .filter((file) => file.endsWith('.db') || file.endsWith('.sqlite'))
    .map((file) => {
      const fullPath = path.join(backupDir, file);
      const stats = fs.statSync(fullPath);
      return {
        fileName: file,
        path: fullPath,
        sizeBytes: stats.size,
        createdAt: stats.birthtime.toISOString(),
        modifiedAt: stats.mtime.toISOString()
      };
    })
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
}

function cleanupOldBackups(backupDir: string) {
  try {
    const files = fs.readdirSync(backupDir);
    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    files.forEach(f => {
      if (!f.endsWith('.db')) return;
      const fp = path.join(backupDir, f);
      const stats = fs.statSync(fp);
      if (now - stats.mtimeMs > THIRTY_DAYS_MS) {
        fs.unlinkSync(fp);
        log.info(`Deleted old backup ${fp}`);
      }
    });
  } catch (err: any) {
    log.error('Failed to cleanup old backups:', err.message);
  }
}

export function scheduleDailyBackup() {
  log.info('Daily backup scheduler started (Targets 2:00 AM)');
  let lastBackupYmd: string | null = null;

  return setInterval(() => {
    try {
      const now = new Date();
      // Track by year-month-day so if the clock skips past 2:00 (PC sleep,
      // process pause, NTP jump) we still take the daily backup the next
      // time we tick after 2:00 AM. Old code only fired on the exact minute,
      // which silently missed days.
      const ymd = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      const past2am = now.getHours() > 2 || (now.getHours() === 2 && now.getMinutes() >= 0);
      if (past2am && lastBackupYmd !== ymd) {
        lastBackupYmd = ymd;
        performBackup(false);
      }
    } catch (err: any) {
      // Never let the scheduler crash the main process. Log and try again
      // next tick.
      log.error('Daily backup tick failed:', err?.message || err);
    }
  }, 60000);
}
