# Noon Dairy POS - Comprehensive Codebase Guide

**Generated:** 2026-04-29  
**Graph Analysis:** 522 nodes, 616 edges, 41 communities  
**Codebase Size:** 105 files, ~61,189 words

---

## 🏗️ Architecture Overview

### Three-Tier System
```
┌─────────────────────────────────────────────────────────────┐
│  ELECTRON DESKTOP APP (Offline-First)                       │
│  ├─ React + Vite Frontend (electron-pos/src)               │
│  ├─ SQLite Local Database (noon-dairy.db)                  │
│  └─ Electron Main Process + IPC                            │
├─────────────────────────────────────────────────────────────┤
│  Cloud Sync Layer (HTTP/JSON)                               │
│  ├─ Device Registration & Auth                             │
│  └─ Sync Secret Guard (X-Sync-Secret header)              │
├─────────────────────────────────────────────────────────────┤
│  NESTJS BACKEND API (localhost:3001/api)                   │
│  ├─ Sync Controller & Service                              │
│  ├─ Business Logic (Sales, Inventory, Customers)          │
│  └─ PostgreSQL Database                                    │
└─────────────────────────────────────────────────────────────┘
```

**Key Principle:** Electron is offline-first. All operations happen locally in SQLite. Sync is asynchronous through outbox table → NestJS backend → PostgreSQL.

---

## 📊 Database Structure (SQLite on Electron)

### Core Tables (18 operational tables)

#### Point of Sale Operations
- **users** - Cashiers & managers (password_hash, manager_pin_hash, role)
- **products** - Inventory items (code, category, selling_price, cost_price, stock)
- **sales** - Completed sales (bill_number, payment_type, discount, tax, grand_total)
- **sale_items** - Line items (product_id, quantity, unit_price, line_total)
- **sale_voids** - Voided sales (requires manager PIN, restocks items)
- **returns** - Customer returns (refund_method, restock_items flag)
- **return_items** - Returned line items

#### Payment & Credit
- **payments** - Customer payment transactions
- **split_payments** - Multi-method payments (cash + online, etc.)
- **ledger_entries** - Customer khata/ledger (tracks credit balance)

#### Inventory & Stock
- **stock_movements** - All stock changes (type: STOCK_IN/OUT, RETURN_IN, VOID_RESTOCK, MILK_COLLECTION, WASTAGE)
- **suppliers** - Milk suppliers
- **milk_collections** - Raw milk purchases from suppliers
- **supplier_payments** - Payments to suppliers
- **supplier_ledger_entries** - Supplier khata

#### Cash & Shifts
- **shifts** - Business day shift (opened_at, closed_at, opening_cash, expected_cash, closing_cash)
- **cash_register** - Daily cash tracking (opening_balance, cash_in, cash_out, closing_balance)
- **expenses** - Daily operational costs (category: ELECTRICITY, FUEL, SALARY, etc.)

#### Daily Rates & Settings
- **daily_rates** - Per-shift milk/yogurt rates (unique per date)
- **rate_change_history** - Audit trail of rate changes
- **settings** - Key-value config (shopDayStartHour, ramadan24Hour, setup_completed, etc.)

#### Audit & Receipts
- **receipt_audit_sessions** - Physical receipt reconciliation (counted_count, missing_count, duplicates)
- **receipt_audit_entries** - Individual receipt status (FOUND, MISSING, DUPLICATE, EXTRA)
- **audit_logs** - Full action audit trail (action_type, actor_user_id, before/after JSON, entry_hash)

#### Hold Sales
- **held_sales** - In-progress sales awaiting checkout
- **held_sale_items** - Items in held sales

#### Sync Coordination
- **sync_outbox** - Pending operations awaiting cloud sync (status: pending/synced/failed)

### Indexes
- **Sales:** date, shift_id, bill_number, payment_type, transaction_id
- **Stock:** product_id, movement_type
- **Dates:** shift_date, cash_date, receipt_audit_date, rate_change_date
- **Ledgers:** customer_id, supplier_id
- **Sync:** outbox status

