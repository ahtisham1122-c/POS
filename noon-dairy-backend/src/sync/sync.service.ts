import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { createSyncToken, hashSyncToken } from './sync-token.util';

@Injectable()
export class SyncService {
  constructor(private prisma: PrismaService) {}

  private modelFields = new Map(
    Prisma.dmmf.datamodel.models.map((model) => [
      model.name.charAt(0).toLowerCase() + model.name.slice(1),
      new Set(model.fields.map((field) => field.name))
    ])
  );

  private tableMap: Record<string, string> = {
    users: 'user',
    products: 'product',
    customers: 'customer',
    sales: 'sale',
    sale_items: 'saleItem',
    saleItems: 'saleItem',
    payments: 'payment',
    split_payments: 'splitPayment',
    splitPayments: 'splitPayment',
    ledger_entries: 'ledgerEntry',
    stock_movements: 'stockMovement',
    stockMovements: 'stockMovement',
    expenses: 'expense',
    daily_rates: 'dailyRate',
    cash_register: 'cashRegister',
    settings: 'setting',
    returns: 'return',
    sale_voids: 'saleVoid',
    saleVoids: 'saleVoid',
    return_items: 'returnItem',
    returnItems: 'returnItem',
    suppliers: 'supplier',
    milk_collections: 'milkCollection',
    milkCollections: 'milkCollection',
    supplier_payments: 'supplierPayment',
    supplierPayments: 'supplierPayment',
    supplier_ledger_entries: 'supplierLedgerEntry',
    supplierLedgerEntries: 'supplierLedgerEntry',
    receipt_audit_sessions: 'receiptAuditSession',
    receiptAuditSessions: 'receiptAuditSession',
    receipt_audit_entries: 'receiptAuditEntry',
    receiptAuditEntries: 'receiptAuditEntry',
    shifts: 'shift'
  };

  private toCamelCaseObject(input: any): any {
    if (Array.isArray(input)) return input.map((v) => this.toCamelCaseObject(v));
    if (!input || typeof input !== 'object') return input;

    return Object.entries(input).reduce<Record<string, any>>((acc, [key, value]) => {
      const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      acc[camelKey] = this.toCamelCaseObject(value);
      return acc;
    }, {});
  }

  private getModel(db: any, table: string) {
    const modelName = this.tableMap[table] || table;
    const model = db[modelName];
    if (!model) {
      throw new BadRequestException({ error: 'SYNC_TABLE_UNSUPPORTED', message: `Unsupported table: ${table}` });
    }
    return model;
  }

  private normalizeEnumValues(modelName: string, data: Record<string, any>) {
    if (modelName === 'sale') {
      if (data.discountType === 'RS') data.discountType = 'FLAT';
      if (data.discountType === 'PERCENT') data.discountType = 'PERCENTAGE';
    }

    if (modelName === 'saleItem') {
      if (data.discountType === 'RS') data.discountType = 'FLAT';
      if (data.discountType === 'PERCENT') data.discountType = 'PERCENTAGE';
    }

    if (modelName === 'product') {
      const category = String(data.category || '').trim().toUpperCase();
      const byName: Record<string, string> = {
        DAIRY: 'MILK',
        MILK: 'MILK',
        YOGURT: 'YOGURT',
        BAKERY: 'OTHER',
        BUTTER: 'BUTTER_CREAM',
        BUTTER_CREAM: 'BUTTER_CREAM',
        DRINKS: 'DRINKS',
        CHEESE: 'CHEESE',
        SWEETS: 'SWEETS',
        OTHER: 'OTHER'
      };
      data.category = byName[category] || 'OTHER';
    }

    if (modelName === 'expense') {
      const category = String(data.category || '').trim().toUpperCase().replace(/\s+/g, '_');
      const allowed = new Set([
        'MILK_PURCHASE',
        'SALARY',
        'ELECTRICITY',
        'FUEL',
        'PACKAGING',
        'RENT',
        'MAINTENANCE',
        'CLEANING',
        'MISCELLANEOUS'
      ]);
      data.category = allowed.has(category) ? category : 'MISCELLANEOUS';
    }

    return data;
  }

