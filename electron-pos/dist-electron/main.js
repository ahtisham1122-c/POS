"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const schema_1 = require("./database/schema");
const migrations_1 = require("./database/migrations");
const auth_ipc_1 = require("./ipc/auth.ipc");
const sales_ipc_1 = require("./ipc/sales.ipc");
const products_ipc_1 = require("./ipc/products.ipc");
const customers_ipc_1 = require("./ipc/customers.ipc");
const expenses_ipc_1 = require("./ipc/expenses.ipc");
const reports_ipc_1 = require("./ipc/reports.ipc");
const printer_ipc_1 = require("./ipc/printer.ipc");
const daily_rates_ipc_1 = require("./ipc/daily-rates.ipc");
const cash_register_ipc_1 = require("./ipc/cash-register.ipc");
const settings_ipc_1 = require("./ipc/settings.ipc");
const inventory_ipc_1 = require("./ipc/inventory.ipc");
const returns_ipc_1 = require("./ipc/returns.ipc");
const receipt_audit_ipc_1 = require("./ipc/receipt-audit.ipc");
const shifts_ipc_1 = require("./ipc/shifts.ipc");
const sync_ipc_1 = require("./ipc/sync.ipc");
const system_ipc_1 = require("./ipc/system.ipc");
const suppliers_ipc_1 = require("./ipc/suppliers.ipc");
const audit_ipc_1 = require("./ipc/audit.ipc");
const exports_ipc_1 = require("./ipc/exports.ipc");
const syncEngine_1 = require("./sync/syncEngine");
const pullSync_1 = require("./sync/pullSync");
const deviceInfo_1 = require("./sync/deviceInfo");
const networkMonitor_1 = require("./sync/networkMonitor");
const apiConfig_1 = require("./sync/apiConfig");
const backup_1 = require("./sync/backup");
const updater_1 = require("./updater");
const logger_1 = __importDefault(require("./utils/logger"));
let mainWindow = null;
let splashWindow = null;
const syncEngine = new syncEngine_1.SyncEngine();
let pullSyncInterval = null;
let backupInterval = null;
const sendOnlineStatus = () => {
    if (mainWindow)
        mainWindow.webContents.send('network-status-changed', 'online');
};
const sendOfflineStatus = () => {
    if (mainWindow)
        mainWindow.webContents.send('network-status-changed', 'offline');
};
function stopBackgroundTasks() {
    syncEngine.stop();
    if (pullSyncInterval) {
        clearInterval(pullSyncInterval);
        pullSyncInterval = null;
    }
    if (backupInterval) {
        clearInterval(backupInterval);
        backupInterval = null;
    }
    networkMonitor_1.networkMonitor.off('online', sendOnlineStatus);
    networkMonitor_1.networkMonitor.off('offline', sendOfflineStatus);
    networkMonitor_1.networkMonitor.stopMonitoring();
}
dotenv_1.default.config();
function createSplashWindow() {
    splashWindow = new electron_1.BrowserWindow({
        width: 400,
        height: 300,
        transparent: true,
        frame: false,
        alwaysOnTop: true
    });
    // Normally load a local splash HTML here.
}
function createWindow() {
    let rendererFallbackLoaded = false;
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        icon: path_1.default.join(__dirname, '../assets/icon.png'),
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        show: false, // Wait until ready-to-show
    });
    const loadPackagedRenderer = () => {
        if (!mainWindow)
            return;
        if (rendererFallbackLoaded)
            return;
        rendererFallbackLoaded = true;
        mainWindow.loadFile(path_1.default.join(__dirname, '../dist-renderer/index.html'));
    };
    // Use Electron's packaged flag instead of NODE_ENV so installed app never tries localhost.
    if (!electron_1.app.isPackaged) {
        mainWindow.loadURL('http://localhost:5173').catch(() => {
            logger_1.default.warn('Dev renderer not reachable on :5173, falling back to local dist build.');
            loadPackagedRenderer();
        });
        mainWindow.webContents.openDevTools();
    }
    else {
        loadPackagedRenderer();
    }
    mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
        logger_1.default.error('Renderer failed to load', { code, description, url });
        if (!electron_1.app.isPackaged) {
            logger_1.default.warn('Retrying with local dist build after did-fail-load.');
            loadPackagedRenderer();
        }
    });
    mainWindow.once('ready-to-show', () => {
        if (splashWindow) {
            splashWindow.close();
            splashWindow = null;
        }
        mainWindow?.show();
        (0, updater_1.setupAutoUpdater)(mainWindow);
    });
}
function registerDeviceWithCloud() {
    setTimeout(async () => {
        try {
            const info = (0, deviceInfo_1.getDeviceInfo)();
            const apiUrl = (0, apiConfig_1.getApiBaseUrl)();
            const syncHeaders = (0, apiConfig_1.getSyncHeaders)(info.deviceId);
            if (!syncHeaders) {
                logger_1.default.warn('Cloud device registration skipped because SYNC_DEVICE_SECRET is not configured.');
                return;
            }
            await (0, apiConfig_1.fetchWithTimeout)(`${apiUrl}/sync/register-device`, {
                method: 'POST',
                headers: syncHeaders,
                body: JSON.stringify(info)
            }, 15000);
            logger_1.default.info('Registered device with cloud.');
            // Attempt first pull
            await (0, pullSync_1.pullSync)(mainWindow || undefined);
        }
        catch (e) {
            logger_1.default.error('Failed to register device:', e);
        }
    }, 2000); // 2 second delay to let API boot in dev
}
electron_1.app.whenReady().then(() => {
    createSplashWindow();
    logger_1.default.info('Starting App...');
    logger_1.default.info('Initializing database...');
    (0, schema_1.initializeDatabase)();
    (0, migrations_1.runMigrations)();
    logger_1.default.info('Registering IPC handlers...');
    (0, auth_ipc_1.registerAuthIPC)();
    (0, sales_ipc_1.registerSalesIPC)();
    (0, products_ipc_1.registerProductsIPC)();
    (0, customers_ipc_1.registerCustomersIPC)();
    (0, expenses_ipc_1.registerExpensesIPC)();
    (0, reports_ipc_1.registerReportsIPC)();
    (0, printer_ipc_1.registerPrinterIPC)();
    (0, daily_rates_ipc_1.registerDailyRatesIPC)();
    (0, cash_register_ipc_1.registerCashRegisterIPC)();
    (0, settings_ipc_1.registerSettingsIPC)();
    (0, inventory_ipc_1.registerInventoryIPC)();
    (0, returns_ipc_1.registerReturnsIPC)();
    (0, receipt_audit_ipc_1.registerReceiptAuditIPC)();
    (0, shifts_ipc_1.registerShiftsIPC)();
    (0, system_ipc_1.registerSystemIPC)();
    (0, suppliers_ipc_1.registerSuppliersIPC)();
    (0, audit_ipc_1.registerAuditIPC)();
    (0, exports_ipc_1.registerExportsIPC)();
    (0, sync_ipc_1.registerSyncIPC)(syncEngine, () => mainWindow);
    logger_1.default.info('Starting sync engine & background tasks...');
    syncEngine.start();
    backupInterval = (0, backup_1.scheduleDailyBackup)();
    // Set up 60s pull interval
    pullSyncInterval = setInterval(() => {
        (0, pullSync_1.pullSync)(mainWindow || undefined);
    }, 60000);
    networkMonitor_1.networkMonitor.on('online', sendOnlineStatus);
    networkMonitor_1.networkMonitor.on('offline', sendOfflineStatus);
    registerDeviceWithCloud();
    // Simulate startup delay for splash
    setTimeout(() => {
        createWindow();
    }, 500);
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    stopBackgroundTasks();
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('will-quit', () => {
    (0, backup_1.performBackup)(false);
    stopBackgroundTasks();
});
