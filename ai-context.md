# Noon Dairy POS - AI Handoff Context

Use this file to continue development in a new Codex/Antigravity chat. Keep answers beginner-friendly for the owner, but act as a senior full-stack POS engineer.

## Project
- Real desktop POS for a Pakistan dairy shop: counter sale -> thermal receipt -> customer takes receipt to delivery counter -> delivery staff keeps receipt.
- Shop can run normal hours 5am-midnight, late sales after midnight, and Ramadan 24-hour mode.
- Single-counter setup only. No barcode scanner needed. No multi-device stock conflict handling needed for now.
- Currency: Pakistani Rupees. Shop branding currently Gujjar Milk Shop / Noon Dairy POS.

## Repo Path
- Root: `C:\Users\Ahtisham Ul Haq\Documents\Codex\2026-04-23-files-mentioned-by-the-user-noon\noon-dairy-pos`
- Electron app: `electron-pos`
- Cloud backend: `noon-dairy-backend`
- There is also an older/root Next.js prototype in `src`; main active app is `electron-pos`.

## Must-Follow Workflow
- Before work: run `git log --oneline -5`.
- After work: run build/tests relevant to touched area.
- Commit every completed task: `git add .; git commit -m "codex: brief description"`.
- Do not expose real `.env` secrets in chat. `.env*` are gitignored except examples.
- Do not revert Antigravity/user changes unless explicitly asked.

## Current Commit Trail
- `293a86a antigravity: fix sales insert column-value mismatch`
- `ba9eab2 antigravity: fix cash tendered validation rounding bug`
- `1c0d6b8 antigravity: run the app`
- `a774617 codex: speed up cash checkout`
- `e7b4df0 codex: handle legacy partial product sync`

## Architecture
- Electron desktop app is offline-first:
  - React + Vite renderer.
  - Electron main process handles IPC.
  - SQLite via `better-sqlite3`.
  - Local DB lives in Electron `userData` folder as `noon-dairy.db`.
  - Outbox table `sync_outbox` stores pending cloud sync operations.
- Cloud backend:
  - NestJS + Prisma + PostgreSQL.
  - Runs at local default `http://localhost:3001/api`.
  - Sync endpoints under `/api/sync/*`.
- Cloud sync design:
  - Electron must sync through Nest backend, not directly to Supabase REST.
  - Supabase anon key was removed from source/default seed because direct REST table sync returned 404.
  - For real Supabase later, backend `DATABASE_URL` should point to Supabase PostgreSQL connection string. Electron should only know backend URL + sync secret.

## Important Commands
Backend:
```powershell
cd "C:\Users\Ahtisham Ul Haq\Documents\Codex\2026-04-23-files-mentioned-by-the-user-noon\noon-dairy-pos\noon-dairy-backend"
npm run build
npx prisma validate
npx prisma db push
npm run start
```

Electron:
```powershell
cd "C:\Users\Ahtisham Ul Haq\Documents\Codex\2026-04-23-files-mentioned-by-the-user-noon\noon-dairy-pos\electron-pos"
npm run build:electron
npm run build:renderer
npm run dev:electron
npm run build:win
```

## Config Rules
- Backend `.env` must have strong:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `JWT_REFRESH_SECRET`
  - `SYNC_DEVICE_SECRET`
  - `PORT=3001`
  - `CORS_ORIGINS`
- Electron `.env` / SQLite settings:
  - `APP_API_URL=http://localhost:3001/api`
  - `SYNC_DEVICE_SECRET` must match backend.
- Backend startup now refuses weak/missing JWT/sync secrets.

## Business-Day / Shift Rules Implemented
- Business day is shift-based, not midnight-based.
- Sale belongs to open shift via `shift_id`.
- Late sale after midnight belongs to previous open shift.
- If no shift open between midnight-5am, app should look for previous unclosed shift or require opening shift.
- Ramadan/24-hour mode setting exists:
  - `ramadan24Hour`
  - `24_hour_mode`
- Z-report/cash register should group by shift, not calendar date.

## Key Electron Files
- DB schema/seed: `electron-pos/electron/database/schema.ts`
- DB connection: `electron-pos/electron/database/db.ts`
- Business day logic: `electron-pos/electron/database/businessDay.ts`
- Cash register helpers: `electron-pos/electron/database/cashRegister.ts`
- Sync engine: `electron-pos/electron/sync/syncEngine.ts`
- Pull sync: `electron-pos/electron/sync/pullSync.ts`
- API config: `electron-pos/electron/sync/apiConfig.ts`
- Outbox helper: `electron-pos/electron/sync/outboxHelper.ts`
- IPC files:
  - Sales: `electron-pos/electron/ipc/sales.ipc.ts`
  - Returns: `electron-pos/electron/ipc/returns.ipc.ts`
  - Customers/Khata: `electron-pos/electron/ipc/customers.ipc.ts`
  - Products: `electron-pos/electron/ipc/products.ipc.ts`
  - Inventory: `electron-pos/electron/ipc/inventory.ipc.ts`
  - Expenses: `electron-pos/electron/ipc/expenses.ipc.ts`
  - Shifts: `electron-pos/electron/ipc/shifts.ipc.ts`
  - Cash register: `electron-pos/electron/ipc/cash-register.ipc.ts`
  - Suppliers: `electron-pos/electron/ipc/suppliers.ipc.ts`
  - Receipt audit: `electron-pos/electron/ipc/receipt-audit.ipc.ts`
  - Settings: `electron-pos/electron/ipc/settings.ipc.ts`
  - Sync: `electron-pos/electron/ipc/sync.ipc.ts`
