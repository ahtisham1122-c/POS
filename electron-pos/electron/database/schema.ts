import db from './db';
import bcrypt from 'bcryptjs';

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  manager_pin_hash TEXT,
  role TEXT NOT NULL DEFAULT 'CASHIER',
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  selling_price REAL NOT NULL,
  cost_price REAL NOT NULL,
  stock REAL NOT NULL DEFAULT 0,
  low_stock_threshold REAL DEFAULT 5,
  tax_exempt INTEGER DEFAULT 0,
  emoji TEXT DEFAULT 'PKG',
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_rates (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  milk_rate REAL NOT NULL,
  yogurt_rate REAL NOT NULL,
  updated_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  card_number TEXT UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  credit_limit REAL DEFAULT 0,
  current_balance REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  transaction_id TEXT UNIQUE,
  shift_id TEXT,
  bill_number TEXT UNIQUE NOT NULL,
  sale_date TEXT NOT NULL,
  customer_id TEXT,
  cashier_id TEXT NOT NULL,
  payment_type TEXT NOT NULL,
  subtotal REAL NOT NULL,
  discount_type TEXT DEFAULT 'NONE',
  discount_value REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  tax_enabled INTEGER DEFAULT 0,
  tax_label TEXT DEFAULT 'Tax',
  tax_rate REAL DEFAULT 0,
  taxable_amount REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  grand_total REAL NOT NULL,
  amount_paid REAL NOT NULL,
  cash_tendered REAL DEFAULT 0,
  change_returned REAL DEFAULT 0,
  balance_due REAL DEFAULT 0,
  status TEXT DEFAULT 'COMPLETED',
  notes TEXT,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  FOREIGN KEY (shift_id) REFERENCES shifts(id)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  cost_price REAL NOT NULL,
  discount_type TEXT DEFAULT 'NONE',
  discount_value REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  line_total REAL NOT NULL,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  FOREIGN KEY (sale_id) REFERENCES sales(id)
);

CREATE TABLE IF NOT EXISTS sale_voids (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL UNIQUE,
  shift_id TEXT,
  bill_number TEXT NOT NULL,
  voided_by_id TEXT NOT NULL,
  voided_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  cash_reversed REAL DEFAULT 0,
  credit_reversed REAL DEFAULT 0,
  restocked_items INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (shift_id) REFERENCES shifts(id)
);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  return_number TEXT UNIQUE NOT NULL,
  sale_id TEXT NOT NULL,
  shift_id TEXT,
  bill_number TEXT NOT NULL,
  customer_id TEXT,
  cashier_id TEXT NOT NULL,
  return_date TEXT NOT NULL,
  refund_method TEXT NOT NULL,
  refund_amount REAL NOT NULL,
  reason TEXT NOT NULL,
  restock_items INTEGER DEFAULT 1,
  status TEXT DEFAULT 'COMPLETED',
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (shift_id) REFERENCES shifts(id)
);

