// Customer Facing Display (CFD) — 2 lines × 20 characters.
//
// Most retail CFDs (HP rp9 pole displays, Logic Controls PD3000, generic
// VFD/LCD pole displays) speak one of two protocols over a serial port:
//
//   1. Plain "write 40 chars" — the device fills line 1 with the first 20
//      bytes and line 2 with the next 20.
//   2. ESC/POS-flavoured commands — `\x0C` clears, then write text.
//
// We send `\x0C` (clear / cursor home) followed by 40 padded chars. That
// works on every CFD I've tested and degrades cleanly if the device
// ignores the clear byte.
//
// Owner has the CFD on COM5 of an HP AIO. The path/baud are configurable
// from the Settings page (CFD_PORT / CFD_BAUD / CFD_ENABLED) so they can
// move it later without a code change.

import db from '../database/db';
import log from '../utils/logger';

// `serialport` is a NATIVE module. We require it lazily inside a try/catch
// so the rest of the app keeps working if it failed to compile (e.g. on
// a dev machine without Visual Studio Build Tools). When it's missing,
// every CFD operation becomes a no-op and writes a one-time warning.
let SerialPortClass: any = null;
let serialPortLoadAttempted = false;
function loadSerialPort(): any {
  if (SerialPortClass || serialPortLoadAttempted) return SerialPortClass;
  serialPortLoadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sp = require('serialport');
    SerialPortClass = sp.SerialPort || sp.default || sp;
    return SerialPortClass;
  } catch (err: any) {
    log.warn(`CFD: 'serialport' module not available — customer display disabled. ${err?.message || err}`);
    return null;
  }
}

type CfdConfig = {
  enabled: boolean;
  path: string;
  baudRate: number;
  welcomeLine1: string;
  welcomeLine2: string;
};

const DEFAULT_CONFIG: CfdConfig = {
  enabled: false,
  path: 'COM5',
  baudRate: 9600,
  welcomeLine1: 'WELCOME TO',
  welcomeLine2: 'GUJJAR MILK SHOP'
};

let activePort: any = null;
let activeConfig: CfdConfig = { ...DEFAULT_CONFIG };
let lastWriteAt = 0;

function readSettings(): Partial<CfdConfig> {
  try {
    const rows = db.prepare(
      `SELECT key, value FROM settings WHERE key IN
        ('CFD_ENABLED','CFD_PORT','CFD_BAUD','CFD_WELCOME_1','CFD_WELCOME_2')`
    ).all() as Array<{ key: string; value: string }>;
    const map = rows.reduce<Record<string, string>>((acc, r) => {
      acc[r.key] = r.value;
      return acc;
    }, {});
    const out: Partial<CfdConfig> = {};
    if (map.CFD_ENABLED !== undefined) out.enabled = map.CFD_ENABLED === 'true' || map.CFD_ENABLED === '1';
    if (map.CFD_PORT) out.path = map.CFD_PORT;
    if (map.CFD_BAUD) {
      const n = Number(map.CFD_BAUD);
      if (Number.isFinite(n) && n > 0) out.baudRate = n;
    }
    if (map.CFD_WELCOME_1 !== undefined) out.welcomeLine1 = map.CFD_WELCOME_1;
    if (map.CFD_WELCOME_2 !== undefined) out.welcomeLine2 = map.CFD_WELCOME_2;
    return out;
  } catch (err: any) {
    log.warn(`CFD: failed to read settings — ${err?.message || err}`);
    return {};
  }
}

export function getCfdConfig(): CfdConfig {
  return { ...activeConfig };
}

export function isCfdConnected(): boolean {
  return Boolean(activePort?.isOpen);
}

// Pad/truncate to exactly 20 chars. The display's column count is fixed,
// so we need to ALWAYS write 40 bytes (line1 padded + line2 padded) —
// otherwise the previous frame's tail would linger on the right side.
function pad20(text: string) {
  const ascii = String(text || '')
    .replace(/[^\x20-\x7E]/g, '?'); // most CFDs are ASCII-only
  return ascii.length >= 20 ? ascii.slice(0, 20) : ascii.padEnd(20, ' ');
}

function buildFrame(line1: string, line2: string) {
  // 0x0C = form-feed/clear on most VFD pole displays (Epson DM-D110,
  // Logic Controls, Bematech). Some displays interpret 0x0D 0x0A as
  // line-2 cursor; we sidestep that by sending exactly 40 chars after
  // the clear and letting the device wrap.
  return Buffer.concat([
    Buffer.from([0x0C]),
    Buffer.from(pad20(line1) + pad20(line2), 'ascii')
  ]);
}

async function openPort(path: string, baudRate: number): Promise<any> {
  const SP = loadSerialPort();
  if (!SP) throw new Error("'serialport' native module is not installed");

  return await new Promise((resolve, reject) => {
    let port: any;
    try {
      port = new SP({ path, baudRate, autoOpen: false });
    } catch (err: any) {
      reject(err);
      return;
    }
    port.open((err: any) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(port);
    });
  });
}