- UI pages:
  - POS: `electron-pos/src/pages/POS.tsx`
  - Cash register: `electron-pos/src/pages/CashRegister.tsx`
  - Settings: `electron-pos/src/pages/Settings.tsx`
  - Reports: `electron-pos/src/pages/Reports.tsx`
  - Suppliers: `electron-pos/src/pages/Suppliers.tsx`
  - Receipt audit: `electron-pos/src/pages/ReceiptAudit.tsx`

## Key Backend Files
- Prisma schema: `noon-dairy-backend/prisma/schema.prisma`
- Seed: `noon-dairy-backend/prisma/seed.ts`
- Main startup/security: `noon-dairy-backend/src/main.ts`
- Sync guard: `noon-dairy-backend/src/sync/sync-secret.guard.ts`
- Sync controller: `noon-dairy-backend/src/sync/sync.controller.ts`
- Sync service: `noon-dairy-backend/src/sync/sync.service.ts`
- Sales: `noon-dairy-backend/src/sales/sales.module.ts`
- Cash register: `noon-dairy-backend/src/cash-register/cash-register.module.ts`

## Sync Work Completed
- Direct Supabase REST sync removed from Electron.
- Electron now posts outbox records to Nest backend `/api/sync/ingest`.
- Backend `/sync` guarded by `X-Sync-Secret`.
- Backend sync normalizes:
  - snake_case to camelCase.
  - discount `RS` -> `FLAT`, `PERCENT` -> `PERCENTAGE`.
  - product categories from local names to backend enum.
  - expense category fallback to `MISCELLANEOUS`.
  - SQLite booleans `0/1` -> Prisma booleans.
  - date-only strings -> Date values for date fields.
- Backend sync sanitizes payload fields against Prisma model fields.
- Backend creates safe inactive placeholders if synced records reference unknown:
  - users
  - products
  - customers
  - suppliers
- Duplicate `transactionId` is skipped, preventing duplicate cloud sales.

## Sync Tests Already Passed
- Backend routes:
  - `/api/sync/register-device`
  - `/api/sync/pull`
  - `/api/sync/status`
  - `/api/sync/ingest`
- Representative records synced successfully:
  - sale
  - sale item
  - stock movement
  - payment
  - customer ledger entry
  - duplicate transaction ID skip
  - shift
  - cash register
  - supplier
  - milk collection
  - supplier payment
  - supplier ledger entry
  - receipt audit session
  - receipt audit entry
  - return
  - return item

## Commercial Blockers Already Addressed
- Duplicate sale protection via `transaction_id`.
- Cash tendered/change returned/payment breakdown saved.
- Manager PIN approval exists in Electron IPC for refunds, voids, stock adjustment, daily rates/discount limit paths.
- Shift-based reporting/business day logic.
- Visible sync status badge and stuck outbox warning.
- Backup/restore safety work exists in `electron-pos/electron/sync/backup.ts`.
- Audit log system exists in `electron-pos/electron/audit/auditLog.ts`.
- Export IPC exists for reports.

## Known Risks / Next Best Work
- Run a full real Electron end-to-end test:
  - open shift
  - open cash register
  - create sale
  - print/reprint receipt
  - create return
  - receipt audit
  - close shift
  - sync now
  - verify backend DB records.
- Audit existing local SQLite DB settings: older installed app may still contain old Supabase URL/key in `settings`. Schema init now replaces Supabase REST URL defaults, but installed DB should be checked from Settings > Sync or via SQLite.
- Backend sync is robust but not a full conflict-resolution system. Since single-counter only, acceptable for now.
- Backend reports are still thin compared with Electron reports. If cloud dashboard is needed, build shift-based cloud reports.
- Production VPS/Supabase deployment still needs final `.env`, migrations, PM2/Nginx setup.
- UI/UX quality complaints remain; owner dislikes current UI. Do not overpromise. Improve page by page with real POS workflow.

## Manual Verification Checklist
- Backend:
  - `npm run build`
  - `npx prisma validate`
  - `npx prisma db push`
  - `npm run start`
  - visit `http://localhost:3001/api/docs`
- Electron:
  - `npm run build:electron`
  - `npm run build:renderer`
  - `npm run dev:electron`
  - Settings > Sync: API URL is backend `/api`, not Supabase REST.
  - Sync status shows live/online when backend is running.
- Real sale:
  - shift open
  - cash register open
  - sale complete
  - receipt generated
  - outbox drains to zero
  - backend DB has sale + items + split payment + stock movement.

## Communication Preference
- User is a beginner. Explain in simple English.
- User wants step-by-step guidance and usually says "next".
- Do not dump large theory. Do the work, verify, then summarize.
- When showing secrets/config, mask real secret values.
