"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSystemIPC = registerSystemIPC;
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const backup_1 = require("../sync/backup");
const businessDay_1 = require("../database/businessDay");
function registerSystemIPC() {
    electron_1.ipcMain.handle('system:backup', () => {
        const backupPath = (0, backup_1.performBackup)(true);
        if (!backupPath)
            return { success: false, error: 'Backup failed' };
        return { success: true, path: backupPath, backups: (0, backup_1.listBackups)() };
    });
    electron_1.ipcMain.handle('system:listBackups', () => {
        return {
            success: true,
            backupDir: (0, backup_1.getBackupDir)(),
            dbPath: (0, backup_1.getDatabasePath)(),
            backups: (0, backup_1.listBackups)()
        };
    });
    electron_1.ipcMain.handle('system:restore', async () => {
        const { canceled, filePaths } = await electron_1.dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'SQLite Databases', extensions: ['db', 'sqlite'] }]
        });
        if (canceled || filePaths.length === 0) {
            return { success: false, reason: 'canceled' };
        }
        try {
            const source = filePaths[0];
            const { stagedRestore, safetyBackup } = (0, backup_1.requestRestoreOnRestart)(source);
            electron_1.app.relaunch();
            electron_1.app.exit(0);
            return {
                success: true,
                restoredFrom: source,
                stagedRestore,
                safetyBackup,
                message: 'Restore scheduled. The app will close, replace the database safely, and reopen.'
            };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('system:openBackupFolder', async () => {
        const backupDir = (0, backup_1.getBackupDir)();
        if (!fs_1.default.existsSync(backupDir))
            fs_1.default.mkdirSync(backupDir, { recursive: true });
        const { shell } = await Promise.resolve().then(() => __importStar(require('electron')));
        await shell.openPath(backupDir);
        return { success: true, backupDir };
    });
    electron_1.ipcMain.handle('system:getPaths', () => {
        return {
            userData: electron_1.app.getPath('userData'),
            documents: electron_1.app.getPath('documents'),
            backupDir: (0, backup_1.getBackupDir)(),
            dbPath: (0, backup_1.getDatabasePath)()
        };
    });
    electron_1.ipcMain.handle('system:getBusinessDate', () => {
        return (0, businessDay_1.getBusinessDateInfo)();
    });
}
