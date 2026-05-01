import { ipcMain, BrowserWindow, shell } from 'electron';
import log from '../utils/logger';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import db from '../database/db';

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toReceiptAmount(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function toReceiptQuantity(value: unknown) {
  const quantity = Number(value || 0);
  if (!Number.isFinite(quantity)) return '0';
  return quantity.toFixed(3).replace(/\.?0+$/, '');
}

function normalizeReceiptData(input: any) {
  if (input?.sale) {
    const sale = input.sale;
    const splitPayments = input.splitPayments || [];
    const cashPaid = splitPayments
      .filter((payment: any) => payment.method === 'CASH')
      .reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0);
    const onlinePaid = splitPayments
      .filter((payment: any) => payment.method === 'ONLINE')
      .reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0);

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
      items: (input.items || []).map((item: any) => ({
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
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as Array<{ key: string; value: string }>;
  const settings = rows.reduce<Record<string, string>>((acc, row) => {
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

export function registerPrinterIPC() {
  ipcMain.handle('printer:getPrinters', async () => {
    let tempWindow: BrowserWindow | null = null;
    try {
      const existingWindow = BrowserWindow.getAllWindows()[0];
      const sourceWindow = existingWindow || new BrowserWindow({ show: false });
      if (!existingWindow) tempWindow = sourceWindow;

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
    } catch (e: any) {
      return { success: false, printers: [], error: e.message };
    } finally {
      if (tempWindow && !tempWindow.isDestroyed()) tempWindow.destroy();
    }
  });

  ipcMain.handle('printer:printReceipt', async (_event, receiptData) => {
    try {
      const receipt = normalizeReceiptData(receiptData);
      const receiptSettings = getReceiptSettings();
      log.info(`Printing receipt ${receipt.billNumber} via temp file`);

      const win = new BrowserWindow({
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
                width: 250px; 
                margin: 0; 
                padding: 0;
                background-color: white;
                color: black !important;
                font-family: 'Arial Black', 'Arial', sans-serif;
                font-size: 11px;
                line-height: 0.95;
                font-weight: 700;
              }
              .center { text-align: center; }
              .bold { font-weight: 900; }
              .hr { border-bottom: 1px solid black; margin: 2px 0; }
              .flex { display: flex; justify-content: space-between; align-items: baseline; }
              .title { font-size: 15px; margin-bottom: 0; line-height: 1; }
              .subtitle { font-size: 9px; margin-bottom: 0; line-height: 1; }
              .item-row { margin: 0 0 1px; width: 100%; }
              .item-name { font-size: 13px; font-weight: 900; text-transform: uppercase; flex-shrink: 0; }
              .item-amount { font-size: 13px; font-weight: 900; flex-shrink: 0; }
              .item-detail { font-size: 11px; font-weight: 900; margin-top: 0; }
              .leader { flex-grow: 1; border-bottom: 1px dotted black; margin: 0 4px; position: relative; top: -4px; }
              .total-row { font-size: 15px; margin-top: 2px; border-top: 2px solid black; padding-top: 1px; }
              .handover { font-size: 10px; margin-top: 3px; border: 1px solid black; padding: 2px; text-align: center; line-height: 1; }
              .thanks { font-size: 12px; margin-top: 4px; border-top: 1px solid black; padding-top: 2px; }
              .footer { font-size: 8px; margin-top: 1px; }
            </style>
          </head>
          <body>
            <div class="center bold title">${escapeHtml(receiptSettings.shopName)}</div>
            <div class="center subtitle">${escapeHtml(receiptSettings.shopAddress)} | ${escapeHtml(receiptSettings.shopPhone)}</div>
            
            <div class="hr"></div>
            
            <div class="flex" style="font-size: 10px;">
              <span>Bill: ${escapeHtml(receipt.billNumber)}</span>
              <span>${new Date(receipt.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            
            <div class="hr" style="border-bottom-width: 1px;"></div>
            
            ${(receipt.items || []).map((item: any) => `
              <div class="item-row">
                <div class="flex">
                  <span class="item-name">${escapeHtml(item.name)}</span>
                  <span class="leader"></span>
                  <span class="item-amount">${toReceiptAmount(item.lineTotal)}</span>
                </div>
                <div class="item-detail">
                  ${toReceiptQuantity(item.quantity)} ${escapeHtml(item.unit || 'kg')} x Rs.${toReceiptAmount(item.price)}
                </div>
              </div>
            `).join('')}

            <div class="hr" style="border-bottom-width: 1px;"></div>
            <div class="flex" style="font-size: 10px;">
              <span>Subtotal</span>
              <span>${toReceiptAmount(receipt.subtotal)}</span>
            </div>
            ${toReceiptAmount(receipt.discount) > 0 ? `
            <div class="flex" style="font-size: 10px;">
              <span>Discount</span>
              <span>-${toReceiptAmount(receipt.discount)}</span>
            </div>
            ` : ''}
            ${toReceiptAmount(receipt.taxAmount) > 0 ? `
            <div class="flex" style="font-size: 10px;">
              <span>${escapeHtml(receipt.taxLabel || 'Tax')}</span>
              <span>${toReceiptAmount(receipt.taxAmount)}</span>
            </div>
            ` : ''}
            
            <div class="flex bold total-row">
              <span>TOTAL:</span>
              <span style="font-size: 18px;">Rs.${toReceiptAmount(receipt.grandTotal)}</span>
            </div>
            
            <div class="flex" style="font-size: 11px; margin-top: 0;">
              <span>${escapeHtml(receipt.paymentType === 'ONLINE' ? 'Online' : receipt.paymentType === 'SPLIT' ? 'Paid' : 'Cash')}: ${toReceiptAmount(receipt.amountPaid)}</span>
              ${receipt.changeToReturn > 0 ? `<span>Change: ${toReceiptAmount(receipt.changeToReturn)}</span>` : ''}
            </div>

            ${receipt.paymentType === 'SPLIT' ? `
            <div class="flex" style="font-size: 10px;">
              <span>Cash:</span>
              <span>${toReceiptAmount(receipt.cashPaid)}</span>
            </div>
            <div class="flex" style="font-size: 10px;">
              <span>Online:</span>
              <span>${toReceiptAmount(receipt.onlinePaid)}</span>
            </div>
            ` : ''}

            ${receipt.balanceDue > 0 ? `
            <div class="flex bold" style="font-size: 11px;">
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
            <div style="height: 14px;"></div>
          </body>
        </html>
      `;

      const tempPath = path.join(app.getPath('temp'), `receipt-${Date.now()}.html`);
      fs.writeFileSync(tempPath, receiptHtml);

      const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        let settled = false;
        let deviceName = '';
        const finish = (payload: { success: boolean; error?: string }) => {
          if (settled) return;
          settled = true;

          try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          } catch (cleanupError: any) {
            log.warn('Receipt temp cleanup failed:', cleanupError.message);
          }

          if (!win.isDestroyed()) win.close();
          resolve(payload);
        };

        win.webContents.once('did-fail-load', (_event, _code, description) => {
          finish({ success: false, error: description || 'Receipt failed to load' });
        });

        win.webContents.once('did-finish-load', () => {
          setTimeout(async () => {
            // --- Helper: save receipt as PDF when no printer is available ---
            const saveAsPdf = async (reason: string) => {
              try {
                const pdfDir = path.join(app.getPath('documents'), 'NoonDairyReceipts');
                if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
                const safeBill = String(receipt.billNumber || Date.now()).replace(/[^a-zA-Z0-9-_]/g, '-');
                const pdfPath = path.join(pdfDir, `receipt-${safeBill}.pdf`);
                const pdfData = await win.webContents.printToPDF({ printBackground: true });
                fs.writeFileSync(pdfPath, pdfData);
                shell.openPath(pdfDir);
                log.info(`No printer (${reason}) — receipt saved as PDF: ${pdfPath}`);
                finish({ success: true, error: undefined });
              } catch (pdfErr: any) {
                finish({ success: false, error: `${reason}. PDF fallback also failed: ${pdfErr.message}` });
              }
            };

            try {
              const printers = await win.webContents.getPrintersAsync();
              if (printers.length === 0) {
                await saveAsPdf('No printer installed');
                return;
              }

              if (receiptSettings.printerName) {
                const selectedPrinter = printers.find((printer) => printer.name === receiptSettings.printerName);
                if (!selectedPrinter) {
                  await saveAsPdf(`Selected printer "${receiptSettings.printerName}" is not available`);
                  return;
                }
                deviceName = selectedPrinter.name;
              }
            } catch (error: any) {
              finish({ success: false, error: error.message || 'Could not check printer status' });
              return;
            }

            win.webContents.print({
              silent: true,
              deviceName,
              printBackground: true,
              margins: { marginType: 'none' }
            }, async (success, errorType) => {
              if (!success) {
                log.error('Print failed:', errorType);
                // Printer rejected — try PDF fallback
                await saveAsPdf(errorType || 'Printer rejected the receipt');
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
    } catch (e: any) {
      log.error('Thermal print failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('printer:printStatement', async (_event, statementData) => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].webContents.executeJavaScript('window.print();');
    }
    return { success: true };
  });
}