---

## 🎯 Business Logic Layers

### Layer 1: Shift-Based Business Days

**File:** `electron-pos/electron/database/businessDay.ts`

```
Business Day = Shift-based, NOT calendar-based
├─ Shift opened 5am → operates as one day even across midnight
├─ Sales after midnight (12am-5am) → belong to previous shift
├─ Ramadan/24-hour mode → ignores time boundaries
└─ Reporting/Z-reports → grouped by shift, not calendar date
```

**Key Functions:**
- `getBusinessDate(now)` - Calculate which business day applies (accounting for 5am threshold)
- `getOpenShift()` - Find active shift or null
- `getLateSaleNote()` - Warn if sale created after business day started
- `shouldWarnBeforeOpeningShift()` - Alert if opening shift before 5am

---

### Layer 2: Inventory & Stock (Milk/Yogurt Linked)

**Key Features (Recent commits):**
- **Milk/Yogurt are linked products:**
  - Yogurt production DEDUCTS milk stock automatically
  - Both locked from deletion to prevent data corruption
  - Daily rates (milk_rate, yogurt_rate) affect selling prices
  
- **Stock Movement Tracking:**
  - Types: STOCK_IN, STOCK_OUT, RETURN_IN, VOID_RESTOCK, MILK_COLLECTION, WASTAGE
  - Each movement records before/after quantities
  - Supplier milk collections → auto stock-in
  - Returns/voids → auto restock items

**No barcode scanner:** Products selected by code/name in UI.  
**No multi-device conflicts:** Single counter only.

---

### Layer 3: Payment & Customer Credit

**Supported Payment Types:** CASH, ONLINE, CREDIT, SPLIT

**SPLIT Payments (Recent feature):**
- One sale = multiple split_payment rows
- Example: Rs 500 cash + Rs 300 online = Rs 800 sale
- Each split tracked separately in database

**Customer Khata (Ledger):**
- `ledger_entries` tracks credit/payment history
- Balance calculated: initial credit_limit - ledger balance
- Payments collected → ledger entries updated
- Reports show outstanding credit per customer

---

### Layer 4: Cash Register & Shift Closing

**File:** `electron-pos/electron/database/cashRegister.ts`

**Z-Report (End of Shift):**
1. Collect all sales from shift (via shift_id)
2. Group by payment method (cash, online, credit, split)
3. Calculate expected cash = opening_cash + cash_in - cash_out
4. Count physical cash → compare with expected (variance = closing_cash - expected_cash)
5. Lock shift (status = CLOSED)

**Cash In/Out:**
- Tracked separately (not merged into closing_balance)
- Expense entries → cash_out
- Sales refunds → cash_out
- Manual cash adjustments → cash_in/out entries

---

### Layer 5: Receipt Audit System

**Purpose:** Verify all printed receipts are accounted for.

**Flow:**
1. Cashier manually counts physical receipts
2. Enter bill numbers into audit session
3. System queries sales table for each bill_number
4. Mark as FOUND, MISSING, DUPLICATE, or EXTRA
5. Calculate: missing_count, missing_amount, duplicate_count
6. Audit entries + session saved to database

**Integration:** Shift can be closed only after receipt audit completed.

---

### Layer 6: Discount & Manager Approval

**Types:**
- Whole-sale discount (RS amount or PERCENT)
- Per-item discount (RS or PERCENT per line item)

**Manager PIN Protection:**
- Discount > configured limit → requires manager PIN
- PIN verified via `requireManagerApproval()` IPC
- Audit logged with approver name

**Quick Buttons:** Exact, Rs 500, Rs 1000, Rs 5000 (cash checkout)

---

## 🔄 Cloud Sync Pipeline

### Outbox Pattern (Electron → Backend)

**File:** `electron-pos/electron/sync/syncEngine.ts`