  private normalizeDateOnlyFields(modelName: string, data: Record<string, any>) {
    const dateOnlyFields: Record<string, string[]> = {
      shift: ['shiftDate'],
      cashRegister: ['date'],
      dailyRate: ['date'],
      expense: ['expenseDate'],
      milkCollection: ['collectionDate'],
      receiptAuditSession: ['auditDate']
    };

    for (const field of dateOnlyFields[modelName] || []) {
      if (typeof data[field] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data[field])) {
        data[field] = new Date(`${data[field]}T00:00:00.000Z`);
      }
    }

    return data;
  }

  private normalizeBooleanFields(modelName: string, data: Record<string, any>) {
    const booleanFields: Record<string, string[]> = {
      user: ['isActive'],
      product: ['taxExempt', 'isActive'],
      customer: ['isActive'],
      sale: ['taxEnabled'],
      cashRegister: ['isClosedForDay'],
      supplier: ['isActive'],
      return: ['restockItems'],
      saleVoid: ['restockedItems']
    };

    for (const field of booleanFields[modelName] || []) {
      if (data[field] === 0 || data[field] === 1) {
        data[field] = data[field] === 1;
      } else if (typeof data[field] === 'string' && ['true', 'false', '0', '1'].includes(data[field].toLowerCase())) {
        data[field] = data[field] === '1' || data[field].toLowerCase() === 'true';
      }
    }

    return data;
  }

  private normalizeLegacyRequiredFields(modelName: string, data: Record<string, any>) {
    if (modelName === 'product') {
      const productId = String(data.id || data.productId || 'unknown');
      if (!data.code) data.code = `SYNC-${productId.slice(0, 18)}`;
      if (!data.name) data.name = data.productName || `Synced Product ${productId.slice(0, 8)}`;
      if (!data.unit) data.unit = 'unit';
      if (data.sellingPrice === undefined || data.sellingPrice === null) data.sellingPrice = Number(data.unitPrice || 0);
      if (data.costPrice === undefined || data.costPrice === null) data.costPrice = 0;
      if (data.stock === undefined || data.stock === null) data.stock = 0;
      if (data.lowStockThreshold === undefined || data.lowStockThreshold === null) data.lowStockThreshold = 0;
      if (data.taxExempt === undefined || data.taxExempt === null) data.taxExempt = false;
      if (!data.emoji) data.emoji = 'PKG';
    }

    if (modelName === 'supplier') {
      const supplierId = String(data.id || 'unknown');
      if (!data.code) data.code = `SYNC-SUP-${supplierId.slice(0, 12)}`;
      if (!data.name) data.name = `Synced Supplier ${supplierId.slice(0, 8)}`;
      if (!data.allowedShifts) data.allowedShifts = 'BOTH';
      if (data.defaultRate === undefined || data.defaultRate === null) data.defaultRate = 0;
      if (data.currentBalance === undefined || data.currentBalance === null) data.currentBalance = 0;
      if (data.isActive === undefined || data.isActive === null) data.isActive = false;
    }

    if (modelName === 'saleItem') {
      const quantity = Number(data.quantity || 0);
      const lineTotal = Number(data.lineTotal || 0);

      if (data.unitPrice === undefined || data.unitPrice === null) {
        data.unitPrice = quantity > 0 ? lineTotal / quantity : 0;
      }

      if (data.costPrice === undefined || data.costPrice === null) {
        data.costPrice = 0;
      }
    }

    if (modelName === 'stockMovement') {
      const quantity = Number(data.quantity || 0);
      const movementType = String(data.movementType || '').toUpperCase();

      if (data.stockBefore === undefined || data.stockBefore === null) {
        data.stockBefore = 0;
      }

      if (data.stockAfter === undefined || data.stockAfter === null) {
        const stockBefore = Number(data.stockBefore || 0);
        const increasesStock = ['STOCK_IN', 'OPENING', 'RETURN_IN', 'VOID_RESTOCK', 'MILK_COLLECTION'].includes(movementType);
        const decreasesStock = ['STOCK_OUT', 'WASTAGE'].includes(movementType);
        data.stockAfter = increasesStock ? stockBefore + quantity : decreasesStock ? stockBefore - quantity : stockBefore;
      }

      if (!data.createdById) {
        data.createdById = 'admin-id';
      }
    }

    return data;
  }

  private sanitizePayload(modelName: string, payload: Record<string, any>) {
    const allowedFields = this.modelFields.get(modelName);
    if (!allowedFields) return payload;

    const data = { ...payload };
    delete data.synced;

    for (const key of Object.keys(data)) {
      if (!allowedFields.has(key)) {
        delete data[key];
      }
    }

    this.normalizeEnumValues(modelName, data);
    this.normalizeDateOnlyFields(modelName, data);
    this.normalizeBooleanFields(modelName, data);
    this.normalizeLegacyRequiredFields(modelName, data);
    return data;
  }

  private async ensureUserExists(userId: string | null | undefined, tx: Prisma.TransactionClient) {
    if (!userId) return;
    const existing = await tx.user.findUnique({ where: { id: userId } });
    if (existing) return;

    await tx.user.create({
      data: {
        id: userId,
        name: `Synced User ${userId.slice(0, 8)}`,
        username: `synced-${userId}`,
        passwordHash: 'external-sync-user',
        role: 'CASHIER',
        isActive: false
      }
    });
  }

  private async ensureProductExists(data: Record<string, any>, tx: Prisma.TransactionClient) {
    const productId = data.productId || data.id;
    if (!productId) return;
    const existing = await tx.product.findUnique({ where: { id: productId } });
    if (existing) return;

    const name = String(data.productName || data.name || `Synced Product ${String(productId).slice(0, 8)}`);
    const unit = String(data.unit || 'unit');
    const price = Number(data.unitPrice || data.sellingPrice || 0);
    const cost = Number(data.costPrice || 0);

    await tx.product.create({
      data: {
        id: productId,
        code: `SYNC-${String(productId).slice(0, 18)}`,
        name,
        category: 'OTHER',
        unit,
        sellingPrice: Number.isFinite(price) ? price : 0,
        costPrice: Number.isFinite(cost) ? cost : 0,
        stock: 0,
        lowStockThreshold: 0,
        taxExempt: false,
        emoji: 'PKG',
        isActive: false
      }
    });
  }

  private async ensureCustomerExists(customerId: string | null | undefined, tx: Prisma.TransactionClient) {
    if (!customerId) return;
    const existing = await tx.customer.findUnique({ where: { id: customerId } });
    if (existing) return;

    await tx.customer.create({
      data: {
        id: customerId,
        code: `SYNC-CUST-${String(customerId).slice(0, 12)}`,
        name: `Synced Customer ${String(customerId).slice(0, 8)}`,
        currentBalance: 0,
        isActive: false
      }
    });
  }

  private async ensureSupplierExists(supplierId: string | null | undefined, tx: Prisma.TransactionClient) {
    if (!supplierId) return;
    const existing = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (existing) return;

    await tx.supplier.create({
      data: {
        id: supplierId,
        code: `SYNC-SUP-${String(supplierId).slice(0, 12)}`,
        name: `Synced Supplier ${String(supplierId).slice(0, 8)}`,
        currentBalance: 0,
        isActive: false
      }
    });
  }

  private async ensureShiftExists(shiftId: string | null | undefined, tx: Prisma.TransactionClient) {
    if (!shiftId) return;
    const existing = await tx.shift.findUnique({ where: { id: shiftId } });
    if (existing) return;

    const placeholderUserId = `sync-shift-user-${shiftId.slice(0, 8)}`;
    await this.ensureUserExists(placeholderUserId, tx);
    await tx.shift.create({
      data: {
        id: shiftId,
        shiftDate: new Date(),
        openedById: placeholderUserId,
        openedAt: new Date(),
        status: 'CLOSED',
        openingCash: 0,
        expectedCash: 0,
        closingCash: 0,
        cashVariance: 0,
      }
    });
  }

  private async ensureSyncDependencies(modelName: string, data: Record<string, any>, tx: Prisma.TransactionClient) {
    if (modelName === 'sale') {
      await this.ensureShiftExists(data.shiftId, tx);
      await this.ensureUserExists(data.cashierId, tx);
      await this.ensureCustomerExists(data.customerId, tx);
    }

    if (modelName === 'cashRegister') {
      await this.ensureShiftExists(data.shiftId, tx);
    }

    if (modelName === 'shift') {
      await this.ensureUserExists(data.openedById, tx);
      await this.ensureUserExists(data.closedById, tx);
    }

    if (modelName === 'saleItem') {
      await this.ensureProductExists(data, tx);
    }

    if (modelName === 'return') {
      await this.ensureUserExists(data.cashierId, tx);
      await this.ensureCustomerExists(data.customerId, tx);
    }

    if (modelName === 'stockMovement') {
      await this.ensureProductExists(data, tx);
      await this.ensureUserExists(data.createdById, tx);
    }

    if (modelName === 'ledgerEntry' || modelName === 'payment' || modelName === 'splitPayment') {
      await this.ensureCustomerExists(data.customerId, tx);
      await this.ensureUserExists(data.collectedById || data.receivedById, tx);
    }

    if (modelName === 'milkCollection' || modelName === 'supplierPayment' || modelName === 'supplierLedgerEntry') {
      await this.ensureSupplierExists(data.supplierId, tx);
      await this.ensureUserExists(data.createdById || data.paidById, tx);
    }

    if (modelName === 'receiptAuditSession') {
      await this.ensureUserExists(data.countedById, tx);
    }
  }

  private async hasRequiredParent(modelName: string, data: Record<string, any>, tx: Prisma.TransactionClient) {
    if (modelName === 'sale') {
      // Shifts can arrive after sales from older outbox queues. ensureSyncDependencies()
      // creates a safe placeholder shift, then the real shift row can update it later.
      return true;
    }

    if (modelName === 'saleItem') {
      if (!data.saleId) return false;
      const sale = await tx.sale.findUnique({ where: { id: data.saleId }, select: { id: true } });
      return Boolean(sale);
    }

    if (modelName === 'splitPayment' || modelName === 'saleVoid') {
      if (!data.saleId) return false;
      const sale = await tx.sale.findUnique({ where: { id: data.saleId }, select: { id: true } });
      return Boolean(sale);
    }

    if (modelName === 'payment') {
      if (data.saleId) {
        const sale = await tx.sale.findUnique({ where: { id: data.saleId }, select: { id: true } });
        if (!sale) return false;
      }
      return true;
    }

    if (modelName === 'returnItem') {
      if (!data.returnId) return false;
      const returnRecord = await tx.return.findUnique({ where: { id: data.returnId }, select: { id: true } });
      return Boolean(returnRecord);
    }

    if (modelName === 'receiptAuditEntry') {
      if (!data.sessionId) return false;
      const session = await tx.receiptAuditSession.findUnique({ where: { id: data.sessionId }, select: { id: true } });
      return Boolean(session);
    }

    if (modelName === 'supplierLedgerEntry' || modelName === 'supplierPayment' || modelName === 'milkCollection') {
      if (!data.supplierId) return false;
      const supplier = await tx.supplier.findUnique({ where: { id: data.supplierId }, select: { id: true } });
      return Boolean(supplier);
    }

    return true;
  }

  private async hasConflictingUserName(modelName: string, data: Record<string, any>, recordId: string, db: any) {
    if (modelName !== 'user' || !data.username) return false;

    const username = String(data.username).trim();
    if (!username) return false;

    const existingByUsername = await db.user.findUnique({
      where: { username },
      select: { id: true }
    });

    return Boolean(existingByUsername && existingByUsername.id !== recordId);
  }

  async processOperation(op: any, tx?: Prisma.TransactionClient) {
    const { table, operation, recordId, payload, deviceId, timestamp } = op;
    const db = tx || this.prisma;
    const modelName = this.tableMap[table] || table;
    const model = this.getModel(db, table);
    const normalizedPayload = this.sanitizePayload(modelName, this.toCamelCaseObject(payload || {}));
    if (recordId && !normalizedPayload.id) normalizedPayload.id = recordId;

    try {
      // 1. Immutable logic for sales
      if ((table === 'sale_items' || table === 'saleItems') && operation !== 'INSERT') {
        return { success: true, action: 'skipped', reason: 'Sales are immutable' };
      }

      const existingRecord = await model.findUnique({
        where: { id: recordId }
      });

      if (modelName === 'sale' && normalizedPayload.transactionId) {
        const existingByTransaction = await this.prisma.sale.findUnique({
          where: { transactionId: normalizedPayload.transactionId }
        });
        if (existingByTransaction && existingByTransaction.id !== recordId) {
          return { success: true, action: 'skipped', reason: 'Duplicate transaction ID' };
        }
      }

      // 2. Insert Logic (Idempotent)
      if (operation === 'INSERT') {
        if (existingRecord) {
          // Immutable transaction rows should not be overwritten by duplicate inserts.
          if (modelName === 'sale' || modelName === 'saleItem') {
            return { success: true, action: 'skipped', reason: 'Duplicate sale' };
          }

          const data = { ...normalizedPayload };
          delete data.id;
          if (await this.hasConflictingUserName(modelName, data, recordId, db)) {
            return { success: true, action: 'skipped', reason: 'Duplicate username' };
          }
          await this.ensureSyncDependencies(modelName, normalizedPayload, db as Prisma.TransactionClient);
          if (Object.keys(data).length > 0) {
            await model.update({ where: { id: recordId }, data });
          }
          return { success: true, action: 'updated' };
        } else {
          // Transform payload string dates to Date objects where appropriate
          const data = { ...normalizedPayload };
          if (!(await this.hasRequiredParent(modelName, data, db as Prisma.TransactionClient))) {
            return { success: true, action: 'skipped', reason: `Missing parent for ${modelName}` };
          }
          if (await this.hasConflictingUserName(modelName, data, recordId, db)) {
            return { success: true, action: 'skipped', reason: 'Duplicate username' };
          }
          await this.ensureSyncDependencies(modelName, data, db as Prisma.TransactionClient);
          
          await model.create({ data });
          
          // Re-calculate stock if it's a stock movement
          if (table === 'stockMovements' || table === 'stock_movements') {
             await this.recalculateStock(normalizedPayload.productId, db);
          }
          return { success: true, action: 'created' };
        }
      }

      // 3. Update Logic (Last Write Wins)
      if (operation === 'UPDATE') {
        if (table === 'sales' || table === 'sale') {
          const allowedSaleUpdate: Record<string, any> = {};
          if (normalizedPayload.status) allowedSaleUpdate.status = normalizedPayload.status;
          if (normalizedPayload.notes !== undefined) allowedSaleUpdate.notes = normalizedPayload.notes;
          if (Object.keys(allowedSaleUpdate).length === 0) {
            return { success: true, action: 'skipped', reason: 'No supported sale update fields' };
          }
          normalizedPayload.id = recordId;
          Object.keys(normalizedPayload).forEach((key) => {
            if (!['id', 'status', 'notes', 'updatedAt'].includes(key)) {
              delete normalizedPayload[key];
            }
          });
        }

        if (!existingRecord) {
           // Treating as upsert if missing but update preferred
           if (!(await this.hasRequiredParent(modelName, normalizedPayload, db as Prisma.TransactionClient))) {
            return { success: true, action: 'skipped', reason: `Missing parent for ${modelName}` };
           }
           if (await this.hasConflictingUserName(modelName, normalizedPayload, recordId, db)) {
            return { success: true, action: 'skipped', reason: 'Duplicate username' };
           }
           await this.ensureSyncDependencies(modelName, normalizedPayload, db as Prisma.TransactionClient);
           await model.create({ data: normalizedPayload });
           return { success: true, action: 'created' };
        }
        
        const existingDateRaw = existingRecord.updatedAt || existingRecord.createdAt || timestamp;
        const incomingDateRaw = normalizedPayload.updatedAt || normalizedPayload.createdAt || timestamp;
        const existingDate = new Date(existingDateRaw).getTime();
        const incomingDate = new Date(incomingDateRaw).getTime();

        if (!Number.isFinite(existingDate) || !Number.isFinite(incomingDate) || incomingDate > existingDate) {
          if (await this.hasConflictingUserName(modelName, normalizedPayload, recordId, db)) {
            return { success: true, action: 'skipped', reason: 'Duplicate username' };
          }
          await model.update({
             where: { id: recordId },
             data: normalizedPayload
          });
          return { success: true, action: 'updated' };
        } else {
          return { success: true, action: 'skipped', reason: 'Cloud record is newer' };
        }
      }

      // 4. Delete Logic (Soft Delete)
      if (operation === 'DELETE') {
        if (existingRecord) {
          const supportsSoftDelete = ['users', 'products', 'customers', 'expenses'].includes(table);
          if (supportsSoftDelete) {
            await model.update({
              where: { id: recordId },
              data: { isActive: false }
            });
          } else {
            await model.delete({ where: { id: recordId } });
          }
          return { success: true, action: 'updated' };
        }
      }

      return { success: true, action: 'skipped' };
    } catch (e: any) {
      // Prisma error code mapping — handle common known failures gracefully so the
      // sync engine can retry instead of failing with a 400 and getting stuck.
      const code = e?.code;
      if (code === 'P2003') {
        // Foreign key violation — parent not synced yet. Will retry once parent arrives.
        console.warn(`Sync FK miss on table ${table}: ${e.message}`);
        return { success: true, action: 'skipped', reason: `Missing parent for ${modelName}` };
      }
      if (code === 'P2002') {
        // Unique constraint — record already exists. Treat as success (idempotent).
        console.warn(`Sync unique conflict on table ${table}: ${e.message}`);
        return { success: true, action: 'skipped', reason: 'Duplicate record (unique constraint)' };
      }
      if (code === 'P2025') {
        // Record not found during update — will retry as upsert.
        console.warn(`Sync missing record on table ${table}: ${e.message}`);
        return { success: true, action: 'skipped', reason: 'Record not found for update' };
      }
      console.error(`Sync error on table ${table}:`, e.message);
      throw new BadRequestException({ error: 'SYNC_ERROR', message: e.message });
    }
  }

  async processBatch(operations: any[]) {
    // Process sequentially but wrapped in transaction for atomic guarantee
    return this.prisma.$transaction(async (tx) => {
      const results: Array<Record<string, any>> = [];
      for (const op of operations) {
        const res = await this.processOperation(op, tx);
        results.push({ recordId: op.recordId, ...res });
      }
      return results;
    });
  }

  async pullData(deviceId: string, since: string) {
    const dateQuery = since ? new Date(since) : new Date(0);
    
    // Pull only shared baseline data, ignore sales/expenses generated by isolated terminals
    const [products, customers, dailyRates, settings] = await Promise.all([
      this.prisma.product.findMany({ where: { updatedAt: { gt: dateQuery } } }),
      this.prisma.customer.findMany({ where: { updatedAt: { gt: dateQuery } } }),
      this.prisma.dailyRate.findMany({ where: { createdAt: { gt: dateQuery } } }),
      this.prisma.setting.findMany({ where: { updatedAt: { gt: dateQuery } } })
    ]);

    // Track that terminal pulled
    await this.prisma.device.update({
      where: { deviceId },
      data: { lastSeenAt: new Date(), lastSyncedAt: new Date() }
    }).catch(() => null); // Silently ignore if not registered

    return {
      products,
      customers,
      dailyRates,
      settings
    };
  }

  async getStatus(deviceId: string) {
    const device = await this.prisma.device.findUnique({ where: { deviceId } });
    return {
      pendingInCloud: 0,
      lastSyncedAt: device?.lastSyncedAt?.toISOString() || null,
      deviceName: device?.deviceName || 'Unknown'
    };
  }

  async verifyRecords(records: Array<{ table: string; id: string }> = []) {
    const safeRecords = (Array.isArray(records) ? records : [])
      .filter((record) => record?.table && record?.id)
      .slice(0, 50);

    const results = await Promise.all(safeRecords.map(async (record) => {
      const modelName = this.tableMap[record.table] || record.table;
      const model = (this.prisma as any)[modelName];

      if (!model?.findUnique) {
        return {
          table: record.table,
          model: modelName,
          id: record.id,
          found: false,
          error: 'Unsupported table'
        };
      }

      const found = await model.findUnique({
        where: { id: record.id },
        select: { id: true }
      });

      return {
        table: record.table,
        model: modelName,
        id: record.id,
        found: Boolean(found)
      };
    }));

    return {
      success: true,
      checked: results.length,
      found: results.filter((result) => result.found).length,
      missing: results.filter((result) => !result.found).length,
      results
    };
  }

  async registerDevice(data: any) {
    if (!data?.deviceId) {
      throw new BadRequestException('Device ID is required');
    }

    const syncToken = createSyncToken();
    const syncTokenHash = hashSyncToken(syncToken);
    const tokenIssuedAt = new Date();

    const device = await this.prisma.device.upsert({
      where: { deviceId: data.deviceId },
      update: {
        lastSeenAt: tokenIssuedAt,
        deviceName: data.deviceName || 'Unknown terminal',
        terminalNumber: Number(data.terminalNumber || 1),
        syncTokenHash,
        tokenIssuedAt,
        revokedAt: null
      },
      create: { 
        deviceId: data.deviceId, 
        deviceName: data.deviceName || 'Unknown terminal',
        terminalNumber: Number(data.terminalNumber || 1),
        syncTokenHash,
        tokenIssuedAt,
        revokedAt: null,
        lastSeenAt: tokenIssuedAt,
        lastSyncedAt: tokenIssuedAt
      }
    });
    return { success: true, deviceId: device.deviceId, syncToken };
  }

  async getAllDevices() {
    const devices = await this.prisma.device.findMany({
      orderBy: { terminalNumber: 'asc' }
    });
    return { data: devices };
  }

  private async recalculateStock(productId: string, tx: Prisma.TransactionClient) {
    // Re-verify exact stock sum independently of local clients
    const movements = await tx.stockMovement.findMany({
      where: { productId }
    });
    
    let totalStock = 0;
    movements.forEach(m => {
       const qty = Number(m.quantity);
       if (['STOCK_IN', 'OPENING', 'RETURN_IN', 'VOID_RESTOCK', 'MILK_COLLECTION', 'DELIVERY_RETURN'].includes(m.movementType)) {
         totalStock += qty;
       } else if (['STOCK_OUT', 'WASTAGE', 'DELIVERY_OUT'].includes(m.movementType)) {
         totalStock -= qty;
       }
    });

    await tx.product.update({
      where: { id: productId },
      data: { stock: totalStock }
    });
  }
}
