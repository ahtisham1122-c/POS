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

const CODE39_PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', A: 'wnnnnwnnw', B: 'nnwnnwnnw',
  C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn',
  G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww',
  O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn',
  S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw',
  W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn'
};

function normalizeBarcodeValue(value: unknown) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z\-. $/+%]/g, '');
}

function renderCode39Svg(value: unknown) {
  const clean = normalizeBarcodeValue(value);
  if (!clean) return '';
  const encoded = `*${clean}*`;
  const narrow = 1;
  const wide = 2.4;
  const gap = 1;
  const height = 24;
  let x = 0;
  const rects: string[] = [];

  for (const char of encoded) {
    const pattern = CODE39_PATTERNS[char];
    if (!pattern) continue;
    for (let i = 0; i < pattern.length; i++) {
      const width = pattern[i] === 'w' ? wide : narrow;
      if (i % 2 === 0) {
        rects.push(`<rect x="${x.toFixed(1)}" y="0" width="${width.toFixed(1)}" height="${height}" fill="#000"/>`);
      }
      x += width;
    }
    x += gap;
  }

  return `
    <svg class="barcode-svg" viewBox="0 0 ${Math.ceil(x)} ${height}" preserveAspectRatio="none" aria-label="${escapeHtml(clean)}">
      ${rects.join('')}
    </svg>
  `;
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
    // KHATA leg of a split sale (e.g. customer paid Rs.50 cash + Rs.100 to khata).
    // Without this we couldn't show the credit portion on the receipt.
    const khataPaid = splitPayments
      .filter((payment: any) => payment.method === 'KHATA' || payment.method === 'CREDIT')
      .reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0);

    return {
      billNumber: sale.bill_number,
      tokenNumber: sale.token_number,
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
      khataPaid,
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
    printerName: settings.printerName || settings.printer_name || '',
    paperWidth: settings.paperWidth || settings.paper_width || '80mm'
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
      const printerName = String(receiptData?.printerName || receiptSettings.printerName || '').trim();
      const paperWidth = String(receiptData?.paperWidth || receiptSettings.paperWidth || '80mm').trim() === '58mm' ? '58mm' : '80mm';
      const receiptWidthPx = paperWidth === '58mm' ? 210 : 250;
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

      // Build a clear, customer-readable payment line. Owner asked for the
      // payment method to appear on every receipt so customers (and the
      // cashier reconciling at end-of-shift) can see at a glance whether the
      // bill was paid in cash, online, on khata, or split between them.
      // We map the DB enum (CASH | ONLINE | CREDIT | SPLIT) onto the
      // shop's local terminology: CREDIT prints as KHATA.
      const rawPaymentType = String(receipt.paymentType || '').toUpperCase();
      // For SPLIT receipts the per-method totals can come either pre-computed
      // from POS.tsx (cashPaid/onlinePaid) or from a raw splitPayments array.
      // Sum from the array as a fallback so KHATA splits print correctly even
      // when the caller didn't pre-compute khataPaid.
      const splitArr = Array.isArray((receipt as any).splitPayments)
        ? (receipt as any).splitPayments
        : [];
      const sumSplit = (method: string) => splitArr
        .filter((p: any) => String(p?.method || '').toUpperCase() === method)
        .reduce((sum: number, p: any) => sum + Number(p?.amount || 0), 0);
      const cashPaidAmt = Number(receipt.cashPaid || sumSplit('CASH') || 0);
      const onlinePaidAmt = Number(receipt.onlinePaid || sumSplit('ONLINE') || 0);
      const khataPaidAmt = Number((receipt as any).khataPaid || sumSplit('KHATA') || sumSplit('CREDIT') || 0);
      let paymentLabel = '';
      let paymentBreakdown = '';
      if (rawPaymentType === 'CASH') {
        paymentLabel = 'PAID: CASH';
      } else if (rawPaymentType === 'ONLINE') {
        paymentLabel = 'PAID: ONLINE';
      } else if (rawPaymentType === 'CREDIT' || rawPaymentType === 'KHATA') {
        paymentLabel = 'PAID: KHATA';
      } else if (rawPaymentType === 'SPLIT') {
        paymentLabel = 'PAID: SPLIT';
        const parts: string[] = [];
        if (cashPaidAmt > 0) parts.push(`CASH Rs.${toReceiptAmount(cashPaidAmt)}`);
        if (onlinePaidAmt > 0) parts.push(`ONLINE Rs.${toReceiptAmount(onlinePaidAmt)}`);
        if (khataPaidAmt > 0) parts.push(`KHATA Rs.${toReceiptAmount(khataPaidAmt)}`);
        paymentBreakdown = parts.join(' + ');
      } else {
        paymentLabel = `PAID: ${rawPaymentType || 'CASH'}`;
      }
      const tokenLine = receipt.tokenNumber
        ? `<div class="center token-line">TOKEN ${escapeHtml(receipt.tokenNumber)}</div>`
        : '';
      const barcodeSvg = renderCode39Svg(receipt.billNumber);
      const barcodeBlock = barcodeSvg
        ? `
          <div class="barcode-wrap">
            ${barcodeSvg}
            <div class="barcode-label">SCAN FOR RETURN / AUDIT</div>
          </div>
        `
        : '';

      // Minimal receipt: logo, bill+date, items (name + amount only), TOTAL.
      // Owner asked to remove shop name, phone, ITEM COUNTER box, subtotal/
      // discount/tax/payment/change/due lines for maximum paper savings.
      // Keep fonts bold but compact so busy days use less receipt paper.
      const receiptHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              * { box-sizing: border-box; }
              body {
                width: ${receiptWidthPx}px;
                margin: 0;
                padding: 0;
                background-color: white;
                color: black !important;
                font-family: 'Arial Black', 'Arial', sans-serif;
                font-size: 12px;
                line-height: 1;
                font-weight: 900;
              }
              .center { text-align: center; }
              .token-line { font-size: 24px; font-weight: 900; line-height: 0.95; margin-bottom: 1px; }
              .hr { border-bottom: 1px solid black; margin: 1px 0; }
              .flex { display: flex; justify-content: space-between; align-items: baseline; }
              .meta { font-size: 10px; line-height: 1; margin: 0; }
              .item-row { margin: 0 0 1px; width: 100%; }
              .item-name { font-size: 14px; font-weight: 900; text-transform: uppercase; flex-shrink: 0; }
              .item-amount { font-size: 14px; font-weight: 900; flex-shrink: 0; }
              .leader { flex-grow: 1; border-bottom: 1px dotted black; margin: 0 3px; position: relative; top: -4px; }
              .total-row { margin-top: 2px; border-top: 2px double black; padding-top: 2px; }
              .total-label { font-size: 16px; font-weight: 900; }
              .total-amount { font-size: 19px; font-weight: 900; }
              .payment-label { text-align: center; font-size: 12px; font-weight: 900; margin: 1px 0; letter-spacing: 0.3px; }
              .payment-breakdown { text-align: center; font-size: 10px; font-weight: 900; margin: 0 0 1px; }
              .barcode-wrap { margin: 2px 0 0; text-align: center; }
              .barcode-svg { display: block; width: 72%; height: 18px; margin: 0 auto; }
              .barcode-label { font-family: Arial, sans-serif; font-size: 7px; line-height: 1; margin-top: 1px; font-weight: 900; letter-spacing: 0.2px; }
            </style>
          </head>
          <body>
            ${tokenLine}
            <div class="flex meta">
              <span>Bill: ${escapeHtml(receipt.billNumber)}</span>
              <span>${escapeHtml(dateStr)}${dateStr && timeStr ? ' ' : ''}${escapeHtml(timeStr)}</span>
            </div>

            <div class="hr"></div>

            <div class="payment-label">${escapeHtml(paymentLabel)}</div>
            ${paymentBreakdown ? `<div class="payment-breakdown">${escapeHtml(paymentBreakdown)}</div>` : ''}

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

            ${barcodeBlock}

            <div style="height: 2px;"></div>
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
                log.info(`No printer (${reason}) - receipt saved as PDF: ${pdfPath}`);
                finish({ success: false, error: `${reason}. Receipt saved as PDF: ${pdfPath}` });
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

              if (printerName) {
                const selectedPrinter = printers.find((printer) => printer.name === printerName);
                if (!selectedPrinter) {
                  finish({ success: false, error: `Selected printer "${printerName}" is not available. Install/select the BC-105 Windows printer driver in Settings.` });
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
