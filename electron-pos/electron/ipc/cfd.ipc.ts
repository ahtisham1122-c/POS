import { ipcMain } from 'electron';
import db from '../database/db';
import { createOutboxEntry } from '../sync/outboxHelper';
import {
  applyCfdConfig,
  getCfdStatus,
  isCfdEnabled,
  listSerialPorts,
  showCartTotal,
  showItem,
  showLines,
  showThankYou,
  showWelcome,
  testCfd
} from '../peripherals/cfdDisplay';

// IPC for the Customer Facing Display (CFD) — 2x20 pole/VFD attached on
// COM5 of the HP AIO. The renderer calls these handlers as the cart
// changes; everything below the IPC boundary lives in
// electron/peripherals/cfdDisplay.ts.

export function registerCfdIPC() {
  ipcMain.handle('cfd:getStatus', () => getCfdStatus());

  ipcMain.handle('cfd:listPorts', async () => {
    return await listSerialPorts();
  });

  ipcMain.handle('cfd:test', async (
    _event,
    data: { path: string; baudRate?: number; line1?: string; line2?: string }
  ) => {
    if (!data?.path) return { success: false, error: 'A COM port is required' };
    const baud = Number(data?.baudRate) > 0 ? Number(data.baudRate) : 9600;
    return await testCfd(data.path, baud, data.line1, data.line2);
  });

  // Save settings + reconnect in one atomic step. The renderer can't open
  // the serial port itself (Electron blocks it for security), so anything
  // that touches a port must round-trip here.
  ipcMain.handle('cfd:saveConfig', async (_event, data: {
    enabled?: boolean;
    path?: string;
    baudRate?: number;
    welcomeLine1?: string;
    welcomeLine2?: string;
  }) => {
    try {
      const now = new Date().toISOString();
      const updates: Array<[string, string]> = [];
      if (data.enabled !== undefined) updates.push(['CFD_ENABLED', data.enabled ? 'true' : 'false']);
      if (data.path !== undefined) updates.push(['CFD_PORT', String(data.path)]);
      if (data.baudRate !== undefined) updates.push(['CFD_BAUD', String(Number(data.baudRate) || 9600)]);
      if (data.welcomeLine1 !== undefined) updates.push(['CFD_WELCOME_1', String(data.welcomeLine1)]);
      if (data.welcomeLine2 !== undefined) updates.push(['CFD_WELCOME_2', String(data.welcomeLine2)]);

      const upsert = db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (@key, @value, @updatedAt)
        ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @updatedAt
      `);
      const tx = db.transaction((rows: Array<[string, string]>) => {
        for (const [key, value] of rows) {
          upsert.run({ key, value, updatedAt: now });
          // Outbox the change so a multi-terminal owner can update CFD
          // settings centrally and have them sync. (CFD itself stays
          // device-local; we just propagate the preferences.)
          createOutboxEntry('settings', 'UPDATE', key, { key, value, updated_at: now });
        }
      });
      tx(updates);

      const result = await applyCfdConfig();
      return { success: result.success, error: result.error };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  // Re-apply (useful from the UI's Reconnect button).
  ipcMain.handle('cfd:reconnect', async () => {
    return await applyCfdConfig();
  });

  // Sales hooks — the renderer calls these as the cart changes. Each one
  // is a thin pass-through; if CFD is disabled the implementation is a
  // no-op so the renderer doesn't have to check first.
  ipcMain.handle('cfd:showItem', async (_event, data: { name: string; price: number; quantity?: number }) => {
    if (!isCfdEnabled()) return { success: true, skipped: true };
    await showItem(String(data?.name || ''), Number(data?.price || 0), Number(data?.quantity) || undefined);
    return { success: true };
  });

  ipcMain.handle('cfd:showCartTotal', async (_event, data: { itemCount: number; total: number }) => {
    if (!isCfdEnabled()) return { success: true, skipped: true };
    await showCartTotal(Number(data?.itemCount || 0), Number(data?.total || 0));
    return { success: true };
  });

  ipcMain.handle('cfd:showThankYou', async (_event, data: { grandTotal: number; change?: number }) => {
    if (!isCfdEnabled()) return { success: true, skipped: true };
    await showThankYou(Number(data?.grandTotal || 0), Number(data?.change) || 0);
    return { success: true };
  });

  ipcMain.handle('cfd:showWelcome', async () => {
    if (!isCfdEnabled()) return { success: true, skipped: true };
    await showWelcome();
    return { success: true };
  });

  ipcMain.handle('cfd:showLines', async (_event, data: { line1: string; line2: string }) => {
    if (!isCfdEnabled()) return { success: true, skipped: true };
    await showLines(String(data?.line1 || ''), String(data?.line2 || ''));
    return { success: true };
  });
}
