import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { getDeviceInfo } from '../sync/deviceInfo';
import { createOutboxEntry } from '../sync/outboxHelper';
import { addCashIn, addCashOut } from '../database/cashRegister';
import { getCurrentUser, requireCurrentUser, requireManagerApproval } from './auth.ipc';
import { logAudit } from '../audit/auditLog';
import { getBusinessDate, getLateSaleNote } from '../database/businessDay';
import {
  calculateDiscount,
  calculateItemDiscount,
  calculateTax,
  requireNonNegativeNumber,
  requirePositiveNumber,
  resolveSaleUnitPrice,
  roundMoney
} from '../lib/salesMath';

function getSettingsMap() {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as Array<{ key: string; value: string }>;
  return rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

function parseBooleanSetting(value: unknown) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function getSaleDailyRate(businessDate: string) {
  const dailyRate = db.prepare(`
    SELECT *
    FROM daily_rates
    WHERE date = ?
    LIMIT 1
  `).get(businessDate) as any;
  if (dailyRate) return dailyRate;
  throw new Error(`Today's milk/yogurt rates are not set for ${businessDate}. Enter Daily Rates before making sales.`);
}

export function registerSalesIPC() {
  ipcMain.handle('sales:getAll', (_event, filters?: any) => {
    const date = filters?.date?.trim();
    if (date) {
      return db.prepare(`
        SELECT s.*, COALESCE(c.name, 'Walk-in') as customer_name
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        LEFT JOIN shifts sh ON sh.id = s.shift_id
        WHERE sh.shift_date = ? OR (s.shift_id IS NULL AND s.sale_date LIKE ?)
        ORDER BY s.sale_date DESC
      `).all(date, `${date}%`);
    }
    return db.prepare(`
      SELECT s.*, COALESCE(c.name, 'Walk-in') as customer_name
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      ORDER BY s.sale_date DESC
      LIMIT 200
    `).all();
  });

  ipcMain.handle('sales:getOne', (_event, id: string) => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as any;
    if (!sale) return null;
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY created_at ASC').all(id);
    return { ...sale, items };
  });

  ipcMain.handle('sales:getReceipt', (_event, id: string) => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as any;
    if (!sale) return null;
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY created_at ASC').all(id);
    const splitPayments = db.prepare('SELECT * FROM split_payments WHERE sale_id = ? ORDER BY created_at ASC').all(id);
    const customer = sale.customer_id
      ? db.prepare('SELECT id, name, phone FROM customers WHERE id = ?').get(sale.customer_id)
      : null;
    return { sale, items, customer, splitPayments };
  });

  ipcMain.handle('sales:void', async (_event, data: { saleId: string; reason: string; restockItems?: boolean; managerPin?: string }) => {
    try {
      return db.transaction((input) => {
        const manager = requireManagerApproval(input.managerPin, 'voiding a sale');
        const reason = String(input.reason || '').trim();
        if (!reason) throw new Error('Void reason is required');
        if (reason.length < 5) throw new Error('Void reason must be at least 5 characters');

        const sale = db.prepare(`
          SELECT sales.*, shifts.shift_date
          FROM sales
          LEFT JOIN shifts ON shifts.id = sales.shift_id
          WHERE sales.id = ?
        `).get(input.saleId) as any;
        if (!sale) throw new Error('Sale was not found');
        if (sale.status === 'CANCELLED') throw new Error('This bill is already voided');
        if (sale.status === 'REFUNDED' || sale.status === 'PARTIALLY_REFUNDED') {
          throw new Error('Refunded bills cannot be voided. Use the returns record for audit.');
        }

        const alreadyVoided = db.prepare('SELECT id FROM sale_voids WHERE sale_id = ?').get(sale.id);
        if (alreadyVoided) throw new Error('This bill already has a void record');

        const now = new Date().toISOString();
        const voidId = crypto.randomUUID();
        const restockItems = input.restockItems !== false;
        const cashReversed = Number(sale.amount_paid || 0);
        const creditReversed = Number(sale.balance_due || 0);

        if (restockItems) {
          const saleItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id) as any[];
          const getProductStock = db.prepare('SELECT stock FROM products WHERE id = ?');
          const updateProductStock = db.prepare('UPDATE products SET stock = ?, updated_at = ?, synced = 0 WHERE id = ?');
          const insertStockMovement = db.prepare(`
            INSERT INTO stock_movements (
              id, product_id, movement_type, quantity, stock_before, stock_after,
              reference_id, notes, created_by_id, created_at, synced
            ) VALUES (?, ?, 'VOID_RESTOCK', ?, ?, ?, ?, ?, ?, ?, 0)
          `);

          for (const item of saleItems) {
            const stockRow = getProductStock.get(item.product_id) as any;
            const stockBefore = Number(stockRow?.stock || 0);
            const quantity = Number(item.quantity || 0);
            const stockAfter = stockBefore + quantity;
            updateProductStock.run(stockAfter, now, item.product_id);
            createOutboxEntry('products', 'UPDATE', item.product_id, {
              id: item.product_id,
              stock: stockAfter,
              updated_at: now
            });

            const movementId = crypto.randomUUID();
            insertStockMovement.run(
              movementId,
              item.product_id,
              quantity,
              stockBefore,
              stockAfter,
              voidId,
              `Void bill ${sale.bill_number}: ${reason}`,
              manager.id,
              now
            );
            createOutboxEntry('stock_movements', 'INSERT', movementId, {
              id: movementId,
              product_id: item.product_id,
              movement_type: 'VOID_RESTOCK',
              quantity,
              stock_before: stockBefore,
              stock_after: stockAfter,
              reference_id: voidId,
              notes: `Void bill ${sale.bill_number}: ${reason}`,
              created_by_id: manager.id,
              created_at: now
            });
          }
        }

        if (cashReversed > 0) {
          addCashOut(cashReversed, sale.shift_date || getBusinessDate(new Date(now)), sale.shift_id || null);
        }

        if (sale.customer_id && creditReversed > 0) {
          const customer = db.prepare('SELECT current_balance FROM customers WHERE id = ?').get(sale.customer_id) as any;
          const currentBalance = Number(customer?.current_balance || 0);
          const balanceAfter = Math.max(0, currentBalance - creditReversed);

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
            ) VALUES (?, ?, ?, 'VOID_CREDIT_ADJUSTMENT', ?, ?, ?, ?, ?, 0)
          `).run(
            ledgerId,
            sale.customer_id,
            sale.id,
            creditReversed,
            balanceAfter,
            `Void bill ${sale.bill_number}: ${reason}`,
            now,
            now
          );
          createOutboxEntry('ledger_entries', 'INSERT', ledgerId, {
            id: ledgerId,
            customer_id: sale.customer_id,
            sale_id: sale.id,
            entry_type: 'VOID_CREDIT_ADJUSTMENT',
            amount: creditReversed,
            balance_after: balanceAfter,
            description: `Void bill ${sale.bill_number}: ${reason}`,
            entry_date: now,
            created_at: now
          });
        }

        db.prepare(`
          INSERT INTO sale_voids (
            id, sale_id, shift_id, bill_number, voided_by_id, voided_at, reason,
            cash_reversed, credit_reversed, restocked_items, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(
          voidId,
          sale.id,
          sale.shift_id || null,
          sale.bill_number,
          manager.id,
          now,
          reason,
          cashReversed,
          creditReversed,
          restockItems ? 1 : 0,
          now
        );
        createOutboxEntry('sale_voids', 'INSERT', voidId, {
          id: voidId,
          sale_id: sale.id,
          shift_id: sale.shift_id || null,
          bill_number: sale.bill_number,
          voided_by_id: manager.id,
          voided_at: now,
          reason,
          cash_reversed: cashReversed,
          credit_reversed: creditReversed,
          restocked_items: restockItems ? 1 : 0,
          created_at: now
        });

        logAudit({
          actionType: 'VOID_SALE',
          entityType: 'sales',
          entityId: sale.id,
          before: sale,
          after: { status: 'CANCELLED', reason, restockItems, cashReversed, creditReversed },
          reason,
          approvedBy: manager
        });

        db.prepare('UPDATE sales SET status = ?, notes = ?, synced = 0 WHERE id = ?')
          .run('CANCELLED', `Voided by ${manager.name}: ${reason}`, sale.id);
        createOutboxEntry('sales', 'UPDATE', sale.id, {
          id: sale.id,
          status: 'CANCELLED',
          notes: `Voided by ${manager.name}: ${reason}`,
          updated_at: now
        });

        return {
          success: true,
          voidId,
          billNumber: sale.bill_number,
          cashReversed,
          creditReversed,
          restockedItems: restockItems
        };
      })(data);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('sales:create', async (_event, saleData) => {
    const transaction = db.transaction((data) => {
      const now = new Date().toISOString();
      const saleId = crypto.randomUUID();
      const { terminalNumber } = getDeviceInfo();
      const requestedCashierId = data.cashierId || getCurrentUser()?.id;
      if (!requestedCashierId) {
        throw new Error('No logged-in cashier found');
      }

      const cashier = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(requestedCashierId) as any;
      if (!cashier) {
        throw new Error('Logged-in cashier was not found');
      }
      const cashierId = cashier.id;
      const paymentType = String(data.paymentType || '').toUpperCase();
      if (!['CASH', 'ONLINE', 'CREDIT', 'SPLIT'].includes(paymentType)) {
        throw new Error('Invalid payment type');
      }

      const openShift = db.prepare(`
        SELECT *
        FROM shifts
        WHERE status = 'OPEN'
        ORDER BY opened_at DESC
        LIMIT 1
      `).get() as any;

      if (!openShift) {
        throw new Error('Please open a shift before making sales');
      }

      const saleDate = openShift.shift_date;
      const lateSaleNote = getLateSaleNote(openShift, new Date(now));

      const cashRegister = db.prepare('SELECT * FROM cash_register WHERE shift_id = ? OR (shift_id IS NULL AND date = ?) ORDER BY created_at DESC LIMIT 1').get(openShift.id, saleDate) as any;
      if (!cashRegister) {
        throw new Error('Please open the cash register before making sales');
      }

      if (Number(cashRegister.is_closed_for_day || 0) === 1) {
        throw new Error('Cash register is closed for today. No more sales can be made.');
      }

      const transactionId = String(data.transactionId || '').trim();
      if (!transactionId) {
        throw new Error('Sale transaction ID is required. Please try the sale again.');
      }

      const existingSale = db.prepare(`
        SELECT id, bill_number
        FROM sales
        WHERE transaction_id = ?
        LIMIT 1
      `).get(transactionId) as any;

      if (existingSale) {
        return {
          success: false,
          duplicate: true,
          saleId: existingSale.id,
          billNumber: existingSale.bill_number,
          error: `This sale was already saved as ${existingSale.bill_number}. It was not saved again.`
        };
      }

      if (!Array.isArray(data.items) || data.items.length === 0) {
        throw new Error('Sale must contain at least one item');
      }

      if (paymentType === 'CREDIT' && !data.customerId) {
        throw new Error('Please select a customer for khata credit payment');
      }

      const customer = data.customerId
        ? db.prepare('SELECT id, current_balance FROM customers WHERE id = ? AND is_active = 1').get(data.customerId) as any
        : null;

      if (data.customerId && !customer) {
        throw new Error('Selected customer was not found');
      }

      const dailyRate = getSaleDailyRate(saleDate);
      const settingsMap = getSettingsMap();
      const taxEnabled = parseBooleanSetting(settingsMap.taxEnabled);
      const taxRate = requireNonNegativeNumber(settingsMap.taxRate || 0, 'Tax rate');
      const taxLabel = String(settingsMap.taxLabel || 'Tax').trim() || 'Tax';
      const normalizedItems = data.items.map((item: any) => {
        const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(item.productId) as any;
        if (!product) {
          throw new Error(`Product not found for sale item`);
        }

        const quantity = requirePositiveNumber(item.quantity, `${product.name} quantity`);
        const unitPrice = resolveSaleUnitPrice(product, dailyRate);
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
          throw new Error(`${product.name} does not have a valid selling price`);
        }

        const grossLineTotal = roundMoney(quantity * unitPrice);
        const itemDiscount = calculateItemDiscount(grossLineTotal, item.discountType || 'NONE', item.discountValue || 0);

        return {
          productId: product.id,
          productName: product.name,
          unit: product.unit,
          quantity,
          sellingPrice: unitPrice,
          costPrice: Number(product.cost_price || 0),
          taxExempt: Number(product.tax_exempt || 0) === 1,
          discountType: itemDiscount.discountType,
          discountValue: itemDiscount.discountValue,
          discountAmount: itemDiscount.discountAmount,
          lineTotal: roundMoney(grossLineTotal - itemDiscount.discountAmount)
        };
      });

      const subtotal = roundMoney(normalizedItems.reduce((sum: number, item: any) => sum + item.lineTotal, 0));
      const taxableSubtotal = roundMoney(normalizedItems.reduce((sum: number, item: any) => sum + (item.taxExempt ? 0 : item.lineTotal), 0));
      const discount = calculateDiscount(subtotal, data.discountType || 'NONE', data.discountValue);
      const totalItemDiscount = roundMoney(normalizedItems.reduce((sum: number, item: any) => sum + item.discountAmount, 0));
      const totalDiscountGiven = roundMoney(discount.discountAmount + totalItemDiscount);
      const discountApprovalLimit = Number(settingsMap.discountApprovalLimit || 100);
      let discountApprover: any = null;
      if (totalDiscountGiven > discountApprovalLimit) {
        discountApprover = requireManagerApproval(data.managerPin, `discount above Rs. ${discountApprovalLimit}`);
      }
      const tax = calculateTax({
        subtotal,
        taxableSubtotal,
        discountAmount: discount.discountAmount,
        taxEnabled,
        taxRate
      });
      const grandTotal = roundMoney(subtotal - discount.discountAmount + tax.taxAmount);
      const requestedCashPaid = requireNonNegativeNumber(data.cashPaid, 'Cash paid');
      const requestedOnlinePaid = requireNonNegativeNumber(data.onlinePaid, 'Online paid');
      const requestedCashTendered = requireNonNegativeNumber(data.cashTendered, 'Cash tendered');
      const cashPaid = paymentType === 'CASH'
        ? grandTotal
        : paymentType === 'SPLIT'
          ? requestedCashPaid
          : 0;
      const onlinePaid = paymentType === 'ONLINE'
        ? grandTotal
        : paymentType === 'SPLIT'
          ? requestedOnlinePaid
          : 0;
      const amountPaid = paymentType === 'CREDIT' ? 0 : roundMoney(cashPaid + onlinePaid);
      const balanceDue = paymentType === 'CREDIT' ? grandTotal : 0;
      const cashTendered = paymentType === 'CASH'
        ? (requestedCashTendered === 0 || Math.abs(requestedCashTendered - grandTotal) < 0.01 ? grandTotal : roundMoney(requestedCashTendered))
        : paymentType === 'SPLIT'
          ? cashPaid
          : 0;
      const changeReturned = paymentType === 'CASH' ? roundMoney(cashTendered - grandTotal) : 0;

      if (paymentType === 'CASH' && cashTendered < grandTotal) {
        throw new Error('Cash tendered cannot be less than the bill total');
      }

      if (paymentType === 'SPLIT' && cashPaid <= 0) {
        throw new Error('Split payment must include some cash');
      }

      if (paymentType === 'SPLIT' && onlinePaid <= 0) {
        throw new Error('Split payment must include some online payment');
      }

      if (paymentType === 'SPLIT' && Math.round(amountPaid) !== Math.round(grandTotal)) {
        throw new Error('Split payment cash plus online amount must equal the bill total');
      }

      if (paymentType === 'CREDIT' && amountPaid !== 0) {
        throw new Error('Credit sale cannot include cash paid');
      }
      
      db.prepare('UPDATE bill_counter SET last_number = last_number + 1 WHERE id = 1').run();
      const counterResult = db.prepare('SELECT last_number FROM bill_counter WHERE id = 1').get() as { last_number: number };
      const billNumber = `BILL-${String(counterResult.last_number).padStart(4, '0')}`;

      // 1. INSERT into sales table
      db.prepare(`
        INSERT INTO sales (
          id, transaction_id, shift_id, bill_number, sale_date, customer_id, cashier_id, payment_type,
          subtotal, discount_type, discount_value, discount_amount, tax_enabled, tax_label, tax_rate, taxable_amount, tax_amount, grand_total, 
          amount_paid, cash_tendered, change_returned, balance_due, status, created_at, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        saleId, transactionId, openShift.id, billNumber, now, data.customerId || null, cashierId, paymentType,
        subtotal, discount.discountType, discount.discountValue, discount.discountAmount,
        tax.taxEnabled ? 1 : 0, taxLabel, taxRate, tax.taxableAmount, tax.taxAmount, grandTotal,
        amountPaid, cashTendered, changeReturned, balanceDue, 'COMPLETED', now
      );

      // Create sync outbox entry for sale
      createOutboxEntry('sales', 'INSERT', saleId, {
        id: saleId, transaction_id: transactionId, bill_number: billNumber, sale_date: now, customer_id: data.customerId || null,
        shift_id: openShift.id, cashier_id: cashierId, payment_type: paymentType, subtotal,
        discount_type: discount.discountType, discount_value: discount.discountValue, discount_amount: discount.discountAmount,
        tax_enabled: tax.taxEnabled ? 1 : 0,
        tax_label: taxLabel,
        tax_rate: taxRate,
        taxable_amount: tax.taxableAmount,
        tax_amount: tax.taxAmount,
        grand_total: grandTotal, amount_paid: amountPaid, cash_tendered: cashTendered, change_returned: changeReturned, balance_due: balanceDue,
        created_at: now
      });

      // 2. Process sale items
      if (normalizedItems.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO sale_items (
            id, sale_id, product_id, product_name, unit, quantity, unit_price, cost_price,
            discount_type, discount_value, discount_amount, line_total, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `);
        const updateStock = db.prepare(`UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?`);
        const getStock = db.prepare(`SELECT stock, code, category FROM products WHERE id = ?`);
        const insertMovement = db.prepare(`
          INSERT INTO stock_movements (
            id, product_id, movement_type, quantity, stock_before, stock_after, reference_id, created_by_id, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `);

        for (const item of normalizedItems) {
          const itemId = crypto.randomUUID();
          insertItem.run(
            itemId, saleId, item.productId, item.productName, item.unit, 
            item.quantity, item.sellingPrice, item.costPrice || 0,
            item.discountType, item.discountValue, item.discountAmount, item.lineTotal, now
          );
          
          createOutboxEntry('sale_items', 'INSERT', itemId, {
            id: itemId,
            sale_id: saleId,
            product_id: item.productId,
            product_name: item.productName,
            unit: item.unit,
            quantity: item.quantity,
            unit_price: item.sellingPrice,
            cost_price: item.costPrice || 0,
            discount_type: item.discountType,
            discount_value: item.discountValue,
            discount_amount: item.discountAmount,
            line_total: item.lineTotal,
            created_at: now
          });

          // 3. Stock management
          const currentStockObj: any = getStock.get(item.productId);
          if (currentStockObj) {
            const currentStock = currentStockObj.stock;
            // Milk and yogurt are tracked via supplier collections / production — allow going below 0
            const isTrackedDairy = ['MILK', 'YOGT'].includes(String(currentStockObj.code || '').toUpperCase());
            if (!isTrackedDairy && currentStock - item.quantity < 0) {
              throw new Error(`Insufficient stock for ${item.productName}`);
            }
            updateStock.run(item.quantity, now, item.productId);
            createOutboxEntry('products', 'UPDATE', item.productId, { id: item.productId, stock: currentStock - item.quantity, updated_at: now });
            
            // 4. Stock Movement
            const movId = crypto.randomUUID();
            insertMovement.run(
              movId, item.productId, 'STOCK_OUT', item.quantity, 
              currentStock, currentStock - item.quantity, saleId, cashierId, now
            );
            createOutboxEntry('stock_movements', 'INSERT', movId, {
              id: movId, product_id: item.productId, movement_type: 'STOCK_OUT',
              quantity: item.quantity,
              stock_before: currentStock,
              stock_after: currentStock - item.quantity,
              reference_id: saleId,
              created_by_id: cashierId,
              created_at: now
            });
          }
        }
      }

      // 5. Credit Payment Logic
      const insertSplitPayment = db.prepare(`
        INSERT INTO split_payments (
          id, sale_id, method, amount, customer_id, received_by_id, created_at, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `);

      if (cashPaid > 0) {
        const splitPaymentId = crypto.randomUUID();
        insertSplitPayment.run(splitPaymentId, saleId, 'CASH', cashPaid, null, cashierId, now);
        createOutboxEntry('split_payments', 'INSERT', splitPaymentId, {
          id: splitPaymentId,
          sale_id: saleId,
          method: 'CASH',
          amount: cashPaid,
          customer_id: null,
          received_by_id: cashierId,
          created_at: now
        });
      }

      if (onlinePaid > 0) {
        const onlineSplitPaymentId = crypto.randomUUID();
        insertSplitPayment.run(onlineSplitPaymentId, saleId, 'ONLINE', onlinePaid, null, cashierId, now);
        createOutboxEntry('split_payments', 'INSERT', onlineSplitPaymentId, {
          id: onlineSplitPaymentId,
          sale_id: saleId,
          method: 'ONLINE',
          amount: onlinePaid,
          customer_id: null,
          received_by_id: cashierId,
          created_at: now
        });
      }

      if (data.customerId && paymentType === 'CREDIT') {
        const creditSplitPaymentId = crypto.randomUUID();
        insertSplitPayment.run(creditSplitPaymentId, saleId, 'KHATA', balanceDue, data.customerId, cashierId, now);
        createOutboxEntry('split_payments', 'INSERT', creditSplitPaymentId, {
          id: creditSplitPaymentId,
          sale_id: saleId,
          method: 'KHATA',
          amount: balanceDue,
          customer_id: data.customerId,
          received_by_id: cashierId,
          created_at: now
        });

        const newBalance = (customer?.current_balance || 0) + balanceDue;
        
        db.prepare(`UPDATE customers SET current_balance = ?, updated_at = ? WHERE id = ?`).run(newBalance, now, data.customerId);
        createOutboxEntry('customers', 'UPDATE', data.customerId, { id: data.customerId, current_balance: newBalance, updated_at: now });

        const ledgerId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO ledger_entries (id, customer_id, sale_id, entry_type, amount, balance_after, description, entry_date, created_at, synced)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(ledgerId, data.customerId, saleId, 'SALE_CREDIT', balanceDue, newBalance, `Credit Sale #${billNumber}`, now, now);
        createOutboxEntry('ledger_entries', 'INSERT', ledgerId, {
          id: ledgerId,
          customer_id: data.customerId,
          sale_id: saleId,
          entry_type: 'SALE_CREDIT',
          amount: balanceDue,
          balance_after: newBalance,
          description: `Credit Sale #${billNumber}`,
          entry_date: now,
          created_at: now
        });
      }

      // 6. Cash Register Logic
      if (cashPaid > 0) {
        addCashIn(Number(cashPaid), saleDate, openShift.id);
      }

      if (totalDiscountGiven > 0) {
        logAudit({
          actionType: 'DISCOUNT_GIVEN',
          entityType: 'sales',
          entityId: saleId,
          after: { billNumber, orderDiscount: discount.discountAmount, itemDiscount: totalItemDiscount, totalDiscountGiven },
          approvedBy: discountApprover
        });
      }

      return {
        success: true,
        saleId,
        transactionId,
        billNumber,
        subtotal,
        discountAmount: discount.discountAmount,
        taxAmount: tax.taxAmount,
        taxRate,
        taxLabel,
        grandTotal,
        amountPaid,
        balanceDue,
        cashPaid,
        onlinePaid,
        cashTendered,
        changeReturned,
        lateSaleNote
      };
    });

    try {
      const result = transaction(saleData);
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('sales:hold', async (_event, holdData) => {
    const transaction = db.transaction((data) => {
      const now = new Date().toISOString();
      const holdId = data.id || crypto.randomUUID();

      db.prepare(`
        INSERT INTO held_sales (id, customer_id, customer_name, payment_type, subtotal, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(holdId, data.customerId || null, data.customerName || 'Walk-in', data.paymentType, data.subtotal, now);

      const insertItem = db.prepare(`
        INSERT INTO held_sale_items (id, held_sale_id, product_id, product_name, unit, quantity, unit_price, line_total, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of data.items) {
        insertItem.run(
          crypto.randomUUID(), holdId, item.productId, item.productName, item.unit,
          item.quantity, item.price, item.lineTotal, now
        );
      }
      return { success: true, holdId };
    });

    try {
      return transaction(holdData);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('sales:getHeld', () => {
    try {
      const heldSales = db.prepare('SELECT * FROM held_sales ORDER BY created_at ASC').all() as any[];
      return heldSales.map(sale => {
        const items = db.prepare('SELECT * FROM held_sale_items WHERE held_sale_id = ?').all(sale.id);
        return {
          id: sale.id,
          customerId: sale.customer_id,
          customerName: sale.customer_name,
          paymentType: sale.payment_type,
          subtotal: sale.subtotal,
          time: sale.created_at,
          items: items.map((i: any) => ({
            productId: i.product_id,
            name: i.product_name,
            unit: i.unit,
            quantity: i.quantity,
            price: i.unit_price,
            lineTotal: i.line_total
          }))
        };
      });
    } catch (error: any) {
      console.error('Error fetching held sales:', error);
      return [];
    }
  });

  ipcMain.handle('sales:deleteHeld', (_event, id: string) => {
    const transaction = db.transaction((holdId) => {
      db.prepare('DELETE FROM held_sale_items WHERE held_sale_id = ?').run(holdId);
      db.prepare('DELETE FROM held_sales WHERE id = ?').run(holdId);
      return { success: true };
    });
    try {
      return transaction(id);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