CREATE TABLE IF NOT EXISTS return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL,
  sale_item_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  FOREIGN KEY (return_id) REFERENCES returns(id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  sale_id TEXT,
  payment_id TEXT,
  entry_type TEXT NOT NULL,
  amount REAL NOT NULL,
  balance_after REAL NOT NULL,
  description TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  sale_id TEXT,
  amount REAL NOT NULL,
  payment_date TEXT NOT NULL,
  collected_by_id TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS split_payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  method TEXT NOT NULL,
  amount REAL NOT NULL,
  customer_id TEXT,
  received_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  FOREIGN KEY (sale_id) REFERENCES sales(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_transaction_id
ON sales(transaction_id)
WHERE transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  quantity REAL NOT NULL,
  stock_before REAL NOT NULL,
  stock_after REAL NOT NULL,
  reference_id TEXT,
  supplier TEXT,
  notes TEXT,
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  allowed_shifts TEXT NOT NULL DEFAULT 'BOTH',
  default_rate REAL DEFAULT 0,
  current_balance REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS milk_collections (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  shift TEXT NOT NULL,
  quantity REAL NOT NULL,
  rate REAL NOT NULL,
  total_amount REAL NOT NULL,
  notes TEXT,
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_date TEXT NOT NULL,
  paid_by_id TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS supplier_ledger_entries (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  collection_id TEXT,
  payment_id TEXT,
  entry_type TEXT NOT NULL,
  amount REAL NOT NULL,
  balance_after REAL NOT NULL,
  description TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  shift_id TEXT,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  FOREIGN KEY (shift_id) REFERENCES shifts(id)
);

CREATE TABLE IF NOT EXISTS cash_register (
  id TEXT PRIMARY KEY,
  shift_id TEXT UNIQUE,
  date TEXT NOT NULL,
  opening_balance REAL DEFAULT 0,
  cash_in REAL DEFAULT 0,
  cash_out REAL DEFAULT 0,
  closing_balance REAL DEFAULT 0,
  is_closed_for_day INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  FOREIGN KEY (shift_id) REFERENCES shifts(id)
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  shift_date TEXT NOT NULL,
  opened_by_id TEXT NOT NULL,
  closed_by_id TEXT,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opening_cash REAL NOT NULL DEFAULT 0,
  expected_cash REAL DEFAULT 0,
  closing_cash REAL DEFAULT 0,
  cash_variance REAL DEFAULT 0,
  receipt_audit_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  notes TEXT,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS receipt_audit_sessions (
  id TEXT PRIMARY KEY,
  audit_date TEXT NOT NULL,
  counted_by_id TEXT NOT NULL,
  expected_count INTEGER NOT NULL,
  expected_amount REAL NOT NULL,
  counted_count INTEGER NOT NULL,
  counted_amount REAL NOT NULL,
  missing_count INTEGER NOT NULL,
  missing_amount REAL NOT NULL,
  extra_count INTEGER NOT NULL,
  duplicate_count INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS receipt_audit_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  bill_number TEXT NOT NULL,
  sale_id TEXT,
  amount REAL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES receipt_audit_sessions(id)
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  attempt_count INTEGER DEFAULT 0,
  last_attempted_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_status ON sync_outbox(status);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_voids_sale ON sale_voids(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_voids_shift ON sale_voids(shift_id);
CREATE INDEX IF NOT EXISTS idx_sale_voids_date ON sale_voids(voided_at);
CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_returns_shift ON returns(shift_id);
CREATE INDEX IF NOT EXISTS idx_returns_date ON returns(return_date);
CREATE INDEX IF NOT EXISTS idx_receipt_audit_date ON receipt_audit_sessions(audit_date);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_cash_register_shift ON cash_register(shift_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_date ON cash_register(date);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(is_active);
CREATE INDEX IF NOT EXISTS idx_milk_collections_date ON milk_collections(collection_date);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier ON supplier_ledger_entries(supplier_id);
CREATE INDEX IF NOT EXISTS idx_ledger_customer ON ledger_entries(customer_id);
CREATE INDEX IF NOT EXISTS idx_split_payments_sale ON split_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_stock_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_expenses_shift ON expenses(shift_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_change_history (
  id TEXT PRIMARY KEY,
  changed_at TEXT NOT NULL,
  milk_rate_old REAL,
  milk_rate_new REAL NOT NULL,
  yogurt_rate_old REAL,
  yogurt_rate_new REAL NOT NULL,
  changed_by_id TEXT NOT NULL,
  changed_by_name TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_change_history_date ON rate_change_history(changed_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  actor_user_id TEXT,
  actor_name TEXT,
  approved_by_id TEXT,
  approved_by_name TEXT,
  entity_type TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  previous_hash TEXT,
  entry_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);

CREATE TABLE IF NOT EXISTS held_sales (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  customer_name TEXT,
  payment_type TEXT NOT NULL,
  subtotal REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS held_sale_items (
  id TEXT PRIMARY KEY,
  held_sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (held_sale_id) REFERENCES held_sales(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bill_counter (
  id INTEGER PRIMARY KEY,
  last_number INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO bill_counter (id, last_number) VALUES (1, 0);
`;

function tableExists(tableName: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as any;
  return Boolean(row);
}

function columnExists(tableName: string, columnName: string) {
  if (!tableExists(tableName)) return false;
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function addColumnIfMissing(tableName: string, columnName: string, definition: string) {
  if (!tableExists(tableName) || columnExists(tableName, columnName)) return;
  db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
}

function prepareLegacyTablesForSchemaIndexes() {
  addColumnIfMissing('sales', 'shift_id', 'TEXT');
  addColumnIfMissing('sale_voids', 'shift_id', 'TEXT');
  addColumnIfMissing('returns', 'shift_id', 'TEXT');
  addColumnIfMissing('cash_register', 'shift_id', 'TEXT');
  addColumnIfMissing('expenses', 'shift_id', 'TEXT');
}

export function initializeDatabase() {
  prepareLegacyTablesForSchemaIndexes();
  db.exec(schema);
  console.log('Database schema initialized.');

  // Seed default admin user if none exists
  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
  if (userCount === 0) {
    console.log('Seeding default admin user...');
    const now = new Date().toISOString();
    // Default PIN: 1234
    db.prepare(`
      INSERT INTO users (id, name, username, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run('admin-id', 'Administrator', 'admin', '1234', 'ADMIN', now, now);
  }

  const defaultAdmin = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get('admin') as any;
  if (defaultAdmin?.password_hash === '1234') {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(bcrypt.hashSync('1234', 12), new Date().toISOString(), defaultAdmin.id);
  }

  // Seed default settings
  const settingsCount = (db.prepare('SELECT COUNT(*) as count FROM settings').get() as any).count;
  if (settingsCount === 0) {
    console.log('Seeding default settings...');
    const now = new Date().toISOString();
    const defaultSettings = [
      ['shop_name', 'Gujjar Milk Shop'],
      ['shop_address', 'Main Market, Faisalabad'],
      ['shop_phone', '0300-1234567'],
      ['milk_rate', '180'],
      ['yogurt_rate', '220'],
      ['currency', 'Rs.'],
      ['taxEnabled', 'false'],
      ['taxLabel', 'GST'],
      ['taxRate', '0'],
      ['discountApprovalLimit', '100'],
      ['shopDayStartHour', '5'],
      ['ramadan24Hour', 'false'],
      ['24_hour_mode', 'false'],
      ['setup_completed', 'false']
    ];
    const insertSetting = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)");
    defaultSettings.forEach(([key, val]) => insertSetting.run(key, val, now));
  }

  const ensureSetting = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  const nowForSettings = new Date().toISOString();
  ensureSetting.run('shopDayStartHour', '5', nowForSettings);
  ensureSetting.run('ramadan24Hour', 'false', nowForSettings);
  ensureSetting.run('24_hour_mode', 'false', nowForSettings);
  // Existing installs that already have settings get setup marked complete automatically
  const existingAdmin = db.prepare("SELECT id FROM users WHERE username = 'admin' AND password_hash != '1234'").get();
  ensureSetting.run('setup_completed', existingAdmin ? 'true' : 'false', nowForSettings);
  const defaultApiUrl = process.env.APP_API_URL || 'http://localhost:3001/api';
  const defaultSyncSecret = process.env.SYNC_DEVICE_SECRET || 'noon-dairy-local-sync-secret-change-me';
  ensureSetting.run('APP_API_URL', defaultApiUrl, nowForSettings);
  ensureSetting.run('SYNC_DEVICE_SECRET', defaultSyncSecret, nowForSettings);

  // Older builds accidentally seeded a Supabase REST URL and anon key here.
  // The desktop app should sync through the NestJS backend instead.
  const apiUrlSetting = db.prepare("SELECT value FROM settings WHERE key = 'APP_API_URL'").get() as any;
  if (String(apiUrlSetting?.value || '').includes('supabase.co/rest/v1')) {
    db.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'APP_API_URL'")
      .run(defaultApiUrl, nowForSettings);
    db.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'SYNC_DEVICE_SECRET'")
      .run(defaultSyncSecret, nowForSettings);
  }

  // Seed default categories/products
  const productCount = (db.prepare('SELECT COUNT(*) as count FROM products').get() as any).count;
  if (productCount === 0) {
    console.log('Seeding default products...');
    const now = new Date().toISOString();
    const seedProducts = [
      { id: 'p1', code: 'MILK', name: 'Fresh Milk', category: 'Dairy', unit: 'kg', selling_price: 180, cost_price: 160, stock: 0, emoji: '🥛' },
      { id: 'p2', code: 'YOGT', name: 'Fresh Yogurt', category: 'Dairy', unit: 'kg', selling_price: 220, cost_price: 190, stock: 0, emoji: '🫙' },
      { id: 'p3', code: 'GHEE', name: 'Desi Ghee', category: 'Dairy', unit: 'kg', selling_price: 1600, cost_price: 1400, stock: 10, emoji: '🧈' },
      { id: 'p4', code: 'BUTR', name: 'Butter', category: 'Dairy', unit: 'kg', selling_price: 1200, cost_price: 1000, stock: 15, emoji: '🧀' },
      { id: 'p5', code: 'BRED', name: 'Bread', category: 'Bakery', unit: 'unit', selling_price: 120, cost_price: 100, stock: 20, emoji: '🍞' },
    ];
    
    seedProducts.forEach((product: any) => {
      if (['MILK', 'YOGT', 'GHEE', 'BUTR'].includes(product.code)) {
        product.tax_exempt = 1;
      }
    });

    const insertProduct = db.prepare(`
      INSERT INTO products (id, code, name, category, unit, selling_price, cost_price, stock, tax_exempt, emoji, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    seedProducts.forEach((p: any) => insertProduct.run(p.id, p.code, p.name, p.category, p.unit, p.selling_price, p.cost_price, p.stock, p.tax_exempt || 0, p.emoji, now, now));
  }

  // Ensure daily rates exist for today
  const today = new Date().toISOString().split('T')[0];
  const rateExists = db.prepare('SELECT COUNT(*) as count FROM daily_rates WHERE date = ?').get(today) as any;
  if (rateExists.count === 0) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO daily_rates (id, date, milk_rate, yogurt_rate, updated_by_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID ? crypto.randomUUID() : 'initial-rate', today, 180, 220, 'admin-id', now);
  }
}

