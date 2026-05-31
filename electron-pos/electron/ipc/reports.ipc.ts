import { ipcMain } from 'electron';
import db from '../database/db';
import { createOutboxEntry } from '../sync/outboxHelper';
import { getCashRegisterExpected } from '../database/cashRegister';
import { getActiveBusinessDate, getBusinessDate, formatLocalDate } from '../database/businessDay';

const ACCOUNTING_SALE_STATUSES = "'COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'";
const REAL_REFUND_WHERE = "r.status = 'COMPLETED' AND r.correction_type = 'REFUND'";

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

function businessDayScope(alias: string, shiftAlias: string, dateColumn: string) {
  return `COALESCE(${shiftAlias}.shift_date, substr(${alias}.${dateColumn}, 1, 10)) = ?`;
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
      WHERE ${shiftTableScope('r', 'return_date', scope)} AND ${REAL_REFUND_WHERE}
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

    // The owner uses returns to undo wrongly-printed receipts (they reverse
    // both the receipt and the inventory). So returns must NEVER appear in
    // gross sales — they're not real customer revenue, they're corrections.
    // Subtract refund total from raw sales to get the true gross.
    const rawSales = Number(saleStats?.grossSales || 0);
    const totalRefundsAmt = Number(refundStats?.totalRefunds || 0);
    const grossSalesAfterRefunds = Number((rawSales - totalRefundsAmt).toFixed(2));

    return {
      date: reportDate,
      openingCash,
      totalSalesCount: Number(saleStats?.salesCount || 0),
      grossSalesAmount: grossSalesAfterRefunds,
      totalDiscounts: Number((Number(saleStats?.orderDiscounts || 0) + Number(itemDiscountStats?.itemDiscounts || 0)).toFixed(2)),
      totalRefunds: totalRefundsAmt,
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
      WHERE ${shiftTableScope('r', 'return_date', scope)} AND ${REAL_REFUND_WHERE}
    `).get(...scopeParams(scope)) as any;
    const expenses = db.prepare(`SELECT SUM(amount) as total FROM expenses e WHERE ${shiftTableScope('e', 'expense_date', scope)}`).get(...scopeParams(scope)) as any;
    const refundTotal = returns?.total || 0;
    const cashRefunds = returns?.cashRefunds || 0;
    
    return {
      date: scope.date,
      totalSales: (sales?.total || 0) - refundTotal,
      // Gross now excludes refunds — owner uses returns to fix wrongly-printed
      // receipts, so they should not be counted as revenue.
      grossSales: (sales?.total || 0) - refundTotal,
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
      LEFT JOIN products p ON p.id = si.product_id
      WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
        AND (UPPER(COALESCE(p.code, '')) = 'MILK' OR LOWER(si.product_name) LIKE '%milk%')
    `).get(...saleParams) as any;

    const yogurtStats = db.prepare(`
      SELECT SUM(si.quantity) as qty
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
        AND (UPPER(COALESCE(p.code, '')) IN ('YOGT', 'YOGURT') OR LOWER(si.product_name) LIKE '%yog%')
    `).get(...saleParams) as any;

    const otherStats = db.prepare(`
      SELECT
        SUM(si.quantity) as qty,
        SUM(si.line_total) as sales,
        COUNT(*) as lines
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
        AND NOT (UPPER(COALESCE(p.code, '')) = 'MILK' OR LOWER(si.product_name) LIKE '%milk%')
        AND NOT (UPPER(COALESCE(p.code, '')) IN ('YOGT', 'YOGURT') OR LOWER(si.product_name) LIKE '%yog%')
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
      WHERE ${shiftTableScope('r', 'return_date', scope)} AND ${REAL_REFUND_WHERE}
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
      // Gross excludes refunds (returns are correction tools, not revenue).
      grossSales: (saleStats?.totalSales || 0) - (returnStats?.total || 0),
      refunds: returnStats?.total || 0,
      refundCount: returnStats?.count || 0,
      cashSales: (tenderStats?.cashSales || 0) - (returnStats?.cashRefunds || 0),
      onlineSales: tenderStats?.onlineSales || 0,
      creditSales: saleStats?.creditSales || 0,
      milkSold: milkStats?.qty || 0,
      yogurtSold: yogurtStats?.qty || 0,
      otherItemsSold: otherStats?.qty || 0,
      otherItemsSales: otherStats?.sales || 0,
      otherItemLines: otherStats?.lines || 0,
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
    const end = getActiveBusinessDate();
    const startDate = new Date(`${end}T00:00:00`);
    startDate.setDate(startDate.getDate() - (safeDays - 1));
    const start = formatLocalDate(startDate);
    const salesRows = db.prepare(`
      SELECT
        COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) as date,
        COUNT(*) as orders,
        COALESCE(SUM(s.grand_total), 0) as total
      FROM sales s
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) <= ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      GROUP BY COALESCE(sh.shift_date, substr(s.sale_date, 1, 10))
      ORDER BY date ASC
    `).all(start, end) as Array<{ date: string; orders: number; total: number }>;
    const returnRows = db.prepare(`
      SELECT
        COALESCE(sh.shift_date, substr(r.return_date, 1, 10)) as date,
        COALESCE(SUM(r.refund_amount), 0) as refunds
      FROM returns r
      LEFT JOIN shifts sh ON sh.id = r.shift_id
      WHERE COALESCE(sh.shift_date, substr(r.return_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(r.return_date, 1, 10)) <= ?
        AND ${REAL_REFUND_WHERE}
      GROUP BY COALESCE(sh.shift_date, substr(r.return_date, 1, 10))
    `).all(start, end) as Array<{ date: string; refunds: number }>;
    const refundsByDate = new Map(returnRows.map((row) => [row.date, Number(row.refunds || 0)]));
    return salesRows.map((row) => {
      const refunds = refundsByDate.get(row.date) || 0;
      const net = Number(row.total || 0) - refunds;
      return {
        ...row,
        // Both grossTotal and total exclude refunds — returns are corrections,
        // not revenue, so the chart should not show them as part of gross.
        grossTotal: net,
        refunds,
        total: net
      };
    });
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
      SELECT *
      FROM (
        SELECT
          c.id,
          c.name,
          c.phone,
          COALESCE((
            SELECT le.balance_after
            FROM ledger_entries le
            WHERE le.customer_id = c.id
            ORDER BY le.entry_date DESC, le.created_at DESC
            LIMIT 1
          ), c.current_balance, 0) as current_balance
        FROM customers c
        WHERE c.is_active = 1
      )
      WHERE current_balance > 0
      ORDER BY current_balance DESC
    `).all();
  });

  ipcMain.handle('reports:getProfitLoss', (_event, startDate: string, endDate: string) => {
    // Guard: at 2K walk-ins/day = 730K sales/year, scanning multiple years
    // in JS would freeze the UI. Cap the window to 1 year max. Owner can
    // still ask for any 12-month slice; just not "all time" by accident.
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (start && end && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
      const oneYearMs = 366 * 24 * 60 * 60 * 1000;
      if (end.getTime() - start.getTime() > oneYearMs) {
        const cappedStart = new Date(end.getTime() - oneYearMs);
        startDate = cappedStart.toISOString().slice(0, 10);
      }
    }

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
      WHERE ${REAL_REFUND_WHERE}
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

    const returnedCogsStats = db.prepare(`
      SELECT COALESCE(SUM(
        CASE WHEN r.restock_items = 1 THEN ri.quantity * si.cost_price ELSE 0 END
      ), 0) as returnedCogs
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      JOIN sale_items si ON si.id = ri.sale_item_id
      LEFT JOIN shifts sh ON sh.id = r.shift_id
      WHERE ${REAL_REFUND_WHERE}
        AND COALESCE(sh.shift_date, substr(r.return_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(r.return_date, 1, 10)) <= ?
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
    const cogs = Number(cogsStats.cogs || 0) - Number(returnedCogsStats.returnedCogs || 0);
    const grossProfit = revenue - cogs;
    const expenses = expenseStats.expenses;
    const netProfit = grossProfit - expenses;

    return {
      revenue,
      // Wrong-entry corrections are excluded by sale status. Real refunds
      // reduce revenue; restocked items also reverse their COGS.
      grossRevenue: revenue,
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
    const sales = db.prepare(`
      SELECT
        substr(COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)), 1, 7) as month,
        COUNT(s.id) as bills,
        COALESCE(SUM(s.grand_total), 0) as revenue
      FROM sales s
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE substr(COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)), 1, 4) = ? AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      GROUP BY substr(COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)), 1, 7)
      ORDER BY month ASC
    `).all(year) as Array<{ month: string; bills: number; revenue: number }>;

    // Subtract refunds per-month so monthly revenue matches the dashboard
    // (returns = wrongly-printed receipts being corrected, not revenue).
    const refunds = db.prepare(`
      SELECT
        substr(COALESCE(sh.shift_date, substr(r.return_date, 1, 10)), 1, 7) as month,
        COALESCE(SUM(r.refund_amount), 0) as refunded
      FROM returns r
      LEFT JOIN shifts sh ON sh.id = r.shift_id
      WHERE substr(COALESCE(sh.shift_date, substr(r.return_date, 1, 10)), 1, 4) = ?
        AND ${REAL_REFUND_WHERE}
      GROUP BY substr(COALESCE(sh.shift_date, substr(r.return_date, 1, 10)), 1, 7)
    `).all(year) as Array<{ month: string; refunded: number }>;
    const refundByMonth = new Map(refunds.map((r) => [r.month, Number(r.refunded || 0)]));

    return sales.map((row) => ({
      ...row,
      revenue: Number(row.revenue || 0) - (refundByMonth.get(row.month) || 0)
    }));
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
      WHERE ${shiftTableScope('r', 'return_date', scope)} AND ${REAL_REFUND_WHERE}
    `).get(...scopeParams(scope)) as any;

    const todayExpenses = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM expenses e WHERE ${shiftTableScope('e', 'expense_date', scope)}
    `).get(...scopeParams(scope)) as any;

    const outstandingDues = db.prepare(`
      SELECT COALESCE(SUM(current_balance), 0) as total, COUNT(*) as count
      FROM (
        SELECT
          c.id,
          COALESCE((
            SELECT le.balance_after
            FROM ledger_entries le
            WHERE le.customer_id = c.id
            ORDER BY le.entry_date DESC, le.created_at DESC
            LIMIT 1
          ), c.current_balance, 0) as current_balance
        FROM customers c
        WHERE c.is_active = 1
      )
      WHERE current_balance > 0
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
    const rawSales = Number(todaySales.revenue || 0);
    // Owner uses returns to fix wrongly-printed receipts. They reverse the
    // sale AND the stock — so they're corrections, not revenue. Gross sales
    // shown on the dashboard must already have refunds subtracted.
    const grossSales = Number(rawSales.toFixed(2));
    const netSales = Number((rawSales - refunds).toFixed(2));

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

  // -------------------------------------------------------------------------
  // ANALYTICS — owner-focused trend dashboard.
  //
  // Returns ONLY aggregated numbers (no row lists), so it scales to millions
  // of sales without lag. Three sections:
  //   1. Today's KPIs:       bills served, total sold, avg per-bill,
  //                          avg milk per bill (kg), avg yogurt per bill (kg)
  //   2. Hourly breakdown:   24-row array of bills + revenue per hour today
  //   3. 30-day trend:       daily milk kg, yogurt kg, combined kg, revenue
  //   4. Comparison:         this week vs last week, this month vs last month
  //
  // Walk-in receipts only — khata customer detail is not needed here, the
  // owner just wants "is the average basket increasing or decreasing?"
  // -------------------------------------------------------------------------
  ipcMain.handle('reports:getAnalytics', (_event, filters?: { date?: string; daysBack?: number }) => {
    // Owner asked for a date picker so they can review past days. If a date
    // is supplied we anchor *all* sections of the report to it (today's KPIs,
    // hourly chart, period comparisons). The 30-day trend window also rolls
    // back so it ends on the picked date.
    const today = (filters?.date && /^\d{4}-\d{2}-\d{2}$/.test(filters.date))
      ? filters.date
      : getActiveBusinessDate();
    const daysBack = Math.max(7, Math.min(180, Number(filters?.daysBack) || 30));
    // Analytics is a full business-date view, not a single-register view.
    // If the register is closed early and a same-date shift/register is later
    // opened, using only the latest shift makes today's cards look empty while
    // Sales History still shows the date's receipts. Scope by shift_date so all
    // shifts for the picked business date are included.
    const saleWhere = businessDayScope('s', 'sh', 'sale_date');
    const saleParams = [today];
    const returnWhere = businessDayScope('r', 'sh', 'return_date');
    const expenseWhere = businessDayScope('e', 'sh', 'expense_date');

    // ---- Today's KPIs ----
    const todayKpis = db.prepare(`
      SELECT
        COUNT(*) AS bills,
        COALESCE(SUM(s.grand_total), 0) AS revenue
      FROM sales s
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(...saleParams) as any;

    // Per-product quantity sold today. We pattern-match on product name
    // because the shop only has 2 system products (MILK, YOGT) — but they
    // may also sell variations like 'Fresh Milk', 'Lassi (yogurt-based)',
    // etc. Pattern match is forgiving and zero-config.
    const todayMilkQty = db.prepare(`
      SELECT COALESCE(SUM(si.quantity), 0) AS qty
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
        AND (UPPER(COALESCE(p.code, '')) = 'MILK' OR LOWER(si.product_name) LIKE '%milk%')
    `).get(...saleParams) as any;
    const todayYogurtQty = db.prepare(`
      SELECT COALESCE(SUM(si.quantity), 0) AS qty
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
        AND (UPPER(COALESCE(p.code, '')) IN ('YOGT', 'YOGURT') OR LOWER(si.product_name) LIKE '%yog%')
    `).get(...saleParams) as any;

    const bills = Number(todayKpis?.bills || 0);
    const revenue = Number(todayKpis?.revenue || 0);
    const milkKg = Number(todayMilkQty?.qty || 0);
    const yogurtKg = Number(todayYogurtQty?.qty || 0);
    const todayRefunds = db.prepare(`
      SELECT COALESCE(SUM(refund_amount), 0) AS refunds, COUNT(*) AS refundCount
      FROM returns r
      LEFT JOIN shifts sh ON sh.id = r.shift_id
      WHERE ${returnWhere} AND ${REAL_REFUND_WHERE}
    `).get(today) as any;
    const todayExpenses = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS expenses
      FROM expenses e
      LEFT JOIN shifts sh ON sh.id = e.shift_id
      WHERE ${expenseWhere}
    `).get(today) as any;
    const todayProfit = db.prepare(`
      SELECT
        COALESCE(SUM(si.line_total), 0) AS itemRevenue,
        COALESCE(SUM(si.quantity * si.cost_price), 0) AS itemCost,
        COALESCE(SUM(si.line_total - (si.quantity * si.cost_price)), 0) AS grossProfit
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(...saleParams) as any;
    const todayRefundProfitImpact = db.prepare(`
      SELECT COALESCE(SUM(
        ri.line_total - CASE WHEN r.restock_items = 1 THEN ri.quantity * si.cost_price ELSE 0 END
      ), 0) AS profitImpact
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      JOIN sale_items si ON si.id = ri.sale_item_id
      LEFT JOIN shifts sh ON sh.id = r.shift_id
      WHERE ${returnWhere} AND ${REAL_REFUND_WHERE}
    `).get(today) as any;
    const tenderRows = db.prepare(`
      SELECT sp.method, COALESCE(SUM(sp.amount), 0) AS amount, COUNT(DISTINCT sp.sale_id) AS bills
      FROM split_payments sp
      JOIN sales s ON s.id = sp.sale_id
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      GROUP BY sp.method
      ORDER BY amount DESC
    `).all(...saleParams) as any[];

    // Avoid division-by-zero on a fresh shift (no sales yet).
    const safeBills = bills > 0 ? bills : 1;
    const refunds = Number(todayRefunds?.refunds || 0);
    const expensesToday = Number(todayExpenses?.expenses || 0);
    const grossProfit = Number(todayProfit?.grossProfit || 0) - Number(todayRefundProfitImpact?.profitImpact || 0);
    const netSales = Number((revenue - refunds).toFixed(2));
    const today_kpis = {
      bills,
      revenue,
      refunds,
      refundCount: Number(todayRefunds?.refundCount || 0),
      netSales,
      expenses: expensesToday,
      estimatedGrossProfit: Number(grossProfit.toFixed(2)),
      estimatedNetProfit: Number((grossProfit - expensesToday).toFixed(2)),
      marginPct: netSales > 0 ? Number(((grossProfit / netSales) * 100).toFixed(1)) : 0,
      avgBill: Number((revenue / safeBills).toFixed(2)),
      avgMilkKgPerBill: Number((milkKg / safeBills).toFixed(3)),
      avgYogurtKgPerBill: Number((yogurtKg / safeBills).toFixed(3)),
      milkKg: Number(milkKg.toFixed(3)),
      yogurtKg: Number(yogurtKg.toFixed(3)),
      combinedKg: Number((milkKg + yogurtKg).toFixed(3))
    };
    const tenderTotal = tenderRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const tenderMix = tenderRows.map((row) => ({
      method: row.method,
      amount: Number(row.amount || 0),
      bills: Number(row.bills || 0),
      pct: tenderTotal > 0 ? Number(((Number(row.amount || 0) / tenderTotal) * 100).toFixed(1)) : 0
    }));

    // ---- Hourly breakdown (today) ----
    // sale_date is stored as UTC ISO (`new Date().toISOString()`), so without
    // the 'localtime' modifier strftime returns UTC hours — at UTC+5 in
    // Pakistan, a 6 PM sale would show up at 1 PM on the chart. Owner reported
    // hours not lining up with when they actually serve customers; this fix
    // converts to the machine's local timezone before bucketing.
    const hourlyRows = db.prepare(`
      SELECT
        CAST(strftime('%H', s.sale_date, 'localtime') AS INTEGER) AS hour,
        COUNT(*) AS bills,
        COALESCE(SUM(s.grand_total), 0) AS revenue
      FROM sales s
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE ${saleWhere} AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      GROUP BY hour
      ORDER BY hour ASC
    `).all(...saleParams) as Array<{ hour: number; bills: number; revenue: number }>;
    const hourlyMap = new Map(hourlyRows.map((r) => [r.hour, r]));
    const hourly = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      bills: Number(hourlyMap.get(h)?.bills || 0),
      revenue: Number(hourlyMap.get(h)?.revenue || 0)
    }));
    const activeHours = hourly.filter((row) => row.bills > 0);
    const busiestHour = activeHours.reduce((best, row) => !best || row.bills > best.bills ? row : best, null as any);
    const quietestHour = activeHours.reduce((best, row) => !best || row.bills < best.bills ? row : best, null as any);

    // ---- 30-day trend (window ends on the picked `today`) ----
    // Two changes vs the old query:
    //   1. The window is anchored on the picked date — picking 2026-04-15
    //      shows the 30 days ending that day, not the literal last 30.
    //   2. We hydrate every date in the window even when there were no sales
    //      that day. Without this, gap-days were dropped and the chart bars
    //      bunched together instead of showing a real "this Tuesday was slow"
    //      trough — owner said "daily volume chart not shown properly".
    const trendStart = new Date(`${today}T00:00:00`);
    trendStart.setDate(trendStart.getDate() - (daysBack - 1));
    const trendEnd = new Date(`${today}T00:00:00`);
    trendEnd.setDate(trendEnd.getDate() + 1); // exclusive upper bound
    const trendStartIso = formatLocalDate(trendStart);
    const trendEndIso = formatLocalDate(trendEnd);

    const dailyTrendRows = db.prepare(`
      SELECT
        COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) AS date,
        COUNT(DISTINCT s.id) AS bills,
        COALESCE(SUM(DISTINCT s.grand_total), 0) AS revenue,
        COALESCE(SUM(CASE WHEN UPPER(COALESCE(p.code, '')) = 'MILK' OR LOWER(si.product_name) LIKE '%milk%' THEN si.quantity ELSE 0 END), 0) AS milkKg,
        COALESCE(SUM(CASE WHEN UPPER(COALESCE(p.code, '')) IN ('YOGT', 'YOGURT') OR LOWER(si.product_name) LIKE '%yog%' THEN si.quantity ELSE 0 END), 0) AS yogurtKg
      FROM sales s
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      LEFT JOIN sale_items si ON si.sale_id = s.id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) < ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      GROUP BY COALESCE(sh.shift_date, substr(s.sale_date, 1, 10))
      ORDER BY date ASC
    `).all(trendStartIso, trendEndIso) as Array<{ date: string; bills: number; revenue: number; milkKg: number; yogurtKg: number }>;

    // SUM(DISTINCT s.grand_total) above prevents the LEFT JOIN against
    // sale_items from inflating revenue. But DISTINCT only dedupes by VALUE,
    // not by sale id, so re-run a clean revenue/bill aggregate without the
    // sale_items join to get accurate per-day totals.
    const dailyTotalsRows = db.prepare(`
      SELECT
        COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) AS date,
        COUNT(s.id) AS bills,
        COALESCE(SUM(s.grand_total), 0) AS revenue
      FROM sales s
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) < ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      GROUP BY COALESCE(sh.shift_date, substr(s.sale_date, 1, 10))
    `).all(trendStartIso, trendEndIso) as Array<{ date: string; bills: number; revenue: number }>;

    const trendByDate = new Map(dailyTrendRows.map((r) => [r.date, r]));
    const totalsByDate = new Map(dailyTotalsRows.map((r) => [r.date, r]));
    // Build the full 30-day series in JS so missing days render as zero bars.
    const dailyTrend: Array<{ date: string; bills: number; revenue: number; milkKg: number; yogurtKg: number }> = [];
    for (let i = 0; i < daysBack; i++) {
      const d = new Date(`${today}T00:00:00`);
      d.setDate(d.getDate() - (daysBack - 1 - i));
      const iso = formatLocalDate(d);
      const row = trendByDate.get(iso);
      const totals = totalsByDate.get(iso);
      dailyTrend.push({
        date: iso,
        bills: Number(totals?.bills || 0),
        revenue: Number(totals?.revenue || 0),
        milkKg: Number(row?.milkKg || 0),
        yogurtKg: Number(row?.yogurtKg || 0)
      });
    }
    const bestDay = dailyTrend.reduce((best, row) => !best || row.revenue > best.revenue ? row : best, null as any);

    // ---- Yogurt production plan (multi-factor) ----
    //
    // Yogurt takes ~24h to set. Owner wants the prediction at *this morning*
    // so the staff knows how many kg of milk to set aside today to sell as
    // yogurt tomorrow. The model blends four signals:
    //
    //   1. Same-weekday median (last 8 weeks)  → robust seasonal baseline.
    //   2. EWMA of last 14 active days          → captures very recent shift.
    //   3. Today-so-far                         → real-time pulse.
    //   4. Customer-mix factor                  → sticky khata demand bumps.
    //
    // Adjusted by a trend factor (recent 7 vs prior 7) and a *dynamic* safety
    // buffer scaled by historical volatility (coefficient of variation), so a
    // steady shop gets a tight prediction and a noisy one gets more buffer.
    const mean = (numbers: number[]) => numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : 0;
    const median = (numbers: number[]) => {
      if (!numbers.length) return 0;
      const sorted = [...numbers].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    const stddev = (numbers: number[]) => {
      if (numbers.length < 2) return 0;
      const m = mean(numbers);
      return Math.sqrt(mean(numbers.map((n) => (n - m) ** 2)));
    };

    const tomorrowForPlan = new Date(`${today}T00:00:00`);
    tomorrowForPlan.setDate(tomorrowForPlan.getDate() + 1);
    const tomorrowIso = formatLocalDate(tomorrowForPlan);
    const tomorrowDow = tomorrowForPlan.getDay();
    const historyForPlan = dailyTrend.filter((row) => row.date <= today);
    const recent7 = historyForPlan.slice(-7);
    const prior7 = historyForPlan.slice(-14, -7);
    const recent14Active = historyForPlan.slice(-14).filter((row) => Number(row.yogurtKg || 0) > 0);
    const sameWeekday = historyForPlan
      .filter((row) => new Date(`${row.date}T00:00:00`).getDay() === tomorrowDow)
      .slice(-8);
    const sameWeekdayKgs = sameWeekday.map((row) => Number(row.yogurtKg || 0)).filter((value) => value > 0);

    // Use median when we have enough same-weekday data (>= 3) — robust to
    // outlier days (e.g. Eid bump that won't repeat). Fall back to mean.
    const sameWeekdayMedian = median(sameWeekdayKgs);
    const sameWeekdayMean = mean(sameWeekdayKgs);
    const sameWeekdayBaseline = sameWeekdayKgs.length >= 3 ? sameWeekdayMedian : sameWeekdayMean;

    // EWMA over recent active days — alpha 0.35 puts ~64% of weight on the
    // last 5 days, so a sudden demand shift gets reflected within a week.
    const ewmaAlpha = 0.35;
    let ewma = recent14Active.length ? Number(recent14Active[0].yogurtKg || 0) : 0;
    for (let i = 1; i < recent14Active.length; i++) {
      ewma = ewmaAlpha * Number(recent14Active[i].yogurtKg || 0) + (1 - ewmaAlpha) * ewma;
    }
    const recent7Avg = mean(recent7.map((row) => Number(row.yogurtKg || 0)));
    const prior7Avg = mean(prior7.map((row) => Number(row.yogurtKg || 0)));
    const recentActiveAvg = mean(recent14Active.map((row) => Number(row.yogurtKg || 0)));
    const todayYogurtForPlan = Number(historyForPlan[historyForPlan.length - 1]?.yogurtKg || 0);

    // Week-over-week trend factor, clamped so a single freak day can't double
    // the order. >1 = demand rising, <1 = falling.
    let trendFactor = 1;
    if (prior7Avg > 0 && recent7Avg > 0) {
      trendFactor = Math.max(0.85, Math.min(1.20, recent7Avg / prior7Avg));
    }
    const weekTrendPct = (trendFactor - 1) * 100;
    const weekTrend: 'rising' | 'falling' | 'steady' =
      weekTrendPct > 3 ? 'rising' : weekTrendPct < -3 ? 'falling' : 'steady';

    // Customer-mix factor — known/khata customers buy on routine, so a high
    // known-share means demand is sticky and we can lean slightly higher
    // without overproducing. Computed inline against the trend window.
    const planMixRow = db.prepare(`
      SELECT
        COUNT(s.id) as totalBills,
        COALESCE(SUM(CASE WHEN s.customer_id IS NOT NULL THEN 1 ELSE 0 END), 0) as knownBills
      FROM sales s
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) < ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(trendStartIso, trendEndIso) as { totalBills: number; knownBills: number } | undefined;
    const knownShare = planMixRow && Number(planMixRow.totalBills) > 0
      ? Number(planMixRow.knownBills) / Number(planMixRow.totalBills)
      : 0;
    const mixFactor = knownShare >= 0.35 ? 1.03 : knownShare >= 0.20 ? 1.015 : 1.00;

    // Blend the three baseline signals. Weight the seasonal (same-weekday)
    // signal highest when we have enough samples; otherwise lean on EWMA.
    const haveStrongSeasonal = sameWeekdayKgs.length >= 4;
    const wSeasonal = haveStrongSeasonal ? 0.50 : 0.30;
    const wEwma = haveStrongSeasonal ? 0.30 : 0.50;
    const wToday = 0.20;
    const seasonalSignal = sameWeekdayBaseline || ewma || recent7Avg;
    const ewmaSignal = ewma || recentActiveAvg || recent7Avg;
    const blended = (seasonalSignal * wSeasonal) + (ewmaSignal * wEwma) + (todayYogurtForPlan * wToday);
    const adjusted = blended * trendFactor * mixFactor;

    // Dynamic safety buffer: more volatility → bigger buffer.
    // CV = stddev / mean; ranges roughly 0 (steady) to 0.6+ (chaotic).
    const cv = sameWeekdayMean > 0 ? stddev(sameWeekdayKgs) / sameWeekdayMean : 0;
    const safetyBufferPct = Math.max(8, Math.min(22, Math.round(8 + cv * 25)));
    const recommendedRaw = adjusted * (1 + safetyBufferPct / 100);
    const recommendedYogurtKg = Number((Math.ceil(Math.max(0, recommendedRaw) * 2) / 2).toFixed(1));

    // Expected range — ±1 stddev around the adjusted (pre-buffer) estimate.
    const rangeSpread = sameWeekdayKgs.length >= 2 ? stddev(sameWeekdayKgs) : adjusted * 0.15;
    const expectedRangeKg = {
      low: Number(Math.max(0, adjusted - rangeSpread).toFixed(1)),
      high: Number((adjusted + rangeSpread).toFixed(1))
    };

    const volatilityPct = Number((cv * 100).toFixed(1));
    const confidence: 'HIGH' | 'MEDIUM' | 'LOW' =
      sameWeekdayKgs.length >= 4 && historyForPlan.length >= 14 && cv < 0.30
        ? 'HIGH'
        : historyForPlan.length >= 10
          ? 'MEDIUM'
          : 'LOW';

    const yogurtPlan = {
      targetDate: tomorrowIso,
      recommendedKg: recommendedYogurtKg,
      confidence,
      recent7AvgKg: Number(recent7Avg.toFixed(2)),
      recentActiveAvgKg: Number(recentActiveAvg.toFixed(2)),
      sameWeekdayAvgKg: Number(sameWeekdayMean.toFixed(2)),
      sameWeekdayMedianKg: Number(sameWeekdayMedian.toFixed(2)),
      ewmaKg: Number(ewma.toFixed(2)),
      todayYogurtKg: Number(todayYogurtForPlan.toFixed(2)),
      safetyBufferPct,
      basisDays: historyForPlan.length,
      sameWeekdaySamples: sameWeekdayKgs.length,
      weekTrend,
      weekTrendPct: Number(weekTrendPct.toFixed(1)),
      volatilityPct,
      knownSharePct: Number((knownShare * 100).toFixed(1)),
      expectedRangeKg,
      // Series for the same-weekday sparkline in the UI.
      sameWeekdayHistory: sameWeekday.map((row) => ({
        date: row.date,
        yogurtKg: Number(Number(row.yogurtKg || 0).toFixed(2))
      })),
      factors: {
        seasonalKg: Number(seasonalSignal.toFixed(2)),
        ewmaKg: Number(ewmaSignal.toFixed(2)),
        todayKg: Number(todayYogurtForPlan.toFixed(2)),
        trendFactor: Number(trendFactor.toFixed(3)),
        mixFactor: Number(mixFactor.toFixed(3))
      }
    };

    const customerBehaviorRow = db.prepare(`
      SELECT
        COUNT(s.id) as totalBills,
        COALESCE(SUM(CASE WHEN s.customer_id IS NULL THEN 1 ELSE 0 END), 0) as walkInBills,
        COALESCE(SUM(CASE WHEN s.customer_id IS NOT NULL THEN 1 ELSE 0 END), 0) as knownBills,
        COUNT(DISTINCT s.customer_id) as knownCustomers,
        COALESCE(SUM(CASE WHEN s.customer_id IS NULL THEN s.grand_total ELSE 0 END), 0) as walkInRevenue,
        COALESCE(SUM(CASE WHEN s.customer_id IS NOT NULL THEN s.grand_total ELSE 0 END), 0) as knownRevenue
      FROM sales s
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) < ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(trendStartIso, trendEndIso) as any;

    const repeatCustomers = db.prepare(`
      SELECT
        c.id, c.name, c.phone,
        COUNT(s.id) as visits,
        COALESCE(SUM(s.grand_total), 0) as revenue,
        MAX(COALESCE(sh.shift_date, substr(s.sale_date, 1, 10))) as lastVisit
      FROM sales s
      JOIN customers c ON c.id = s.customer_id
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) < ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      GROUP BY c.id, c.name, c.phone
      HAVING COUNT(s.id) >= 2
      ORDER BY visits DESC, revenue DESC
      LIMIT 6
    `).all(trendStartIso, trendEndIso) as any[];

    const topProducts = db.prepare(`
      SELECT
        si.product_id as productId,
        si.product_name as productName,
        si.unit,
        COALESCE(p.category, 'OTHER') as category,
        COALESCE(SUM(si.quantity), 0) as quantity,
        COALESCE(SUM(si.line_total), 0) as revenue,
        COALESCE(SUM(si.quantity * si.cost_price), 0) as cost,
        COALESCE(SUM(si.line_total - (si.quantity * si.cost_price)), 0) as grossProfit,
        COUNT(DISTINCT s.id) as bills
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) < ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      GROUP BY si.product_id, si.product_name, si.unit, p.category
      ORDER BY revenue DESC
      LIMIT 10
    `).all(trendStartIso, trendEndIso) as any[];

    const categoryMix = db.prepare(`
      SELECT
        COALESCE(p.category, 'OTHER') as category,
        COALESCE(SUM(si.line_total), 0) as revenue,
        COALESCE(SUM(si.quantity), 0) as quantity,
        COUNT(DISTINCT s.id) as bills
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) < ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      GROUP BY COALESCE(p.category, 'OTHER')
      ORDER BY revenue DESC
    `).all(trendStartIso, trendEndIso) as any[];

    const expenseBreakdown = db.prepare(`
      SELECT category, COALESCE(SUM(amount), 0) as amount, COUNT(*) as count
      FROM expenses
      WHERE substr(expense_date, 1, 10) >= ? AND substr(expense_date, 1, 10) < ?
      GROUP BY category
      ORDER BY amount DESC
      LIMIT 8
    `).all(trendStartIso, trendEndIso) as any[];

    const customerRiskRow = db.prepare(`
      SELECT
        COUNT(*) as customersWithDues,
        COALESCE(SUM(current_balance), 0) as totalDues,
        COALESCE(SUM(CASE WHEN credit_limit > 0 AND current_balance > credit_limit THEN 1 ELSE 0 END), 0) as overLimitCount
      FROM customers
      WHERE is_active = 1 AND current_balance > 0
    `).get() as any;
    const topDues = db.prepare(`
      SELECT id, code, name, phone, credit_limit, current_balance
      FROM customers
      WHERE is_active = 1 AND current_balance > 0
      ORDER BY current_balance DESC
      LIMIT 8
    `).all() as any[];

    const stockRisk = db.prepare(`
      SELECT id, code, name, unit, stock, low_stock_threshold, selling_price, cost_price
      FROM products
      WHERE is_active = 1 AND stock <= low_stock_threshold
      ORDER BY (stock - low_stock_threshold) ASC, name ASC
      LIMIT 8
    `).all() as any[];

    // ---- This week vs last week, this month vs last month ----
    const periodSummary = (since: string, until: string) => {
      const totals = db.prepare(`
        SELECT
          COUNT(s.id) AS bills,
          COALESCE(SUM(s.grand_total), 0) AS revenue
        FROM sales s
        LEFT JOIN shifts sh ON sh.id = s.shift_id
        WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
          AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) < ?
          AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      `).get(since, until) as any;
      const row = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN UPPER(COALESCE(p.code, '')) = 'MILK' OR LOWER(si.product_name) LIKE '%milk%' THEN si.quantity ELSE 0 END), 0) AS milkKg,
          COALESCE(SUM(CASE WHEN UPPER(COALESCE(p.code, '')) IN ('YOGT', 'YOGURT') OR LOWER(si.product_name) LIKE '%yog%' THEN si.quantity ELSE 0 END), 0) AS yogurtKg
        FROM sales s
        LEFT JOIN sale_items si ON si.sale_id = s.id
        LEFT JOIN products p ON p.id = si.product_id
        LEFT JOIN shifts sh ON sh.id = s.shift_id
        WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
          AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) < ?
          AND s.status IN (${ACCOUNTING_SALE_STATUSES})
      `).get(since, until) as any;
      const b = Number(totals?.bills || 0);
      const safeB = b > 0 ? b : 1;
      const totalRevenue = Number(totals?.revenue || 0);
      return {
        bills: b,
        revenue: totalRevenue,
        milkKg: Number(row?.milkKg || 0),
        yogurtKg: Number(row?.yogurtKg || 0),
        avgBill: Number((totalRevenue / safeB).toFixed(2)),
        avgMilkKgPerBill: Number(((row?.milkKg || 0) / safeB).toFixed(3)),
        avgYogurtKgPerBill: Number(((row?.yogurtKg || 0) / safeB).toFixed(3))
      };
    };

    // Anchor period windows on the picked date (parsed as local midnight,
    // never UTC, so a date string like "2026-04-15" doesn't drift across the
    // day boundary at UTC+5).
    const ymd = formatLocalDate;
    const now = new Date(`${today}T00:00:00`);
    const startOfThisWeek = new Date(now); startOfThisWeek.setDate(now.getDate() - 6);
    const startOfLastWeek = new Date(now); startOfLastWeek.setDate(now.getDate() - 13);
    const endOfLastWeek   = new Date(now); endOfLastWeek.setDate(now.getDate() - 6);

    const startOfThisMonth = new Date(now); startOfThisMonth.setDate(now.getDate() - 29);
    const startOfLastMonth = new Date(now); startOfLastMonth.setDate(now.getDate() - 59);
    const endOfLastMonth   = new Date(now); endOfLastMonth.setDate(now.getDate() - 29);

    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);

    const compare = {
      thisWeek:  periodSummary(ymd(startOfThisWeek),  ymd(tomorrow)),
      lastWeek:  periodSummary(ymd(startOfLastWeek),  ymd(endOfLastWeek)),
      thisMonth: periodSummary(ymd(startOfThisMonth), ymd(tomorrow)),
      lastMonth: periodSummary(ymd(startOfLastMonth), ymd(endOfLastMonth))
    };
    // ---- Most common buy size (modal quantity) ----
    // Owner wants to know "what kg do people most often buy?" — answers the
    // basic question: should we keep loose 1kg measures ready, or 0.5kg.
    // We round to 2 decimals so 0.999kg and 1.001kg collapse into a "1.00"
    // bucket, then take the top 6 by bill count.
    const buyPatternRows = db.prepare(`
      SELECT
        CASE
          WHEN UPPER(COALESCE(p.code, '')) = 'MILK' OR LOWER(si.product_name) LIKE '%milk%' THEN 'MILK'
          WHEN UPPER(COALESCE(p.code, '')) IN ('YOGT', 'YOGURT') OR LOWER(si.product_name) LIKE '%yog%' THEN 'YOGURT'
          ELSE NULL
        END AS kind,
        ROUND(si.quantity, 2) AS qty,
        COUNT(*) AS bills,
        COALESCE(SUM(si.line_total), 0) AS revenue
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) < ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
        AND si.quantity > 0
      GROUP BY kind, ROUND(si.quantity, 2)
      HAVING kind IS NOT NULL
      ORDER BY bills DESC
    `).all(trendStartIso, trendEndIso) as Array<{ kind: 'MILK' | 'YOGURT'; qty: number; bills: number; revenue: number }>;

    const buildBuyPattern = (kind: 'MILK' | 'YOGURT') => {
      const rows = buyPatternRows.filter((row) => row.kind === kind);
      const totalBills = rows.reduce((sum, row) => sum + Number(row.bills || 0), 0);
      const top = rows.slice(0, 6).map((row) => ({
        qty: Number(row.qty || 0),
        bills: Number(row.bills || 0),
        revenue: Number(row.revenue || 0),
        sharePct: totalBills > 0 ? Number(((Number(row.bills || 0) / totalBills) * 100).toFixed(1)) : 0
      }));
      return {
        totalBillsWithItem: totalBills,
        mostCommonQty: top[0]?.qty ?? 0,
        mostCommonSharePct: top[0]?.sharePct ?? 0,
        top
      };
    };

    const buyPatterns = {
      milk: buildBuyPattern('MILK'),
      yogurt: buildBuyPattern('YOGURT')
    };

    // ---- Milk vs Yogurt customer mix ----
    // Per-bill segmentation: was this bill only milk, only yogurt, or both?
    // We then mirror the same logic against known (khata) customers so the
    // owner can see "of my 23 khata customers, 12 buy both / 8 only milk".
    const milkYogurtMixRow = db.prepare(`
      WITH bill_kinds AS (
        SELECT
          s.id AS sale_id,
          MAX(CASE WHEN UPPER(COALESCE(p.code, '')) = 'MILK' OR LOWER(si.product_name) LIKE '%milk%' THEN 1 ELSE 0 END) AS has_milk,
          MAX(CASE WHEN UPPER(COALESCE(p.code, '')) IN ('YOGT', 'YOGURT') OR LOWER(si.product_name) LIKE '%yog%' THEN 1 ELSE 0 END) AS has_yogurt
        FROM sales s
        LEFT JOIN sale_items si ON si.sale_id = s.id
        LEFT JOIN products p ON p.id = si.product_id
        LEFT JOIN shifts sh ON sh.id = s.shift_id
        WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
          AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) < ?
          AND s.status IN (${ACCOUNTING_SALE_STATUSES})
        GROUP BY s.id
      )
      SELECT
        COALESCE(SUM(CASE WHEN has_milk = 1 AND has_yogurt = 0 THEN 1 ELSE 0 END), 0) AS only_milk,
        COALESCE(SUM(CASE WHEN has_milk = 0 AND has_yogurt = 1 THEN 1 ELSE 0 END), 0) AS only_yogurt,
        COALESCE(SUM(CASE WHEN has_milk = 1 AND has_yogurt = 1 THEN 1 ELSE 0 END), 0) AS both,
        COALESCE(SUM(CASE WHEN has_milk = 0 AND has_yogurt = 0 THEN 1 ELSE 0 END), 0) AS neither,
        COUNT(*) AS total_bills
      FROM bill_kinds
    `).get(trendStartIso, trendEndIso) as any;

    const knownCustomerMixRow = db.prepare(`
      WITH customer_kinds AS (
        SELECT
          s.customer_id,
          MAX(CASE WHEN UPPER(COALESCE(p.code, '')) = 'MILK' OR LOWER(si.product_name) LIKE '%milk%' THEN 1 ELSE 0 END) AS has_milk,
          MAX(CASE WHEN UPPER(COALESCE(p.code, '')) IN ('YOGT', 'YOGURT') OR LOWER(si.product_name) LIKE '%yog%' THEN 1 ELSE 0 END) AS has_yogurt
        FROM sales s
        LEFT JOIN sale_items si ON si.sale_id = s.id
        LEFT JOIN products p ON p.id = si.product_id
        LEFT JOIN shifts sh ON sh.id = s.shift_id
        WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
          AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) < ?
          AND s.status IN (${ACCOUNTING_SALE_STATUSES})
          AND s.customer_id IS NOT NULL
        GROUP BY s.customer_id
      )
      SELECT
        COALESCE(SUM(CASE WHEN has_milk = 1 AND has_yogurt = 0 THEN 1 ELSE 0 END), 0) AS only_milk,
        COALESCE(SUM(CASE WHEN has_milk = 0 AND has_yogurt = 1 THEN 1 ELSE 0 END), 0) AS only_yogurt,
        COALESCE(SUM(CASE WHEN has_milk = 1 AND has_yogurt = 1 THEN 1 ELSE 0 END), 0) AS both,
        COUNT(*) AS total_customers
      FROM customer_kinds
    `).get(trendStartIso, trendEndIso) as any;

    const milkYogurtMix = {
      windowDays: daysBack,
      bills: {
        onlyMilk: Number(milkYogurtMixRow?.only_milk || 0),
        onlyYogurt: Number(milkYogurtMixRow?.only_yogurt || 0),
        both: Number(milkYogurtMixRow?.both || 0),
        neither: Number(milkYogurtMixRow?.neither || 0),
        total: Number(milkYogurtMixRow?.total_bills || 0)
      },
      knownCustomers: {
        onlyMilk: Number(knownCustomerMixRow?.only_milk || 0),
        onlyYogurt: Number(knownCustomerMixRow?.only_yogurt || 0),
        both: Number(knownCustomerMixRow?.both || 0),
        total: Number(knownCustomerMixRow?.total_customers || 0)
      }
    };

    // ---- Same-day-last-year comparison ----
    // Only meaningful once we have history older than a year. We compute the
    // calendar-anchored date (handles leap years naturally) and pull totals
    // for that single day. Also compute a ±3-day window because a holiday
    // can shift by a couple of days year-over-year (Eid, Muharram, etc.).
    const lastYearAnchor = new Date(`${today}T00:00:00`);
    lastYearAnchor.setFullYear(lastYearAnchor.getFullYear() - 1);
    const lastYearIso = formatLocalDate(lastYearAnchor);
    const lastYearWindowStart = new Date(lastYearAnchor); lastYearWindowStart.setDate(lastYearWindowStart.getDate() - 3);
    const lastYearWindowEnd   = new Date(lastYearAnchor); lastYearWindowEnd.setDate(lastYearWindowEnd.getDate() + 4); // exclusive

    const sameDayLastYearRow = db.prepare(`
      SELECT
        COUNT(s.id) AS bills,
        COALESCE(SUM(s.grand_total), 0) AS revenue
      FROM sales s
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) = ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(lastYearIso) as any;
    const sameDayLastYearVolRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN UPPER(COALESCE(p.code, '')) = 'MILK' OR LOWER(si.product_name) LIKE '%milk%' THEN si.quantity ELSE 0 END), 0) AS milkKg,
        COALESCE(SUM(CASE WHEN UPPER(COALESCE(p.code, '')) IN ('YOGT', 'YOGURT') OR LOWER(si.product_name) LIKE '%yog%' THEN si.quantity ELSE 0 END), 0) AS yogurtKg
      FROM sales s
      LEFT JOIN sale_items si ON si.sale_id = s.id
      LEFT JOIN products p ON p.id = si.product_id
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) = ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(lastYearIso) as any;
    const lastYearWindowRow = db.prepare(`
      SELECT
        COUNT(s.id) AS bills,
        COALESCE(SUM(s.grand_total), 0) AS revenue
      FROM sales s
      LEFT JOIN shifts sh ON sh.id = s.shift_id
      WHERE COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) >= ?
        AND COALESCE(sh.shift_date, substr(s.sale_date, 1, 10)) < ?
        AND s.status IN (${ACCOUNTING_SALE_STATUSES})
    `).get(formatLocalDate(lastYearWindowStart), formatLocalDate(lastYearWindowEnd)) as any;

    const lyBills = Number(sameDayLastYearRow?.bills || 0);
    const lyRevenue = Number(sameDayLastYearRow?.revenue || 0);
    const lyHasData = lyBills > 0 || lyRevenue > 0 || Number(lastYearWindowRow?.bills || 0) > 0;
    const todayBillsForLy = Number(today_kpis.bills || 0);
    const todayRevenueForLy = Number(today_kpis.revenue || 0);
    const sameDayLastYear = lyHasData ? {
      date: lastYearIso,
      bills: lyBills,
      revenue: lyRevenue,
      milkKg: Number(Number(sameDayLastYearVolRow?.milkKg || 0).toFixed(2)),
      yogurtKg: Number(Number(sameDayLastYearVolRow?.yogurtKg || 0).toFixed(2)),
      revenueDeltaPct: lyRevenue > 0 ? Number((((todayRevenueForLy - lyRevenue) / lyRevenue) * 100).toFixed(1)) : null,
      billsDeltaPct: lyBills > 0 ? Number((((todayBillsForLy - lyBills) / lyBills) * 100).toFixed(1)) : null,
      window: {
        start: formatLocalDate(lastYearWindowStart),
        end: formatLocalDate(new Date(lastYearWindowEnd.getTime() - 86400000)),
        bills: Number(lastYearWindowRow?.bills || 0),
        revenue: Number(lastYearWindowRow?.revenue || 0)
      }
    } : null;

    // ---- Daily milk procurement cost (weighted avg buy rate) ----
    // Each supplier has their own per-kg rate, and even within one supplier
    // the cow vs buffalo rate differs. Owner wants the single number that
    // matters: "what did I pay per kg of milk on average today?". Computed
    // as SUM(total_amount) / SUM(quantity), which is the only correct
    // weighted average — straight AVG(rate) over-weights small entries.
    const milkCostToday = db.prepare(`
      SELECT
        COALESCE(SUM(quantity), 0) AS total_kg,
        COALESCE(SUM(total_amount), 0) AS total_spend,
        COUNT(*) AS entry_count,
        COUNT(DISTINCT supplier_id) AS supplier_count,
        COALESCE(MIN(rate), 0) AS min_rate,
        COALESCE(MAX(rate), 0) AS max_rate
      FROM milk_collections
      WHERE collection_date = ?
    `).get(today) as any;

    const milkCostByType = db.prepare(`
      SELECT
        milk_type,
        COALESCE(SUM(quantity), 0) AS total_kg,
        COALESCE(SUM(total_amount), 0) AS total_spend
      FROM milk_collections
      WHERE collection_date = ?
      GROUP BY milk_type
    `).all(today) as Array<{ milk_type: string; total_kg: number; total_spend: number }>;

    // Lowest/highest single entry today — useful for negotiation ("Farmer X
    // gave you the priciest milk today, see if cow/buffalo mix is right").
    const milkCostExtremes = db.prepare(`
      SELECT mc.rate, mc.quantity, mc.milk_type, mc.shift, s.name AS supplier_name
      FROM milk_collections mc
      JOIN suppliers s ON s.id = mc.supplier_id
      WHERE mc.collection_date = ?
      ORDER BY mc.rate ASC
    `).all(today) as Array<{ rate: number; quantity: number; milk_type: string; shift: string; supplier_name: string }>;

    // Window-wide weighted avg + per-day series for the trend sparkline. The
    // owner needs context: "today's Rs.182/kg — is that high or low for the
    // last 30 days?" so we expose both the window-avg and the daily series.
    const milkCostWindow = db.prepare(`
      SELECT
        COALESCE(SUM(quantity), 0) AS total_kg,
        COALESCE(SUM(total_amount), 0) AS total_spend
      FROM milk_collections
      WHERE collection_date >= ? AND collection_date < ?
    `).get(trendStartIso, trendEndIso) as any;

    const milkCostDaily = db.prepare(`
      SELECT
        collection_date AS date,
        COALESCE(SUM(quantity), 0) AS total_kg,
        COALESCE(SUM(total_amount), 0) AS total_spend
      FROM milk_collections
      WHERE collection_date >= ? AND collection_date < ?
      GROUP BY collection_date
      ORDER BY collection_date ASC
    `).all(trendStartIso, trendEndIso) as Array<{ date: string; total_kg: number; total_spend: number }>;

    const sellingRateRow = db.prepare(`
      SELECT milk_rate FROM daily_rates WHERE date <= ? ORDER BY date DESC LIMIT 1
    `).get(today) as any;
    const milkSellingRate = Number(sellingRateRow?.milk_rate || 0);

    const computeAvgRate = (kg: number, spend: number) =>
      kg > 0 ? Number((Number(spend) / Number(kg)).toFixed(2)) : 0;

    const todayKg = Number(milkCostToday?.total_kg || 0);
    const todaySpend = Number(milkCostToday?.total_spend || 0);
    const todayAvgRate = computeAvgRate(todayKg, todaySpend);
    const windowKg = Number(milkCostWindow?.total_kg || 0);
    const windowSpend = Number(milkCostWindow?.total_spend || 0);
    const windowAvgRate = computeAvgRate(windowKg, windowSpend);

    const byType = (typeKey: 'COW' | 'BUFFALO' | 'MIXED') => {
      const row = milkCostByType.find((r) => String(r.milk_type).toUpperCase() === typeKey);
      const kg = Number(row?.total_kg || 0);
      const spend = Number(row?.total_spend || 0);
      return {
        kg: Number(kg.toFixed(2)),
        spend: Number(spend.toFixed(0)),
        avgRate: computeAvgRate(kg, spend)
      };
    };

    const dailyAvgRates = milkCostDaily.map((row) => ({
      date: row.date,
      avgRatePerKg: computeAvgRate(Number(row.total_kg || 0), Number(row.total_spend || 0)),
      totalKg: Number(Number(row.total_kg || 0).toFixed(2))
    }));

    const cheapest = milkCostExtremes[0];
    const priciest = milkCostExtremes[milkCostExtremes.length - 1];

    const marginPerKg = milkSellingRate > 0 && todayAvgRate > 0 ? Number((milkSellingRate - todayAvgRate).toFixed(2)) : 0;
    const marginPct = milkSellingRate > 0 && todayAvgRate > 0
      ? Number((((milkSellingRate - todayAvgRate) / milkSellingRate) * 100).toFixed(1))
      : 0;

    const milkCost = {
      today: {
        date: today,
        totalKg: Number(todayKg.toFixed(2)),
        totalSpend: Number(todaySpend.toFixed(0)),
        avgRatePerKg: todayAvgRate,
        supplierCount: Number(milkCostToday?.supplier_count || 0),
        entryCount: Number(milkCostToday?.entry_count || 0),
        minRate: Number(milkCostToday?.min_rate || 0),
        maxRate: Number(milkCostToday?.max_rate || 0),
        cow: byType('COW'),
        buffalo: byType('BUFFALO'),
        mixed: byType('MIXED'),
        cheapestSupplier: cheapest ? { name: cheapest.supplier_name, rate: Number(cheapest.rate), milkType: cheapest.milk_type, shift: cheapest.shift } : null,
        priciestSupplier: priciest ? { name: priciest.supplier_name, rate: Number(priciest.rate), milkType: priciest.milk_type, shift: priciest.shift } : null
      },
      window: {
        days: daysBack,
        totalKg: Number(windowKg.toFixed(2)),
        totalSpend: Number(windowSpend.toFixed(0)),
        avgRatePerKg: windowAvgRate
      },
      selling: {
        milkRate: milkSellingRate,
        marginPerKg,
        marginPct
      },
      dailyTrend: dailyAvgRates
    };

    const insights = [
      busiestHour ? `Peak hour is ${String(busiestHour.hour).padStart(2, '0')}:00 with ${busiestHour.bills} bills.` : 'No peak hour yet because there are no sales in this period.',
      bestDay ? `Best day in the selected window was ${bestDay.date} with Rs. ${Math.round(bestDay.revenue).toLocaleString('en-PK')} sales.` : 'No best day yet.',
      Number(customerRiskRow?.totalDues || 0) > 0 ? `Khata dues are Rs. ${Math.round(Number(customerRiskRow.totalDues)).toLocaleString('en-PK')} across ${customerRiskRow.customersWithDues} customers.` : 'No active customer dues right now.',
      stockRisk.length > 0 ? `${stockRisk.length} product(s) are at or below low-stock level.` : 'No low-stock risk found.'
    ];

    if (milkCost.today.totalKg > 0) {
      insights.push(`Avg milk buy rate today: Rs. ${milkCost.today.avgRatePerKg}/kg across ${milkCost.today.totalKg.toFixed(0)} kg from ${milkCost.today.supplierCount} farmer(s).`);
      if (milkSellingRate > 0 && marginPerKg !== 0) {
        const verb = marginPerKg >= 0 ? 'margin' : 'LOSS';
        insights.push(`Per-kg ${verb}: Rs. ${Math.abs(marginPerKg)} (${Math.abs(marginPct)}%) — selling at Rs. ${milkSellingRate}/kg.`);
      }
    }
    if (buyPatterns.milk.mostCommonQty > 0) {
      insights.push(`Most customers buy ${buyPatterns.milk.mostCommonQty} kg milk (${buyPatterns.milk.mostCommonSharePct}% of milk bills).`);
    }
    if (buyPatterns.yogurt.mostCommonQty > 0) {
      insights.push(`Most customers buy ${buyPatterns.yogurt.mostCommonQty} kg yogurt (${buyPatterns.yogurt.mostCommonSharePct}% of yogurt bills).`);
    }
    if (sameDayLastYear && sameDayLastYear.revenueDeltaPct != null) {
      const verb = sameDayLastYear.revenueDeltaPct >= 0 ? 'up' : 'down';
      insights.push(`Same day last year: Rs. ${Math.round(sameDayLastYear.revenue).toLocaleString('en-PK')} — today is ${verb} ${Math.abs(sameDayLastYear.revenueDeltaPct).toFixed(1)}%.`);
    }

    return {
      reportDate: today,
      daysBack,
      today: today_kpis,
      hourly,
      busiestHour,
      quietestHour,
      dailyTrend: dailyTrend.map((row) => ({
        date: row.date,
        bills: Number(row.bills || 0),
        revenue: Number(row.revenue || 0),
        milkKg: Number(Number(row.milkKg || 0).toFixed(3)),
        yogurtKg: Number(Number(row.yogurtKg || 0).toFixed(3)),
        combinedKg: Number((Number(row.milkKg || 0) + Number(row.yogurtKg || 0)).toFixed(3))
      })),
      compare,
      yogurtPlan,
      customerBehavior: {
        totalBills: Number(customerBehaviorRow?.totalBills || 0),
        walkInBills: Number(customerBehaviorRow?.walkInBills || 0),
        knownBills: Number(customerBehaviorRow?.knownBills || 0),
        knownCustomers: Number(customerBehaviorRow?.knownCustomers || 0),
        walkInRevenue: Number(customerBehaviorRow?.walkInRevenue || 0),
        knownRevenue: Number(customerBehaviorRow?.knownRevenue || 0),
        repeatCustomers: repeatCustomers.map((row) => ({
          ...row,
          visits: Number(row.visits || 0),
          revenue: Number(row.revenue || 0)
        }))
      },
      tenderMix,
      topProducts: topProducts.map((row) => ({
        ...row,
        quantity: Number(row.quantity || 0),
        revenue: Number(row.revenue || 0),
        cost: Number(row.cost || 0),
        grossProfit: Number(row.grossProfit || 0),
        marginPct: Number(row.revenue || 0) > 0 ? Number(((Number(row.grossProfit || 0) / Number(row.revenue || 0)) * 100).toFixed(1)) : 0,
        bills: Number(row.bills || 0)
      })),
      categoryMix: categoryMix.map((row) => ({
        category: row.category,
        revenue: Number(row.revenue || 0),
        quantity: Number(row.quantity || 0),
        bills: Number(row.bills || 0)
      })),
      expenseBreakdown: expenseBreakdown.map((row) => ({
        category: row.category,
        amount: Number(row.amount || 0),
        count: Number(row.count || 0)
      })),
      customerRisk: {
        customersWithDues: Number(customerRiskRow?.customersWithDues || 0),
        totalDues: Number(customerRiskRow?.totalDues || 0),
        overLimitCount: Number(customerRiskRow?.overLimitCount || 0),
        topDues
      },
      buyPatterns,
      milkYogurtMix,
      sameDayLastYear,
      milkCost,
      stockRisk,
      insights,
      generatedAt: new Date().toISOString()
    };
  });
}
