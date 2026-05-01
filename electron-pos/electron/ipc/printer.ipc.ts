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

// Read the bundled app icon and return a data URI we can inline in the
// receipt HTML. Inline data URI is the most reliable way to print an image
// on a thermal printer — no external file lookups, no missing-asset issues.
// Cached at module load so we don't re-read on every print.
let cachedLogoDataUri: string | null = null;
function getLogoDataUri(): string {
  if (cachedLogoDataUri !== null) return cachedLogoDataUri;
  try {
    // electron/ipc/printer.ipc.ts → up to electron/ → up to electron-pos/ → assets/
    const candidates = [
      path.join(__dirname, '..', 'assets', 'icon.png'),
      path.join(__dirname, '..', '..', 'assets', 'icon.png'),
      path.join(process.resourcesPath || '', 'assets', 'icon.png'),
      path.join(app.getAppPath(), 'assets', 'icon.png'),
    ];
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        const buf = fs.readFileSync(candidate);
        cachedLogoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
        return cachedLogoDataUri;
      }
    }
  } catch (err: any) {
    log.warn(`Logo load failed (receipt will print without logo): ${err?.message || err}`);
  }
  cachedLogoDataUri = '';
  return cachedLogoDataUri;
}

function getReceiptSettings() {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as Array<{ key: string; value: string }>;
  const settings = rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});

  return {
    shopName: settings.shop_name || 'Gujjar Milk Shop',
    shopPhone: settings.shop_phone || '',
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
      const logoDataUri = getLogoDataUri();
      log.info(`Printing receipt ${receipt.billNumber} via temp file`);

      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        }
      });

      // Format date+time once. Date was previously missing — only time printed.
      const saleDate = new Date(receipt.date);
      const dateStr = isNaN(saleDate.getTime())
        ? ''
        : saleDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const timeStr = isNaN(saleDate.getTime())
        ? ''
        : saleDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Minimal receipt: logo, bill+date, items (name + amount only), TOTAL.
      // Owner asked to remove shop name, phone, ITEM COUNTER box, subtotal/
      // discount/tax/payment/change/due lines for maximum paper savings.
      // Bigger fonts make it readable on a 58/80mm thermal printer at arm's
      // length. Item names are uppercase + bold for unambiguous scanning.
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
                font-size: 14px;
                line-height: 1.05;
                font-weight: 900;
              }
              .center { text-align: center; }
              .hr { border-bottom: 2px solid black; margin: 2px 0; }
              .flex { display: flex; justify-content: space-between; align-items: baseline; }
              .logo { display: block; margin: 0 auto 2px; width: 44px; height: 44px; object-fit: contain; }
              .meta { font-size: 12px; line-height: 1.1; margin: 1px 0; }
              .item-row { margin: 0 0 2px; width: 100%; }
              .item-name { font-size: 16px; font-weight: 900; text-transform: uppercase; flex-shrink: 0; }
              .item-amount { font-size: 16px; font-weight: 900; flex-shrink: 0; }
              .leader { flex-grow: 1; border-bottom: 2px dotted black; margin: 0 4px; position: relative; top: -5px; }
              .total-row { margin-top: 4px; border-top: 3px double black; padding-top: 3px; }
              .total-label { font-size: 18px; font-weight: 900; }
              .total-amount { font-size: 22px; font-weight: 900; }
            </style>
          </head>
          <body>
            ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="" />` : ''}

            <div class="flex meta">
              <span>Bill: ${escapeHtml(receipt.billNumber)}</span>
              <span>${escapeHtml(dateStr)}${dateStr && timeStr ? ' ' : ''}${escapeHtml(timeStr)}</span>
            </div>

            <div class="hr"></div>

            ${(receipt.items || []).map((item: any) => `
              <div class="item-row flex">
                <span class="item-name">${escapeHtml(item.name)}</span>
                <span class="leader"></span>
                <span class="item-amount">${toReceiptAmount(item.lineTotal)}</span>
              </div>
            `).join('')}

            <div class="flex total-row">
              <span class="total-label">TOTAL</span>
              <span class="total-amount">Rs.${toReceiptAmount(receipt.grandTotal)}</span>
            </div>

            <div style="height: 10px;"></div>
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
