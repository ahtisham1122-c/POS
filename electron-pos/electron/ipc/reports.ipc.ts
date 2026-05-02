import { ipcMain } from 'electron';
import db from '../database/db';
import { createOutboxEntry } from '../sync/outboxHelper';
import { getCashRegisterExpected } from '../database/cashRegister';
import { getActiveBusinessDate, getBusinessDate } from '../database/businessDay';

const ACCOUNTING_SALE_STATUSES = "'COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'";

function getShiftScope(reportDate: string) {
  const shift = db.prepare(`
    SELECT s.*, opener.name as cashier_name, closer.name as closed_by_name
    FROM shifts s
    LEFT JOIN users opener ON opener.id = s.opened_by_id
    LEFT JOIN users closer ON closer.id = s.closed_by_id
    WHERE s.shift_date = ?
    ORDER BY s.opened_at DESC
    LIMIT 1
  `).get(reportDate) as any;

  return { date: reportDate, shift, shiftId: shift?.id || null };
}

function saleScope(alias: string, scope: { date: string; shiftId: string | null }) {
  if (scope.shiftId) {
    return `(${alias}.shift_id = ? OR (${alias}.shift_id IS NULL AND substr(${alias}.sale_date, 1, 10) = ?))`;
  }
  return `substr(${alias}.sale_date, 1, 10) = ?`;
}

function scopeParams(scope: { date: string; shiftId: string | null }) {
  return scope.shiftId ? [scope.shiftId, scope.date] : [scope.date];
}

function shiftTableScope(alias: string, dateColumn: string, scope: { date: string; shiftId: string | null }) {
  if (scope.shiftId) {
    return `(${alias}.shift_id = ? OR (${alias}.shift_id IS NULL AND substr(${alias}.${dateColumn}, 1, 10) = ?))`;
  }
  return `substr(${alias}.${dateColumn}, 1, 10) = ?`;
}