1. **Electron creates record locally** (SQLite)
   - Immediately available for POS use
   - Sets synced=0 in database

2. **Insert sync_outbox entry** (table_name, operation, record_id, payload)
   - Operation: INSERT, UPDATE, DELETE
   - Payload: full record as JSON

3. **SyncEngine processes outbox every 5 seconds**
   - Checks network status (via networkMonitor)
   - Pulls pending outbox rows (status='pending')
   - Implements retry strategy: 1min, 2min, 5min, 15min, 30min, 60min delays
   - Stops processing batch on first error (likely network/server issue)

4. **POST to `/api/sync/ingest`**
   ```json
   {
     "table": "sales",
     "operation": "INSERT",
     "recordId": "...",
     "payload": { sale object },
     "timestamp": "2026-04-29T...",
     "device": { id, name, terminalNumber }
   }
   ```

5. **NestJS Backend receives & normalizes**
   - Converts snake_case → camelCase
   - Normalizes enums: 'RS' → 'FLAT', 'PERCENT' → 'PERCENTAGE'
   - Maps product categories to backend enums
   - Handles SQLite booleans (0/1 → true/false)
   - Creates safe placeholders if references missing

6. **Backend writes to PostgreSQL**
   - Validates payload against Prisma schema
   - Checks duplicate transactionId (prevents duplicate sales)
   - Upserts record if idempotent

7. **Sync status updates** (status='synced')
   - Electron UI shows sync badge (green = all synced, yellow = pending)
   - Stuck outbox warning if > N entries pending

---

### Sync Guards & Authentication

**File:** `noon-dairy-backend/src/sync/sync-secret.guard.ts`

- All `/api/sync/*` routes guarded by `X-Sync-Secret` header
- Secret must match `SYNC_DEVICE_SECRET` in backend .env
- Device registration required first (POST `/api/sync/register-device`)

---

## 🎨 Frontend (React + Vite)

### Main Pages (electron-pos/src/pages)

| Page | Purpose | Key Features |
|------|---------|--------------|
| **POS.tsx** | Main point-of-sale | Quick buttons (Milk, Yogurt), hold/resume, discount, split payment, touch input pad |
| **CashRegister.tsx** | Daily cash tracking | Open register, record cash in/out, Z-report export, close register |
| **Reports.tsx** | Dashboard & exports | Products tab (sales performance), Sales, Stock, Khata, Supplier, Expenses reports |
| **Settings.tsx** | Configuration | User management, rates (with history table), backup/restore, PIN change |
| **Suppliers.tsx** | Supplier mgmt | Add/edit suppliers, milk collections, supplier payments, ledger |
| **ReceiptAudit.tsx** | Receipt verification | Count receipts, mark found/missing/duplicate, reconcile audit |
| **Inventory.tsx** | Stock management | Stock in/out, adjust quantities, view stock levels |
| **Customers.tsx** | Customer khata | Add/edit customers, view ledger, collect payments |
| **Expenses.tsx** | Daily costs | Record expenses (salary, fuel, etc.), categorize |
| **Login.tsx** | Authentication | Username/password, manager PIN display |

### UI Components

- **Modals:** PINModal, CustomerModal, ProductModal, RateModal, PaymentModal
- **Alerts:** Toast notifications (low stock, credit limit, sync warnings)
- **Touch Input Pad:** On-screen keyboard for touchscreen POS terminals
- **Tables:** Scrollable data grids with real/formatted data
- **Status Badges:** Sync status, payment status, stock warnings

### State Management

**CartStore** (Zustand):
- items[] (product_id, quantity, unit_price, discount)
- Derived: subtotal, discountAmount, taxAmount, grandTotal
- Actions: addItem, removeItem, updateQuantity, setItemDiscount, clearCart

---

## 🔧 IPC Handlers (Electron Main ↔ React)

**File:** `electron-pos/electron/ipc/*.ts`

### Critical Handlers

