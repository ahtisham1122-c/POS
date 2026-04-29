import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { getCurrentUser } from './auth.ipc';
import { handleStockMutation } from './inventory.ipc';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextRiderCode() {
  const row = db.prepare('SELECT COUNT(*) as count FROM riders').get() as any;
  return `RDR-${String(Number(row?.count || 0) + 1).padStart(4, '0')}`;
}

function getMilkProduct() {
  return db.prepare(`
    SELECT * FROM products
    WHERE code = 'MILK' OR lower(name) LIKE '%milk%'
    ORDER BY code = 'MILK' DESC
    LIMIT 1
  `).get() as any;
}

function todayDate() {
  return new Date().toISOString().split('T')[0];
}

// Recalculate and persist totals on a session from its entries
function refreshSessionTotals(sessionId: string) {
  const pickupRow = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) as total
    FROM delivery_entries WHERE session_id = ? AND entry_type = 'PICKUP'
  `).get(sessionId) as any;

  const returnRow = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) as total
    FROM delivery_entries WHERE session_id = ? AND entry_type = 'RETURN'
  `).get(sessionId) as any;

  const totalPickup = Number(pickupRow?.total || 0);
  const totalReturn = Number(returnRow?.total || 0);
  const totalDelivered = Math.max(0, totalPickup - totalReturn);

  db.prepare(`
    UPDATE delivery_sessions
    SET total_pickup = ?, total_return = ?, total_delivered = ?
    WHERE id = ?
  `).run(totalPickup, totalReturn, totalDelivered, sessionId);

  return { totalPickup, totalReturn, totalDelivered };
}

// ─── IPC Registration ─────────────────────────────────────────────────────────