export function registerReportsIPC() {
  ipcMain.handle('reports:getZReport', (_event, date: string) => {
    const reportDate = date || getBusinessDate();
    const scope = getShiftScope(reportDate);
    const shift = scope.shift;
    const saleWhere = saleScope('s', scope);
    const saleParams = scopeParams(scope);
    const register = scope.shiftId
      ? db.prepare('SELECT * FROM cash_register WHERE shift_id = ? OR (shift_id IS NULL AND date = ?) ORDER BY created_at DESC LIMIT 1').get(scope.shiftId, reportDate) as any
      : db.prepare('SELECT * FROM cash_register WHERE date = ? ORDER BY created_at DESC LIMIT 1').get(reportDate) as any;

    const saleStats = db.prepare(`
      SELECT
        COUNT(*) as salesCount,
        COALESCE(SUM(grand_total), 0) as grossSales,
        COALESCE(SUM(discount_amount), 0) as orderDiscounts,
        COALESCE(SUM(balance_due), 0) as khataSales
      FROM sales s
      WHERE ${saleWhere} AND s.status != 'CANCELLED'
    `).get(...saleParams) as any;

    const itemDiscountStats = db.prepare(`
      SELECT COALESCE(SUM(si.discount_amount), 0) as itemDiscounts
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${saleWhere} AND s.status != 'CANCELLED'
    `).get(...saleParams) as any;

    const tenderStats = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN sp.method = 'CASH' THEN sp.amount ELSE 0 END), 0) as cashSales,
        COALESCE(SUM(CASE WHEN sp.method = 'ONLINE' THEN sp.amount ELSE 0 END), 0) as onlineSales,
        COALESCE(SUM(CASE WHEN sp.method = 'KHATA' THEN sp.amount ELSE 0 END), 0) as khataTender
      FROM split_payments sp
      JOIN sales s ON s.id = sp.sale_id
      WHERE ${saleWhere} AND s.status != 'CANCELLED'
    `).get(...saleParams) as any;

    const refundStats = db.prepare(`
      SELECT
        COUNT(*) as refundCount,
        COALESCE(SUM(refund_amount), 0) as totalRefunds,
        COALESCE(SUM(CASE WHEN refund_method = 'CASH' THEN refund_amount ELSE 0 END), 0) as cashRefunds
      FROM returns r
      WHERE ${shiftTableScope('r', 'return_date', scope)} AND r.status = 'COMPLETED'
    `).get(...scopeParams(scope)) as any;

    const voidStats = db.prepare(`
      SELECT
        COUNT(*) as voidCount,
        COALESCE(SUM(cash_reversed), 0) as voidCash,
        COALESCE(SUM(credit_reversed), 0) as voidCredit
      FROM sale_voids v
      WHERE ${shiftTableScope('v', 'voided_at', scope)}
    `).get(...scopeParams(scope)) as any;

    const expenseStats = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as expenses
      FROM expenses e
      WHERE ${shiftTableScope('e', 'expense_date', scope)}
    `).get(...scopeParams(scope)) as any;

    const drawer = getCashRegisterExpected(reportDate, scope.shiftId);
    const openingCash = Number(shift?.opening_cash ?? drawer.openingCash);
    const cashSales = Number(tenderStats?.cashSales || 0);
    const cashRefunds = Number(refundStats?.cashRefunds || 0);
    const expenses = Number(expenseStats?.expenses || 0);
    const expectedCash = drawer.expectedCash;
    const countedCash = Number(shift?.closing_cash ?? register?.closing_balance ?? 0);
    const isClosed = Boolean(shift?.closed_at || Number(register?.is_closed_for_day || 0) === 1);
    const variance = isClosed ? Number((countedCash - expectedCash).toFixed(2)) : 0;

    return {
      date: reportDate,
      openingCash,
      totalSalesCount: Number(saleStats?.salesCount || 0),
      grossSalesAmount: Number(saleStats?.grossSales || 0),
      totalDiscounts: Number((Number(saleStats?.orderDiscounts || 0) + Number(itemDiscountStats?.itemDiscounts || 0)).toFixed(2)),
      totalRefunds: Number(refundStats?.totalRefunds || 0),
      refundCount: Number(refundStats?.refundCount || 0),
      totalVoids: Number(voidStats?.voidCount || 0),
      voidCash: Number(voidStats?.voidCash || 0),
      voidCredit: Number(voidStats?.voidCredit || 0),
      khataCreditSales: Number(saleStats?.khataSales || tenderStats?.khataTender || 0),
      cashSales,
      onlineSales: Number(tenderStats?.onlineSales || 0),
      expenses,
      cashInRecorded: drawer.cashIn,
      cashOutRecorded: drawer.cashOut,
      netExpectedCashInDrawer: expectedCash,
      cashActuallyCounted: countedCash,
      variance,
      cashierName: shift?.cashier_name || 'Unknown cashier',
      closedByName: shift?.closed_by_name || null,
      shiftOpenTime: shift?.opened_at || register?.created_at || null,
      shiftCloseTime: shift?.closed_at || null,
      shiftHours: shift?.opened_at
        ? Number(((new Date(shift?.closed_at || new Date().toISOString()).getTime() - new Date(shift.opened_at).getTime()) / 3600000).toFixed(2))
        : 0,
      status: isClosed ? 'CLOSED' : 'OPEN'
    };
  });

  ipcMain.handle('reports:getDailySummary', (_event, date: string) => {
    const scope = getShiftScope(date || getBusinessDate());
    const saleWhere = saleScope('s', scope);
    const saleParams = scopeParams(scope);
    const sales = db.prepare(`SELECT SUM(grand_total) as total, SUM(amount_paid) as collected FROM sales s WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})`).get(...saleParams) as any;
    const tenders = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN sp.method = 'CASH' THEN sp.amount ELSE 0 END), 0) as cashCollected,
        COALESCE(SUM(CASE WHEN sp.method = 'ONLINE' THEN sp.amount ELSE 0 END), 0) as onlineCollected
      FROM split_payments sp
      JOIN sales s ON s.id = sp.sale_id
      WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(...saleParams) as any;
    const returns = db.prepare(`
      SELECT
        SUM(refund_amount) as total,
        SUM(CASE WHEN refund_method = 'CASH' THEN refund_amount ELSE 0 END) as cashRefunds
      FROM returns r
      WHERE ${shiftTableScope('r', 'return_date', scope)} AND r.status = 'COMPLETED'
    `).get(...scopeParams(scope)) as any;
    const expenses = db.prepare(`SELECT SUM(amount) as total FROM expenses e WHERE ${shiftTableScope('e', 'expense_date', scope)}`).get(...scopeParams(scope)) as any;
    const refundTotal = returns?.total || 0;
    const cashRefunds = returns?.cashRefunds || 0;
    
    return {
      date: scope.date,
      totalSales: (sales?.total || 0) - refundTotal,
      grossSales: sales?.total || 0,
      totalRefunds: refundTotal,
      totalCollected: (sales?.collected || 0) - cashRefunds,
      cashCollected: (tenders?.cashCollected || 0) - cashRefunds,
      onlineCollected: tenders?.onlineCollected || 0,
      totalExpenses: expenses?.total || 0,
      netCash: (tenders?.cashCollected || 0) - cashRefunds - (expenses?.total || 0),
    };
  });

  ipcMain.handle('reports:getEndOfDay', (_event, date: string) => {
    const scope = getShiftScope(date || getBusinessDate());
    const saleWhere = saleScope('s', scope);
    const saleParams = scopeParams(scope);
    const saleStats = db.prepare(`
      SELECT 
        COUNT(*) as bills, 
        SUM(grand_total) as totalSales, 
        SUM(amount_paid) as paidSales, 
        SUM(balance_due) as creditSales 
      FROM sales s WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(...saleParams) as any;

    const milkStats = db.prepare(`
      SELECT SUM(si.quantity) as qty
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE si.product_name LIKE '%milk%' AND ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(...saleParams) as any;

    const yogurtStats = db.prepare(`
      SELECT SUM(si.quantity) as qty
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE si.product_name LIKE '%yogurt%' AND ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(...saleParams) as any;

    const expenseStats = db.prepare(`
      SELECT SUM(amount) as total FROM expenses e WHERE ${shiftTableScope('e', 'expense_date', scope)}
    `).get(...scopeParams(scope)) as any;

    const returnStats = db.prepare(`
      SELECT
        COUNT(*) as count,
        SUM(refund_amount) as total,
        SUM(CASE WHEN refund_method = 'CASH' THEN refund_amount ELSE 0 END) as cashRefunds
      FROM returns r
      WHERE ${shiftTableScope('r', 'return_date', scope)} AND r.status = 'COMPLETED'
    `).get(...scopeParams(scope)) as any;

    const drawer = getCashRegisterExpected(scope.date, scope.shiftId);
    const tenderStats = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN sp.method = 'CASH' THEN sp.amount ELSE 0 END), 0) as cashSales,
        COALESCE(SUM(CASE WHEN sp.method = 'ONLINE' THEN sp.amount ELSE 0 END), 0) as onlineSales
      FROM split_payments sp
      JOIN sales s ON s.id = sp.sale_id
      WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(...saleParams) as any;

    return {
      bills: saleStats?.bills || 0,
      totalSales: (saleStats?.totalSales || 0) - (returnStats?.total || 0),
      grossSales: saleStats?.totalSales || 0,
      refunds: returnStats?.total || 0,
      refundCount: returnStats?.count || 0,
      cashSales: (tenderStats?.cashSales || 0) - (returnStats?.cashRefunds || 0),
      onlineSales: tenderStats?.onlineSales || 0,
      creditSales: saleStats?.creditSales || 0,
      milkSold: milkStats?.qty || 0,
      yogurtSold: yogurtStats?.qty || 0,
      expenses: expenseStats?.total || 0,
      cashInDrawer: drawer.expectedCash
    };
  });

  ipcMain.handle('reports:closeRegister', (_event, data: { date: string, physicalCash: number, expectedCash: number, difference: number }) => {
    try {
      return db.transaction(() => {
        const { date, physicalCash } = data;
        const now = new Date().toISOString();
        const scope = getShiftScope(date || getActiveBusinessDate());
        const register = scope.shiftId
          ? db.prepare('SELECT * FROM cash_register WHERE shift_id = ? OR (shift_id IS NULL AND date = ?) ORDER BY created_at DESC LIMIT 1').get(scope.shiftId, scope.date) as any
          : db.prepare('SELECT * FROM cash_register WHERE date = ? ORDER BY created_at DESC LIMIT 1').get(scope.date) as any;

        if (!register) {
          return { success: false, error: 'Cash register is not opened for this date' };
        }

        if (Number(register.is_closed_for_day) === 1) {
          return { success: false, error: 'Cash register is already closed for this date' };
        }

        const countedCash = Number(physicalCash);
        if (!Number.isFinite(countedCash) || countedCash < 0) {
          return { success: false, error: 'Please enter a valid counted cash amount' };
        }

        const expectedCash = getCashRegisterExpected(scope.date, scope.shiftId).expectedCash;
        const difference = Number((countedCash - expectedCash).toFixed(2));
      
        db.prepare(`
          UPDATE cash_register 
          SET closing_balance = ?, is_closed_for_day = 1, synced = 0
          WHERE id = ?
        `).run(countedCash, register.id);
      
        createOutboxEntry('cash_register', 'UPDATE', register.id, {
          id: register.id,
          shift_id: scope.shiftId,
          date: scope.date,
          closing_balance: countedCash,
          expected_cash: expectedCash,
          cash_difference: difference,
          is_closed_for_day: 1,
          updated_at: now
        });

        return { success: true, closingBalance: countedCash, expectedCash, variance: difference };
      })();
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('reports:getSalesChart', (_event, days: number = 7) => {
    const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 7;
    const salesRows = db.prepare(`
      SELECT
        COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) as date,
        COUNT(*) as orders,
        COALESCE(SUM(s.grand_total), 0) as total
      FROM sales s
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE s.sale_date >= datetime('now', ?) AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      GROUP BY COALESCE(sh.shift_date, substr(s.sale_date, 1, 10))
      ORDER BY date ASC
    `).all(`-${safeDays} day`) as Array<{ date: string; orders: number; total: number }>;
    const returnRows = db.prepare(`
      SELECT
        COALESCE(sh.shift_date, substr(r.return_date, 1, 10)) as date,
        COALESCE(SUM(r.refund_amount), 0) as refunds
      FROM returns r
      LEFT JOIN shifts sh ON sh.id = r.shift_id
      WHERE r.return_date >= datetime('now', ?) AND r.status = 'COMPLETED'
      GROUP BY COALESCE(sh.shift_date, substr(r.return_date, 1, 10))
    `).all(`-${safeDays} day`) as Array<{ date: string; refunds: number }>;
    const refundsByDate = new Map(returnRows.map((row) => [row.date, Number(row.refunds || 0)]));
    return salesRows.map((row) => ({
      ...row,
      grossTotal: Number(row.total || 0),
      refunds: refundsByDate.get(row.date) || 0,
      total: Number(row.total || 0) - (refundsByDate.get(row.date) || 0)
    }));
  });

  ipcMain.handle('reports:getProductPerformance', () => {
    return db.prepare(`
      SELECT
        si.product_id as productId,
        si.product_name as productName,
        COALESCE(SUM(si.quantity), 0) as totalQty,
        COALESCE(SUM(si.line_total), 0) as totalSales
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.status IN (${ACCOUNTING_SALE_STATUSES})
      GROUP BY si.product_id, si.product_name
      ORDER BY totalSales DESC
      LIMIT 20
    `).all();
  });

  ipcMain.handle('reports:getCustomerDues', () => {
    return db.prepare(`
      SELECT id, name, phone, current_balance 
      FROM customers 
      WHERE current_balance > 0 AND is_active = 1 
      ORDER BY current_balance DESC
    `).all();
  });

  ipcMain.handle('reports:getProfitLoss', (_event, startDate: string, endDate: string) => {
    const revenueStats = db.prepare(`
      SELECT 
        COALESCE(SUM(grand_total), 0) as revenue,
        COALESCE(SUM(amount_paid), 0) as paidSales,
        COALESCE(SUM(balance_due), 0) as creditSales
      FROM sales s
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) <= ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(startDate, endDate) as any;

    const returnStats = db.prepare(`
      SELECT
        COALESCE(SUM(refund_amount), 0) as refunds,
        COALESCE(SUM(CASE WHEN refund_method = 'CASH' THEN refund_amount ELSE 0 END), 0) as cashRefunds
      FROM returns r
      LEFT JOIN shifts sh ON sh.id = r.shift_id
      WHERE r.status = 'COMPLETED'
      AND COALESCE(sh.shift_date, substr(r.return_date, 1, 10)) >= ?
      AND COALESCE(sh.shift_date, substr(r.return_date, 1, 10)) <= ?
    `).get(startDate, endDate) as any;

    const cogsStats = db.prepare(`
      SELECT COALESCE(SUM(si.quantity * si.cost_price), 0) as cogs
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) <= ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(startDate, endDate) as any;

    const expenseStats = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as expenses 
      FROM expenses 
      WHERE substr(expense_date, 1, 10) >= ? AND substr(expense_date, 1, 10) <= ?
    `).get(startDate, endDate) as any;

    const paymentsStats = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as paymentsCollected
      FROM payments
      WHERE substr(payment_date, 1, 10) >= ? AND substr(payment_date, 1, 10) <= ?
    `).get(startDate, endDate) as any;
    const tenderStats = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN sp.method = 'CASH' THEN sp.amount ELSE 0 END), 0) as cashSales,
        COALESCE(SUM(CASE WHEN sp.method = 'ONLINE' THEN sp.amount ELSE 0 END), 0) as onlineSales
      FROM split_payments sp
      JOIN sales s ON s.id = sp.sale_id
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) <= ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(startDate, endDate) as any;

    const refunds = returnStats.refunds;
    const revenue = revenueStats.revenue - refunds;
    const cogs = cogsStats.cogs;
    const grossProfit = revenue - cogs;
    const expenses = expenseStats.expenses;
    const netProfit = grossProfit - expenses;

    return {
      revenue,
      grossRevenue: revenueStats.revenue,
      refunds,
      cogs,
      grossProfit,
      expenses,
      netProfit,
      cashSales: tenderStats.cashSales - returnStats.cashRefunds,
      onlineSales: tenderStats.onlineSales,
      creditSales: revenueStats.creditSales,
      paymentsCollected: paymentsStats.paymentsCollected
    };
  });

  ipcMain.handle('reports:getMonthlySummary', (_event, year: string) => {
    // year format 'YYYY'
    return db.prepare(`
      SELECT 
        substr(COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)), 1, 7) as month,
        COUNT(s.id) as bills,
        COALESCE(SUM(s.grand_total), 0) as revenue
      FROM sales s
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE substr(COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)), 1, 4) = ? AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      GROUP BY substr(COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)), 1, 7)
      ORDER BY month ASC
    `).all(year);
  });

  ipcMain.handle('reports:getDashboardStats', () => {
    const today = getActiveBusinessDate();
    const scope = getShiftScope(today);
    const saleWhere = saleScope('s', scope);
    const saleParams = scopeParams(scope);
    
    const todaySales = db.prepare(`
      SELECT 
        COUNT(*) as bills, 
        COALESCE(SUM(grand_total), 0) as revenue,
        COALESCE(SUM(amount_paid), 0) as paidCollected
      FROM sales s WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(...saleParams) as any;
    const todayTenders = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN sp.method = 'CASH' THEN sp.amount ELSE 0 END), 0) as cashCollected,
        COALESCE(SUM(CASE WHEN sp.method = 'ONLINE' THEN sp.amount ELSE 0 END), 0) as onlineCollected
      FROM split_payments sp
      JOIN sales s ON s.id = sp.sale_id
      WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(...saleParams) as any;

    const todayReturns = db.prepare(`
      SELECT
        COALESCE(SUM(refund_amount), 0) as total,
        COALESCE(SUM(CASE WHEN refund_method = 'CASH' THEN refund_amount ELSE 0 END), 0) as cashRefunds
      FROM returns r
      WHERE ${shiftTableScope('r', 'return_date', scope)} AND r.status = 'COMPLETED'
    `).get(...scopeParams(scope)) as any;

    const todayExpenses = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM expenses e WHERE ${shiftTableScope('e', 'expense_date', scope)}
    `).get(...scopeParams(scope)) as any;

    const outstandingDues = db.prepare(`
      SELECT COALESCE(SUM(current_balance), 0) as total, COUNT(*) as count 
      FROM customers WHERE current_balance > 0
    `).get() as any;

    const recentSales = db.prepare(`
      SELECT 
        id, 
        strftime('%H:%M', sale_date) as time, 
        payment_type as type, 
        grand_total as amount,
        COALESCE((SELECT name FROM customers WHERE id = sales.customer_id), 'Walk-in') as customer
      FROM sales 
      WHERE ${saleScope('sales', scope)} AND status IN (${ACCOUNTING_SALE_STATUSES})
      ORDER BY sale_date DESC 
      LIMIT 10
    `).all(...saleParams);

    const topProducts = db.prepare(`
      SELECT 
        si.product_name as name, 
        SUM(si.quantity) as qty, 
        SUM(si.line_total) as rev,
        p.emoji
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON s.id = si.sale_id
      WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      GROUP BY si.product_id 
      ORDER BY rev DESC 
      LIMIT 5
    `).all(...saleParams);

    const lowStock = db.prepare(`
      SELECT name, emoji, stock, low_stock_threshold 
      FROM products 
      WHERE stock <= low_stock_threshold AND is_active = 1
    `).all();

    const drawer = getCashRegisterExpected(today, scope.shiftId);
    const refunds = Number(todayReturns.total || 0);
    const cashRefunds = Number(todayReturns.cashRefunds || 0);
    const grossSales = Number(todaySales.revenue || 0);
    const netSales = grossSales - refunds;

    return {
      kpis: {
        grossSales,
        refunds,
        netSales,
        revenue: netSales,
        bills: todaySales.bills,
        cashOnHand: drawer.expectedCash,
        expectedCash: drawer.expectedCash,
        cashCollected: todayTenders.cashCollected - cashRefunds,
        onlineCollected: todayTenders.onlineCollected,
        dues: outstandingDues.total,
        dueCount: outstandingDues.count
      },
      recentSales,
      topProducts,
      stockAlerts: lowStock
    };
  });
}