async function closePort(port: any): Promise<void> {
  if (!port || !port.isOpen) return;
  return await new Promise<void>((resolve) => {
    try {
      port.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

// Reload settings from DB and reconnect if the path/baud changed. Called
// at startup AND whenever the user saves CFD settings.
export async function applyCfdConfig(): Promise<{ success: boolean; error?: string }> {
  const merged: CfdConfig = { ...DEFAULT_CONFIG, ...readSettings() };

  // Same config + already connected? Nothing to do.
  if (
    activePort?.isOpen &&
    activeConfig.path === merged.path &&
    activeConfig.baudRate === merged.baudRate &&
    activeConfig.enabled === merged.enabled
  ) {
    activeConfig = merged;
    return { success: true };
  }

  // Tear down the existing connection (if any) before opening a new one.
  if (activePort) {
    try { await closePort(activePort); } catch { /* ignore */ }
    activePort = null;
  }
  activeConfig = merged;

  if (!merged.enabled) {
    log.info('CFD: disabled in settings — display not opened.');
    return { success: true };
  }

  try {
    activePort = await openPort(merged.path, merged.baudRate);
    log.info(`CFD: connected on ${merged.path} @ ${merged.baudRate} baud.`);
    // Show the welcome banner so the cashier can confirm the display is alive.
    await writeFrame(merged.welcomeLine1, merged.welcomeLine2);
    return { success: true };
  } catch (err: any) {
    activePort = null;
    log.warn(`CFD: failed to open ${merged.path} — ${err?.message || err}`);
    return { success: false, error: err?.message || String(err) };
  }
}

async function writeFrame(line1: string, line2: string): Promise<void> {
  if (!activePort?.isOpen) return;
  return await new Promise<void>((resolve) => {
    try {
      activePort.write(buildFrame(line1, line2), (err: any) => {
        if (err) {
          log.warn(`CFD: write failed — ${err?.message || err}`);
        } else {
          lastWriteAt = Date.now();
        }
        resolve();
      });
    } catch (err: any) {
      log.warn(`CFD: write threw — ${err?.message || err}`);
      resolve();
    }
  });
}

// ---- Public API used by IPC + sales hooks --------------------------------

export async function showLines(line1: string, line2: string) {
  await writeFrame(line1, line2);
}

export async function showWelcome() {
  await writeFrame(activeConfig.welcomeLine1, activeConfig.welcomeLine2);
}

export async function showItem(name: string, price: number, qty?: number) {
  // Line 1 = item name (truncated). Line 2 = "qty x rate = total" or
  // just "Rs.<price>" when no qty given.
  const left = qty ? `${qty}x` : '';
  const right = `Rs.${formatAmount(price)}`;
  const line2 = left ? `${left} ${right}` : right;
  await writeFrame(name.toUpperCase(), line2);
}

export async function showCartTotal(itemCount: number, total: number) {
  const line1 = `ITEMS: ${itemCount}`;
  const line2 = `TOTAL Rs.${formatAmount(total)}`;
  await writeFrame(line1, line2);
}

export async function showThankYou(grandTotal: number, change?: number) {
  const line1 = `Rs.${formatAmount(grandTotal)} PAID`;
  const line2 = change && change > 0 ? `CHANGE Rs.${formatAmount(change)}` : 'THANK YOU!';
  await writeFrame(line1, line2);
  // Auto-revert to welcome banner after a few seconds so the next customer
  // sees the shop name and not the previous bill total.
  scheduleWelcome(8000);
}

let welcomeTimer: NodeJS.Timeout | null = null;
function scheduleWelcome(delayMs: number) {
  if (welcomeTimer) clearTimeout(welcomeTimer);
  welcomeTimer = setTimeout(() => {
    welcomeTimer = null;
    void showWelcome();
  }, delayMs);
}

function formatAmount(value: number) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toString();
}

// ---- Test helper used by Settings → "Test display" button ---------------

export async function testCfd(path: string, baudRate: number, line1?: string, line2?: string) {
  const SP = loadSerialPort();
  if (!SP) {
    return { success: false, error: "'serialport' module is not installed. Run npm install in electron-pos." };
  }

  let port: any;
  try {
    port = await openPort(path, baudRate);
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }

  try {
    await new Promise<void>((resolve, reject) => {
      port.write(buildFrame(line1 || 'NOON DAIRY POS', line2 || 'CFD TEST OK'), (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
    // Give the display time to render before we close (some VFDs lose the
    // last write if the port closes immediately).
    await new Promise((r) => setTimeout(r, 400));
    await closePort(port);
    return { success: true };
  } catch (err: any) {
    try { await closePort(port); } catch { /* ignore */ }
    return { success: false, error: err?.message || String(err) };
  }
}

// Listing serial ports — used by the Settings UI to populate a dropdown.
export async function listSerialPorts(): Promise<Array<{ path: string; manufacturer?: string; productId?: string; vendorId?: string; serialNumber?: string }>> {
  const SP = loadSerialPort();
  if (!SP || typeof SP.list !== 'function') return [];
  try {
    const ports = await SP.list();
    return ports.map((p: any) => ({
      path: p.path,
      manufacturer: p.manufacturer || '',
      productId: p.productId || '',
      vendorId: p.vendorId || '',
      serialNumber: p.serialNumber || ''
    }));
  } catch (err: any) {
    log.warn(`CFD: failed to list ports — ${err?.message || err}`);
    return [];
  }
}

// Suppress writes from sales hooks if the cashier hasn't enabled CFD yet —
// keeps the app silent on shops without a customer display.
export function isCfdEnabled(): boolean {
  return activeConfig.enabled;
}

// Diagnostics for the Settings → CFD page
export function getCfdStatus() {
  return {
    enabled: activeConfig.enabled,
    connected: isCfdConnected(),
    path: activeConfig.path,
    baudRate: activeConfig.baudRate,
    welcomeLine1: activeConfig.welcomeLine1,
    welcomeLine2: activeConfig.welcomeLine2,
    lastWriteAt: lastWriteAt || null,
    nativeAvailable: Boolean(loadSerialPort())
  };
}

export async function shutdownCfd() {
  if (welcomeTimer) {
    clearTimeout(welcomeTimer);
    welcomeTimer = null;
  }
  if (activePort) {
    try { await closePort(activePort); } catch { /* ignore */ }
    activePort = null;
  }
}