export function registerRidersIPC() {

  // ── Rider CRUD ──────────────────────────────────────────────────────────────

  ipcMain.handle('riders:getAll', (_event, showInactive = false) => {
    return db.prepare(`
      SELECT * FROM riders
      ${showInactive ? '' : 'WHERE is_active = 1'}
      ORDER BY name ASC
    `).all();
  });

  ipcMain.handle('riders:create', (_event, data: any) => {
    try {
      if (!data.name?.trim()) return { success: false, error: 'Rider name is required' };
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const code = nextRiderCode();

      db.prepare(`
        INSERT INTO riders (id, code, name, phone, area, is_active, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(id, code, data.name.trim(), data.phone || null, data.area || null, data.notes || null, now, now);

      return { success: true, id, code };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('riders:update', (_event, id: string, data: any) => {
    try {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE riders SET name = COALESCE(?, name), phone = ?, area = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(data.name?.trim() || null, data.phone || null, data.area || null, data.notes || null, now, id);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('riders:deactivate', (_event, id: string) => {
    try {
      const now = new Date().toISOString();
      db.prepare(`UPDATE riders SET is_active = 0, updated_at = ? WHERE id = ?`).run(now, id);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Today's Overview (all riders) ──────────────────────────────────────────

  ipcMain.handle('deliveries:getTodayOverview', () => {
    const date = todayDate();
    const sessions = db.prepare(`
      SELECT ds.*, r.name as rider_name, r.code as rider_code, r.area as rider_area
      FROM delivery_sessions ds
      JOIN riders r ON ds.rider_id = r.id
      WHERE ds.session_date = ?
      ORDER BY ds.created_at ASC
    `).all(date) as any[];

    const totalPickup = sessions.reduce((s, x) => s + Number(x.total_pickup || 0), 0);
    const totalReturn = sessions.reduce((s, x) => s + Number(x.total_return || 0), 0);
    const totalDelivered = sessions.reduce((s, x) => s + Number(x.total_delivered || 0), 0);
    const activeCount = sessions.filter(x => x.status === 'OPEN').length;
    const completedCount = sessions.filter(x => x.status === 'COMPLETED').length;

    return { sessions, totalPickup, totalReturn, totalDelivered, activeCount, completedCount };
  });

  // ── Get or create today's open session for a rider ─────────────────────────

  ipcMain.handle('deliveries:getOrCreateSession', (_event, riderId: string) => {
    try {
      const date = todayDate();
      const user = getCurrentUser();

      let session = db.prepare(`
        SELECT * FROM delivery_sessions
        WHERE rider_id = ? AND session_date = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(riderId, date) as any;

      if (!session) {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO delivery_sessions (id, rider_id, session_date, status, total_pickup, total_return, total_delivered, opened_by_id, created_at)
          VALUES (?, ?, ?, 'OPEN', 0, 0, 0, ?, ?)
        `).run(id, riderId, date, user?.id || 'system', now);
        session = db.prepare(`SELECT * FROM delivery_sessions WHERE id = ?`).get(id);
      }

      // Attach entries
      const entries = db.prepare(`
        SELECT * FROM delivery_entries WHERE session_id = ? ORDER BY created_at ASC
      `).all(session.id);

      return { success: true, session: { ...session, entries } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Add Pickup (deducts from milk inventory) ────────────────────────────────

  ipcMain.handle('deliveries:addPickup', (_event, data: { sessionId: string; riderId: string; quantity: number; notes?: string }) => {
    try {
      if (!data.quantity || Number(data.quantity) <= 0) return { success: false, error: 'Quantity must be greater than zero' };

      const session = db.prepare(`SELECT * FROM delivery_sessions WHERE id = ?`).get(data.sessionId) as any;
      if (!session) return { success: false, error: 'Session not found' };
      if (session.status === 'COMPLETED') return { success: false, error: 'Session is already completed — cannot add more entries' };

      const milkProduct = getMilkProduct();
      if (!milkProduct) return { success: false, error: 'Milk product not found in inventory' };

      const user = getCurrentUser();
      const now = new Date().toISOString();
      const entryId = crypto.randomUUID();
      const qty = Number(data.quantity);
      const rider = db.prepare('SELECT name FROM riders WHERE id = ?').get(data.riderId) as any;

      // Deduct from milk inventory
      const stockResult = handleStockMutation(milkProduct.id, -qty, 'DELIVERY_OUT', {
        userId: user?.id || 'system',
        referenceId: data.sessionId,
        notes: `Delivery pickup — Rider: ${rider?.name || data.riderId}${data.notes ? ` — ${data.notes}` : ''}`,
      }) as any;

      if (!stockResult?.success) return { success: false, error: stockResult?.error || 'Failed to update milk stock' };

      db.prepare(`
        INSERT INTO delivery_entries (id, session_id, rider_id, entry_type, quantity, notes, created_by_id, created_at)
        VALUES (?, ?, ?, 'PICKUP', ?, ?, ?, ?)
      `).run(entryId, data.sessionId, data.riderId, qty, data.notes || null, user?.id || 'system', now);

      const totals = refreshSessionTotals(data.sessionId);
      const milkStock = db.prepare('SELECT stock FROM products WHERE id = ?').get(milkProduct.id) as any;

      return { success: true, entryId, totals, milkStockRemaining: milkStock?.stock || 0 };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Add Return (adds back to milk inventory) ────────────────────────────────

  ipcMain.handle('deliveries:addReturn', (_event, data: { sessionId: string; riderId: string; quantity: number; notes?: string }) => {
    try {
      if (!data.quantity || Number(data.quantity) <= 0) return { success: false, error: 'Quantity must be greater than zero' };

      const session = db.prepare(`SELECT * FROM delivery_sessions WHERE id = ?`).get(data.sessionId) as any;
      if (!session) return { success: false, error: 'Session not found' };
      if (session.status === 'COMPLETED') return { success: false, error: 'Session is already completed — cannot add more entries' };

      // Return cannot exceed total pickup
      const totalPickup = Number(session.total_pickup || 0);
      const totalReturn = Number(session.total_return || 0);
      const qty = Number(data.quantity);
      if (totalReturn + qty > totalPickup) {
        return { success: false, error: `Return (${totalReturn + qty} kg) cannot exceed total pickup (${totalPickup} kg)` };
      }

      const milkProduct = getMilkProduct();
      if (!milkProduct) return { success: false, error: 'Milk product not found in inventory' };

      const user = getCurrentUser();
      const now = new Date().toISOString();
      const entryId = crypto.randomUUID();
      const rider = db.prepare('SELECT name FROM riders WHERE id = ?').get(data.riderId) as any;

      // Add back to milk inventory
      const stockResult = handleStockMutation(milkProduct.id, qty, 'DELIVERY_RETURN', {
        userId: user?.id || 'system',
        referenceId: data.sessionId,
        notes: `Delivery return — Rider: ${rider?.name || data.riderId}${data.notes ? ` — ${data.notes}` : ''}`,
      }) as any;

      if (!stockResult?.success) return { success: false, error: stockResult?.error || 'Failed to update milk stock' };

      db.prepare(`
        INSERT INTO delivery_entries (id, session_id, rider_id, entry_type, quantity, notes, created_by_id, created_at)
        VALUES (?, ?, ?, 'RETURN', ?, ?, ?, ?)
      `).run(entryId, data.sessionId, data.riderId, qty, data.notes || null, user?.id || 'system', now);

      const totals = refreshSessionTotals(data.sessionId);
      const milkStock = db.prepare('SELECT stock FROM products WHERE id = ?').get(milkProduct.id) as any;

      return { success: true, entryId, totals, milkStockRemaining: milkStock?.stock || 0 };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Complete Session ────────────────────────────────────────────────────────

  ipcMain.handle('deliveries:completeSession', (_event, sessionId: string, notes?: string) => {
    try {
      const session = db.prepare(`SELECT * FROM delivery_sessions WHERE id = ?`).get(sessionId) as any;
      if (!session) return { success: false, error: 'Session not found' };
      if (session.status === 'COMPLETED') return { success: false, error: 'Session already completed' };

      const user = getCurrentUser();
      const now = new Date().toISOString();
      const totals = refreshSessionTotals(sessionId);

      db.prepare(`
        UPDATE delivery_sessions
        SET status = 'COMPLETED', completed_by_id = ?, completed_at = ?, notes = COALESCE(?, notes)
        WHERE id = ?
      `).run(user?.id || 'system', now, notes || null, sessionId);

      return { success: true, totals };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Get Session with Entries ────────────────────────────────────────────────

  ipcMain.handle('deliveries:getSession', (_event, sessionId: string) => {
    const session = db.prepare(`SELECT * FROM delivery_sessions WHERE id = ?`).get(sessionId) as any;
    if (!session) return null;
    const entries = db.prepare(`
      SELECT * FROM delivery_entries WHERE session_id = ? ORDER BY created_at ASC
    `).all(sessionId);
    return { ...session, entries };
  });

  // ── History: past sessions for a rider ─────────────────────────────────────

  ipcMain.handle('deliveries:getRiderHistory', (_event, riderId: string, limit = 30) => {
    return db.prepare(`
      SELECT ds.*, COUNT(de.id) as entry_count
      FROM delivery_sessions ds
      LEFT JOIN delivery_entries de ON de.session_id = ds.id
      WHERE ds.rider_id = ?
      GROUP BY ds.id
      ORDER BY ds.session_date DESC
      LIMIT ?
    `).all(riderId, limit);
  });

  // ── History: all sessions (for the History tab) ─────────────────────────────

  ipcMain.handle('deliveries:getAllHistory', (_event, limit = 60) => {
    return db.prepare(`
      SELECT ds.*, r.name as rider_name, r.code as rider_code, r.area as rider_area,
             COUNT(de.id) as entry_count
      FROM delivery_sessions ds
      JOIN riders r ON ds.rider_id = r.id
      LEFT JOIN delivery_entries de ON de.session_id = ds.id
      WHERE ds.status = 'COMPLETED'
      GROUP BY ds.id
      ORDER BY ds.session_date DESC, ds.completed_at DESC
      LIMIT ?
    `).all(limit);
  });

  // ── Current milk stock (for display) ───────────────────────────────────────

  ipcMain.handle('deliveries:getMilkStock', () => {
    const milk = getMilkProduct();
    return milk ? { stock: milk.stock, unit: milk.unit } : { stock: 0, unit: 'kg' };
  });
}
