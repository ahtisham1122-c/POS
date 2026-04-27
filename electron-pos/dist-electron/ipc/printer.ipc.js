"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPrinterIPC = registerPrinterIPC;
const electron_1 = require("electron");
const logger_1 = __importDefault(require("../utils/logger"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_2 = require("electron");
const db_1 = __importDefault(require("../database/db"));
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function toReceiptAmount(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? Math.round(amount) : 0;
}
function normalizeReceiptData(input) {
    if (input?.sale) {
        const sale = input.sale;
        const splitPayments = input.splitPayments || [];
        const cashPaid = splitPayments
            .filter((payment) => payment.method === 'CASH')
            .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const onlinePaid = splitPayments
            .filter((payment) => payment.method === 'ONLINE')
            .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        return {
            billNumber: sale.bill_number,
            date: sale.sale_date || sale.created_at,
            customer: input.customer?.name || 'Walk-in',
            paymentType: sale.payment_type,
            subtotal: Number(sale.subtotal || 0),
            discount: Number(sale.discount_amount || 0),
            taxLabel: sale.tax_label || 'Tax',
            taxAmount: Number(sale.tax_amount || 0),
            grandTotal: Number(sale.grand_total || 0),
            amountPaid: sale.payment_type === 'CASH'
                ? Number(sale.cash_tendered || sale.amount_paid || 0)
                : Number(sale.amount_paid || 0),
            balanceDue: Number(sale.balance_due || 0),
            cashPaid,
            onlinePaid,
            changeToReturn: Number(sale.change_returned || 0),
            items: (input.items || []).map((item) => ({
                id: item.id,
                name: item.product_name,
                quantity: Number(item.quantity || 0),
                price: Number(item.unit_price || 0),
                lineTotal: Number(item.line_total || 0)
            }))
        };
    }
    return input || {};
}
function getReceiptSettings() {
    const rows = db_1.default.prepare(`SELECT key, value FROM settings`).all();
    const settings = rows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
    }, {});
    return {
        shopName: settings.shop_name || 'Gujjar Milk Shop',
        shopAddress: settings.shop_address || 'Main Market, Faisalabad',
        shopPhone: settings.shop_phone || '0300-1234567',
        footer: settings.receipt_footer || 'Thank you',
        printerName: settings.printerName || settings.printer_name || ''
    };
}
function registerPrinterIPC() {
    electron_1.ipcMain.handle('printer:getPrinters', async () => {
        let tempWindow = null;
        try {
            const existingWindow = electron_1.BrowserWindow.getAllWindows()[0];
            const sourceWindow = existingWindow || new electron_1.BrowserWindow({ show: false });
            if (!existingWindow)
                tempWindow = sourceWindow;
            const printers = await sourceWindow.webContents.getPrintersAsync();
            return {
                success: true,
                printers: printers.map((printer) => ({
                    name: printer.name,
                    displayName: printer.displayName || printer.name,
                    description: printer.description || '',
                    status: printer.status,
                    isDefault: printer.isDefault
                }))
            };
        }
        catch (e) {
            return { success: false, printers: [], error: e.message };
        }
        finally {
            if (tempWindow && !tempWindow.isDestroyed())
                tempWindow.destroy();
        }
    });
    electron_1.ipcMain.handle('printer:printReceipt', async (_event, receiptData) => {
        try {
            const receipt = normalizeReceiptData(receiptData);
            const receiptSettings = getReceiptSettings();
            logger_1.default.info(`Printing receipt ${receipt.billNumber} via temp file`);
            const win = new electron_1.BrowserWindow({
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                }
            });
            const receiptHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              * { box-sizing: border-box; }
              body { 
                width: 260px; 
                margin: 0; 
                padding: 0;
                background-color: white;
                color: black !important;
                font-family: 'Arial Black', 'Arial', sans-serif;
                font-size: 13px;
                line-height: 1.0;
                font-weight: 900;
              }
              .center { text-align: center; }
              .bold { font-weight: 900; }
              .hr { border-bottom: 2px solid black; margin: 3px 0; }
              .flex { display: flex; justify-content: space-between; align-items: baseline; }
              .title { font-size: 18px; margin-bottom: 0px; }
              .subtitle { font-size: 11px; margin-bottom: 0px; }
              .item-row { margin: 1px 0; width: 100%; }
              .item-name { font-size: 15px; text-transform: uppercase; flex-shrink: 0; }
              .item-amount { font-size: 15px; flex-shrink: 0; }
              .leader { flex-grow: 1; border-bottom: 1px dotted black; margin: 0 4px; position: relative; top: -4px; }
              .total-row { font-size: 17px; margin-top: 3px; border-top: 3px solid black; padding-top: 2px; }
              .handover { font-size: 12px; margin-top: 6px; border: 2px solid black; padding: 4px; text-align: center; }
              .thanks { font-size: 15px; margin-top: 8px; border-top: 1px solid black; padding-top: 4px; }
              .footer { font-size: 10px; margin-top: 2px; }
            </style>
          </head>
          <body>
            <div class="center bold title">${escapeHtml(receiptSettings.shopName)}</div>
            <div class="center subtitle">${escapeHtml(receiptSettings.shopAddress)} | ${escapeHtml(receiptSettings.shopPhone)}</div>
            
            <div class="hr"></div>
            
            <div class="flex" style="font-size: 12px;">
              <span>Bill: ${escapeHtml(receipt.billNumber)}</span>
              <span>${new Date(receipt.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            
            <div class="hr" style="border-bottom-width: 1px;"></div>
            
            ${(receipt.items || []).map((item) => `
              <div class="item-row">
                <div class="flex">
                  <span class="item-name">${escapeHtml(item.name)}</span>
                  <span class="leader"></span>
                  <span class="item-amount">${toReceiptAmount(item.lineTotal)}</span>
                </div>
              </div>
            `).join('')}

            <div class="hr" style="border-bottom-width: 1px;"></div>
            <div class="flex" style="font-size: 12px;">
              <span>Subtotal</span>
              <span>${toReceiptAmount(receipt.subtotal)}</span>
            </div>
            ${toReceiptAmount(receipt.discount) > 0 ? `
            <div class="flex" style="font-size: 12px;">
              <span>Discount</span>
              <span>-${toReceiptAmount(receipt.discount)}</span>
            </div>
            ` : ''}
            ${toReceiptAmount(receipt.taxAmount) > 0 ? `
            <div class="flex" style="font-size: 12px;">
              <span>${escapeHtml(receipt.taxLabel || 'Tax')}</span>
              <span>${toReceiptAmount(receipt.taxAmount)}</span>
            </div>
            ` : ''}
            
            <div class="flex bold total-row">
              <span>TOTAL:</span>
              <span style="font-size: 22px;">Rs.${toReceiptAmount(receipt.grandTotal)}</span>
            </div>
            
            <div class="flex" style="font-size: 13px; margin-top: 1px;">
              <span>${escapeHtml(receipt.paymentType === 'ONLINE' ? 'Online' : receipt.paymentType === 'SPLIT' ? 'Paid' : 'Cash')}: ${toReceiptAmount(receipt.amountPaid)}</span>
              ${receipt.changeToReturn > 0 ? `<span>Change: ${toReceiptAmount(receipt.changeToReturn)}</span>` : ''}
            </div>

            ${receipt.paymentType === 'SPLIT' ? `
            <div class="flex" style="font-size: 12px;">
              <span>Cash:</span>
              <span>${toReceiptAmount(receipt.cashPaid)}</span>
            </div>
            <div class="flex" style="font-size: 12px;">
              <span>Online:</span>
              <span>${toReceiptAmount(receipt.onlinePaid)}</span>
            </div>
            ` : ''}

            ${receipt.balanceDue > 0 ? `
            <div class="flex bold" style="font-size: 13px;">
              <span>Due:</span>
              <span>${toReceiptAmount(receipt.balanceDue)}</span>
            </div>
            ` : ''}

            <div class="handover bold">
              ITEM COUNTER: KEEP THIS RECEIPT<br/>
              DO NOT RETURN TO CUSTOMER
            </div>
            
            <div class="center bold thanks">${escapeHtml(receiptSettings.footer).toUpperCase()}</div>
            <div class="center footer">${escapeHtml(receiptSettings.shopName)} POS</div>
            <div style="height: 30px;"></div>
          </body>
        </html>
      `;
            const tempPath = path_1.default.join(electron_2.app.getPath('temp'), `receipt-${Date.now()}.html`);
            fs_1.default.writeFileSync(tempPath, receiptHtml);
            const result = await new Promise((resolve) => {
                let settled = false;
                let deviceName = '';
                const finish = (payload) => {
                    if (settled)
                        return;
                    settled = true;
                    try {
                        if (fs_1.default.existsSync(tempPath))
                            fs_1.default.unlinkSync(tempPath);
                    }
                    catch (cleanupError) {
                        logger_1.default.warn('Receipt temp cleanup failed:', cleanupError.message);
                    }
                    if (!win.isDestroyed())
                        win.close();
                    resolve(payload);
                };
                win.webContents.once('did-fail-load', (_event, _code, description) => {
                    finish({ success: false, error: description || 'Receipt failed to load' });
                });
                win.webContents.once('did-finish-load', () => {
                    setTimeout(async () => {
                        try {
                            const printers = await win.webContents.getPrintersAsync();
                            if (printers.length === 0) {
                                finish({ success: false, error: 'No printer is installed on this computer' });
                                return;
                            }
                            if (receiptSettings.printerName) {
                                const selectedPrinter = printers.find((printer) => printer.name === receiptSettings.printerName);
                                if (!selectedPrinter) {
                                    finish({ success: false, error: `Selected printer "${receiptSettings.printerName}" is not available` });
                                    return;
                                }
                                deviceName = selectedPrinter.name;
                            }
                        }
                        catch (error) {
                            finish({ success: false, error: error.message || 'Could not check printer status' });
                            return;
                        }
                        win.webContents.print({
                            silent: true,
                            deviceName,
                            printBackground: true,
                            margins: { marginType: 'none' }
                        }, (success, errorType) => {
                            if (!success) {
                                logger_1.default.error('Print failed:', errorType);
                                finish({ success: false, error: errorType || 'Printer rejected the receipt' });
                                return;
                            }
                            finish({ success: true });
                        });
                    }, 500);
                });
                win.loadFile(tempPath).catch((error) => {
                    finish({ success: false, error: error.message });
                });
            });
            return result;
        }
        catch (e) {
            logger_1.default.error('Thermal print failed:', e.message);
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('printer:printStatement', async (_event, statementData) => {
        const windows = electron_1.BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            windows[0].webContents.executeJavaScript('window.print();');
        }
        return { success: true };
    });
}
