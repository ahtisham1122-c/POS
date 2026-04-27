import { BrowserWindow } from 'electron';
import db from '../database/db';
import { networkMonitor } from './networkMonitor';
import { getDeviceInfo } from './deviceInfo';
import { fetchWithTimeout, getApiBaseUrl, getSyncHeaders } from './apiConfig';

export async function pullSync(mainWindow?: BrowserWindow) {
  if (!networkMonitor.isOnline) return;

  try {
    const { deviceId } = getDeviceInfo();
    const apiUrl = getApiBaseUrl();
    const syncHeaders = getSyncHeaders(deviceId);
    if (!syncHeaders) return;

    // Get last pull timestamp
    const lastPullRecord = db.prepare(`SELECT value FROM settings WHERE key = 'last_pull_timestamp'`).get() as any;
    const since = lastPullRecord ? lastPullRecord.value : new Date(0).toISOString();

    const isSupabase = apiUrl.includes('supabase.co');
    const supabaseKeySetting = db.prepare("SELECT value FROM settings WHERE key = 'SYNC_DEVICE_SECRET'").get() as any;
    const actualSupabaseKey = supabaseKeySetting?.value || process.env.SYNC_DEVICE_SECRET;

    let products: any[] = [];
    let customers: any[] = [];
    let dailyRates: any[] = [];
    let settings: any[] = [];

    if (isSupabase && actualSupabaseKey) {
      let baseRestUrl = apiUrl;
      if (!baseRestUrl.includes('/rest/v1')) {
        baseRestUrl = `${baseRestUrl.replace(/\/$/, '')}/rest/v1`;
      }

      const headers = {
        'apikey': actualSupabaseKey,
        'Authorization': `Bearer ${actualSupabaseKey}`
      };

      try {
        const prodRes = await fetchWithTimeout(`${baseRestUrl}/products?updated_at=gt.${since}`, { headers }, 15000);
        if (prodRes.ok) products = (await prodRes.json()) as any[];
      } catch (e) { console.error('Supabase pull products failed:', e); }

      try {
        const custRes = await fetchWithTimeout(`${baseRestUrl}/customers?updated_at=gt.${since}`, { headers }, 15000);
        if (custRes.ok) customers = (await custRes.json()) as any[];
      } catch (e) { console.error('Supabase pull customers failed:', e); }

      try {
        const rateRes = await fetchWithTimeout(`${baseRestUrl}/daily_rates`, { headers }, 15000);
        if (rateRes.ok) dailyRates = (await rateRes.json()) as any[];
      } catch (e) { console.error('Supabase pull daily rates failed:', e); }

      try {
        const setRes = await fetchWithTimeout(`${baseRestUrl}/settings?updated_at=gt.${since}`, { headers }, 15000);
        if (setRes.ok) settings = (await setRes.json()) as any[];
      } catch (e) { console.error('Supabase pull settings failed:', e); }

    } else {
      const response = await fetchWithTimeout(`${apiUrl}/sync/pull?deviceId=${deviceId}&since=${since}`, {
        headers: syncHeaders
      }, 15000);
      
      if (!response.ok) {
        throw new Error(`Pull failed with standard status ${response.status}`);
      }

      const parsed: any = await response.json();
      const payload = parsed?.success ? parsed.data : parsed;
      products = payload?.products || [];
      customers = payload?.customers || [];
      dailyRates = payload?.dailyRates || [];
      settings = payload?.settings || [];
    }
    
    let hasUpdates = false;

    db.transaction(() => {
      // 1. Upsert Products
      const upsertProduct = db.prepare(`
        INSERT INTO products (id, code, name, category, unit, selling_price, cost_price, stock, low_stock_threshold, tax_exempt, emoji, is_active, created_at, updated_at, synced)
        VALUES (@id, @code, @name, @category, @unit, @sellingPrice, @costPrice, @stock, @lowStockThreshold, @taxExempt, @emoji, @isActive, @createdAt, @updatedAt, 1)
        ON CONFLICT(id) DO UPDATE SET
          name = @name, category = @category, unit = @unit, selling_price = @sellingPrice, cost_price = @costPrice,
          low_stock_threshold = @lowStockThreshold, tax_exempt = @taxExempt, emoji = @emoji, is_active = @isActive, updated_at = @updatedAt, synced = 1
        WHERE @updatedAt > products.updated_at
      `);

      for (const p of products) {
        upsertProduct.run({
          id: p.id, code: p.code, name: p.name, category: p.category, unit: p.unit, 
          sellingPrice: p.sellingPrice ?? p.selling_price,
          costPrice: p.costPrice ?? p.cost_price, 
          stock: p.stock, 
          lowStockThreshold: p.lowStockThreshold ?? p.low_stock_threshold, 
          taxExempt: (p.taxExempt ?? p.tax_exempt) ? 1 : 0, 
          emoji: p.emoji, 
          isActive: (p.isActive ?? p.is_active) ? 1 : 0, 
          createdAt: p.createdAt ?? p.created_at, 
          updatedAt: p.updatedAt ?? p.updated_at
        });
        hasUpdates = true;
      }

      // 2. Upsert Customers
      const upsertCustomer = db.prepare(`
        INSERT INTO customers (id, code, card_number, name, phone, address, credit_limit, current_balance, is_active, created_at, updated_at, synced)
        VALUES (@id, @code, @cardNumber, @name, @phone, @address, @creditLimit, @currentBalance, @isActive, @createdAt, @updatedAt, 1)
        ON CONFLICT(id) DO UPDATE SET
          name = @name, phone = @phone, address = @address, credit_limit = @creditLimit, current_balance = @currentBalance,
          is_active = @isActive, updated_at = @updatedAt, synced = 1
        WHERE @updatedAt > customers.updated_at
      `);

      for (const c of customers) {
        upsertCustomer.run({
          id: c.id, code: c.code, 
          cardNumber: c.cardNumber ?? c.card_number, 
          name: c.name, phone: c.phone, address: c.address,
          creditLimit: c.creditLimit ?? c.credit_limit, 
          currentBalance: c.currentBalance ?? c.current_balance, 
          isActive: (c.isActive ?? c.is_active) ? 1 : 0,
          createdAt: c.createdAt ?? c.created_at, 
          updatedAt: c.updatedAt ?? c.updated_at
        });
        hasUpdates = true;
      }

      // 3. Upsert Daily Rates
      const upsertRate = db.prepare(`
        INSERT INTO daily_rates (id, date, milk_rate, yogurt_rate, updated_by_id, created_at, synced)
        VALUES (@id, @date, @milkRate, @yogurtRate, @updatedById, @createdAt, 1)
        ON CONFLICT(date) DO UPDATE SET
          milk_rate = @milkRate, yogurt_rate = @yogurtRate, updated_by_id = @updatedById, synced = 1
      `); // No updated_at in daily_rates schema, overwrite if fetched
      
      for (const r of dailyRates) {
        upsertRate.run({
          id: r.id, date: r.date, 
          milkRate: r.milkRate ?? r.milk_rate, 
          yogurtRate: r.yogurtRate ?? r.yogurt_rate, 
          updatedById: r.updatedById ?? r.updated_by_id, 
          createdAt: r.createdAt ?? r.created_at
        });
        hasUpdates = true;
      }

      const upsertSetting = db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (@key, @value, @updatedAt)
        ON CONFLICT(key) DO UPDATE SET
          value = @value,
          updated_at = @updatedAt
        WHERE @updatedAt > settings.updated_at
      `);

      for (const setting of settings) {
        upsertSetting.run({
          key: setting.key,
          value: setting.value,
          updatedAt: setting.updatedAt || new Date().toISOString()
        });
        hasUpdates = true;
      }

      // Update sync timestamp
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES ('last_pull_timestamp', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
      `).run(now, now, now, now);

    })(); // execute transaction

    if (hasUpdates && mainWindow) {
      mainWindow.webContents.send('sync-pull-complete', { message: 'Cloud updates applied' });
    }

  } catch (err) {
    console.error('Error during pullSync:', err);
  }
}
