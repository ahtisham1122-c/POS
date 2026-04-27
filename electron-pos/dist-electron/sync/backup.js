"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBackupDir = getBackupDir;
exports.getDatabasePath = getDatabasePath;
exports.performBackup = performBackup;
exports.requestRestoreOnRestart = requestRestoreOnRestart;
exports.applyPendingRestoreIfAny = applyPendingRestoreIfAny;
exports.listBackups = listBackups;
exports.scheduleDailyBackup = scheduleDailyBackup;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const logger_1 = __importDefault(require("../utils/logger"));
function getBackupDir() {
    return path_1.default.join(electron_1.app.getPath('documents'), 'NoonDairyBackup');
}
function getDatabasePath() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'noon-dairy.db');
}
function getPendingRestorePath() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'pending-restore.json');
}
function copySqliteFileWithSidecars(source, target) {
    fs_1.default.copyFileSync(source, target);
    for (const suffix of ['-wal', '-shm']) {
        const sourceSidecar = `${source}${suffix}`;
        const targetSidecar = `${target}${suffix}`;
        if (fs_1.default.existsSync(sourceSidecar)) {
            fs_1.default.copyFileSync(sourceSidecar, targetSidecar);
        }
    }
}
function performBackup(isManual = false) {
    try {
        const dbPath = getDatabasePath();
        const backupDir = getBackupDir();
        if (!fs_1.default.existsSync(backupDir)) {
            fs_1.default.mkdirSync(backupDir, { recursive: true });
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const type = isManual ? 'manual' : 'auto';
        const backupFile = path_1.default.join(backupDir, `${type}-backup-${stamp}.db`);
        copySqliteFileWithSidecars(dbPath, backupFile);
        logger_1.default.info(`Local backup created successfully at ${backupFile}`);
        cleanupOldBackups(backupDir);
        if (isManual) {
            electron_1.dialog.showMessageBox({ type: 'info', title: 'Backup Successful', message: `Database backed up to ${backupFile}` });
        }
        return backupFile;
    }
    catch (err) {
        logger_1.default.error('Backup failed:', err.message);
        if (isManual)
            electron_1.dialog.showErrorBox('Backup Failed', err.message);
        return null;
    }
}
function requestRestoreOnRestart(source) {
    const backupDir = getBackupDir();
    if (!fs_1.default.existsSync(backupDir)) {
        fs_1.default.mkdirSync(backupDir, { recursive: true });
    }
    const safetyBackup = performBackup(false);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const stagedRestore = path_1.default.join(backupDir, `pending-restore-${stamp}.db`);
    copySqliteFileWithSidecars(source, stagedRestore);
    fs_1.default.writeFileSync(getPendingRestorePath(), JSON.stringify({
        source: stagedRestore,
        safetyBackup,
        requestedAt: new Date().toISOString()
    }, null, 2));
    return { stagedRestore, safetyBackup };
}
function applyPendingRestoreIfAny() {
    const markerPath = getPendingRestorePath();
    if (!fs_1.default.existsSync(markerPath))
        return null;
    const marker = JSON.parse(fs_1.default.readFileSync(markerPath, 'utf8'));
    const target = getDatabasePath();
    for (const suffix of ['', '-wal', '-shm']) {
        const targetFile = `${target}${suffix}`;
        if (fs_1.default.existsSync(targetFile)) {
            fs_1.default.rmSync(targetFile, { force: true });
        }
    }
    copySqliteFileWithSidecars(marker.source, target);
    fs_1.default.rmSync(markerPath, { force: true });
    logger_1.default.info(`Pending restore applied from ${marker.source}`);
    return marker;
}
function listBackups() {
    const backupDir = getBackupDir();
    if (!fs_1.default.existsSync(backupDir)) {
        fs_1.default.mkdirSync(backupDir, { recursive: true });
    }
    return fs_1.default.readdirSync(backupDir)
        .filter((file) => file.endsWith('.db') || file.endsWith('.sqlite'))
        .map((file) => {
        const fullPath = path_1.default.join(backupDir, file);
        const stats = fs_1.default.statSync(fullPath);
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
function cleanupOldBackups(backupDir) {
    try {
        const files = fs_1.default.readdirSync(backupDir);
        const now = Date.now();
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        files.forEach(f => {
            if (!f.endsWith('.db'))
                return;
            const fp = path_1.default.join(backupDir, f);
            const stats = fs_1.default.statSync(fp);
            if (now - stats.mtimeMs > THIRTY_DAYS_MS) {
                fs_1.default.unlinkSync(fp);
                logger_1.default.info(`Deleted old backup ${fp}`);
            }
        });
    }
    catch (err) {
        logger_1.default.error('Failed to cleanup old backups:', err.message);
    }
}
function scheduleDailyBackup() {
    logger_1.default.info('Daily backup scheduler started (Targets 2:00 AM)');
    return setInterval(() => {
        const now = new Date();
        // Run backup at exactly 2:00 AM
        if (now.getHours() === 2 && now.getMinutes() === 0) {
            performBackup(false);
        }
    }, 60000); // Check every minute
}
