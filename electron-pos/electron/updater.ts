import { autoUpdater } from 'electron-updater';
import { dialog, BrowserWindow } from 'electron';
import log from './utils/logger';

export function setupAutoUpdater(mainWindow: BrowserWindow | null) {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = false; // We download in background cautiously

  log.info('Auto-updater initialized');

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version);
    
    // In a real app we might verify if the cart is active before prompting
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
          message: `A new version (${info.version}) of Gujjar Milk Shop POS is available.`,
      buttons: ['Update Now (Downloads in background)', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-downloaded', () => {
    log.info('Update downloaded. Prompting install.');
    dialog.showMessageBox({
      type: 'question',
      title: 'Update Ready',
      message: 'The update has finished downloading. Install and restart now?',
      buttons: ['Restart', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err.message);
  });

  // Check immediately
  autoUpdater.checkForUpdates().catch(err => log.error('Failed to check for updates', err));
}
