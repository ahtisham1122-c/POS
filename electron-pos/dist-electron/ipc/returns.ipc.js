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
exports.registerReturnsIPC = registerReturnsIPC;
const electron_1 = require("electron");
const db_1 = __importDefault(require("../database/db"));
const crypto = __importStar(require("crypto"));
const outboxHelper_1 = require("../sync/outboxHelper");
const cashRegister_1 = require("../database/cashRegister");
const auth_ipc_1 = require("./auth.ipc");
const auditLog_1 = require("../audit/auditLog");
function nextReturnNumber() {
    const count = db_1.default.prepare('SELECT COUNT(*) as count FROM returns').get();
    return `RET-${String(Number(count?.count || 0) + 1).padStart(4, '0')}`;
}
function getAlreadyReturnedQty(saleItemId) {
    const row = db_1.default.prepare(`
    SELECT COALESCE(SUM(ri.quantity), 0) as qty
    FROM return_items ri
    JOIN returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = ? AND r.status = 'COMPLETED'
  `).get(saleItemId);
    return Number(row?.qty || 0);
}
function registerReturnsIPC() {
    electron_1.ipcMain.handle('returns:getAll', (_event, filters) => {
        const date = filters?.date?.trim();
        if (date) {
            return db_1.default.prepare(`
        SELECT r.*, COALESCE(c.name, 'Walk-in') as customer_name
        FROM returns r
        LEFT JOIN customers c ON c.id = r.customer_id
        WHERE r.return_date LIKE ?
        ORDER BY r.return_date DESC
      `).all(`${date}%`);
        }
        return db_1.default.prepare(`
      SELECT r.*, COALESCE(c.name, 'Walk-in') as customer_name
      FROM returns r
      LEFT JOIN customers c ON c.id = r.customer_id
      ORDER BY r.return_date DESC
      LIMIT 200
    `).all();
    });
    electron_1.ipcMain.handle('returns:getSaleForReturn', (_event, saleIdOrBillNumber) => {
        const lookup = saleIdOrBillNumber.trim();
        if (!lookup)
            return null;
        const sale = db_1.default.prepare(`
      SELECT s.*, COALESCE(c.name, 'Walk-in') as customer_name, c.current_balance
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id = ? OR s.bill_number = ?
    `).get(lookup, lookup);
        if (!sale)
            return null;
        const items = db_1.default.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY created_at ASC').all(sale.id);
        return {
            ...sale,
            items: items.map((item) => {
                const returnedQty = getAlreadyReturnedQty(item.id);
                return {
                    ...item,
                    returned_quantity: returnedQty,
                    returnable_quantity: Math.max(0, Number(item.quantity || 0) - returnedQty)
                };
            })
        };
    });
    electron_1.ipcMain.handle('returns:create', (_event, data) => {
        try {
            return db_1.default.transaction((input) => {
                if (!input.saleId)
                    throw new Error('Select a sale before creating a return');
                if (!input.items?.length)
                    throw new Error('Select at least one item to return');
                if (!input.reason?.trim())
                    throw new Error('Return reason is required');
                if (!['CASH', 'CREDIT_ADJUSTMENT'].includes(input.refundMethod)) {
                    throw new Error('Invalid refund method');
                }
                const now = new Date().toISOString();
                const approver = (0, auth_ipc_1.requireManagerApproval)(input.managerPin, 'processing a refund');
                const cashierId = (0, auth_ipc_1.requireCurrentUser)().id;
                const sale = db_1.default.prepare('SELECT * FROM sales WHERE id = ?').get(input.saleId);
                if (!sale)
                    throw new Error('Original sale was not found');
                if (sale.status === 'REFUNDED')
                    throw new Error('This bill is already fully refunded');
                const returnId = crypto.randomUUID();
                const returnNumber = nextReturnNumber();
                const restockItems = input.restockItems !== false;
                let refundAmount = 0;
                const insertReturnItem = db_1.default.prepare(`
          INSERT INTO return_items (
            id, return_id, sale_item_id, product_id, product_name, unit,
            quantity, unit_price, line_total, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `);
                const getProductStock = db_1.default.prepare('SELECT stock FROM products WHERE id = ?');
                const updateProductStock = db_1.default.prepare('UPDATE products SET stock = ?, updated_at = ?, synced = 0 WHERE id = ?');
                const insertStockMovement = db_1.default.prepare(`
          INSERT INTO stock_movements (
            id, product_id, movement_type, quantity, stock_before, stock_after,
            reference_id, notes, created_by_id, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `);
                for (const returnItem of input.items) {
                    const qty = Number(returnItem.quantity || 0);
                    if (qty <= 0)
                        throw new Error('Returned quantity must be greater than zero');
                    const saleItem = db_1.default.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?')
                        .get(returnItem.saleItemId, sale.id);
                    if (!saleItem)
                        throw new Error('One of the selected items does not belong to this bill');
                    const alreadyReturned = getAlreadyReturnedQty(saleItem.id);
                    const returnableQty = Number(saleItem.quantity || 0) - alreadyReturned;
                    if (qty > returnableQty) {
                        throw new Error(`${saleItem.product_name} can only return ${returnableQty} ${saleItem.unit}`);
                    }
                    const lineTotal = Number((qty * Number(saleItem.unit_price || 0)).toFixed(2));
                    refundAmount += lineTotal;
                    const returnItemId = crypto.randomUUID();
                    insertReturnItem.run(returnItemId, returnId, saleItem.id, saleItem.product_id, saleItem.product_name, saleItem.unit, qty, saleItem.unit_price, lineTotal, now);
                    (0, outboxHelper_1.createOutboxEntry)('return_items', 'INSERT', returnItemId, {
                        id: returnItemId,
                        return_id: returnId,
                        sale_item_id: saleItem.id,
                        product_id: saleItem.product_id,
                        quantity: qty,
                        line_total: lineTotal,
                        created_at: now
                    });
                    if (restockItems) {
                        const stockRow = getProductStock.get(saleItem.product_id);
                        const stockBefore = Number(stockRow?.stock || 0);
                        const stockAfter = stockBefore + qty;
                        updateProductStock.run(stockAfter, now, saleItem.product_id);
                        (0, outboxHelper_1.createOutboxEntry)('products', 'UPDATE', saleItem.product_id, {
                            id: saleItem.product_id,
                            stock: stockAfter,
                            updated_at: now
                        });
                        const movementId = crypto.randomUUID();
                        insertStockMovement.run(movementId, saleItem.product_id, 'RETURN_IN', qty, stockBefore, stockAfter, returnId, `Return ${returnNumber} for bill ${sale.bill_number}`, cashierId, now);
                        (0, outboxHelper_1.createOutboxEntry)('stock_movements', 'INSERT', movementId, {
                            id: movementId,
                            product_id: saleItem.product_id,
                            movement_type: 'RETURN_IN',
                            quantity: qty,
                            stock_before: stockBefore,
                            stock_after: stockAfter,
                            reference_id: returnId,
                            created_at: now
                        });
                    }
                }
                refundAmount = Number(refundAmount.toFixed(2));
                if (refundAmount <= 0)
                    throw new Error('Refund amount must be greater than zero');
                if (input.refundMethod === 'CASH') {
                    (0, cashRegister_1.addCashOut)(refundAmount, now.split('T')[0]);
                }
                if (input.refundMethod === 'CREDIT_ADJUSTMENT') {
                    if (!sale.customer_id)
                        throw new Error('Credit adjustment requires a customer bill');
                    const customer = db_1.default.prepare('SELECT current_balance FROM customers WHERE id = ?').get(sale.customer_id);
                    const currentBalance = Number(customer?.current_balance || 0);
                    if (refundAmount > currentBalance) {
                        throw new Error(`Customer balance is only Rs. ${currentBalance}. Use cash refund for the extra amount.`);
                    }
                    const balanceAfter = currentBalance - refundAmount;
                    db_1.default.prepare('UPDATE customers SET current_balance = ?, updated_at = ?, synced = 0 WHERE id = ?')
                        .run(balanceAfter, now, sale.customer_id);
                    (0, outboxHelper_1.createOutboxEntry)('customers', 'UPDATE', sale.customer_id, {
                        id: sale.customer_id,
                        current_balance: balanceAfter,
                        updated_at: now
                    });
                    const ledgerId = crypto.randomUUID();
                    db_1.default.prepare(`
            INSERT INTO ledger_entries (
              id, customer_id, sale_id, entry_type, amount, balance_after,
              description, entry_date, created_at, synced
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          `).run(ledgerId, sale.customer_id, sale.id, 'RETURN_CREDIT_ADJUSTMENT', refundAmount, balanceAfter, `Return ${returnNumber} against bill ${sale.bill_number}`, now, now);
                    (0, outboxHelper_1.createOutboxEntry)('ledger_entries', 'INSERT', ledgerId, {
                        id: ledgerId,
                        customer_id: sale.customer_id,
                        sale_id: sale.id,
                        entry_type: 'RETURN_CREDIT_ADJUSTMENT',
                        amount: refundAmount,
                        balance_after: balanceAfter,
                        created_at: now
                    });
                }
                db_1.default.prepare(`
          INSERT INTO returns (
            id, return_number, sale_id, bill_number, customer_id, cashier_id,
            return_date, refund_method, refund_amount, reason, restock_items,
            status, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, 0)
        `).run(returnId, returnNumber, sale.id, sale.bill_number, sale.customer_id || null, cashierId, now, input.refundMethod, refundAmount, input.reason.trim(), restockItems ? 1 : 0, now);
                (0, outboxHelper_1.createOutboxEntry)('returns', 'INSERT', returnId, {
                    id: returnId,
                    return_number: returnNumber,
                    sale_id: sale.id,
                    bill_number: sale.bill_number,
                    customer_id: sale.customer_id || null,
                    cashier_id: cashierId,
                    return_date: now,
                    refund_method: input.refundMethod,
                    refund_amount: refundAmount,
                    reason: input.reason.trim(),
                    restock_items: restockItems ? 1 : 0,
                    created_at: now
                });
                (0, auditLog_1.logAudit)({
                    actionType: 'REFUND_CREATED',
                    entityType: 'returns',
                    entityId: returnId,
                    before: { saleId: sale.id, billNumber: sale.bill_number },
                    after: { returnNumber, refundMethod: input.refundMethod, refundAmount, restockItems },
                    reason: input.reason.trim(),
                    approvedBy: approver
                });
                const returnedTotal = db_1.default.prepare(`
          SELECT COALESCE(SUM(refund_amount), 0) as total
          FROM returns
          WHERE sale_id = ? AND status = 'COMPLETED'
        `).get(sale.id);
                const newStatus = Number(returnedTotal?.total || 0) >= Number(sale.grand_total || 0)
                    ? 'REFUNDED'
                    : 'PARTIALLY_REFUNDED';
                db_1.default.prepare('UPDATE sales SET status = ?, synced = 0 WHERE id = ?').run(newStatus, sale.id);
                (0, outboxHelper_1.createOutboxEntry)('sales', 'UPDATE', sale.id, {
                    id: sale.id,
                    status: newStatus,
                    updated_at: now
                });
                return { success: true, returnId, returnNumber, refundAmount };
            })(data);
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
}
