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
exports.registerExportsIPC = registerExportsIPC;
const electron_1 = require("electron");
const db_1 = __importDefault(require("../database/db"));
const auth_ipc_1 = require("./auth.ipc");
const cashRegister_1 = require("../database/cashRegister");
const businessDay_1 = require("../database/businessDay");
function money(value) {
    return Number(value || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 });
}
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function htmlTable(title, rows, columns) {
    return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #111; padding: 24px; }
          h1 { margin: 0 0 6px; font-size: 22px; }
          .meta { color: #555; margin-bottom: 18px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { background: #0f4c35; color: white; text-align: left; }
          th, td { border: 1px solid #ccc; padding: 7px; }
          tr:nth-child(even) td { background: #f7f7f7; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">Noon Dairy POS - exported ${escapeHtml(new Date().toLocaleString())}</div>
        <table>
          <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>${columns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join('')}</tr>
            `).join('')}
          </tbody>
        </table>
      </body>
    </html>
  `;
}
function getReport(type, params = {}) {
    const date = params.date || (0, businessDay_1.getBusinessDate)();
    const startDate = params.startDate || date;
    const endDate = params.endDate || date;
    if (type === 'daily-sales') {
        const rows = db_1.default.prepare(`
      SELECT bill_number, sale_date, payment_type, subtotal, discount_amount, tax_amount, grand_total, amount_paid, balance_due, status
      FROM sales
      WHERE substr(sale_date, 1, 10) = ?
      ORDER BY sale_date ASC
    `).all(date);
        return {
            title: `Daily Sales Report - ${date}`,
            rows: rows.map((row) => ({
                bill: row.bill_number,
                date: row.sale_date,
                payment: row.payment_type,
                subtotal: money(row.subtotal),
                discount: money(row.discount_amount),
                tax: money(row.tax_amount),
                total: money(row.grand_total),
                paid: money(row.amount_paid),
                due: money(row.balance_due),
                status: row.status
            })),
            columns: [
                { key: 'bill', label: 'Bill' },
                { key: 'date', label: 'Date' },
                { key: 'payment', label: 'Payment' },
                { key: 'subtotal', label: 'Subtotal' },
                { key: 'discount', label: 'Discount' },
                { key: 'tax', label: 'Tax' },
                { key: 'total', label: 'Total' },
                { key: 'paid', label: 'Paid' },
                { key: 'due', label: 'Due' },
                { key: 'status', label: 'Status' }
            ]
        };
    }
    if (type === 'z-report') {
        const sales = db_1.default.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(grand_total), 0) as gross, COALESCE(SUM(discount_amount), 0) as discounts, COALESCE(SUM(balance_due), 0) as khata
      FROM sales WHERE substr(sale_date, 1, 10) = ? AND status != 'CANCELLED'
    `).get(date);
        const tenders = db_1.default.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN sp.method = 'CASH' THEN sp.amount ELSE 0 END), 0) as cash,
        COALESCE(SUM(CASE WHEN sp.method = 'ONLINE' THEN sp.amount ELSE 0 END), 0) as online
      FROM split_payments sp JOIN sales s ON s.id = sp.sale_id
      WHERE substr(s.sale_date, 1, 10) = ? AND s.status != 'CANCELLED'
    `).get(date);
        const refunds = db_1.default.prepare(`SELECT COALESCE(SUM(refund_amount), 0) as total FROM returns WHERE substr(return_date, 1, 10) = ?`).get(date);
        const voids = db_1.default.prepare(`SELECT COUNT(*) as count FROM sale_voids WHERE substr(voided_at, 1, 10) = ?`).get(date);
        const { register, openingCash, cashIn, cashOut, expectedCash } = (0, cashRegister_1.getCashRegisterExpected)(date);
        const counted = Number(register?.closing_balance || 0);
        const rows = [
            { item: 'Opening Cash', value: money(openingCash) },
            { item: 'Sales Count', value: sales?.count || 0 },
            { item: 'Gross Sales', value: money(sales?.gross) },
            { item: 'Discounts', value: money(sales?.discounts) },
            { item: 'Refunds', value: money(refunds?.total) },
            { item: 'Voids', value: voids?.count || 0 },
            { item: 'Khata / Credit Sales', value: money(sales?.khata) },
            { item: 'Cash Sales', value: money(tenders?.cash) },
            { item: 'Online Sales', value: money(tenders?.online) },
            { item: 'Cash In Recorded', value: money(cashIn) },
            { item: 'Cash Out Recorded', value: money(cashOut) },
            { item: 'Expected Cash', value: money(expectedCash) },
            { item: 'Counted Cash', value: money(counted) },
            { item: 'Variance', value: money(counted - expectedCash) }
        ];
        return { title: `Z-Report - ${date}`, rows, columns: [{ key: 'item', label: 'Item' }, { key: 'value', label: 'Value' }] };
    }
    if (type === 'khata-ledger') {
        const customerId = params.customerId;
        const rows = db_1.default.prepare(`
      SELECT le.entry_date, c.name as customer, le.entry_type, le.description, le.amount, le.balance_after
      FROM ledger_entries le
      JOIN customers c ON c.id = le.customer_id
      WHERE (? IS NULL OR le.customer_id = ?)
      AND substr(le.entry_date, 1, 10) >= ? AND substr(le.entry_date, 1, 10) <= ?
      ORDER BY le.entry_date ASC
    `).all(customerId || null, customerId || null, startDate, endDate);
        return {
            title: `Khata Ledger - ${startDate} to ${endDate}`,
            rows: rows.map((row) => ({ ...row, amount: money(row.amount), balance_after: money(row.balance_after) })),
            columns: [
                { key: 'entry_date', label: 'Date' },
                { key: 'customer', label: 'Customer' },
                { key: 'entry_type', label: 'Type' },
                { key: 'description', label: 'Description' },
                { key: 'amount', label: 'Amount' },
                { key: 'balance_after', label: 'Balance' }
            ]
        };
    }
    if (type === 'stock-report') {
        const rows = db_1.default.prepare(`
      SELECT code, name, category, unit, selling_price, cost_price, stock, low_stock_threshold
      FROM products WHERE is_active = 1 ORDER BY name ASC
    `).all();
        return {
            title: 'Stock Report',
            rows: rows.map((row) => ({ ...row, selling_price: money(row.selling_price), cost_price: money(row.cost_price) })),
            columns: [
                { key: 'code', label: 'Code' },
                { key: 'name', label: 'Name' },
                { key: 'category', label: 'Category' },
                { key: 'unit', label: 'Unit' },
                { key: 'selling_price', label: 'Sell Price' },
                { key: 'cost_price', label: 'Cost Price' },
                { key: 'stock', label: 'Stock' },
                { key: 'low_stock_threshold', label: 'Low Stock Level' }
            ]
        };
    }
    if (type === 'expense-report') {
        const rows = db_1.default.prepare(`
      SELECT expense_date, category, description, amount, added_by_id
      FROM expenses
      WHERE substr(expense_date, 1, 10) >= ? AND substr(expense_date, 1, 10) <= ?
      ORDER BY expense_date ASC
    `).all(startDate, endDate);
        return {
            title: `Expense Report - ${startDate} to ${endDate}`,
            rows: rows.map((row) => ({ ...row, amount: money(row.amount) })),
            columns: [
                { key: 'expense_date', label: 'Date' },
                { key: 'category', label: 'Category' },
                { key: 'description', label: 'Description' },
                { key: 'amount', label: 'Amount' },
                { key: 'added_by_id', label: 'Added By' }
            ]
        };
    }
    const report = db_1.default.prepare(`
    SELECT
      s.code, s.name, s.phone,
      COALESCE(SUM(mc.quantity), 0) as total_quantity,
      COALESCE(SUM(CASE WHEN mc.shift = 'MORNING' THEN mc.quantity ELSE 0 END), 0) as morning_quantity,
      COALESCE(SUM(CASE WHEN mc.shift = 'EVENING' THEN mc.quantity ELSE 0 END), 0) as evening_quantity,
      COALESCE(SUM(mc.total_amount), 0) as total_amount,
      s.current_balance
    FROM suppliers s
    LEFT JOIN milk_collections mc ON mc.supplier_id = s.id AND mc.collection_date >= ? AND mc.collection_date <= ?
    WHERE s.is_active = 1
    GROUP BY s.id
    ORDER BY s.name ASC
  `).all(startDate, endDate);
    return {
        title: `Supplier Report - ${startDate} to ${endDate}`,
        rows: report.map((row) => ({ ...row, total_amount: money(row.total_amount), current_balance: money(row.current_balance) })),
        columns: [
            { key: 'code', label: 'Code' },
            { key: 'name', label: 'Supplier' },
            { key: 'phone', label: 'Phone' },
            { key: 'total_quantity', label: 'Total Qty' },
            { key: 'morning_quantity', label: 'Morning Qty' },
            { key: 'evening_quantity', label: 'Evening Qty' },
            { key: 'total_amount', label: 'Amount' },
            { key: 'current_balance', label: 'Balance' }
        ]
    };
}
async function savePdf(html, defaultPath) {
    const { canceled, filePath } = await electron_1.dialog.showSaveDialog({
        defaultPath,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (canceled || !filePath)
        return { success: false, reason: 'canceled' };
    const win = new electron_1.BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    const fs = await Promise.resolve().then(() => __importStar(require('fs')));
    fs.writeFileSync(filePath, pdf);
    win.destroy();
    return { success: true, path: filePath };
}
async function saveExcel(html, defaultPath) {
    const { canceled, filePath } = await electron_1.dialog.showSaveDialog({
        defaultPath,
        filters: [{ name: 'Excel Workbook', extensions: ['xls'] }]
    });
    if (canceled || !filePath)
        return { success: false, reason: 'canceled' };
    const fs = await Promise.resolve().then(() => __importStar(require('fs')));
    fs.writeFileSync(filePath, html, 'utf8');
    return { success: true, path: filePath };
}
function registerExportsIPC() {
    electron_1.ipcMain.handle('exports:report', async (_event, data) => {
        try {
            (0, auth_ipc_1.requireCurrentUser)(['ADMIN', 'MANAGER']);
            const report = getReport(data.type, data.params || {});
            const html = htmlTable(report.title, report.rows, report.columns);
            const safeTitle = report.title.replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-');
            if (data.format === 'pdf') {
                return await savePdf(html, `${safeTitle}.pdf`);
            }
            return await saveExcel(html, `${safeTitle}.xls`);
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
}