| Handler | Purpose | Protections |
|---------|---------|------------|
| **sales.ipc.ts** | Create/void/reprint sales | Duplicate transactionId check, manager PIN for voids |
| **cash-register.ipc.ts** | Open/close register, record movements | Requires open shift, records opening/closing cash |
| **auth.ipc.ts** | Login, manager PIN verification | Bcrypt hash validation, audit logging |
| **suppliers.ipc.ts** | Milk collections, supplier payments | Creates stock_in movements |
| **inventory.ipc.ts** | Stock in/out, adjustments | Manager PIN for adjustments > limit |
| **products.ipc.ts** | Add/edit products, rates | Milk/yogurt locked from deletion |
| **customers.ipc.ts** | CRUD + ledger queries | Prevents negative balances (soft limit) |
| **exports.ipc.ts** | Generate CSV/Excel reports | Formats data, exports to file |
| **backup.ts** | Database backup/restore | Creates timestamped backups, validates restore integrity |
| **sync.ipc.ts** | Trigger sync, pull status | Manual sync-now button, device registration |

### Manager PIN Approval Pattern

```typescript
const pin = await window.ipc.invoke('auth:requireManagerApproval', 'Void this sale?');
if (pin) {
  // PIN verified, proceed
  await window.ipc.invoke('sales:voidSale', { saleId, reason, pin });
}
```

---

## 🚀 NestJS Backend (noon-dairy-backend)

### Modules (DDD-style)

| Module | Responsibility |
|--------|-----------------|
| **auth.module** | JWT strategy, login/logout/refresh, user CRUD |
| **sync.module** | Device registration, ingest, pull, verify |
| **sales.module** | Sale CRUD, void operations |
| **customers.module** | Customer CRUD, ledger queries |
| **products.module** | Product CRUD, pricing |
| **inventory.module** | Stock movements |
| **expenses.module** | Expense CRUD |
| **cash-register.module** | Cash tracking |
| **suppliers.module** | Supplier CRUD, milk collections |
| **daily-rates.module** | Rate management |
| **roles.module** | Role & permission definitions |

### Sync Service (Core)

**File:** `noon-dairy-backend/src/sync/sync.service.ts`

**Key Responsibilities:**

1. **Normalize SQLite → PostgreSQL**
   - snake_case → camelCase
   - Enum mapping (RS→FLAT, PERCENT→PERCENTAGE)
   - Category mapping (DAIRY→MILK, BAKERY→OTHER)
   - Date-only fields (2026-04-29 → Date object)
   - Boolean conversion (0/1 → false/true)

2. **Field Validation & Defaults**
   - Missing product.code → generate from ID
   - Missing saleItem.unitPrice → calculate from lineTotal/quantity
   - Missing stockMovement.stockAfter → calculate from stockBefore + quantity

3. **Duplicate Prevention**
   - transactionId unique index prevents duplicate sales
   - Idempotent upserts for re-synced records

4. **Placeholder Creation**
   - If sale references unknown product → create inactive placeholder
   - If payment references unknown customer → create placeholder
   - Prevents foreign key errors

5. **Batch Processing**
   - Single ingest call
   - Ingest-batch for multiple operations
   - Transactional (all-or-none)

---

## ⚙️ Configuration

### Frontend (.env / localStorage / SQLite settings)

```env
APP_API_URL=http://localhost:3001/api
SYNC_DEVICE_SECRET=[must match backend]
```

**Settings Table (SQLite):**
- shopDayStartHour (default: 5)
- ramadan24Hour (true/false)
- setup_completed (tracks first-time wizard)
- autoPrintReceipt (true/false)
- discountLimitCash, discountLimitCredit (require PIN above)
- taxEnabled, taxLabel, taxRate

### Backend (.env)

