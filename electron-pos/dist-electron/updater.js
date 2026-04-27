"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAutoUpdater = setupAutoUpdater;
const electron_updater_1 = require("electron-updater");
const electron_1 = require("electron");
const logger_1 = __importDefault(require("./utils/logger"));
function setupAutoUpdater(mainWindow) {
    electron_updater_1.autoUpdater.logger = logger_1.default;
    electron_updater_1.autoUpdater.autoDownload = false; // We download in background cautiously
    logger_1.default.info('Auto-updater initialized');
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        logger_1.default.info('Update available:', info.version);
        // In a real app we might verify if the cart is active before prompting
        electron_1.dialog.showMessageBox({
            type: 'info',
            title: 'Update Available',
            message: `A new version (${info.version}) of Gujjar Milk Shop POS is available.`,
            buttons: ['Update Now (Downloads in background)', 'Later']
        }).then((result) => {
            if (result.response === 0) {
                electron_updater_1.autoUpdater.downloadUpdate();
            }
        });
    });
    electron_updater_1.autoUpdater.on('update-downloaded', () => {
        logger_1.default.info('Update downloaded. Prompting install.');
        electron_1.dialog.showMessageBox({
            type: 'question',
            title: 'Update Ready',
            message: 'The update has finished downloading. Install and restart now?',
            buttons: ['Restart', 'Later']
        }).then((result) => {
            if (result.response === 0) {
                electron_updater_1.autoUpdater.quitAndInstall();
            }
        });
    });
    electron_updater_1.autoUpdater.on('error', (err) => {
        logger_1.default.error('Auto-updater error:', err.message);
    });
    // Check immediately
    electron_updater_1.autoUpdater.checkForUpdates().catch(err => logger_1.default.error('Failed to check for updates', err));
}
