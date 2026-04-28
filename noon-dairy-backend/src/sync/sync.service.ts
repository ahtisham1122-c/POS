import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

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

  private async ensureSyncDependencies(modelName: string, data: Record<string, any>, tx: Prisma.TransactionClient) {
    if (modelName === 'sale') {
      await this.ensureUserExists(data.cashierId, tx);
      await this.ensureCustomerExists(data.customerId, tx);
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
          // If sale, skip duplicate silently
          if (table === 'sales' || table === 'saleItems') {
            return { success: true, action: 'skipped', reason: 'Duplicate sale' };
          }
          // Fall through to update but checking timestamps is safer
        } else {
          // Transform payload string dates to Date objects where appropriate
          const data = { ...normalizedPayload };
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
           await this.ensureSyncDependencies(modelName, normalizedPayload, db as Prisma.TransactionClient);
           await model.create({ data: normalizedPayload });
           return { success: true, action: 'created' };
        }
        
        const existingDateRaw = existingRecord.updatedAt || existingRecord.createdAt || timestamp;
        const incomingDateRaw = normalizedPayload.updatedAt || normalizedPayload.createdAt || timestamp;
        const existingDate = new Date(existingDateRaw).getTime();
        const incomingDate = new Date(incomingDateRaw).getTime();

        if (!Number.isFinite(existingDate) || !Number.isFinite(incomingDate) || incomingDate > existingDate) {
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
    const device = await this.prisma.device.upsert({
      where: { deviceId: data.deviceId },
      update: { lastSeenAt: new Date(), deviceName: data.deviceName, terminalNumber: data.terminalNumber },
      create: { 
        deviceId: data.deviceId, 
        deviceName: data.deviceName, 
        terminalNumber: data.terminalNumber, 
        lastSeenAt: new Date(),
        lastSyncedAt: new Date()
      }
    });
    return { success: true, deviceId: device.deviceId };
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
       if (m.movementType === 'STOCK_IN' || m.movementType === 'OPENING' || m.movementType === 'RETURN_IN' || m.movementType === 'VOID_RESTOCK' || m.movementType === 'MILK_COLLECTION') {
         totalStock += qty;
       } else if (m.movementType === 'STOCK_OUT' || m.movementType === 'WASTAGE') {
         totalStock -= qty;
       }
    });

    await tx.product.update({
      where: { id: productId },
      data: { stock: totalStock }
    });
  }
}