```env
DATABASE_URL=postgresql://user:pass@localhost/noon_dairy
JWT_SECRET=[strong random]
JWT_REFRESH_SECRET=[strong random]
SYNC_DEVICE_SECRET=[must match Electron]
PORT=3001
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

**Startup Validation:** Backend refuses to start if JWT_SECRET or SYNC_DEVICE_SECRET are weak/missing.

---

## 🔐 Security & Audit

### Authentication

- **User Login:** Username/password via bcryptjs
- **Manager PIN:** 4-digit PIN (bcrypt hash in database)
- **JWT Tokens:** Issued on login, refreshed via refresh token (rotating)
- **Token Revocation:** Refresh tokens marked revokedAt on logout

### Audit Trail

**audit_logs table:**
- Captures every significant action (sale, return, void, expense, rate change, PIN use)
- Stores actor_user_id, approved_by_id (if manager approval used)
- Before/after JSON for data changes
- entry_hash (prevents tampering), previous_hash (chain)
- Immutable append-only log

**Receipt Audit:**
- Physical receipt counts compared with system records
- Missing/extra/duplicate flags recorded
- Session locked after completion

### Manager Approval

- Discount > limit → requires PIN
- Void sale → requires PIN
- Return → requires PIN
- Stock adjustment → requires PIN (if > limit)
- Rate change → requires PIN

---

## 📈 Recent Commits & Features

### Session 2026-04-28

- ✅ **d6c3657** - Milk/yogurt stock locking, yogurt deducts milk, UI badges & warnings
- ✅ **5d8b694** - Milk stock from suppliers, global rates sync, rate history table
- ✅ **79fdf0a** - Remove stock limit check for dairy products
- ✅ **8aa60ae** - Remove large sync alert box
- ✅ **8d70d5f** - Add touch input controls to POS
- ✅ **c797f67** - Replace window.prompt with proper PIN modals
- ✅ **61a3de2** - Update ai-context.md with session notes
- ✅ **6324ac9** - First-time setup wizard for new installs
- ✅ **0c34557** - Reports → Products tab, void PIN in modal
- ✅ **f1da2b4** - Customers page Add/Edit/Khata modals
- ✅ **dd729d4** - Settings RATES tab (real history), BACKUP tab (fully working)
- ✅ **532ba4e** - Held bill shows subtotal, correct time format in hold picker
- ✅ **a774617** - Speed up cash checkout (empty cash box = exact payment)

---

## 🎯 Graphify Analysis: Core Abstractions

**God Nodes (most connected, critical to understand):**

1. **SyncService** (11 edges) - Cloud sync orchestration
2. **CustomersService** (9 edges) - Customer khata & ledger
3. **CustomersController** (9 edges) - Customer API endpoints
4. **ProductsService** (9 edges) - Inventory queries
5. **ProductsController** (9 edges) - Product API endpoints
6. **AuthService** (8 edges) - Login & token management
7. **SyncController** (8 edges) - Sync API endpoints
8. **UsersController** (8 edges) - User management
9. **UsersService** (8 edges) - User business logic
10. **performBackup()** (8 edges) - Backup orchestration

**Major Communities:**

- **POS.tsx** (17 nodes) - Main point-of-sale page
- **backup.ts** (15 nodes) - Backup/restore pipeline
- **CashRegister.tsx** (12 nodes) - Cash & shift management
- **SyncService** (8 nodes) - Cloud sync core
- **exports.ipc.ts** (10 nodes) - Report generation

---

## 🚨 Known Risks & Next Steps

### Testing Needs
- [ ] Full E2E: open shift → sale → return → receipt audit → close shift → sync → verify backend DB
- [ ] Touch input pad on actual touchscreen terminal
- [ ] Multi-user concurrent sales (if applicable)
- [ ] Sync under poor network (retry behavior)
- [ ] Backup/restore under large database

### Production Blockers
- **Supabase Deployment:** Still needs final .env, migrations, PM2/Nginx setup
- **Code Signing:** Windows installer not signed (Defender may warn)
- **Database Scaling:** PostgreSQL connection pooling if high transaction volume
- **Error Reporting:** No centralized error logging (consider Sentry)

### Design Debt
- **SetupWizard Rate Entry:** Uses settings table (requires PIN), blocks wizard flow. Consider setup-only rate seeding IPC.
- **Backend Reports:** Thinner than Electron. If cloud dashboard needed, build shift-based cloud reports.
- **Sync Conflict Resolution:** Single-counter acceptable now, but full CRDT needed for multi-device future.

---

## 📋 Quick Reference: Key Files

### Frontend
```
electron-pos/
├── src/
│   ├── pages/
│   │   ├── POS.tsx          ← Main sales UI
│   │   ├── CashRegister.tsx ← Shift closing
│   │   ├── Reports.tsx      ← Dashboards
│   │   ├── Settings.tsx     ← Config
│   │   └── ...
│   ├── store/
│   │   └── cartStore.ts     ← Zustand cart state
│   └── components/
│       ├── PinModal.tsx
│       ├── PaymentModal.tsx
│       └── ...
└── electron/
    ├── database/
    │   ├── schema.ts        ← SQLite schema + seed
    │   ├── db.ts            ← Database connection
    │   ├── businessDay.ts   ← Shift-based day logic
    │   └── cashRegister.ts  ← Z-report calculations
    ├── sync/
    │   ├── syncEngine.ts    ← Outbox processor
    │   ├── apiConfig.ts     ← API URL & headers
    │   ├── deviceInfo.ts    ← Device registration
    │   └── backup.ts        ← Backup/restore
    └── ipc/
        ├── sales.ipc.ts
        ├── customers.ipc.ts
        ├── auth.ipc.ts
        ├── inventory.ipc.ts
        └── ...
