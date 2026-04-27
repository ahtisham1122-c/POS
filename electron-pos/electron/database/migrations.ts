import db from './db';
import log from '../utils/logger';

export function runMigrations() {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)`);
    
    const versionRecord = db.prepare(`SELECT MAX(version) as v FROM schema_migrations`).get() as any;
    const currentVersion = versionRecord?.v || 0;

    const migrations = [
      {
        version: 1,
        up: () => {
          log.info('Running migration v1: Initial Schema constraints');
          // Phase 1 schema already initialized via schema.ts. We tag it as version 1.
        }
      },
      {
        version: 2,
        up: () => {
          log.info('Running migration v2: Adding Advanced Settings');
          db.exec(`CREATE TABLE IF NOT EXISTS advanced_settings (id TEXT PRIMARY KEY, config TEXT)`);
        }
      },
      {
        version: 3,
        up: () => {
          log.info('Running migration v3: Adding receipt audit');
          db.exec(`
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

            CREATE INDEX IF NOT EXISTS idx_receipt_audit_date ON receipt_audit_sessions(audit_date);
          `);
        }
      },
      {
        version: 4,
        up: () => {
          log.info('Running migration v4: Adding shift management');
          db.exec(`
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

            CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(shift_date);
            CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
          `);
        }
      },
      {
        version: 5,
        up: () => {
          log.info('Running migration v5: Adding dairy supplier and milk collection management');
          db.exec(`
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

            CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(is_active);
            CREATE INDEX IF NOT EXISTS idx_milk_collections_date ON milk_collections(collection_date);
            CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier ON supplier_ledger_entries(supplier_id);
          `);
        }
      },
      {
        version: 6,
        up: () => {
          log.info('Running migration v6: Adding sale void audit trail');
          db.exec(`
            CREATE TABLE IF NOT EXISTS sale_voids (
              id TEXT PRIMARY KEY,
              sale_id TEXT NOT NULL UNIQUE,
              bill_number TEXT NOT NULL,
              voided_by_id TEXT NOT NULL,
              voided_at TEXT NOT NULL,
              reason TEXT NOT NULL,
              cash_reversed REAL DEFAULT 0,
              credit_reversed REAL DEFAULT 0,
              restocked_items INTEGER DEFAULT 1,
              created_at TEXT NOT NULL,
              synced INTEGER DEFAULT 0,
              FOREIGN KEY (sale_id) REFERENCES sales(id)
            );

            CREATE INDEX IF NOT EXISTS idx_sale_voids_sale ON sale_voids(sale_id);
            CREATE INDEX IF NOT EXISTS idx_sale_voids_date ON sale_voids(voided_at);
          `);
        }
      },
      {
        version: 7,
        up: () => {
          log.info('Running migration v7: Adding split payment audit rows');
          db.exec(`
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

            CREATE INDEX IF NOT EXISTS idx_split_payments_sale ON split_payments(sale_id);
          `);
        }
      },
      {
        version: 8,
        up: () => {
          log.info('Running migration v8: Adding item-level discounts');
          const columns = db.prepare(`PRAGMA table_info(sale_items)`).all() as Array<{ name: string }>;
          const names = new Set(columns.map((column) => column.name));
          if (!names.has('discount_type')) db.exec(`ALTER TABLE sale_items ADD COLUMN discount_type TEXT DEFAULT 'NONE'`);
          if (!names.has('discount_value')) db.exec(`ALTER TABLE sale_items ADD COLUMN discount_value REAL DEFAULT 0`);
          if (!names.has('discount_amount')) db.exec(`ALTER TABLE sale_items ADD COLUMN discount_amount REAL DEFAULT 0`);
        }
      },
      {
        version: 9,
        up: () => {
          log.info('Running migration v9: Adding tax-aware checkout');
          const productColumns = db.prepare(`PRAGMA table_info(products)`).all() as Array<{ name: string }>;
          const productNames = new Set(productColumns.map((column) => column.name));
          if (!productNames.has('tax_exempt')) db.exec(`ALTER TABLE products ADD COLUMN tax_exempt INTEGER DEFAULT 0`);

          const saleColumns = db.prepare(`PRAGMA table_info(sales)`).all() as Array<{ name: string }>;
          const saleNames = new Set(saleColumns.map((column) => column.name));
          if (!saleNames.has('tax_enabled')) db.exec(`ALTER TABLE sales ADD COLUMN tax_enabled INTEGER DEFAULT 0`);
          if (!saleNames.has('tax_label')) db.exec(`ALTER TABLE sales ADD COLUMN tax_label TEXT DEFAULT 'Tax'`);
          if (!saleNames.has('tax_rate')) db.exec(`ALTER TABLE sales ADD COLUMN tax_rate REAL DEFAULT 0`);
          if (!saleNames.has('taxable_amount')) db.exec(`ALTER TABLE sales ADD COLUMN taxable_amount REAL DEFAULT 0`);
          if (!saleNames.has('tax_amount')) db.exec(`ALTER TABLE sales ADD COLUMN tax_amount REAL DEFAULT 0`);

          const now = new Date().toISOString();
          const insertSetting = db.prepare(`
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO NOTHING
          `);
          insertSetting.run('taxEnabled', 'false', now);
          insertSetting.run('taxLabel', 'GST', now);
          insertSetting.run('taxRate', '0', now);
        }
      },
      {
        version: 10,
        up: () => {
          log.info('Running migration v10: Adding duplicate sale protection and cash tender records');
          const saleColumns = db.prepare(`PRAGMA table_info(sales)`).all() as Array<{ name: string }>;
          const saleNames = new Set(saleColumns.map((column) => column.name));
          if (!saleNames.has('transaction_id')) db.exec(`ALTER TABLE sales ADD COLUMN transaction_id TEXT`);
          if (!saleNames.has('cash_tendered')) db.exec(`ALTER TABLE sales ADD COLUMN cash_tendered REAL DEFAULT 0`);
          if (!saleNames.has('change_returned')) db.exec(`ALTER TABLE sales ADD COLUMN change_returned REAL DEFAULT 0`);

          db.exec(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_transaction_id
            ON sales(transaction_id)
            WHERE transaction_id IS NOT NULL
          `);
        }
      },
      {
        version: 11,
        up: () => {
          log.info('Running migration v11: Adding manager PIN support');
          const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
          const userNames = new Set(userColumns.map((column) => column.name));
          if (!userNames.has('manager_pin_hash')) db.exec(`ALTER TABLE users ADD COLUMN manager_pin_hash TEXT`);

          const now = new Date().toISOString();
          db.prepare(`
            INSERT INTO settings (key, value, updated_at)
            VALUES ('discountApprovalLimit', '100', ?)
            ON CONFLICT(key) DO NOTHING
          `).run(now);
        }
      },
      {
        version: 12,
        up: () => {
          log.info('Running migration v12: Adding permanent audit logs');
          db.exec(`
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
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);
          `);
        }
      },
      {
        version: 13,
        up: () => {
          log.info('Running migration v13: Adding tamper-evident audit log hashes');
          const auditColumns = db.prepare(`PRAGMA table_info(audit_logs)`).all() as Array<{ name: string }>;
          const auditNames = new Set(auditColumns.map((column) => column.name));
          if (!auditNames.has('previous_hash')) db.exec(`ALTER TABLE audit_logs ADD COLUMN previous_hash TEXT`);
          if (!auditNames.has('entry_hash')) db.exec(`ALTER TABLE audit_logs ADD COLUMN entry_hash TEXT`);
        }
      }
    ];

    for (const m of migrations) {
      if (m.version > currentVersion) {
        log.info(`Applying migration: ${m.version}`);
        db.transaction(() => {
          m.up();
          db.prepare(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(m.version, new Date().toISOString());
        })();
      }
    }
    
    log.info('Database migrations verified successfully.');
  } catch (err: any) {
    log.error('Migration failed:', err.message);
    throw err;
  }
}
