# Noon Dairy POS - Production Readiness Checklist

This checklist covers critical flows to verify before handing over the system for retail use.

## 1. Sales & POS Flow
- [ ] **Walk-in Sale (Cash)**: Add items, complete sale, verify bill number increment and stock reduction.
- [ ] **Khata Sale (Credit)**: Select customer, complete sale, verify customer balance increase and ledger entry.
- [ ] **Partial Payment**: Enter partial cash, verify remaining amount goes to customer khata.
- [ ] **Hold Bill**: Add items, click HOLD, then resume and finish the sale later.
- [ ] **Shortcut Keys**: Test F1 (Held), F2 (Other Items), Enter (Checkout).
- [ ] **Printer Fallback**: Disconnect thermal printer, click PRINT, verify it falls back to browser print dialog gracefully.

## 2. Customer & Khata Management
- [ ] **Statement Generation**: Open a customer ledger, filter by date range, verify "Opening Balance" logic.
- [ ] **Ledger Print/Export**: Print a statement and export to CSV. Verify data matches the UI.
- [ ] **Manual Payment**: Add a payment in the Khata screen, verify customer balance decreases.

## 3. Inventory & Stocks
- [ ] **Stock In**: Add stock to an existing product, verify total stock increases and a "STOCK_IN" movement log is created.
- [ ] **Low Stock Alerts**: Sell items until a product hits its threshold, verify the warning alert appears in POS.
- [ ] **Valuation**: Verify "Total Inventory Value" in Dashboard/Inventory matches `Stock * Cost Price`.

## 4. Cash Register & Reconciliation
- [ ] **Daily Open**: Open register with a starting balance, verify cash_in matches sales.
- [ ] **Expense Impact**: Add an expense, verify "Cash Out" in Register increases and expected cash decreases.
- [ ] **Daily Close**: Close the register with actual physical cash, verify "Variance" is recorded correctly.

## 5. Reports & Analytics
- [ ] **Profit & Loss**: Run a P&L for a date range, verify `Revenue - COGS - Expenses = Net Profit`.
- [ ] **Dashboard KPI**: Verify KPIs (Today's Revenue, Bills, Cash on Hand) update in real-time after a sale.

## 6. System & Infrastructure
- [ ] **Sync Outbox**: Create a sale, verify a row appears in `sync_outbox` with status 'pending'.
- [ ] **Backup/Restore**: Perform a manual backup, verify the `.db` file is created. Try restoring to verify integrity.
- [ ] **Data Seeding**: Delete the database file and restart, verify default products and settings are recreated.

---
**Verified By:** ____________________  **Date:** ____________________
