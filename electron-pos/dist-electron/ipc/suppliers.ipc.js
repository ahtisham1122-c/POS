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
exports.registerSuppliersIPC = registerSuppliersIPC;
const electron_1 = require("electron");
const db_1 = __importDefault(require("../database/db"));
const crypto = __importStar(require("crypto"));
const outboxHelper_1 = require("../sync/outboxHelper");
const cashRegister_1 = require("../database/cashRegister");
const auth_ipc_1 = require("./auth.ipc");
function getMilkProduct() {
    return db_1.default.prepare(`
    SELECT *
    FROM products
    WHERE code = 'MILK' OR lower(name) LIKE '%milk%'
    ORDER BY code = 'MILK' DESC
    LIMIT 1
  `).get();
}
function nextSupplierCode() {
    const row = db_1.default.prepare('SELECT COUNT(*) as count FROM suppliers').get();
    return `SUP-${String(Number(row?.count || 0) + 1).padStart(4, '0')}`;
}
function registerSuppliersIPC() {
    electron_1.ipcMain.handle('suppliers:getAll', () => {
        return db_1.default.prepare(`
      SELECT *
      FROM suppliers
      WHERE is_active = 1
      ORDER BY name ASC
    `).all();
    });
    electron_1.ipcMain.handle('suppliers:create', (_event, data) => {
        try {
            const now = new Date().toISOString();
            const id = crypto.randomUUID();
            const code = nextSupplierCode();
            const allowedShifts = data.allowedShifts || 'BOTH';
            const defaultRate = Number(data.defaultRate || 0);
            if (!data.name?.trim())
                return { success: false, error: 'Supplier name is required' };
            db_1.default.prepare(`
        INSERT INTO suppliers (
          id, code, name, phone, address, allowed_shifts, default_rate,
          current_balance, is_active, created_at, updated_at, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, 0)
      `).run(id, code, data.name.trim(), data.phone || null, data.address || null, allowedShifts, defaultRate, now, now);
            (0, outboxHelper_1.createOutboxEntry)('suppliers', 'INSERT', id, {
                id,
                code,
                name: data.name.trim(),
                phone: data.phone || null,
                address: data.address || null,
                allowed_shifts: allowedShifts,
                default_rate: defaultRate,
                current_balance: 0,
                created_at: now,
                updated_at: now
            });
            return { success: true, id };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('suppliers:update', (_event, id, data) => {
        try {
            const now = new Date().toISOString();
            if (!data.name?.trim())
                return { success: false, error: 'Supplier name is required' };
            db_1.default.prepare(`
        UPDATE suppliers
        SET name = ?, phone = ?, address = ?, allowed_shifts = ?, default_rate = ?, updated_at = ?, synced = 0
        WHERE id = ?
      `).run(data.name.trim(), data.phone || null, data.address || null, data.allowedShifts || 'BOTH', Number(data.defaultRate || 0), now, id);
            (0, outboxHelper_1.createOutboxEntry)('suppliers', 'UPDATE', id, {
                id,
                name: data.name.trim(),
                phone: data.phone || null,
                address: data.address || null,
                allowed_shifts: data.allowedShifts || 'BOTH',
                default_rate: Number(data.defaultRate || 0),
                updated_at: now
            });
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('suppliers:collectMilk', (_event, data) => {
        try {
            return db_1.default.transaction(() => {
                const now = new Date().toISOString();
                const supplier = db_1.default.prepare('SELECT * FROM suppliers WHERE id = ? AND is_active = 1').get(data.supplierId);
                if (!supplier)
                    throw new Error('Supplier not found');
                const shift = data.shift;
                if (!['MORNING', 'EVENING'].includes(shift))
                    throw new Error('Invalid collection shift');
                if (supplier.allowed_shifts !== 'BOTH' && supplier.allowed_shifts !== shift) {
                    throw new Error(`${supplier.name} is not configured for ${shift.toLowerCase()} collection`);
                }
                const quantity = Number(data.quantity || 0);
                const rate = Number(data.rate || 0);
                if (quantity <= 0)
                    throw new Error('Milk quantity must be greater than zero');
                if (rate <= 0)
                    throw new Error('Purchase rate must be greater than zero');
                const totalAmount = Number((quantity * rate).toFixed(2));
                const collectionId = crypto.randomUUID();
                const userId = (0, auth_ipc_1.getCurrentUser)()?.id || 'system';
                db_1.default.prepare(`
          INSERT INTO milk_collections (
            id, supplier_id, collection_date, shift, quantity, rate,
            total_amount, notes, created_by_id, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(collectionId, supplier.id, data.date, shift, quantity, rate, totalAmount, data.notes || null, userId, now);
                (0, outboxHelper_1.createOutboxEntry)('milk_collections', 'INSERT', collectionId, {
                    id: collectionId,
                    supplier_id: supplier.id,
                    collection_date: data.date,
                    shift,
                    quantity,
                    rate,
                    total_amount: totalAmount,
                    notes: data.notes || null,
                    created_by_id: userId,
                    created_at: now
                });
                const newBalance = Number(supplier.current_balance || 0) + totalAmount;
                db_1.default.prepare('UPDATE suppliers SET current_balance = ?, updated_at = ?, synced = 0 WHERE id = ?')
                    .run(newBalance, now, supplier.id);
                (0, outboxHelper_1.createOutboxEntry)('suppliers', 'UPDATE', supplier.id, {
                    id: supplier.id,
                    current_balance: newBalance,
                    updated_at: now
                });
                const ledgerId = crypto.randomUUID();
                db_1.default.prepare(`
          INSERT INTO supplier_ledger_entries (
            id, supplier_id, collection_id, entry_type, amount, balance_after,
            description, entry_date, created_at, synced
          ) VALUES (?, ?, ?, 'MILK_COLLECTION', ?, ?, ?, ?, ?, 0)
        `).run(ledgerId, supplier.id, collectionId, totalAmount, newBalance, `${shift} milk collection ${quantity} kg @ Rs. ${rate}`, now, now);
                (0, outboxHelper_1.createOutboxEntry)('supplier_ledger_entries', 'INSERT', ledgerId, {
                    id: ledgerId,
                    supplier_id: supplier.id,
                    collection_id: collectionId,
                    entry_type: 'MILK_COLLECTION',
                    amount: totalAmount,
                    balance_after: newBalance,
                    created_at: now
                });
                const milkProduct = getMilkProduct();
                if (milkProduct) {
                    const stockBefore = Number(milkProduct.stock || 0);
                    const stockAfter = stockBefore + quantity;
                    db_1.default.prepare('UPDATE products SET stock = ?, cost_price = ?, updated_at = ?, synced = 0 WHERE id = ?')
                        .run(stockAfter, rate, now, milkProduct.id);
                    (0, outboxHelper_1.createOutboxEntry)('products', 'UPDATE', milkProduct.id, {
                        id: milkProduct.id,
                        stock: stockAfter,
                        cost_price: rate,
                        updated_at: now
                    });
                    const movementId = crypto.randomUUID();
                    db_1.default.prepare(`
            INSERT INTO stock_movements (
              id, product_id, movement_type, quantity, stock_before, stock_after,
              reference_id, supplier, notes, created_by_id, created_at, synced
            ) VALUES (?, ?, 'MILK_COLLECTION', ?, ?, ?, ?, ?, ?, ?, ?, 0)
          `).run(movementId, milkProduct.id, quantity, stockBefore, stockAfter, collectionId, supplier.name, `${shift} collection from ${supplier.name}`, userId, now);
                    (0, outboxHelper_1.createOutboxEntry)('stock_movements', 'INSERT', movementId, {
                        id: movementId,
                        product_id: milkProduct.id,
                        movement_type: 'MILK_COLLECTION',
                        quantity,
                        stock_before: stockBefore,
                        stock_after: stockAfter,
                        reference_id: collectionId,
                        supplier: supplier.name,
                        created_at: now
                    });
                }
                return { success: true, collectionId, totalAmount, supplierBalance: newBalance };
            })();
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('suppliers:collectPayment', (_event, supplierId, data) => {
        try {
            return db_1.default.transaction(() => {
                const supplier = db_1.default.prepare('SELECT * FROM suppliers WHERE id = ? AND is_active = 1').get(supplierId);
                if (!supplier)
                    throw new Error('Supplier not found');
                const amount = Number(data.amount || 0);
                if (amount <= 0)
                    throw new Error('Payment amount must be greater than zero');
                if (amount > Number(supplier.current_balance || 0))
                    throw new Error('Payment cannot be more than supplier balance');
                const now = new Date().toISOString();
                const userId = (0, auth_ipc_1.getCurrentUser)()?.id || 'system';
                const paymentId = crypto.randomUUID();
                const balanceAfter = Number(supplier.current_balance || 0) - amount;
                db_1.default.prepare(`
          INSERT INTO supplier_payments (
            id, supplier_id, amount, payment_date, paid_by_id, notes, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `).run(paymentId, supplierId, amount, now, userId, data.notes || null, now);
                (0, outboxHelper_1.createOutboxEntry)('supplier_payments', 'INSERT', paymentId, {
                    id: paymentId,
                    supplier_id: supplierId,
                    amount,
                    payment_date: now,
                    paid_by_id: userId,
                    notes: data.notes || null,
                    created_at: now
                });
                db_1.default.prepare('UPDATE suppliers SET current_balance = ?, updated_at = ?, synced = 0 WHERE id = ?')
                    .run(balanceAfter, now, supplierId);
                (0, outboxHelper_1.createOutboxEntry)('suppliers', 'UPDATE', supplierId, {
                    id: supplierId,
                    current_balance: balanceAfter,
                    updated_at: now
                });
                const ledgerId = crypto.randomUUID();
                db_1.default.prepare(`
          INSERT INTO supplier_ledger_entries (
            id, supplier_id, payment_id, entry_type, amount, balance_after,
            description, entry_date, created_at, synced
          ) VALUES (?, ?, ?, 'PAYMENT', ?, ?, ?, ?, ?, 0)
        `).run(ledgerId, supplierId, paymentId, amount, balanceAfter, `Paid supplier Rs. ${amount}`, now, now);
                (0, outboxHelper_1.createOutboxEntry)('supplier_ledger_entries', 'INSERT', ledgerId, {
                    id: ledgerId,
                    supplier_id: supplierId,
                    payment_id: paymentId,
                    entry_type: 'PAYMENT',
                    amount,
                    balance_after: balanceAfter,
                    created_at: now
                });
                (0, cashRegister_1.addCashOut)(amount, now.split('T')[0]);
                return { success: true, paymentId, balanceAfter };
            })();
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('suppliers:getCollections', (_event, filters) => {
        const date = filters?.date;
        if (date) {
            return db_1.default.prepare(`
        SELECT mc.*, s.name as supplier_name, s.code as supplier_code
        FROM milk_collections mc
        JOIN suppliers s ON s.id = mc.supplier_id
        WHERE mc.collection_date = ?
        ORDER BY mc.created_at DESC
      `).all(date);
        }
        return db_1.default.prepare(`
      SELECT mc.*, s.name as supplier_name, s.code as supplier_code
      FROM milk_collections mc
      JOIN suppliers s ON s.id = mc.supplier_id
      ORDER BY mc.created_at DESC
      LIMIT 300
    `).all();
    });
    electron_1.ipcMain.handle('suppliers:getLedger', (_event, supplierId) => {
        return db_1.default.prepare(`
      SELECT *
      FROM supplier_ledger_entries
      WHERE supplier_id = ?
      ORDER BY entry_date DESC
      LIMIT 300
    `).all(supplierId);
    });
    electron_1.ipcMain.handle('suppliers:getCycleReport', (_event, filters) => {
        const { startDate, endDate } = filters;
        const rows = db_1.default.prepare(`
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
        COALESCE(SUM(mc.total_amount), 0) as collection_amount
      FROM suppliers s
      LEFT JOIN milk_collections mc
        ON mc.supplier_id = s.id
        AND mc.collection_date >= ?
        AND mc.collection_date <= ?
      WHERE s.is_active = 1
      GROUP BY s.id
      ORDER BY s.name ASC
    `).all(startDate, endDate);
        const paymentRows = db_1.default.prepare(`
      SELECT supplier_id, COALESCE(SUM(amount), 0) as paid_amount
      FROM supplier_payments
      WHERE substr(payment_date, 1, 10) >= ? AND substr(payment_date, 1, 10) <= ?
      GROUP BY supplier_id
    `).all(startDate, endDate);
        const paymentsBySupplier = new Map(paymentRows.map((row) => [row.supplier_id, Number(row.paid_amount || 0)]));
        const suppliers = rows.map((row) => {
            const paidAmount = paymentsBySupplier.get(row.id) || 0;
            const collectionAmount = Number(row.collection_amount || 0);
            return {
                ...row,
                total_quantity: Number(row.total_quantity || 0),
                morning_quantity: Number(row.morning_quantity || 0),
                evening_quantity: Number(row.evening_quantity || 0),
                collection_amount: collectionAmount,
                paid_amount: paidAmount,
                period_balance: collectionAmount - paidAmount
            };
        });
        const totals = suppliers.reduce((acc, row) => ({
            total_quantity: acc.total_quantity + row.total_quantity,
            morning_quantity: acc.morning_quantity + row.morning_quantity,
            evening_quantity: acc.evening_quantity + row.evening_quantity,
            collection_amount: acc.collection_amount + row.collection_amount,
            paid_amount: acc.paid_amount + row.paid_amount,
            period_balance: acc.period_balance + row.period_balance,
            current_balance: acc.current_balance + Number(row.current_balance || 0)
        }), {
            total_quantity: 0,
            morning_quantity: 0,
            evening_quantity: 0,
            collection_amount: 0,
            paid_amount: 0,
            period_balance: 0,
            current_balance: 0
        });
        return { startDate, endDate, suppliers, totals };
    });
    electron_1.ipcMain.handle('suppliers:getCycleStatement', (_event, filters) => {
        const { supplierId, startDate, endDate } = filters;
        const supplier = db_1.default.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId);
        if (!supplier)
            return null;
        const collections = db_1.default.prepare(`
      SELECT *
      FROM milk_collections
      WHERE supplier_id = ?
      AND collection_date >= ?
      AND collection_date <= ?
      ORDER BY collection_date ASC, shift ASC, created_at ASC
    `).all(supplierId, startDate, endDate);
        const payments = db_1.default.prepare(`
      SELECT *
      FROM supplier_payments
      WHERE supplier_id = ?
      AND substr(payment_date, 1, 10) >= ?
      AND substr(payment_date, 1, 10) <= ?
      ORDER BY payment_date ASC
    `).all(supplierId, startDate, endDate);
        const openingRow = db_1.default.prepare(`
      SELECT balance_after
      FROM supplier_ledger_entries
      WHERE supplier_id = ? AND substr(entry_date, 1, 10) < ?
      ORDER BY entry_date DESC
      LIMIT 1
    `).get(supplierId, startDate);
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
            collections,
            payments
        };
    });
}
