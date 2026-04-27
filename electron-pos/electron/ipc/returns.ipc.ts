import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { addCashOut } from '../database/cashRegister';
import { requireCurrentUser, requireManagerApproval } from './auth.ipc';
import { logAudit } from '../audit/auditLog';
import { getActiveBusinessDate, getOpenShift } from '../database/businessDay';

type RefundMethod = 'CASH' | 'CREDIT_ADJUSTMENT';

type ReturnItemInput = {
  saleItemId: string;
  quantity: number;
};

type CreateReturnInput = {
  saleId: string;
  items: ReturnItemInput[];
  refundMethod: RefundMethod;
  reason: string;
  restockItems?: boolean;
};

function nextReturnNumber() {
  const count = db.prepare('SELECT COUNT(*) as count FROM returns').get() as any;
  return `RET-${String(Number(count?.count || 0) + 1).padStart(4, '0')}`;
}

function getAlreadyReturnedQty(saleItemId: string) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(ri.quantity), 0) as qty
    FROM return_items ri
    JOIN returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = ? AND r.status = 'COMPLETED'
  `).get(saleItemId) as any;

  return Number(row?.qty || 0);
}

export function registerReturnsIPC() {
  ipcMain.handle('returns:getAll', (_event, filters?: { date?: string }) => {
    const date = filters?.date?.trim();
    if (date) {
      return db.prepare(`
        SELECT r.*, COALESCE(c.name, 'Walk-in') as customer_name
        FROM returns r
        LEFT JOIN customers c ON c.id = r.customer_id
        WHERE r.return_date LIKE ?
        ORDER BY r.return_date DESC
      `).all(`${date}%`);
    }

    return db.prepare(`
      SELECT r.*, COALESCE(c.name, 'Walk-in') as customer_name
      FROM returns r
      LEFT JOIN customers c ON c.id = r.customer_id
      ORDER BY r.return_date DESC
      LIMIT 200
    `).all();
  });

  ipcMain.handle('returns:getSaleForReturn', (_event, saleIdOrBillNumber: string) => {
    const lookup = saleIdOrBillNumber.trim();
    if (!lookup) return null;

    const sale = db.prepare(`
      SELECT s.*, COALESCE(c.name, 'Walk-in') as customer_name, c.current_balance
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id = ? OR s.bill_number = ?
    `).get(lookup, lookup) as any;

    if (!sale) return null;

    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY created_at ASC').all(sale.id) as any[];
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

  ipcMain.handle('returns:create', (_event, data: CreateReturnInput) => {
    try {
      return db.transaction((input: CreateReturnInput) => {
        if (!input.saleId) throw new Error('Select a sale before creating a return');
        if (!input.items?.length) throw new Error('Select at least one item to return');
        if (!input.reason?.trim()) throw new Error('Return reason is required');
        if (!['CASH', 'CREDIT_ADJUSTMENT'].includes(input.refundMethod)) {
          throw new Error('Invalid refund method');
        }

        const now = new Date().toISOString();
        const approver = requireManagerApproval((input as any).managerPin, 'processing a refund');
        const cashierId = requireCurrentUser().id;
        const actionShift = getOpenShift();
        const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(input.saleId) as any;
        if (!sale) throw new Error('Original sale was not found');
        if (sale.status === 'REFUNDED') throw new Error('This bill is already fully refunded');

        const returnId = crypto.randomUUID();
        const returnNumber = nextReturnNumber();
        const restockItems = input.restockItems !== false;
        let refundAmount = 0;

        const insertReturnItem = db.prepare(`
          INSERT INTO return_items (
            id, return_id, sale_item_id, product_id, product_name, unit,
            quantity, unit_price, line_total, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `);

        const getProductStock = db.prepare('SELECT stock FROM products WHERE id = ?');
        const updateProductStock = db.prepare('UPDATE products SET stock = ?, updated_at = ?, synced = 0 WHERE id = ?');
        const insertStockMovement = db.prepare(`
          INSERT INTO stock_movements (
            id, product_id, movement_type, quantity, stock_before, stock_after,
            reference_id, notes, created_by_id, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `);

        for (const returnItem of input.items) {
          const qty = Number(returnItem.quantity || 0);
          if (qty <= 0) throw new Error('Returned quantity must be greater than zero');

          const saleItem = db.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?')
            .get(returnItem.saleItemId, sale.id) as any;
          if (!saleItem) throw new Error('One of the selected items does not belong to this bill');

          const alreadyReturned = getAlreadyReturnedQty(saleItem.id);
          const returnableQty = Number(saleItem.quantity || 0) - alreadyReturned;
          if (qty > returnableQty) {
            throw new Error(`${saleItem.product_name} can only return ${returnableQty} ${saleItem.unit}`);
          }

          const lineTotal = Number((qty * Number(saleItem.unit_price || 0)).toFixed(2));
          refundAmount += lineTotal;

          const returnItemId = crypto.randomUUID();
          insertReturnItem.run(
            returnItemId,
            returnId,
            saleItem.id,
            saleItem.product_id,
            saleItem.product_name,
            saleItem.unit,
            qty,
            saleItem.unit_price,
            lineTotal,
            now
          );

          createOutboxEntry('return_items', 'INSERT', returnItemId, {
            id: returnItemId,
            return_id: returnId,
            sale_item_id: saleItem.id,
            product_id: saleItem.product_id,
            quantity: qty,
            line_total: lineTotal,
            created_at: now
          });

          if (restockItems) {
            const stockRow = getProductStock.get(saleItem.product_id) as any;
            const stockBefore = Number(stockRow?.stock || 0);
            const stockAfter = stockBefore + qty;
            updateProductStock.run(stockAfter, now, saleItem.product_id);
            createOutboxEntry('products', 'UPDATE', saleItem.product_id, {
              id: saleItem.product_id,
              stock: stockAfter,
              updated_at: now
            });

            const movementId = crypto.randomUUID();
            insertStockMovement.run(
              movementId,
              saleItem.product_id,
              'RETURN_IN',
              qty,
              stockBefore,
              stockAfter,
              returnId,
              `Return ${returnNumber} for bill ${sale.bill_number}`,
              cashierId,
              now
            );
            createOutboxEntry('stock_movements', 'INSERT', movementId, {
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
        if (refundAmount <= 0) throw new Error('Refund amount must be greater than zero');

        if (input.refundMethod === 'CASH') {
          addCashOut(refundAmount, actionShift?.shift_date || getActiveBusinessDate(new Date(now)), actionShift?.id || null);
        }

        if (input.refundMethod === 'CREDIT_ADJUSTMENT') {
          if (!sale.customer_id) throw new Error('Credit adjustment requires a customer bill');
          const customer = db.prepare('SELECT current_balance FROM customers WHERE id = ?').get(sale.customer_id) as any;
          const currentBalance = Number(customer?.current_balance || 0);
          if (refundAmount > currentBalance) {
            throw new Error(`Customer balance is only Rs. ${currentBalance}. Use cash refund for the extra amount.`);
          }

          const balanceAfter = currentBalance - refundAmount;
          db.prepare('UPDATE customers SET current_balance = ?, updated_at = ?, synced = 0 WHERE id = ?')
            .run(balanceAfter, now, sale.customer_id);
          createOutboxEntry('customers', 'UPDATE', sale.customer_id, {
            id: sale.customer_id,
            current_balance: balanceAfter,
            updated_at: now
          });

          const ledgerId = crypto.randomUUID();
          db.prepare(`
            INSERT INTO ledger_entries (
              id, customer_id, sale_id, entry_type, amount, balance_after,
              description, entry_date, created_at, synced
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          `).run(
            ledgerId,
            sale.customer_id,
            sale.id,
            'RETURN_CREDIT_ADJUSTMENT',
            refundAmount,
            balanceAfter,
            `Return ${returnNumber} against bill ${sale.bill_number}`,
            now,
            now
          );
          createOutboxEntry('ledger_entries', 'INSERT', ledgerId, {
            id: ledgerId,
            customer_id: sale.customer_id,
            sale_id: sale.id,
            entry_type: 'RETURN_CREDIT_ADJUSTMENT',
            amount: refundAmount,
            balance_after: balanceAfter,
            created_at: now
          });
        }

        db.prepare(`
          INSERT INTO returns (
            id, return_number, sale_id, shift_id, bill_number, customer_id, cashier_id,
            return_date, refund_method, refund_amount, reason, restock_items,
            status, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, 0)
        `).run(
          returnId,
          returnNumber,
          sale.id,
          actionShift?.id || sale.shift_id || null,
          sale.bill_number,
          sale.customer_id || null,
          cashierId,
          now,
          input.refundMethod,
          refundAmount,
          input.reason.trim(),
          restockItems ? 1 : 0,
          now
        );

        createOutboxEntry('returns', 'INSERT', returnId, {
          id: returnId,
          return_number: returnNumber,
          sale_id: sale.id,
          shift_id: actionShift?.id || sale.shift_id || null,
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

        logAudit({
          actionType: 'REFUND_CREATED',
          entityType: 'returns',
          entityId: returnId,
          before: { saleId: sale.id, billNumber: sale.bill_number },
          after: { returnNumber, refundMethod: input.refundMethod, refundAmount, restockItems },
          reason: input.reason.trim(),
          approvedBy: approver
        });

        const returnedTotal = db.prepare(`
          SELECT COALESCE(SUM(refund_amount), 0) as total
          FROM returns
          WHERE sale_id = ? AND status = 'COMPLETED'
        `).get(sale.id) as any;

        const newStatus = Number(returnedTotal?.total || 0) >= Number(sale.grand_total || 0)
          ? 'REFUNDED'
          : 'PARTIALLY_REFUNDED';

        db.prepare('UPDATE sales SET status = ?, synced = 0 WHERE id = ?').run(newStatus, sale.id);
        createOutboxEntry('sales', 'UPDATE', sale.id, {
          id: sale.id,
          status: newStatus,
          updated_at: now
        });

        return { success: true, returnId, returnNumber, refundAmount };
      })(data);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
