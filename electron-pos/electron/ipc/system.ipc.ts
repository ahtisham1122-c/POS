import { ipcMain, dialog, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getBackupDir, getDatabasePath, listBackups, performBackup, requestRestoreOnRestart } from '../sync/backup';
import { getBusinessDateInfo } from '../database/businessDay';

export function registerSystemIPC() {
  ipcMain.handle('system:backup', () => {
    const backupPath = performBackup(true);
    if (!backupPath) return { success: false, error: 'Backup failed' };
    return { success: true, path: backupPath, backups: listBackups() };
  });

  ipcMain.handle('system:listBackups', () => {
    return {
      success: true,
      backupDir: getBackupDir(),
      dbPath: getDatabasePath(),
      backups: listBackups()
    };
  });

  ipcMain.handle('system:restore', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'SQLite Databases', extensions: ['db', 'sqlite'] }]
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, reason: 'canceled' };
    }

    try {
      const source = filePaths[0];
      const { stagedRestore, safetyBackup } = requestRestoreOnRestart(source);

      app.relaunch();
      app.exit(0);
      return {
        success: true,
        restoredFrom: source,
        stagedRestore,
        safetyBackup,
        message: 'Restore scheduled. The app will close, replace the database safely, and reopen.'
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('system:openBackupFolder', async () => {
    const backupDir = getBackupDir();
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const { shell } = await import('electron');
    await shell.openPath(backupDir);
    return { success: true, backupDir };
  });

  ipcMain.handle('system:getPaths', () => {
    return {
      userData: app.getPath('userData'),
      documents: app.getPath('documents'),
      backupDir: getBackupDir(),
      dbPath: getDatabasePath()
    };
  });

  ipcMain.handle('system:getBusinessDate', () => {
    return getBusinessDateInfo();
  });
}
