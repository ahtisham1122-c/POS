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
- `6324ac9 feat: first-time setup wizard for new installs`
- `0c34557 fix: Reports — Products tab implemented, void PIN in modal not prompt`
- `f1da2b4 feat: Customers page — Add, Edit, Khata modals now working`
- `dd729d4 fix: Settings page — real rate history, working backup/restore tab`
- `532ba4e fix: held bill shows subtotal and correct time format in POS hold picker`
- `a774617 codex: speed up cash checkout` (previous)

## Latest Production-Hardening Summary (2026-05-01)
- Latest important commits:
  - `d3d9ed8 fix: issue per-terminal sync credentials`
  - `87c349f fix: harden production readiness gaps`
  - `84df44e fix: cash register CONSTRAINT FAILED + add Reopen Register`
  - `13d702f fix: returns FK violation - insert parent row before children`
  - `bdd25b8 chore: upgrade electron-builder to 26.8.1`
- Current software-side readiness after latest hardening: about 8/10.
- Still not final commercial sign-off until the real shop flow and physical printer are tested on the HP Engage One setup.
- Installer rebuilt after latest hardening: `electron-pos/dist/Noon Dairy POS Setup 1.0.0.exe`.
- Supabase/PostgreSQL schema migrated successfully with `20260430000000_add_device_sync_tokens`.
- Production audits were clean after fixes:
  - root Next prototype: `npm audit --omit=dev` -> 0 vulnerabilities
  - Electron: `npm audit --omit=dev` -> 0 vulnerabilities
  - Backend: `npm audit --omit=dev` -> 0 vulnerabilities
- Root Next prototype upgraded to `next@15.5.15` and builds successfully.
- `next.config.mjs` sets explicit `outputFileTracingRoot` to avoid workspace-root warnings.
- Check `git status --short` before editing. There may be Claude/user dirty files; do not revert unrelated changes.
- Cleanup tools added for removing fake/test data before live use:
  - VPS PostgreSQL: `noon-dairy-backend/scripts/reset-transactional-data.sql`
  - Local Windows SQLite: `electron-pos/scripts/reset-local-transactional-data.cjs`
  - Both are destructive and require typed confirmation. Take/keep backups first.

## Architecture
- Electron desktop app is offline-first:
  - React + Vite renderer.
  - Electron main process handles IPC.
  - SQLite via `better-sqlite3`.
  - Local DB lives in Electron `userData` folder as `noon-dairy.db`.
  - Outbox table `sync_outbox` stores pending cloud sync operations.
- Data storage policy already built:
  - Local SQLite is the main working database for counter sale.
  - Sync outbox is the safety bridge when internet/backend/cloud is down.
  - NestJS + PostgreSQL/Supabase is the online copy for backup/reporting/sync.
  - Local backup files are the emergency recovery copy.
  - Sale always saves locally first, then syncs online later.
- Cloud backend:
  - NestJS + Prisma + PostgreSQL.
  - Runs at local default `http://localhost:3001/api`.
  - Sync endpoints under `/api/sync/*`.
- Cloud sync design:
  - Electron must sync through Nest backend, not directly to Supabase REST.
  - Supabase anon key was removed from source/default seed because direct REST table sync returned 404.
  - Backend `DATABASE_URL` should point to Supabase PostgreSQL connection string.
  - Electron should know backend URL plus registration secret only. Normal sync now uses a per-terminal device token.

## Important Commands
Backend:
```powershell
cd "C:\Users\Ahtisham Ul Haq\Documents\Codex\2026-04-23-files-mentioned-by-the-user-noon\noon-dairy-pos\noon-dairy-backend"
npm run build
npx prisma validate
npx prisma migrate status
npx prisma migrate deploy
npm run test:sync-token
npm run start
```

Electron:
```powershell
cd "C:\Users\Ahtisham Ul Haq\Documents\Codex\2026-04-23-files-mentioned-by-the-user-noon\noon-dairy-pos\electron-pos"
npm run build:electron
npm run build:renderer
npm run typecheck
npm run test:sales-math
npm run test:sync-security
npm run reset:local-transactional-data
npm run dev:electron
npm run build:win
```