```

### Backend
```
noon-dairy-backend/
├── prisma/
│   ├── schema.prisma        ← PostgreSQL schema
│   └── seed.ts              ← Initial data
├── src/
│   ├── sync/
│   │   ├── sync.service.ts  ← Normalization & ingest
│   │   ├── sync.controller.ts
│   │   └── sync-secret.guard.ts
│   ├── auth/
│   │   ├── auth.service.ts
│   │   ├── jwt.strategy.ts
│   │   └── ...
│   ├── sales/
│   │   ├── sales.service.ts
│   │   └── sales.controller.ts
│   └── ...
└── main.ts                  ← Server bootstrap
```

---

## 💡 Development Workflow

### Before Any Work
```bash
cd noon-dairy-pos
git log --oneline -5
```

### Electron Development
```bash
cd electron-pos
npm run build:electron   # Compile TypeScript
npm run build:renderer   # Build React + Vite
npm run dev:electron     # Run with hot reload
npm run build:win        # Package installer
```

### Backend Development
```bash
cd noon-dairy-backend
npm run build
npx prisma validate
npx prisma db push       # Sync schema to PostgreSQL
npm run start
# Visit http://localhost:3001/api/docs for Swagger
```

### After Each Task
```bash
git add .
git commit -m "codex: brief description"
# Rebuild relevant part (renderer or backend)
# Manual test the feature
```

---

## 🧭 How to Navigate Changes

**If modifying:**
- **POS checkout logic** → Read POS.tsx, cartStore.ts, sales.ipc.ts
- **Customer credit system** → Read customers.ipc.ts, ledger_entries, customersService
- **Stock tracking** → Read inventory.ipc.ts, stock_movements, products
- **Sync** → Read syncEngine.ts, sync.service.ts, sync_outbox
- **Reports** → Read Reports.tsx, exports.ipc.ts, _backend_ sales.service.ts
- **Shift closing** → Read CashRegister.tsx, cashRegister.ts, shifts, cash_register
- **Backup** → Read backup.ts, Settings.tsx backup tab
- **Receipt audit** → Read ReceiptAudit.tsx, receipt_audit_sessions, receipt_audit_entries

---

**Last Updated:** 2026-04-29  
**Status:** Production-ready (single-counter only, sync robust, E2E testing recommended)
