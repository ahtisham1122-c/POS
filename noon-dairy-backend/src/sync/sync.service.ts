import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class SyncService {
  constructor(private prisma: PrismaService) {}

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

  async processOperation(op: any, tx?: Prisma.TransactionClient) {
    const { table, operation, recordId, payload, deviceId, timestamp } = op;
    const db = tx || this.prisma;
    const model = this.getModel(db, table);
    const normalizedPayload = this.toCamelCaseObject(payload || {});
    if (recordId && !normalizedPayload.id) normalizedPayload.id = recordId;

    try {
      // 1. Immutable logic for sales
      if ((table === 'sale_items' || table === 'saleItems') && operation !== 'INSERT') {
        return { success: true, action: 'skipped', reason: 'Sales are immutable' };
      }

      const existingRecord = await model.findUnique({
        where: { id: recordId }
      });

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
