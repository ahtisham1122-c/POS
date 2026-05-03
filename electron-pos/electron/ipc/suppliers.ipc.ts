import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { addCashOut } from '../database/cashRegister';
import { getCurrentUser, requireCurrentUser } from './auth.ipc';

type SupplierInput = {
  name: string;
  phone?: string;
  address?: string;
  allowedShifts: 'MORNING' | 'EVENING' | 'BOTH';
  defaultRate: number;
  cowRate?: number;
  buffaloRate?: number;
};

type CollectionInput = {
  supplierId: string;
  date: string;
  shift: 'MORNING' | 'EVENING';
  milkType?: 'COW' | 'BUFFALO' | 'MIXED';
  quantity: number;
  rate: number;
  notes?: string;
};

function getMilkProduct() {
  // Only the system MILK product — never match by name to avoid hitting "milk powder" etc.
  return db.prepare(`SELECT * FROM products WHERE code = 'MILK' LIMIT 1`).get() as any;
}

function normalizeMilkType(value?: string) {
  const milkType = String(value || 'MIXED').toUpperCase();
  return ['COW', 'BUFFALO', 'MIXED'].includes(milkType) ? milkType : 'MIXED';
}

function getSupplierRate(data: { defaultRate?: number; cowRate?: number; buffaloRate?: number }, milkType: string) {
  const defaultRate = Number(data.defaultRate || 0);
  if (milkType === 'COW') return Number(data.cowRate || defaultRate || 0);
  if (milkType === 'BUFFALO') return Number(data.buffaloRate || defaultRate || 0);
  return defaultRate;
}

