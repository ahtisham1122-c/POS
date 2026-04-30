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
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const safetyBackup = performBackup(false);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stagedRestore = path.join(backupDir, `pending-restore-${stamp}.db`);
  copySqliteFileWithSidecars(source, stagedRestore);

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

  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as { source: string; safetyBackup?: string };
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
  return setInterval(() => {
    const now = new Date();
    // Run backup at exactly 2:00 AM
    if (now.getHours() === 2 && now.getMinutes() === 0) {
      performBackup(false);
    }
  }, 60000); // Check every minute
}
