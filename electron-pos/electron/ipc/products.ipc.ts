import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { getCurrentUser, requireCurrentUser } from './auth.ipc';
import { logAudit } from '../audit/auditLog';

function requireText(value: unknown, fieldName: string) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${fieldName} is required`);
  return text;
}

function requireNumber(value: unknown, fieldName: string, options: { min?: number; mustBeGreaterThanZero?: boolean } = {}) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${fieldName} must be a valid number`);
  }

  if (options.mustBeGreaterThanZero && numberValue <= 0) {
    throw new Error(`${fieldName} must be greater than zero`);
  }

  if (options.min !== undefined && numberValue < options.min) {
    throw new Error(`${fieldName} cannot be less than ${options.min}`);
  }

  return numberValue;
}

export function registerProductsIPC() {
  ipcMain.handle('products:getAll', () => {
    return db.prepare('SELECT * FROM products WHERE is_active = 1').all();
  });

  ipcMain.handle('products:getOne', (_event, id: string) => {
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id) || null;
  });

  ipcMain.handle('products:getMovements', (_event, id: string) => {
    return db.prepare(`
      SELECT sm.*, p.name as product_name, p.code as product_code
      FROM stock_movements sm
      JOIN products p ON sm.product_id = p.id
      WHERE sm.product_id = ?
      ORDER BY sm.created_at DESC
    `).all(id);
  });

  ipcMain.handle('products:create', async (_event, data: any) => {
    try {
      requireCurrentUser(['ADMIN', 'MANAGER']);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const code = data.code || `PRD-${Date.now()}`;
      const productName = requireText(data.name, 'Product name');
      const category = requireText(data.category || 'OTHER', 'Category');
      const unit = requireText(data.unit || 'pcs', 'Unit');
      const sellingPrice = requireNumber(data.sellingPrice, 'Selling price', { mustBeGreaterThanZero: true });
      const costPrice = requireNumber(data.costPrice || 0, 'Cost price', { min: 0 });
      const initialStock = requireNumber(data.stock || 0, 'Opening stock', { min: 0 });
      const lowStockThreshold = requireNumber(data.lowStockThreshold || 5, 'Low stock threshold', { min: 0 });
      const taxExempt = data.taxExempt === true || data.taxExempt === 1 || data.taxExempt === 'true' ? 1 : 0;
      const emoji = data.emoji || 'PKG';

      db.transaction(() => {
        db.prepare(`
          INSERT INTO products (
            id, code, name, category, unit, selling_price, cost_price, stock, low_stock_threshold, tax_exempt,
            emoji, is_active, created_at, updated_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)
        `).run(
          id,
          code,
          productName,
          category,
          unit,
          sellingPrice,
          costPrice,
          initialStock,
          lowStockThreshold,
          taxExempt,
          emoji,
          now,
          now
        );

        createOutboxEntry('products', 'INSERT', id, {
          id,
          code,
          name: productName,
          category,
          unit,
          selling_price: sellingPrice,
          cost_price: costPrice,
          stock: initialStock,
          low_stock_threshold: lowStockThreshold,
          tax_exempt: taxExempt,
          emoji,
          created_at: now,
          updated_at: now
        });

        if (initialStock > 0) {
          const movementId = crypto.randomUUID();
          db.prepare(`
            INSERT INTO stock_movements (
              id, product_id, movement_type, quantity, stock_before, stock_after, reference_id, supplier, notes, created_by_id, created_at, synced
            ) VALUES (?, ?, 'OPENING', ?, 0, ?, ?, ?, ?, ?, ?, 0)
          `).run(
            movementId,
            id,
            initialStock,
            initialStock,
            null,
            null,
            'Opening stock',
            data.userId || 'system',
            now
          );
          createOutboxEntry('stock_movements', 'INSERT', movementId, {
            id: movementId,
            product_id: id,
            movement_type: 'OPENING',
            quantity: initialStock,
            stock_before: 0,
            stock_after: initialStock,
            reference_id: null,
            supplier: null,
            notes: 'Opening stock',
            created_by_id: data.userId || getCurrentUser()?.id || 'system',
            created_at: now
          });
        }
      })();

      return { success: true, id };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('products:update', async (_event, id: string, data: any) => {
    try {
      requireCurrentUser(['ADMIN', 'MANAGER']);
      const now = new Date().toISOString();
      const oldProduct = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
      if (!oldProduct) return { success: false, error: 'Product not found' };
      const productName = data.name !== undefined ? requireText(data.name, 'Product name') : oldProduct.name;
      const category = data.category !== undefined ? requireText(data.category, 'Category') : oldProduct.category;
      const unit = data.unit !== undefined ? requireText(data.unit, 'Unit') : oldProduct.unit;
      const sellingPrice = requireNumber(data.sellingPrice ?? oldProduct.selling_price, 'Selling price', { mustBeGreaterThanZero: true });
      const costPrice = requireNumber(data.costPrice ?? oldProduct.cost_price, 'Cost price', { min: 0 });
      const lowStockThreshold = requireNumber(data.lowStockThreshold ?? oldProduct.low_stock_threshold, 'Low stock threshold', { min: 0 });
      const taxExempt = data.taxExempt === undefined
        ? Number(oldProduct.tax_exempt || 0)
        : (data.taxExempt === true || data.taxExempt === 1 || data.taxExempt === 'true' ? 1 : 0);
      const emoji = data.emoji ?? oldProduct.emoji;

      db.prepare(`
        UPDATE products
        SET name = ?, category = ?, unit = ?, selling_price = ?, cost_price = ?, low_stock_threshold = ?, tax_exempt = ?, emoji = ?, updated_at = ?, synced = 0
        WHERE id = ?
      `).run(
        productName,
        category,
        unit,
        sellingPrice,
        costPrice,
        lowStockThreshold,
        taxExempt,
        emoji,
        now,
        id
      );

      createOutboxEntry('products', 'UPDATE', id, {
        id,
        name: productName,
        category,
        unit,
        selling_price: sellingPrice,
        cost_price: costPrice,
        low_stock_threshold: lowStockThreshold,
        tax_exempt: taxExempt,
        emoji,
        updated_at: now
      });

      if (Number(oldProduct.selling_price) !== sellingPrice || Number(oldProduct.cost_price) !== costPrice) {
        logAudit({
          actionType: 'PRODUCT_PRICE_EDIT',
          entityType: 'products',
          entityId: id,
          before: { sellingPrice: oldProduct.selling_price, costPrice: oldProduct.cost_price },
          after: { sellingPrice, costPrice }
        });
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('products:remove', async (_event, id: string) => {
    try {
      requireCurrentUser(['ADMIN', 'MANAGER']);
      const now = new Date().toISOString();
      db.prepare('UPDATE products SET is_active = 0, updated_at = ?, synced = 0 WHERE id = ?').run(now, id);
      createOutboxEntry('products', 'UPDATE', id, { id, is_active: 0, updated_at: now });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('products:stockIn', async (_event, id: string, data: any) => {
    const transaction = db.transaction(() => {
      requireCurrentUser(['ADMIN', 'MANAGER']);
      const now = new Date().toISOString();
      const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(id) as any;
      if (!product) throw new Error('Product not found');
      const createdById = data.userId || getCurrentUser()?.id || 'system';
      const quantity = requireNumber(data.quantity, 'Stock-in quantity', { mustBeGreaterThanZero: true });

      const stockBefore = product.stock;
      const stockAfter = stockBefore + quantity;

      // UPDATE products
      db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(stockAfter, now, id);
      createOutboxEntry('products', 'UPDATE', id, { id, stock: stockAfter, updated_at: now });

      // INSERT stock_movements
      const movId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO stock_movements (id, product_id, movement_type, quantity, stock_before, stock_after, supplier, notes, created_by_id, created_at, synced)
        VALUES (?, ?, 'STOCK_IN', ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(movId, id, quantity, stockBefore, stockAfter, data.supplier || null, data.notes || '', createdById, now);
      createOutboxEntry('stock_movements', 'INSERT', movId, {
        id: movId,
        product_id: id,
        movement_type: 'STOCK_IN',
        quantity,
        stock_before: stockBefore,
        stock_after: stockAfter,
        supplier: data.supplier || null,
        notes: data.notes || '',
        created_by_id: createdById,
        created_at: now
      });

      return { success: true };
    });

    try {
      return transaction();
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