Root old Next prototype:
```powershell
cd "C:\Users\Ahtisham Ul Haq\Documents\Codex\2026-04-23-files-mentioned-by-the-user-noon\noon-dairy-pos"
npm run build
npm audit --omit=dev
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
  - `SYNC_DEVICE_SECRET` is used only to register this terminal with backend.
  - `SYNC_DEVICE_TOKEN` is issued by backend and stored internally in SQLite settings. Do not expose it in UI/chat/docs.
- Backend startup now refuses weak/missing JWT/sync secrets.
- Known weak/example sync secrets are blocked:
  - `noon-dairy-local-sync-secret-change-me`
  - `change-this...`
  - `PASTE_...`
  - `YOUR_...`
- Settings audit log redacts sync secrets/tokens.

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
- Device registration: `electron-pos/electron/sync/deviceRegistration.ts`
- Sync secret validation: `electron-pos/electron/sync/secretValidation.ts`
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
- Sync token utility: `noon-dairy-backend/src/sync/sync-token.util.ts`
- Device sync token migration: `noon-dairy-backend/prisma/migrations/20260430000000_add_device_sync_tokens/migration.sql`
- Sales: `noon-dairy-backend/src/sales/sales.module.ts`
- Cash register: `noon-dairy-backend/src/cash-register/cash-register.module.ts`

## Sync Work Completed
- Direct Supabase REST sync removed from Electron.
- Electron now posts outbox records to Nest backend `/api/sync/ingest`.
- Backend sync registration is guarded by `X-Sync-Secret`.
- Normal backend sync is guarded by per-terminal credentials:
  - request header `X-Device-Id`
  - request header `X-Device-Token`
  - backend stores only `Device.syncTokenHash`, not the raw token.
- `sync:syncNow` tries device registration first, so after owner saves Sync settings it does not require app restart.
- `settings:getAll` does not return `SYNC_DEVICE_TOKEN`.
- Old shared secret now acts as registration credential, not the everyday sync credential.
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
- Latest automated sync/security tests passed:
  - Electron `npm run test:sync-security`
  - Backend `npm run test:sync-token`

## Commercial Blockers Already Addressed
- Duplicate sale protection via `transaction_id`.
- Cash tendered/change returned/payment breakdown saved.
- POS cash sale no longer requires typing cash received. Empty cash box is treated as exact cash payment for faster counter checkout; cash box is now only an optional change calculator with quick buttons.
- Manager PIN approval exists in Electron IPC for refunds, voids, stock adjustment, daily rates/discount limit paths.
- Shift-based reporting/business day logic.
- Visible sync status badge and stuck outbox warning.
- Backup/restore safety work exists in `electron-pos/electron/sync/backup.ts`.
- Audit log system exists in `electron-pos/electron/audit/auditLog.ts`.
- Export IPC exists for reports.
- Weak/default cloud sync secrets blocked.
- Per-terminal sync credential flow implemented.
- Backend production dependency audit clean.
- Electron production dependency audit clean.
- Root Next prototype dependency audit clean.
- Installer now uses `electron-builder@26.8.1`.

## Latest Cash Register / Shift Fixes
- Receipt Audit no longer blocks daily close.
- Cash Register close now uses simple cash count audit:
  - expected cash
  - actual counted cash
  - cash extra/short variance
  - optional closing note
- If yesterday's shift is still open, app tells cashier to close that shift first before opening today's shift.
- Cash register had a CONSTRAINT FAILED issue fixed and Reopen Register was added in recent commit `84df44e`.
- Returns FK violation fixed in recent commit `13d702f`; parent return row is inserted before child return items.

## User / Role Fixes
- Settings > Users & Roles > Add User now creates a real login user.
- Only ADMIN can add login users.
- User roles:
  - `CASHIER`
  - `MANAGER`
  - `ADMIN`
- PINs are hashed. Do not sync real PIN hashes from Electron to cloud.

## Recent POS Cash Checkout Work
- Commit `a774617 codex: speed up cash checkout` updated `electron-pos/src/pages/POS.tsx`.
- In Cash mode, cashier can leave the cash received input empty and press Enter/CASH to complete the sale.
- Backend sale IPC already treats blank/zero tendered cash as exact payment, so saved payment totals remain sensible.
- POS now shows quick cash buttons: Exact, Rs 500, Rs 1000, Rs 5000.
- Verified after the change:
  - `npm run build:renderer`
  - `npm run build:electron`

## UI/UX Work Completed (Session 2026-04-28)
- `532ba4e` — Fix held bill subtotal and time format in POS hold picker
- `dd729d4` — Settings RATES tab: real rate history from SQLite (was hardcoded fake rows). BACKUP tab: fully implemented with Backup Now / Restore from File / Open Folder / backup list table (was "coming soon").
- `f1da2b4` — Customers page: Add Customer modal, Edit Customer modal, Khata (ledger) modal fully implemented (buttons were wired to nothing before).
- `0c34557` — Reports PRODUCTS tab implemented with real product performance data. Void sale manager PIN moved from window.prompt to proper inline input in the void modal.
- `6324ac9` — First-time setup wizard (SetupWizard.tsx): shop info → rates → PIN change, 3-step guided flow. App.tsx checks setup_completed setting; wizard shows before Login on fresh install. schema.ts seeds setup_completed correctly.
- Windows installer rebuilt: `electron-pos/dist/Noon Dairy POS Setup 1.0.0.exe` — ready to distribute.

## Known Risks / Next Best Work
- Run a full real Electron end-to-end test:
  - open shift
  - open cash register
  - create sale
  - print/reprint receipt
  - create return
  - close shift/register with counted cash
  - sync now
  - verify backend DB records.
- Physical printer test still must be done on real HP Engage One / thermal printer hardware.
- Production VPS/Supabase deployment still needs final `.env`, migrations, PM2/Nginx setup.
- Backend sync is robust but not a full conflict-resolution system. Since single-counter only, acceptable for now.
- Backend reports are still thin compared with Electron reports. If cloud dashboard is needed, build shift-based cloud reports.
- Code signing for installer not configured (Windows Defender may warn). For production distribution, purchase a code signing certificate.
- SetupWizard step 2 saves rates to settings table (not daily_rates table directly) — daily_rates IPC requires manager PIN which blocks wizard flow. Consider adding a setup-only rate seeding IPC if this is a problem.

## Test Coverage Notes
- Automated tests are better than before but still thin for real money software. Current focused tests:
  - `electron-pos/scripts/sales-math-smoke.cjs`
  - `electron-pos/scripts/sync-security-smoke.cjs`
  - `noon-dairy-backend/scripts/sync-token-smoke.cjs`
- After 6-12 months of data, consider adding report/archive optimization if reports feel slow. SQLite is fine for single-counter daily POS, but long report queries may eventually need indexes/archive screens.

## Manual Verification Checklist
- Backend:
  - `npm run build`
  - `npx prisma validate`
  - `npx prisma migrate status`
  - `npx prisma migrate deploy` when new migrations exist
  - `npm run test:sync-token`
  - `npm run start`
  - visit `http://localhost:3001/api/docs`
- Electron:
  - `npm run typecheck`
  - `npm run build:electron`
  - `npm run build:renderer`
  - `npm run test:sales-math`
  - `npm run test:sync-security`
  - `npm run dev:electron`
  - Settings > Sync: API URL is backend `/api`, not Supabase REST.
  - Settings > Sync: enter the strong registration secret matching backend `SYNC_DEVICE_SECRET`.
  - Sync Now should register the terminal and store an internal `SYNC_DEVICE_TOKEN`.
  - Sync status shows live/online when backend is running and terminal is registered.
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