function recalculateSupplierLedger(supplierId: string) {
  const rows = db.prepare(`
    SELECT id, entry_type, amount, balance_after, entry_date, created_at
    FROM supplier_ledger_entries
    WHERE supplier_id = ?
    ORDER BY entry_date ASC, created_at ASC, id ASC
  `).all(supplierId) as any[];

  let balance = 0;
  const updateLedger = db.prepare('UPDATE supplier_ledger_entries SET balance_after = ?, synced = 0 WHERE id = ?');

  for (const row of rows) {
    const amount = Number(row.amount || 0);
    balance += row.entry_type === 'PAYMENT' ? -amount : amount;
    if (Number(row.balance_after || 0) !== balance) {
      updateLedger.run(balance, row.id);
      createOutboxEntry('supplier_ledger_entries', 'UPDATE', row.id, {
        id: row.id,
        balance_after: balance
      });
    }
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE suppliers SET current_balance = ?, updated_at = ?, synced = 0 WHERE id = ?')
    .run(balance, now, supplierId);
  createOutboxEntry('suppliers', 'UPDATE', supplierId, {
    id: supplierId,
    current_balance: balance,
    updated_at: now
  });

  return balance;
}

function nextSupplierCode() {
  const row = db.prepare('SELECT COUNT(*) as count FROM suppliers').get() as any;
  return `SUP-${String(Number(row?.count || 0) + 1).padStart(4, '0')}`;
}

export function registerSuppliersIPC() {
  ipcMain.handle('suppliers:getAll', () => {
    return db.prepare(`
      SELECT *
      FROM suppliers
      WHERE is_active = 1
      ORDER BY name ASC
    `).all();
  });

  ipcMain.handle('suppliers:create', (_event, data: SupplierInput) => {
    try {
      requireCurrentUser(['ADMIN', 'MANAGER']);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const code = nextSupplierCode();
      const allowedShifts = data.allowedShifts || 'BOTH';
      const defaultRate = Number(data.defaultRate || 0);
      const cowRate = Number(data.cowRate || defaultRate || 0);
      const buffaloRate = Number(data.buffaloRate || defaultRate || 0);

      if (!data.name?.trim()) return { success: false, error: 'Supplier name is required' };

      db.prepare(`
        INSERT INTO suppliers (
          id, code, name, phone, address, allowed_shifts, default_rate, cow_rate, buffalo_rate,
          current_balance, is_active, created_at, updated_at, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, 0)
      `).run(id, code, data.name.trim(), data.phone || null, data.address || null, allowedShifts, defaultRate, cowRate, buffaloRate, now, now);

      createOutboxEntry('suppliers', 'INSERT', id, {
        id,
        code,
        name: data.name.trim(),
        phone: data.phone || null,
        address: data.address || null,
        allowed_shifts: allowedShifts,
        default_rate: defaultRate,
        cow_rate: cowRate,
        buffalo_rate: buffaloRate,
        current_balance: 0,
        created_at: now,
        updated_at: now
      });

      return { success: true, id };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('suppliers:update', (_event, id: string, data: SupplierInput) => {
    try {
      requireCurrentUser(['ADMIN', 'MANAGER']);
      const now = new Date().toISOString();
      if (!data.name?.trim()) return { success: false, error: 'Supplier name is required' };

      db.prepare(`
        UPDATE suppliers
        SET name = ?, phone = ?, address = ?, allowed_shifts = ?, default_rate = ?, cow_rate = ?, buffalo_rate = ?, updated_at = ?, synced = 0
        WHERE id = ?
      `).run(
        data.name.trim(),
        data.phone || null,
        data.address || null,
        data.allowedShifts || 'BOTH',
        Number(data.defaultRate || 0),
        Number(data.cowRate || data.defaultRate || 0),
        Number(data.buffaloRate || data.defaultRate || 0),
        now,
        id
      );

      createOutboxEntry('suppliers', 'UPDATE', id, {
        id,
        name: data.name.trim(),
        phone: data.phone || null,
        address: data.address || null,
        allowed_shifts: data.allowedShifts || 'BOTH',
        default_rate: Number(data.defaultRate || 0),
        cow_rate: Number(data.cowRate || data.defaultRate || 0),
        buffalo_rate: Number(data.buffaloRate || data.defaultRate || 0),
        updated_at: now
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('suppliers:collectMilk', (_event, data: CollectionInput) => {
    try {
      requireCurrentUser();
      return db.transaction(() => {
        const now = new Date().toISOString();
        const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ? AND is_active = 1').get(data.supplierId) as any;
        if (!supplier) throw new Error('Supplier not found');

        const shift = data.shift;
        if (!['MORNING', 'EVENING'].includes(shift)) throw new Error('Invalid collection shift');
        if (supplier.allowed_shifts !== 'BOTH' && supplier.allowed_shifts !== shift) {
          throw new Error(`${supplier.name} is not configured for ${shift.toLowerCase()} collection`);
        }

        const milkType = normalizeMilkType(data.milkType);
        const quantity = Number(data.quantity || 0);
        const rate = Number(data.rate || getSupplierRate({
          defaultRate: supplier.default_rate,
          cowRate: supplier.cow_rate,
          buffaloRate: supplier.buffalo_rate
        }, milkType));
        if (quantity <= 0) throw new Error('Milk quantity must be greater than zero');
        if (rate <= 0) throw new Error('Purchase rate must be greater than zero');

        const duplicate = db.prepare(`
          SELECT id
          FROM milk_collections
          WHERE supplier_id = ? AND collection_date = ? AND shift = ? AND milk_type = ?
          LIMIT 1
        `).get(supplier.id, data.date, shift, milkType) as any;
        if (duplicate) {
          throw new Error(`${supplier.name} ${milkType.toLowerCase()} milk is already entered for ${shift.toLowerCase()} on ${data.date}. Use Edit if the quantity or rate is wrong.`);
        }

        const totalAmount = Number((quantity * rate).toFixed(2));
        const collectionId = crypto.randomUUID();
        const userId = getCurrentUser()?.id || 'system';

        db.prepare(`
          INSERT INTO milk_collections (
            id, supplier_id, collection_date, shift, milk_type, quantity, rate,
            total_amount, notes, created_by_id, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(
          collectionId,
          supplier.id,
          data.date,
          shift,
          milkType,
          quantity,
          rate,
          totalAmount,
          data.notes || null,
          userId,
          now
        );

        createOutboxEntry('milk_collections', 'INSERT', collectionId, {
          id: collectionId,
          supplier_id: supplier.id,
          collection_date: data.date,
          shift,
          milk_type: milkType,
          quantity,
          rate,
          total_amount: totalAmount,
          notes: data.notes || null,
          created_by_id: userId,
          created_at: now
        });

        const newBalance = Number(supplier.current_balance || 0) + totalAmount;
        db.prepare('UPDATE suppliers SET current_balance = ?, updated_at = ?, synced = 0 WHERE id = ?')
          .run(newBalance, now, supplier.id);
        createOutboxEntry('suppliers', 'UPDATE', supplier.id, {
          id: supplier.id,
          current_balance: newBalance,
          updated_at: now
        });

        const ledgerId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO supplier_ledger_entries (
            id, supplier_id, collection_id, entry_type, amount, balance_after,
            description, entry_date, created_at, synced
          ) VALUES (?, ?, ?, 'MILK_COLLECTION', ?, ?, ?, ?, ?, 0)
        `).run(
          ledgerId,
          supplier.id,
          collectionId,
          totalAmount,
          newBalance,
          `${shift} ${milkType.toLowerCase()} milk collection ${quantity} kg @ Rs. ${rate}`,
          now,
          now
        );
        createOutboxEntry('supplier_ledger_entries', 'INSERT', ledgerId, {
          id: ledgerId,
          supplier_id: supplier.id,
          collection_id: collectionId,
          entry_type: 'MILK_COLLECTION',
          amount: totalAmount,
          balance_after: newBalance,
          description: `${shift} ${milkType.toLowerCase()} milk collection ${quantity} kg @ Rs. ${rate}`,
          entry_date: now,
          created_at: now
        });

        const milkProduct = getMilkProduct();
        if (milkProduct) {
          const stockBefore = Number(milkProduct.stock || 0);
          const stockAfter = stockBefore + quantity;
          db.prepare('UPDATE products SET stock = ?, cost_price = ?, updated_at = ?, synced = 0 WHERE id = ?')
            .run(stockAfter, rate, now, milkProduct.id);
          createOutboxEntry('products', 'UPDATE', milkProduct.id, {
            id: milkProduct.id,
            stock: stockAfter,
            cost_price: rate,
            updated_at: now
          });

          const movementId = crypto.randomUUID();
          db.prepare(`
            INSERT INTO stock_movements (
              id, product_id, movement_type, quantity, stock_before, stock_after,
              reference_id, supplier, notes, created_by_id, created_at, synced
            ) VALUES (?, ?, 'MILK_COLLECTION', ?, ?, ?, ?, ?, ?, ?, ?, 0)
          `).run(
            movementId,
            milkProduct.id,
            quantity,
            stockBefore,
            stockAfter,
            collectionId,
            supplier.name,
            `${shift} ${milkType.toLowerCase()} milk collection from ${supplier.name}`,
            userId,
            now
          );
          createOutboxEntry('stock_movements', 'INSERT', movementId, {
            id: movementId,
            product_id: milkProduct.id,
            movement_type: 'MILK_COLLECTION',
            quantity,
            stock_before: stockBefore,
            stock_after: stockAfter,
            reference_id: collectionId,
            supplier: supplier.name,
            notes: `${shift} ${milkType.toLowerCase()} milk collection from ${supplier.name}`,
            created_by_id: userId,
            created_at: now
          });
        }

        return { success: true, collectionId, totalAmount, supplierBalance: newBalance };
      })();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('suppliers:updateCollection', (_event, collectionId: string, data: Partial<CollectionInput>) => {
    try {
      requireCurrentUser(['ADMIN', 'MANAGER']);
      return db.transaction(() => {
        const now = new Date().toISOString();
        const existing = db.prepare(`
          SELECT mc.*, s.name as supplier_name, s.allowed_shifts, s.default_rate, s.cow_rate, s.buffalo_rate
          FROM milk_collections mc
          JOIN suppliers s ON s.id = mc.supplier_id
          WHERE mc.id = ?
        `).get(collectionId) as any;
        if (!existing) throw new Error('Milk collection not found');

        const shift = (data.shift || existing.shift) as 'MORNING' | 'EVENING';
        if (!['MORNING', 'EVENING'].includes(shift)) throw new Error('Invalid collection shift');
        if (existing.allowed_shifts !== 'BOTH' && existing.allowed_shifts !== shift) {
          throw new Error(`${existing.supplier_name} is not configured for ${shift.toLowerCase()} collection`);
        }

        const milkType = normalizeMilkType(data.milkType || existing.milk_type);
        const date = data.date || existing.collection_date;
        const duplicate = db.prepare(`
          SELECT id
          FROM milk_collections
          WHERE supplier_id = ? AND collection_date = ? AND shift = ? AND milk_type = ? AND id <> ?
          LIMIT 1
        `).get(existing.supplier_id, date, shift, milkType, collectionId) as any;
        if (duplicate) {
          throw new Error(`${existing.supplier_name} ${milkType.toLowerCase()} milk is already entered for ${shift.toLowerCase()} on ${date}.`);
        }

        const quantity = Number(data.quantity ?? existing.quantity ?? 0);
        const rate = Number(data.rate || getSupplierRate({
          defaultRate: existing.default_rate,
          cowRate: existing.cow_rate,
          buffaloRate: existing.buffalo_rate
        }, milkType));
        if (quantity <= 0) throw new Error('Milk quantity must be greater than zero');
        if (rate <= 0) throw new Error('Purchase rate must be greater than zero');

        const oldQuantity = Number(existing.quantity || 0);
        const quantityDelta = Number((quantity - oldQuantity).toFixed(3));
        const totalAmount = Number((quantity * rate).toFixed(2));

        db.prepare(`
          UPDATE milk_collections
          SET collection_date = ?, shift = ?, milk_type = ?, quantity = ?, rate = ?, total_amount = ?, notes = ?, synced = 0
          WHERE id = ?
        `).run(date, shift, milkType, quantity, rate, totalAmount, data.notes ?? existing.notes, collectionId);
        createOutboxEntry('milk_collections', 'UPDATE', collectionId, {
          id: collectionId,
          supplier_id: existing.supplier_id,
          collection_date: date,
          shift,
          milk_type: milkType,
          quantity,
          rate,
          total_amount: totalAmount,
          notes: data.notes ?? existing.notes,
          created_by_id: existing.created_by_id,
          created_at: existing.created_at
        });

        const ledger = db.prepare(`
          SELECT id
          FROM supplier_ledger_entries
          WHERE collection_id = ?
          LIMIT 1
        `).get(collectionId) as any;
        if (ledger) {
          const description = `${shift} ${milkType.toLowerCase()} milk collection ${quantity} kg @ Rs. ${rate}`;
          db.prepare('UPDATE supplier_ledger_entries SET amount = ?, description = ?, synced = 0 WHERE id = ?')
            .run(totalAmount, description, ledger.id);
          createOutboxEntry('supplier_ledger_entries', 'UPDATE', ledger.id, {
            id: ledger.id,
            amount: totalAmount,
            description
          });
        }

        const milkProduct = getMilkProduct();
        if (milkProduct && (quantityDelta !== 0 || Number(existing.rate || 0) !== rate)) {
          const stockAfter = Number((Number(milkProduct.stock || 0) + quantityDelta).toFixed(3));
          db.prepare('UPDATE products SET stock = ?, cost_price = ?, updated_at = ?, synced = 0 WHERE id = ?')
            .run(stockAfter, rate, now, milkProduct.id);
          createOutboxEntry('products', 'UPDATE', milkProduct.id, {
            id: milkProduct.id,
            stock: stockAfter,
            cost_price: rate,
            updated_at: now
          });
        }

        const movement = db.prepare('SELECT * FROM stock_movements WHERE reference_id = ? LIMIT 1').get(collectionId) as any;
        if (movement) {
          const stockBefore = Number(movement.stock_before || 0);
          const movementStockAfter = Number((stockBefore + quantity).toFixed(3));
          const notes = `${shift} ${milkType.toLowerCase()} milk collection from ${existing.supplier_name}`;
          db.prepare(`
            UPDATE stock_movements
            SET quantity = ?, stock_after = ?, supplier = ?, notes = ?, synced = 0
            WHERE id = ?
          `).run(quantity, movementStockAfter, existing.supplier_name, notes, movement.id);
          createOutboxEntry('stock_movements', 'UPDATE', movement.id, {
            id: movement.id,
            quantity,
            stock_after: movementStockAfter,
            supplier: existing.supplier_name,
            notes
          });
        }

        const supplierBalance = recalculateSupplierLedger(existing.supplier_id);
        return { success: true, collectionId, totalAmount, supplierBalance };
      })();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('suppliers:collectPayment', (_event, supplierId: string, data: { amount: number; notes?: string }) => {
    try {
      requireCurrentUser(['ADMIN', 'MANAGER']);
      return db.transaction(() => {
        const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ? AND is_active = 1').get(supplierId) as any;
        if (!supplier) throw new Error('Supplier not found');

        const amount = Number(data.amount || 0);
        if (amount <= 0) throw new Error('Payment amount must be greater than zero');
        if (amount > Number(supplier.current_balance || 0)) throw new Error('Payment cannot be more than supplier balance');

        const now = new Date().toISOString();
        const userId = getCurrentUser()?.id || 'system';
        const paymentId = crypto.randomUUID();
        const balanceAfter = Number(supplier.current_balance || 0) - amount;

        db.prepare(`
          INSERT INTO supplier_payments (
            id, supplier_id, amount, payment_date, paid_by_id, notes, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `).run(paymentId, supplierId, amount, now, userId, data.notes || null, now);

        createOutboxEntry('supplier_payments', 'INSERT', paymentId, {
          id: paymentId,
          supplier_id: supplierId,
          amount,
          payment_date: now,
          paid_by_id: userId,
          notes: data.notes || null,
          created_at: now
        });

        db.prepare('UPDATE suppliers SET current_balance = ?, updated_at = ?, synced = 0 WHERE id = ?')
          .run(balanceAfter, now, supplierId);
        createOutboxEntry('suppliers', 'UPDATE', supplierId, {
          id: supplierId,
          current_balance: balanceAfter,
          updated_at: now
        });

        const ledgerId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO supplier_ledger_entries (
            id, supplier_id, payment_id, entry_type, amount, balance_after,
            description, entry_date, created_at, synced
          ) VALUES (?, ?, ?, 'PAYMENT', ?, ?, ?, ?, ?, 0)
        `).run(ledgerId, supplierId, paymentId, amount, balanceAfter, `Paid supplier Rs. ${amount}`, now, now);
        createOutboxEntry('supplier_ledger_entries', 'INSERT', ledgerId, {
          id: ledgerId,
          supplier_id: supplierId,
          payment_id: paymentId,
          entry_type: 'PAYMENT',
          amount,
          balance_after: balanceAfter,
          description: `Paid supplier Rs. ${amount}`,
          entry_date: now,
          created_at: now
        });

        addCashOut(amount);

        return { success: true, paymentId, balanceAfter };
      })();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('suppliers:getCollections', (_event, filters?: { date?: string }) => {
    const date = filters?.date;
    if (date) {
      return db.prepare(`
        SELECT mc.*, s.name as supplier_name, s.code as supplier_code
        FROM milk_collections mc
        JOIN suppliers s ON s.id = mc.supplier_id
        WHERE mc.collection_date = ?
        ORDER BY mc.created_at DESC
      `).all(date);
    }

    return db.prepare(`
      SELECT mc.*, s.name as supplier_name, s.code as supplier_code
      FROM milk_collections mc
      JOIN suppliers s ON s.id = mc.supplier_id
      ORDER BY mc.created_at DESC
      LIMIT 300
    `).all();
  });

  ipcMain.handle('suppliers:getLedger', (_event, supplierId: string) => {
    return db.prepare(`
      SELECT *
      FROM supplier_ledger_entries
      WHERE supplier_id = ?
      ORDER BY entry_date DESC
      LIMIT 300
    `).all(supplierId);
  });

  ipcMain.handle('suppliers:getCycleReport', (_event, filters: { startDate: string; endDate: string }) => {
    const { startDate, endDate } = filters;

    const rows = db.prepare(`
      SELECT
        s.id,
        s.code,
        s.name,
        s.phone,
        s.allowed_shifts,
        s.current_balance,
        COALESCE(SUM(mc.quantity), 0) as total_quantity,
        COALESCE(SUM(CASE WHEN mc.shift = 'MORNING' THEN mc.quantity ELSE 0 END), 0) as morning_quantity,
        COALESCE(SUM(CASE WHEN mc.shift = 'EVENING' THEN mc.quantity ELSE 0 END), 0) as evening_quantity,
        COALESCE(SUM(CASE WHEN mc.milk_type = 'COW' THEN mc.quantity ELSE 0 END), 0) as cow_quantity,
        COALESCE(SUM(CASE WHEN mc.milk_type = 'BUFFALO' THEN mc.quantity ELSE 0 END), 0) as buffalo_quantity,
        COALESCE(SUM(mc.total_amount), 0) as collection_amount
      FROM suppliers s
      LEFT JOIN milk_collections mc
        ON mc.supplier_id = s.id
        AND mc.collection_date >= ?
        AND mc.collection_date <= ?
      WHERE s.is_active = 1
      GROUP BY s.id
      ORDER BY s.name ASC
    `).all(startDate, endDate) as any[];

    const paymentRows = db.prepare(`
      SELECT supplier_id, COALESCE(SUM(amount), 0) as paid_amount
      FROM supplier_payments
      WHERE substr(payment_date, 1, 10) >= ? AND substr(payment_date, 1, 10) <= ?
      GROUP BY supplier_id
    `).all(startDate, endDate) as any[];

    const paymentsBySupplier = new Map(paymentRows.map((row) => [row.supplier_id, Number(row.paid_amount || 0)]));

    const suppliers = rows.map((row) => {
      const paidAmount = paymentsBySupplier.get(row.id) || 0;
      const collectionAmount = Number(row.collection_amount || 0);
      return {
        ...row,
        total_quantity: Number(row.total_quantity || 0),
        morning_quantity: Number(row.morning_quantity || 0),
        evening_quantity: Number(row.evening_quantity || 0),
        cow_quantity: Number(row.cow_quantity || 0),
        buffalo_quantity: Number(row.buffalo_quantity || 0),
        collection_amount: collectionAmount,
        paid_amount: paidAmount,
        period_balance: collectionAmount - paidAmount
      };
    });

    const totals = suppliers.reduce((acc, row) => ({
      total_quantity: acc.total_quantity + row.total_quantity,
      morning_quantity: acc.morning_quantity + row.morning_quantity,
      evening_quantity: acc.evening_quantity + row.evening_quantity,
      cow_quantity: acc.cow_quantity + row.cow_quantity,
      buffalo_quantity: acc.buffalo_quantity + row.buffalo_quantity,
      collection_amount: acc.collection_amount + row.collection_amount,
      paid_amount: acc.paid_amount + row.paid_amount,
      period_balance: acc.period_balance + row.period_balance,
      current_balance: acc.current_balance + Number(row.current_balance || 0)
    }), {
      total_quantity: 0,
      morning_quantity: 0,
      evening_quantity: 0,
      cow_quantity: 0,
      buffalo_quantity: 0,
      collection_amount: 0,
      paid_amount: 0,
      period_balance: 0,
      current_balance: 0
    });

    return { startDate, endDate, suppliers, totals };
  });

  ipcMain.handle('suppliers:getCycleStatement', (_event, filters: { supplierId: string; startDate: string; endDate: string }) => {
    const { supplierId, startDate, endDate } = filters;
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId) as any;
    if (!supplier) return null;

    const collections = db.prepare(`
      SELECT *
      FROM milk_collections
      WHERE supplier_id = ?
      AND collection_date >= ?
      AND collection_date <= ?
      ORDER BY collection_date ASC, shift ASC, created_at ASC
    `).all(supplierId, startDate, endDate) as any[];

    const payments = db.prepare(`
      SELECT *
      FROM supplier_payments
      WHERE supplier_id = ?
      AND substr(payment_date, 1, 10) >= ?
      AND substr(payment_date, 1, 10) <= ?
      ORDER BY payment_date ASC
    `).all(supplierId, startDate, endDate) as any[];

    const openingRow = db.prepare(`
      SELECT balance_after
      FROM supplier_ledger_entries
      WHERE supplier_id = ? AND substr(entry_date, 1, 10) < ?
      ORDER BY entry_date DESC
      LIMIT 1
    `).get(supplierId, startDate) as any;

    const openingBalance = Number(openingRow?.balance_after || 0);
    const collectionAmount = collections.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const paidAmount = payments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const closingBalance = openingBalance + collectionAmount - paidAmount;
    const totalQuantity = collections.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const morningQuantity = collections
      .filter((row) => row.shift === 'MORNING')
      .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const eveningQuantity = collections
      .filter((row) => row.shift === 'EVENING')
      .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const cowQuantity = collections
      .filter((row) => row.milk_type === 'COW')
      .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const buffaloQuantity = collections
      .filter((row) => row.milk_type === 'BUFFALO')
      .reduce((sum, row) => sum + Number(row.quantity || 0), 0);

    return {
      supplier,
      startDate,
      endDate,
      openingBalance,
      collectionAmount,
      paidAmount,
      closingBalance,
      totalQuantity,
      morningQuantity,
      eveningQuantity,
      cowQuantity,
      buffaloQuantity,
      collections,
      payments
    };
  });
}
