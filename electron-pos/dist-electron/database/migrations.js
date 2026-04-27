"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const db_1 = __importDefault(require("./db"));
const logger_1 = __importDefault(require("../utils/logger"));
function runMigrations() {
    try {
        db_1.default.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)`);
        const versionRecord = db_1.default.prepare(`SELECT MAX(version) as v FROM schema_migrations`).get();
        const currentVersion = versionRecord?.v || 0;
        const migrations = [
            {
                version: 1,
                up: () => {
                    logger_1.default.info('Running migration v1: Initial Schema constraints');
                    // Phase 1 schema already initialized via schema.ts. We tag it as version 1.
                }
            },
            {
                version: 2,
                up: () => {
                    logger_1.default.info('Running migration v2: Adding Advanced Settings');
                    db_1.default.exec(`CREATE TABLE IF NOT EXISTS advanced_settings (id TEXT PRIMARY KEY, config TEXT)`);
                }
            },
            {
                version: 3,
                up: () => {
                    logger_1.default.info('Running migration v3: Adding receipt audit');
                    db_1.default.exec(`
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
                    logger_1.default.info('Running migration v4: Adding shift management');
                    db_1.default.exec(`
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
                    logger_1.default.info('Running migration v5: Adding dairy supplier and milk collection management');
                    db_1.default.exec(`
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
                    logger_1.default.info('Running migration v6: Adding sale void audit trail');
                    db_1.default.exec(`
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
                    logger_1.default.info('Running migration v7: Adding split payment audit rows');
                    db_1.default.exec(`
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
                    logger_1.default.info('Running migration v8: Adding item-level discounts');
                    const columns = db_1.default.prepare(`PRAGMA table_info(sale_items)`).all();
                    const names = new Set(columns.map((column) => column.name));
                    if (!names.has('discount_type'))
                        db_1.default.exec(`ALTER TABLE sale_items ADD COLUMN discount_type TEXT DEFAULT 'NONE'`);
                    if (!names.has('discount_value'))
                        db_1.default.exec(`ALTER TABLE sale_items ADD COLUMN discount_value REAL DEFAULT 0`);
                    if (!names.has('discount_amount'))
                        db_1.default.exec(`ALTER TABLE sale_items ADD COLUMN discount_amount REAL DEFAULT 0`);
                }
            },
            {
                version: 9,
                up: () => {
                    logger_1.default.info('Running migration v9: Adding tax-aware checkout');
                    const productColumns = db_1.default.prepare(`PRAGMA table_info(products)`).all();
                    const productNames = new Set(productColumns.map((column) => column.name));
                    if (!productNames.has('tax_exempt'))
                        db_1.default.exec(`ALTER TABLE products ADD COLUMN tax_exempt INTEGER DEFAULT 0`);
                    const saleColumns = db_1.default.prepare(`PRAGMA table_info(sales)`).all();
                    const saleNames = new Set(saleColumns.map((column) => column.name));
                    if (!saleNames.has('tax_enabled'))
                        db_1.default.exec(`ALTER TABLE sales ADD COLUMN tax_enabled INTEGER DEFAULT 0`);
                    if (!saleNames.has('tax_label'))
                        db_1.default.exec(`ALTER TABLE sales ADD COLUMN tax_label TEXT DEFAULT 'Tax'`);
                    if (!saleNames.has('tax_rate'))
                        db_1.default.exec(`ALTER TABLE sales ADD COLUMN tax_rate REAL DEFAULT 0`);
                    if (!saleNames.has('taxable_amount'))
                        db_1.default.exec(`ALTER TABLE sales ADD COLUMN taxable_amount REAL DEFAULT 0`);
                    if (!saleNames.has('tax_amount'))
                        db_1.default.exec(`ALTER TABLE sales ADD COLUMN tax_amount REAL DEFAULT 0`);
                    const now = new Date().toISOString();
                    const insertSetting = db_1.default.prepare(`
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
                    logger_1.default.info('Running migration v10: Adding duplicate sale protection and cash tender records');
                    const saleColumns = db_1.default.prepare(`PRAGMA table_info(sales)`).all();
                    const saleNames = new Set(saleColumns.map((column) => column.name));
                    if (!saleNames.has('transaction_id'))
                        db_1.default.exec(`ALTER TABLE sales ADD COLUMN transaction_id TEXT`);
                    if (!saleNames.has('cash_tendered'))
                        db_1.default.exec(`ALTER TABLE sales ADD COLUMN cash_tendered REAL DEFAULT 0`);
                    if (!saleNames.has('change_returned'))
                        db_1.default.exec(`ALTER TABLE sales ADD COLUMN change_returned REAL DEFAULT 0`);
                    db_1.default.exec(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_transaction_id
            ON sales(transaction_id)
            WHERE transaction_id IS NOT NULL
          `);
                }
            },
            {
                version: 11,
                up: () => {
                    logger_1.default.info('Running migration v11: Adding manager PIN support');
                    const userColumns = db_1.default.prepare(`PRAGMA table_info(users)`).all();
                    const userNames = new Set(userColumns.map((column) => column.name));
                    if (!userNames.has('manager_pin_hash'))
                        db_1.default.exec(`ALTER TABLE users ADD COLUMN manager_pin_hash TEXT`);
                    const now = new Date().toISOString();
                    db_1.default.prepare(`
            INSERT INTO settings (key, value, updated_at)
            VALUES ('discountApprovalLimit', '100', ?)
            ON CONFLICT(key) DO NOTHING
          `).run(now);
                }
            },
            {
                version: 12,
                up: () => {
                    logger_1.default.info('Running migration v12: Adding permanent audit logs');
                    db_1.default.exec(`
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
                    logger_1.default.info('Running migration v13: Adding tamper-evident audit log hashes');
                    const auditColumns = db_1.default.prepare(`PRAGMA table_info(audit_logs)`).all();
                    const auditNames = new Set(auditColumns.map((column) => column.name));
                    if (!auditNames.has('previous_hash'))
                        db_1.default.exec(`ALTER TABLE audit_logs ADD COLUMN previous_hash TEXT`);
                    if (!auditNames.has('entry_hash'))
                        db_1.default.exec(`ALTER TABLE audit_logs ADD COLUMN entry_hash TEXT`);
                }
            },
            {
                version: 14,
                up: () => {
                    logger_1.default.info('Running migration v14: Linking sales and cash drawers to shifts');
                    const saleColumns = db_1.default.prepare(`PRAGMA table_info(sales)`).all();
                    const saleNames = new Set(saleColumns.map((column) => column.name));
                    if (!saleNames.has('shift_id'))
                        db_1.default.exec(`ALTER TABLE sales ADD COLUMN shift_id TEXT`);
                    const returnColumns = db_1.default.prepare(`PRAGMA table_info(returns)`).all();
                    const returnNames = new Set(returnColumns.map((column) => column.name));
                    if (!returnNames.has('shift_id'))
                        db_1.default.exec(`ALTER TABLE returns ADD COLUMN shift_id TEXT`);
                    const voidColumns = db_1.default.prepare(`PRAGMA table_info(sale_voids)`).all();
                    const voidNames = new Set(voidColumns.map((column) => column.name));
                    if (!voidNames.has('shift_id'))
                        db_1.default.exec(`ALTER TABLE sale_voids ADD COLUMN shift_id TEXT`);
                    const expenseColumns = db_1.default.prepare(`PRAGMA table_info(expenses)`).all();
                    const expenseNames = new Set(expenseColumns.map((column) => column.name));
                    if (!expenseNames.has('shift_id'))
                        db_1.default.exec(`ALTER TABLE expenses ADD COLUMN shift_id TEXT`);
                    const cashColumns = db_1.default.prepare(`PRAGMA table_info(cash_register)`).all();
                    const cashNames = new Set(cashColumns.map((column) => column.name));
                    if (!cashNames.has('shift_id'))
                        db_1.default.exec(`ALTER TABLE cash_register ADD COLUMN shift_id TEXT`);
                    db_1.default.exec(`
            CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
            CREATE INDEX IF NOT EXISTS idx_returns_shift ON returns(shift_id);
            CREATE INDEX IF NOT EXISTS idx_sale_voids_shift ON sale_voids(shift_id);
            CREATE INDEX IF NOT EXISTS idx_expenses_shift ON expenses(shift_id);
            CREATE INDEX IF NOT EXISTS idx_cash_register_shift ON cash_register(shift_id);
            CREATE INDEX IF NOT EXISTS idx_cash_register_date ON cash_register(date);
          `);
                    db_1.default.exec(`
            UPDATE sales
            SET shift_id = (
              SELECT s.id
              FROM shifts s
              WHERE s.shift_date = substr(sales.sale_date, 1, 10)
              ORDER BY s.opened_at DESC
              LIMIT 1
            )
            WHERE shift_id IS NULL
          `);
                    db_1.default.exec(`
            UPDATE returns
            SET shift_id = (
              SELECT sales.shift_id
              FROM sales
              WHERE sales.id = returns.sale_id
              LIMIT 1
            )
            WHERE shift_id IS NULL
          `);
                    db_1.default.exec(`
            UPDATE sale_voids
            SET shift_id = (
              SELECT sales.shift_id
              FROM sales
              WHERE sales.id = sale_voids.sale_id
              LIMIT 1
            )
            WHERE shift_id IS NULL
          `);
                    db_1.default.exec(`
            UPDATE cash_register
            SET shift_id = (
              SELECT s.id
              FROM shifts s
              WHERE s.shift_date = cash_register.date
              ORDER BY s.opened_at DESC
              LIMIT 1
            )
            WHERE shift_id IS NULL
          `);
                    const now = new Date().toISOString();
                    const setting = db_1.default.prepare(`
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO NOTHING
          `);
                    setting.run('shopDayStartHour', '5', now);
                    setting.run('ramadan24Hour', 'false', now);
                    setting.run('24_hour_mode', 'false', now);
                }
            }
        ];
        for (const m of migrations) {
            if (m.version > currentVersion) {
                logger_1.default.info(`Applying migration: ${m.version}`);
                db_1.default.transaction(() => {
                    m.up();
                    db_1.default.prepare(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(m.version, new Date().toISOString());
                })();
            }
        }
        logger_1.default.info('Database migrations verified successfully.');
    }
    catch (err) {
        logger_1.default.error('Migration failed:', err.message);
        throw err;
    }
}
