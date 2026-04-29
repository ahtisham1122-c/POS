import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { requireCurrentUser, requireManagerApproval } from './auth.ipc';
import { logAudit } from '../audit/auditLog';

function requirePositiveQuantity(value: unknown, fieldName: string) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`${fieldName} must be greater than zero`);
  }
  return quantity;
}

function requireValidStock(value: unknown, fieldName: string) {
  const stock = Number(value);
  if (!Number.isFinite(stock) || stock < 0) {
    throw new Error(`${fieldName} cannot be negative`);
  }
  return stock;
}

export function registerInventoryIPC() {
  ipcMain.handle('inventory:getSummary', () => {
    try {
      const result = db.prepare(`
        SELECT 
          COUNT(id) as totalProducts, 
          SUM(stock * cost_price) as totalValuation, 
          SUM(CASE WHEN stock <= low_stock_threshold THEN 1 ELSE 0 END) as lowStockCount 
        FROM products WHERE is_active = 1
      `).get() as any;
      return { 
        totalProducts: result.totalProducts || 0,
        totalValuation: result.totalValuation || 0,
        lowStockCount: result.lowStockCount || 0
      };
    } catch (e: any) {
      console.error(e);
      return { totalProducts: 0, totalValuation: 0, lowStockCount: 0 };
    }
  });

  ipcMain.handle('inventory:getLowStock', () => {
    try {
      return db.prepare('SELECT * FROM products WHERE is_active = 1 AND stock <= low_stock_threshold').all();
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('inventory:getMovements', () => {
    try {
      return db.prepare(`
        SELECT sm.*, p.name as product_name, p.code as product_code
        FROM stock_movements sm
        JOIN products p ON sm.product_id = p.id
        ORDER BY sm.created_at DESC LIMIT 500
      `).all();
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('inventory:getValuation', () => {
    try {
      const result = db.prepare('SELECT SUM(stock * cost_price) as totalValuation FROM products WHERE is_active = 1').get() as any;
      return result.totalValuation || 0;
    } catch (e) {
      return 0;
    }
  });

  ipcMain.handle('inventory:stockIn', async (_event, id: string, data: any) => {
    try {
      requireCurrentUser(['ADMIN', 'MANAGER']);
      const quantity = requirePositiveQuantity(data.quantity, 'Stock-in quantity');
      const product = db.prepare('SELECT code FROM products WHERE id = ?').get(id) as any;

      // Yogurt is produced from milk — deduct same quantity from Milk in same transaction
      if (product?.code === 'YOGT') {
        return db.transaction(() => {
          const milkProduct = db.prepare(`SELECT id, stock FROM products WHERE code = 'MILK' AND is_active = 1`).get() as any;
          if (!milkProduct) throw new Error('Milk product not found. Yogurt is made from milk.');
          if (Number(milkProduct.stock) < quantity) {
            throw new Error(`Not enough milk stock. Need ${quantity} kg but only ${Number(milkProduct.stock).toFixed(2)} kg available.`);
          }
          // Add yogurt stock — throw on failure so outer transaction rolls back
          const yogurtResult = handleStockMutation(id, quantity, 'STOCK_IN', { ...data, notes: data.notes || 'Yogurt produced from milk' }) as any;
          if (!yogurtResult.success) throw new Error(yogurtResult.error || 'Failed to add yogurt stock');
          // Deduct milk stock — throw on failure so yogurt addition is also rolled back
          const milkResult = handleStockMutation(milkProduct.id, -quantity, 'STOCK_OUT', {
            ...data,
            notes: `Used for yogurt production (${quantity} kg)`,
            referenceId: id
          }) as any;
          if (!milkResult.success) throw new Error(milkResult.error || 'Failed to deduct milk stock');
          return { success: true };
        })();
      }

      return handleStockMutation(id, quantity, 'STOCK_IN', data);
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('inventory:stockOut', async (_event, id: string, data: any) => {
    try {
      requireCurrentUser(['ADMIN', 'MANAGER']);
      return handleStockMutation(id, -requirePositiveQuantity(data.quantity, 'Stock-out quantity'), 'STOCK_OUT', data);
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('inventory:adjustStock', async (_event, id: string, data: any) => {
    try {
      requireCurrentUser();
      const approver = requireManagerApproval(data.managerPin, 'manual stock adjustment');
      return handleStockMutation(id, requireValidStock(data.quantity, 'Adjusted stock'), 'ADJUSTMENT', { ...data, approver });
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('inventory:addWastage', async (_event, id: string, data: any) => {
    try {
      requireCurrentUser(['ADMIN', 'MANAGER']);
      return handleStockMutation(id, -requirePositiveQuantity(data.quantity, 'Wastage quantity'), 'WASTAGE', data);
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}

export function handleStockMutation(productId: string, quantityDiff: number, movementType: string, data: any) {
  const transaction = db.transaction(() => {
    const now = new Date().toISOString();
    const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId) as any;
    if (!product) throw new Error('Product not found');

    const stockBefore = product.stock;
    const stockAfter = movementType === 'ADJUSTMENT' ? quantityDiff : stockBefore + quantityDiff;

    if (stockAfter < 0 && movementType !== 'ADJUSTMENT') {
      throw new Error('Stock cannot be negative');
    }

    db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(stockAfter, now, productId);
    createOutboxEntry('products', 'UPDATE', productId, { id: productId, stock: stockAfter, updated_at: now });

    const movId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO stock_movements (id, product_id, movement_type, quantity, stock_before, stock_after, supplier, notes, reference_id, created_by_id, created_at, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(movId, productId, movementType, Math.abs(quantityDiff), stockBefore, stockAfter, data.supplier || null, data.notes || '', data.referenceId || null, data.userId || 'system', now);
    
    createOutboxEntry('stock_movements', 'INSERT', movId, {
      id: movId,
      product_id: productId,
      movement_type: movementType,
      quantity: Math.abs(quantityDiff),
      stock_before: stockBefore,
      stock_after: stockAfter,
      supplier: data.supplier || null,
      notes: data.notes || '',
      reference_id: data.referenceId || null,
      created_by_id: data.userId || 'system',
      created_at: now
    });

    if (movementType === 'ADJUSTMENT') {
      logAudit({
        actionType: 'STOCK_ADJUSTMENT',
        entityType: 'products',
        entityId: productId,
        before: { stock: stockBefore },
        after: { stock: stockAfter, movementId: movId },
        reason: data.notes || 'Manual stock adjustment',
        approvedBy: data.approver
      });
    }

    return { success: true };
  });

  try {
    return transaction();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
