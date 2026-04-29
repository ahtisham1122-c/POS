import { app, BrowserWindow } from 'electron';
import path from 'path';
import dotenv from 'dotenv';
import { initializeDatabase } from './database/schema';
import { runMigrations } from './database/migrations';
import { registerAuthIPC } from './ipc/auth.ipc';
import { registerSalesIPC } from './ipc/sales.ipc';
import { registerProductsIPC } from './ipc/products.ipc';
import { registerCustomersIPC } from './ipc/customers.ipc';
import { registerExpensesIPC } from './ipc/expenses.ipc';
import { registerReportsIPC } from './ipc/reports.ipc';
import { registerPrinterIPC } from './ipc/printer.ipc';
import { registerDailyRatesIPC } from './ipc/daily-rates.ipc';
import { registerCashRegisterIPC } from './ipc/cash-register.ipc';
import { registerSettingsIPC } from './ipc/settings.ipc';
import { registerInventoryIPC } from './ipc/inventory.ipc';
import { registerReturnsIPC } from './ipc/returns.ipc';
import { registerReceiptAuditIPC } from './ipc/receipt-audit.ipc';
import { registerShiftsIPC } from './ipc/shifts.ipc';
import { registerSyncIPC } from './ipc/sync.ipc';
import { registerSystemIPC } from './ipc/system.ipc';
import { registerSuppliersIPC } from './ipc/suppliers.ipc';
import { registerAuditIPC } from './ipc/audit.ipc';
import { registerExportsIPC } from './ipc/exports.ipc';
import { registerEmployeesIPC } from './ipc/employees.ipc';
import { SyncEngine } from './sync/syncEngine';
import { pullSync } from './sync/pullSync';
import { getDeviceInfo } from './sync/deviceInfo';
import { networkMonitor } from './sync/networkMonitor';
import { fetchWithTimeout, getApiBaseUrl, getSyncHeaders } from './sync/apiConfig';
import { performBackup, scheduleDailyBackup } from './sync/backup';
import { setupAutoUpdater } from './updater';
import log from './utils/logger';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
const syncEngine = new SyncEngine();
let pullSyncInterval: NodeJS.Timeout | null = null;
let backupInterval: NodeJS.Timeout | null = null;

const sendOnlineStatus = () => {
  if (mainWindow) mainWindow.webContents.send('network-status-changed', 'online');
};

const sendOfflineStatus = () => {
  if (mainWindow) mainWindow.webContents.send('network-status-changed', 'offline');
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

  networkMonitor.off('online', sendOnlineStatus);
  networkMonitor.off('offline', sendOfflineStatus);
  networkMonitor.stopMonitoring();
}

dotenv.config();

function createSplashWindow() {
  splashWindow = new BrowserWindow({
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
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false, // Wait until ready-to-show
  });

  const loadPackagedRenderer = () => {
    if (!mainWindow) return;
    if (rendererFallbackLoaded) return;
    rendererFallbackLoaded = true;
    mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  };

  // Use Electron's packaged flag instead of NODE_ENV so installed app never tries localhost.
  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      log.warn('Dev renderer not reachable on :5173, falling back to local dist build.');
      loadPackagedRenderer();
    });
    mainWindow.webContents.openDevTools();
  } else {
    loadPackagedRenderer();
  }

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    log.error('Renderer failed to load', { code, description, url });
    if (!app.isPackaged) {
      log.warn('Retrying with local dist build after did-fail-load.');
      loadPackagedRenderer();
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow?.show();
    setupAutoUpdater(mainWindow);
  });
}

function registerDeviceWithCloud() {
  setTimeout(async () => {
    try {
      const info = getDeviceInfo();
      const apiUrl = getApiBaseUrl();
      const syncHeaders = getSyncHeaders(info.deviceId);
      if (!syncHeaders) {
        log.warn('Cloud device registration skipped because SYNC_DEVICE_SECRET is not configured.');
        return;
      }
      await fetchWithTimeout(`${apiUrl}/sync/register-device`, {
        method: 'POST',
        headers: syncHeaders,
        body: JSON.stringify(info)
      }, 15000);
      log.info('Registered device with cloud.');
      
      // Attempt first pull
      await pullSync(mainWindow || undefined);
    } catch (e) {
      log.error('Failed to register device:', e);
    }
  }, 2000); // 2 second delay to let API boot in dev
}

app.whenReady().then(() => {
  createSplashWindow();

  log.info('Starting App...');
  
  log.info('Initializing database...');
  initializeDatabase();
  runMigrations();
  
  log.info('Registering IPC handlers...');
  registerAuthIPC();
  registerSalesIPC();
  registerProductsIPC();
  registerCustomersIPC();
  registerExpensesIPC();
  registerReportsIPC();
  registerPrinterIPC();
  registerDailyRatesIPC();
  registerCashRegisterIPC();
  registerSettingsIPC();
  registerInventoryIPC();
  registerReturnsIPC();
  registerReceiptAuditIPC();
  registerShiftsIPC();
  registerSystemIPC();
  registerSuppliersIPC();
  registerAuditIPC();
  registerExportsIPC();
  registerEmployeesIPC();
  registerSyncIPC(syncEngine, () => mainWindow);

  log.info('Starting sync engine & background tasks...');
  syncEngine.start();
  backupInterval = scheduleDailyBackup();
  
  // Set up 60s pull interval
  pullSyncInterval = setInterval(() => {
    pullSync(mainWindow || undefined);
  }, 60000);

  networkMonitor.on('online', sendOnlineStatus);
  networkMonitor.on('offline', sendOfflineStatus);

  registerDeviceWithCloud();

  // Simulate startup delay for splash
  setTimeout(() => {
    createWindow();
  }, 500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopBackgroundTasks();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  performBackup(false);
  stopBackgroundTasks();
});
