import db from '../database/db';
import * as crypto from 'crypto';
import os from 'os';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  terminalNumber: number;
}

export function getDeviceInfo(): DeviceInfo {
  let deviceIdRecord = db.prepare(`SELECT value FROM settings WHERE key = 'device_id'`).get() as any;
  let deviceNameRecord = db.prepare(`SELECT value FROM settings WHERE key = 'device_name'`).get() as any;
  let terminalNumRecord = db.prepare(`SELECT value FROM settings WHERE key = 'terminal_number'`).get() as any;

  const now = new Date().toISOString();

  if (!deviceIdRecord) {
    // Generate UUID once
    const newId = crypto.randomUUID();
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run('device_id', newId, now);
    deviceIdRecord = { value: newId };
  }

  if (!deviceNameRecord) {
    const hostName = os.hostname() || 'Unknown-PC';
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run('device_name', hostName, now);
    deviceNameRecord = { value: hostName };
  }

  if (!terminalNumRecord) {
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run('terminal_number', '1', now);
    terminalNumRecord = { value: '1' };
  }

  return {
    deviceId: deviceIdRecord.value,
    deviceName: deviceNameRecord.value,
    terminalNumber: parseInt(terminalNumRecord.value, 10),
  };
}
