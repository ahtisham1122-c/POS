#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');

const dbPath =
  process.env.NOON_DAIRY_DB_PATH ||
  path.join(process.env.APPDATA || '', 'noon-dairy-pos-electron', 'noon-dairy.db');

const confirmationPhrase = 'RESET_LOCAL_TRANSACTIONAL_DATA';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function tableExists(db, tableName) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return Boolean(row);
}

function countRows(db, tableName) {
  if (!tableExists(db, tableName)) return 0;
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function runIfTableExists(db, tableName, sql) {
  if (tableExists(db, tableName)) {
    db.prepare(sql).run();
  }
}

function printCounts(db, label) {
  const tables = [
    'sales',
    'shifts',
    'cash_register',
    'expenses',
    'stock_movements',
    'milk_collections',
    'sync_outbox',
    'customers',
    'suppliers',
    'products',
    'users',
  ];

  console.log(`\n--- Counts ${label} ---`);
  for (const table of tables) {
    console.log(`${table.padEnd(18)} ${countRows(db, table)}`);
  }
}

async function main() {
  console.log('Noon Dairy local SQLite transactional reset');
  console.log(`Database: ${dbPath}`);
  console.log('');
  console.log('This deletes local test sales, shifts, cash register rows, stock movements,');
  console.log('returns, receipt audits, supplier transactions, and pending sync_outbox rows.');
  console.log('It keeps users, settings, daily rates, and real master records.');
  console.log('');

  if (!fs.existsSync(dbPath)) {
    console.error('Database file not found. Nothing was changed.');
    process.exit(1);
  }

  const answer = await ask(`Type exactly ${confirmationPhrase} to continue: `);
  if (answer !== confirmationPhrase) {
    console.log('Reset cancelled. Nothing was changed.');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.before-reset-${timestamp}.bak`;
  fs.copyFileSync(dbPath, backupPath);
  console.log(`Backup created: ${backupPath}`);

  const db = new Database(dbPath);
  db.pragma('foreign_keys = OFF');
  printCounts(db, 'before reset');

  const reset = db.transaction(() => {
    const transactionalTables = [
      'return_items',
      'returns',
      'sale_voids',
      'sale_items',
      'split_payments',
      'ledger_entries',
      'payments',
      'sales',
      'stock_movements',
      'expenses',
      'cash_register',
      'shifts',
      'receipt_audit_entries',
      'receipt_audit_sessions',
      'supplier_ledger_entries',
      'supplier_payments',
      'milk_collections',
      'held_sale_items',
      'held_sales',
      'sync_outbox',
    ];

    for (const table of transactionalTables) {
      runIfTableExists(db, table, `DELETE FROM ${table}`);
    }

    runIfTableExists(
      db,
      'customers',
      `
        DELETE FROM customers
        WHERE code LIKE 'TEST%'
           OR code LIKE 'DEMO%'
           OR code LIKE 'FAKE%'
           OR lower(name) LIKE 'test %'
           OR lower(name) LIKE 'demo %'
           OR lower(name) LIKE 'fake %'
           OR COALESCE(phone, '') IN ('0000000000', '0000', '1234567890')
      `,
    );

    runIfTableExists(
      db,
      'suppliers',
      `
        DELETE FROM suppliers
        WHERE code LIKE 'TEST%'
           OR code LIKE 'DEMO%'
           OR code LIKE 'FAKE%'
           OR lower(name) LIKE 'test %'
           OR lower(name) LIKE 'demo %'
           OR lower(name) LIKE 'fake %'
           OR COALESCE(phone, '') IN ('0000000000', '0000', '1234567890')
      `,
    );

    runIfTableExists(
      db,
      'products',
      `
        DELETE FROM products
        WHERE code NOT IN ('MILK', 'YOGT')
          AND (
               code LIKE 'TEST%'
            OR code LIKE 'DEMO%'
            OR code LIKE 'FAKE%'
            OR lower(name) LIKE 'test %'
            OR lower(name) LIKE 'demo %'
            OR lower(name) LIKE 'fake %'
          )
      `,
    );

    runIfTableExists(db, 'customers', 'UPDATE customers SET current_balance = 0, synced = 0');
    runIfTableExists(db, 'suppliers', 'UPDATE suppliers SET current_balance = 0, synced = 0');
    runIfTableExists(db, 'products', 'UPDATE products SET stock = 0, synced = 0');
    runIfTableExists(db, 'bill_counter', 'UPDATE bill_counter SET last_number = 0 WHERE id = 1');
  });

  reset();
  db.pragma('foreign_keys = ON');
  db.pragma('wal_checkpoint(TRUNCATE)');
  printCounts(db, 'after reset');
  db.close();

  console.log('');
  console.log('Local reset complete. Enter real opening stock again before live use.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
