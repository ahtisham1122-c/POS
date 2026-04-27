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
exports.registerInventoryIPC = registerInventoryIPC;
const electron_1 = require("electron");
const db_1 = __importDefault(require("../database/db"));
const crypto = __importStar(require("crypto"));
const outboxHelper_1 = require("../sync/outboxHelper");
const auth_ipc_1 = require("./auth.ipc");
const auditLog_1 = require("../audit/auditLog");
function requirePositiveQuantity(value, fieldName) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`${fieldName} must be greater than zero`);
    }
    return quantity;
}
function requireValidStock(value, fieldName) {
    const stock = Number(value);
    if (!Number.isFinite(stock) || stock < 0) {
        throw new Error(`${fieldName} cannot be negative`);
    }
    return stock;
}
function registerInventoryIPC() {
    electron_1.ipcMain.handle('inventory:getSummary', () => {
        try {
            const result = db_1.default.prepare(`
        SELECT 
          COUNT(id) as totalProducts, 
          SUM(stock * cost_price) as totalValuation, 
          SUM(CASE WHEN stock <= low_stock_threshold THEN 1 ELSE 0 END) as lowStockCount 
        FROM products WHERE is_active = 1
      `).get();
            return {
                totalProducts: result.totalProducts || 0,
                totalValuation: result.totalValuation || 0,
                lowStockCount: result.lowStockCount || 0
            };
        }
        catch (e) {
            console.error(e);
            return { totalProducts: 0, totalValuation: 0, lowStockCount: 0 };
        }
    });
    electron_1.ipcMain.handle('inventory:getLowStock', () => {
        try {
            return db_1.default.prepare('SELECT * FROM products WHERE is_active = 1 AND stock <= low_stock_threshold').all();
        }
        catch (e) {
            return [];
        }
    });
    electron_1.ipcMain.handle('inventory:getMovements', () => {
        try {
            return db_1.default.prepare(`
        SELECT sm.*, p.name as product_name, p.code as product_code
        FROM stock_movements sm
        JOIN products p ON sm.product_id = p.id
        ORDER BY sm.created_at DESC LIMIT 500
      `).all();
        }
        catch (e) {
            return [];
        }
    });
    electron_1.ipcMain.handle('inventory:getValuation', () => {
        try {
            const result = db_1.default.prepare('SELECT SUM(stock * cost_price) as totalValuation FROM products WHERE is_active = 1').get();
            return result.totalValuation || 0;
        }
        catch (e) {
            return 0;
        }
    });
    electron_1.ipcMain.handle('inventory:stockIn', async (_event, id, data) => {
        try {
            (0, auth_ipc_1.requireCurrentUser)(['ADMIN', 'MANAGER']);
            return handleStockMutation(id, requirePositiveQuantity(data.quantity, 'Stock-in quantity'), 'STOCK_IN', data);
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('inventory:stockOut', async (_event, id, data) => {
        try {
            (0, auth_ipc_1.requireCurrentUser)(['ADMIN', 'MANAGER']);
            return handleStockMutation(id, -requirePositiveQuantity(data.quantity, 'Stock-out quantity'), 'STOCK_OUT', data);
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('inventory:adjustStock', async (_event, id, data) => {
        try {
            (0, auth_ipc_1.requireCurrentUser)();
            const approver = (0, auth_ipc_1.requireManagerApproval)(data.managerPin, 'manual stock adjustment');
            return handleStockMutation(id, requireValidStock(data.quantity, 'Adjusted stock'), 'ADJUSTMENT', { ...data, approver });
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('inventory:addWastage', async (_event, id, data) => {
        try {
            (0, auth_ipc_1.requireCurrentUser)(['ADMIN', 'MANAGER']);
            return handleStockMutation(id, -requirePositiveQuantity(data.quantity, 'Wastage quantity'), 'WASTAGE', data);
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
}
function handleStockMutation(productId, quantityDiff, movementType, data) {
    const transaction = db_1.default.transaction(() => {
        const now = new Date().toISOString();
        const product = db_1.default.prepare('SELECT stock FROM products WHERE id = ?').get(productId);
        if (!product)
            throw new Error('Product not found');
        const stockBefore = product.stock;
        const stockAfter = movementType === 'ADJUSTMENT' ? quantityDiff : stockBefore + quantityDiff;
        if (stockAfter < 0 && movementType !== 'ADJUSTMENT') {
            throw new Error('Stock cannot be negative');
        }
        db_1.default.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(stockAfter, now, productId);
        (0, outboxHelper_1.createOutboxEntry)('products', 'UPDATE', productId, { id: productId, stock: stockAfter, updated_at: now });
        const movId = crypto.randomUUID();
        db_1.default.prepare(`
      INSERT INTO stock_movements (id, product_id, movement_type, quantity, stock_before, stock_after, supplier, notes, reference_id, created_by_id, created_at, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(movId, productId, movementType, Math.abs(quantityDiff), stockBefore, stockAfter, data.supplier || null, data.notes || '', data.referenceId || null, data.userId || 'system', now);
        (0, outboxHelper_1.createOutboxEntry)('stock_movements', 'INSERT', movId, {
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
            (0, auditLog_1.logAudit)({
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
    }
    catch (e) {
        return { success: false, error: e.message };
    }
}
