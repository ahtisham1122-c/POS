import { BrowserWindow } from 'electron';
import db from '../database/db';
import { networkMonitor } from './networkMonitor';
import { getDeviceInfo } from './deviceInfo';
import { fetchWithTimeout, getApiBaseUrl, getSyncHeaders } from './apiConfig';

function dateOnly(value: any) {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text.slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function iso(value: any) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function boolInt(value: any) {
  return value ? 1 : 0;
}

function applyPulledStockMovement(movement: any) {
  const movementId = movement.id;
  if (!movementId) return false;

  const existing = db.prepare(`SELECT id FROM stock_movements WHERE id = ?`).get(movementId) as any;
  if (existing) return false;

  const productId = movement.productId ?? movement.product_id;
  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId) as any;
  if (!product) return false;

  const movementType = String((movement.movementType ?? movement.movement_type) || '').toUpperCase();
  const qty = Number(movement.quantity || 0);
  const stockBefore = Number(product.stock || 0);
  const addsStock = ['STOCK_IN', 'OPENING', 'RETURN_IN', 'VOID_RESTOCK', 'MILK_COLLECTION', 'DELIVERY_RETURN'].includes(movementType);
  const stockAfter = addsStock ? stockBefore + qty : stockBefore - qty;
  const createdAt = iso(movement.createdAt ?? movement.created_at);

  db.prepare(`
    INSERT INTO stock_movements (
      id, product_id, movement_type, quantity, stock_before, stock_after,
      reference_id, supplier, notes, created_by_id, created_at, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    movementId,
    productId,
    movementType,
    qty,
    stockBefore,
    stockAfter,
    movement.referenceId ?? movement.reference_id ?? null,
    movement.supplier || null,
    movement.notes || '',
    movement.createdById ?? movement.created_by_id ?? 'system',
    createdAt
  );

  db.prepare(`UPDATE products SET stock = ?, updated_at = ?, synced = 1 WHERE id = ?`)
    .run(stockAfter, createdAt, productId);
  return true;
}

export async function pullSync(mainWindow?: BrowserWindow) {
  if (!networkMonitor.isOnline) return;

  try {
    const { deviceId } = getDeviceInfo();
    const apiUrl = getApiBaseUrl();
    const syncHeaders = getSyncHeaders(deviceId);
    if (!syncHeaders) return;

    // Get last pull timestamp
    const lastPullRecord = db.prepare(`SELECT value FROM settings WHERE key = 'last_pull_timestamp'`).get() as any;
    const since = lastPullRecord ? lastPullRecord.value : new Date(0).toISOString();

    let products: any[] = [];
    let customers: any[] = [];
    let dailyRates: any[] = [];
    let settings: any[] = [];
    let suppliers: any[] = [];
    let milkCollections: any[] = [];
    let supplierPayments: any[] = [];
    let supplierLedgerEntries: any[] = [];
    let stockMovements: any[] = [];

    const response = await fetchWithTimeout(`${apiUrl}/sync/pull?deviceId=${deviceId}&since=${since}`, {
      headers: syncHeaders
    }, 15000);
    
    if (!response.ok) {
      throw new Error(`Pull failed with status ${response.status}`);
    }

    const parsed: any = await response.json();
    const payload = parsed?.success ? parsed.data : parsed;
    products = payload?.products || [];
    customers = payload?.customers || [];
    dailyRates = payload?.dailyRates || [];
    settings = payload?.settings || [];
    suppliers = payload?.suppliers || [];
    milkCollections = payload?.milkCollections || [];
    supplierPayments = payload?.supplierPayments || [];
    supplierLedgerEntries = payload?.supplierLedgerEntries || [];
    stockMovements = payload?.stockMovements || [];
    
    const SYSTEM_PRODUCT_CODES = new Set(['MILK', 'YOGT']);
    const SYSTEM_PRODUCT_IDS = new Set(['p1', 'p2']);
    let hasUpdates = false;

    db.transaction(() => {
      // 1. Upsert Products
      const upsertProduct = db.prepare(`
        INSERT INTO products (id, code, name, category, unit, selling_price, cost_price, stock, low_stock_threshold, tax_exempt, emoji, is_active, created_at, updated_at, synced)
        VALUES (@id, @code, @name, @category, @unit, @sellingPrice, @costPrice, @stock, @lowStockThreshold, @taxExempt, @emoji, @isActive, @createdAt, @updatedAt, 1)
        ON CONFLICT(id) DO UPDATE SET
          name = @name, category = @category, unit = @unit, selling_price = @sellingPrice, cost_price = @costPrice,
          low_stock_threshold = @lowStockThreshold, tax_exempt = @taxExempt, emoji = @emoji, is_active = @isActive, updated_at = @updatedAt, synced = 1
        WHERE @updatedAt > products.updated_at
      `);

      for (const p of products) {
        const code = String(p.code || '').toUpperCase();
        // Milk and Yogurt are local fixed POS products. Cloud may contain older
        // placeholder rows for p1/p2, so never let pull overwrite them.
        if (SYSTEM_PRODUCT_IDS.has(String(p.id || '')) || SYSTEM_PRODUCT_CODES.has(code)) {
          db.prepare(`
            UPDATE products
            SET name = CASE code WHEN 'MILK' THEN 'Fresh Milk' WHEN 'YOGT' THEN 'Fresh Yogurt' ELSE name END,
                category = 'Dairy',
                unit = 'kg',
                selling_price = CASE WHEN code = 'MILK' AND selling_price <= 0 THEN 180 WHEN code = 'YOGT' AND selling_price <= 0 THEN 220 ELSE selling_price END,
                cost_price = CASE WHEN code = 'MILK' AND cost_price <= 0 THEN 160 WHEN code = 'YOGT' AND cost_price <= 0 THEN 190 ELSE cost_price END,
                low_stock_threshold = COALESCE(low_stock_threshold, 5),
                tax_exempt = 1,
                is_active = 1,
                synced = 1
            WHERE id = ? OR code = ?
          `).run(p.id, code);
          continue;
        }

        const isActive = SYSTEM_PRODUCT_CODES.has(code)
          ? 1
          : ((p.isActive ?? p.is_active) ? 1 : 0);
        upsertProduct.run({
          id: p.id, code: p.code, name: p.name, category: p.category, unit: p.unit,
          sellingPrice: p.sellingPrice ?? p.selling_price,
          costPrice: p.costPrice ?? p.cost_price,
          stock: p.stock,
          lowStockThreshold: p.lowStockThreshold ?? p.low_stock_threshold,
          taxExempt: (p.taxExempt ?? p.tax_exempt) ? 1 : 0,
          emoji: p.emoji,
          isActive,
          createdAt: p.createdAt ?? p.created_at,
          updatedAt: p.updatedAt ?? p.updated_at
        });
        hasUpdates = true;
      }

      // 2. Upsert Customers
      const upsertCustomer = db.prepare(`
        INSERT INTO customers (id, code, card_number, name, phone, address, credit_limit, current_balance, is_active, created_at, updated_at, synced)
        VALUES (@id, @code, @cardNumber, @name, @phone, @address, @creditLimit, @currentBalance, @isActive, @createdAt, @updatedAt, 1)
        ON CONFLICT(id) DO UPDATE SET
          name = @name, phone = @phone, address = @address, credit_limit = @creditLimit, current_balance = @currentBalance,
          is_active = @isActive, updated_at = @updatedAt, synced = 1
        WHERE @updatedAt > customers.updated_at
      `);

      for (const c of customers) {
        upsertCustomer.run({
          id: c.id, code: c.code, 
          cardNumber: c.cardNumber ?? c.card_number, 
          name: c.name, phone: c.phone, address: c.address,
          creditLimit: c.creditLimit ?? c.credit_limit, 
          currentBalance: c.currentBalance ?? c.current_balance, 
          isActive: (c.isActive ?? c.is_active) ? 1 : 0,
          createdAt: c.createdAt ?? c.created_at, 
          updatedAt: c.updatedAt ?? c.updated_at
        });
        hasUpdates = true;
      }

      // 3. Upsert Daily Rates
      const upsertRate = db.prepare(`
        INSERT INTO daily_rates (id, date, milk_rate, yogurt_rate, updated_by_id, created_at, synced)
        VALUES (@id, @date, @milkRate, @yogurtRate, @updatedById, @createdAt, 1)
        ON CONFLICT(date) DO NOTHING
      `);
      
      for (const r of dailyRates) {
        upsertRate.run({
          id: r.id, date: r.date, 
          milkRate: r.milkRate ?? r.milk_rate, 
          yogurtRate: r.yogurtRate ?? r.yogurt_rate, 
          updatedById: r.updatedById ?? r.updated_by_id, 
          createdAt: r.createdAt ?? r.created_at
        });
        hasUpdates = true;
      }

      const upsertSetting = db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (@key, @value, @updatedAt)
        ON CONFLICT(key) DO UPDATE SET
          value = @value,
          updated_at = @updatedAt
        WHERE @updatedAt > settings.updated_at
      `);

      for (const setting of settings) {
        upsertSetting.run({
          key: setting.key,
          value: setting.value,
          updatedAt: setting.updatedAt || new Date().toISOString()
        });
        hasUpdates = true;
      }

      const upsertSupplier = db.prepare(`
        INSERT INTO suppliers (
          id, code, name, phone, address, allowed_shifts, milk_supply_mode,
          default_rate, cow_rate, buffalo_rate, guaranteed_advance_balance,
          payment_cycle, payment_cycle_days, payment_cycle_notes, current_balance,
          is_active, created_at, updated_at, synced
        ) VALUES (@id, @code, @name, @phone, @address, @allowedShifts, @milkSupplyMode,
          @defaultRate, @cowRate, @buffaloRate, @guaranteedAdvanceBalance,
          @paymentCycle, @paymentCycleDays, @paymentCycleNotes, @currentBalance,
          @isActive, @createdAt, @updatedAt, 1)
        ON CONFLICT(id) DO UPDATE SET
          name = @name,
          phone = @phone,
          address = @address,
          allowed_shifts = @allowedShifts,
          milk_supply_mode = @milkSupplyMode,
          default_rate = @defaultRate,
          cow_rate = @cowRate,
          buffalo_rate = @buffaloRate,
          guaranteed_advance_balance = @guaranteedAdvanceBalance,
          payment_cycle = @paymentCycle,
          payment_cycle_days = @paymentCycleDays,
          payment_cycle_notes = @paymentCycleNotes,
          current_balance = CASE WHEN suppliers.synced = 1 THEN @currentBalance ELSE suppliers.current_balance END,
          is_active = @isActive,
          updated_at = @updatedAt,
          synced = CASE WHEN suppliers.synced = 1 THEN 1 ELSE suppliers.synced END
      `);

      for (const s of suppliers) {
        upsertSupplier.run({
          id: s.id,
          code: s.code,
          name: s.name,
          phone: s.phone || null,
          address: s.address || null,
          allowedShifts: s.allowedShifts ?? s.allowed_shifts ?? 'BOTH',
          milkSupplyMode: s.milkSupplyMode ?? s.milk_supply_mode ?? 'MIXED',
          defaultRate: s.defaultRate ?? s.default_rate ?? 0,
          cowRate: s.cowRate ?? s.cow_rate ?? 0,
          buffaloRate: s.buffaloRate ?? s.buffalo_rate ?? 0,
          guaranteedAdvanceBalance: s.guaranteedAdvanceBalance ?? s.guaranteed_advance_balance ?? 0,
          paymentCycle: s.paymentCycle ?? s.payment_cycle ?? 'MONTHLY',
          paymentCycleDays: s.paymentCycleDays ?? s.payment_cycle_days ?? 30,
          paymentCycleNotes: s.paymentCycleNotes ?? s.payment_cycle_notes ?? null,
          currentBalance: s.currentBalance ?? s.current_balance ?? 0,
          isActive: boolInt(s.isActive ?? s.is_active ?? true),
          createdAt: iso(s.createdAt ?? s.created_at),
          updatedAt: iso(s.updatedAt ?? s.updated_at)
        });
        hasUpdates = true;
      }

      const upsertCollection = db.prepare(`
        INSERT INTO milk_collections (
          id, supplier_id, collection_date, shift, milk_type, quantity, rate,
          total_amount, notes, created_by_id, created_at, synced
        ) VALUES (@id, @supplierId, @collectionDate, @shift, @milkType, @quantity, @rate,
          @totalAmount, @notes, @createdById, @createdAt, 1)
        ON CONFLICT(id) DO UPDATE SET
          supplier_id = @supplierId,
          collection_date = @collectionDate,
          shift = @shift,
          milk_type = @milkType,
          quantity = @quantity,
          rate = @rate,
          total_amount = @totalAmount,
          notes = @notes,
          synced = 1
      `);

      for (const c of milkCollections) {
        upsertCollection.run({
          id: c.id,
          supplierId: c.supplierId ?? c.supplier_id,
          collectionDate: dateOnly(c.collectionDate ?? c.collection_date),
          shift: c.shift,
          milkType: c.milkType ?? c.milk_type ?? 'MIXED',
          quantity: c.quantity,
          rate: c.rate,
          totalAmount: c.totalAmount ?? c.total_amount,
          notes: c.notes || null,
          createdById: c.createdById ?? c.created_by_id ?? 'system',
          createdAt: iso(c.createdAt ?? c.created_at)
        });
        hasUpdates = true;
      }

      const upsertSupplierPayment = db.prepare(`
        INSERT INTO supplier_payments (id, supplier_id, amount, payment_date, paid_by_id, notes, created_at, synced)
        VALUES (@id, @supplierId, @amount, @paymentDate, @paidById, @notes, @createdAt, 1)
        ON CONFLICT(id) DO UPDATE SET
          supplier_id = @supplierId,
          amount = @amount,
          payment_date = @paymentDate,
          paid_by_id = @paidById,
          notes = @notes,
          synced = 1
      `);

      for (const p of supplierPayments) {
        upsertSupplierPayment.run({
          id: p.id,
          supplierId: p.supplierId ?? p.supplier_id,
          amount: p.amount,
          paymentDate: dateOnly(p.paymentDate ?? p.payment_date),
          paidById: p.paidById ?? p.paid_by_id ?? 'system',
          notes: p.notes || null,
          createdAt: iso(p.createdAt ?? p.created_at)
        });
        hasUpdates = true;
      }

      const upsertSupplierLedger = db.prepare(`
        INSERT INTO supplier_ledger_entries (
          id, supplier_id, collection_id, payment_id, entry_type, amount,
          balance_after, description, entry_date, created_at, synced
        ) VALUES (@id, @supplierId, @collectionId, @paymentId, @entryType, @amount,
          @balanceAfter, @description, @entryDate, @createdAt, 1)
        ON CONFLICT(id) DO UPDATE SET
          supplier_id = @supplierId,
          collection_id = @collectionId,
          payment_id = @paymentId,
          entry_type = @entryType,
          amount = @amount,
          balance_after = @balanceAfter,
          description = @description,
          entry_date = @entryDate,
          synced = 1
      `);

      for (const l of supplierLedgerEntries) {
        upsertSupplierLedger.run({
          id: l.id,
          supplierId: l.supplierId ?? l.supplier_id,
          collectionId: l.collectionId ?? l.collection_id ?? null,
          paymentId: l.paymentId ?? l.payment_id ?? null,
          entryType: l.entryType ?? l.entry_type,
          amount: l.amount,
          balanceAfter: l.balanceAfter ?? l.balance_after,
          description: l.description,
          entryDate: iso(l.entryDate ?? l.entry_date),
          createdAt: iso(l.createdAt ?? l.created_at)
        });
        hasUpdates = true;
      }

      for (const movement of stockMovements) {
        if (applyPulledStockMovement(movement)) hasUpdates = true;
      }

      // Update sync timestamp
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES ('last_pull_timestamp', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
      `).run(now, now, now, now);

    })(); // execute transaction

    if (hasUpdates && mainWindow) {
      mainWindow.webContents.send('sync-pull-complete', { message: 'Cloud updates applied' });
    }

  } catch (err) {
    console.error('Error during pullSync:', err);
  }
}
