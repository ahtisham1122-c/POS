"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const backup_1 = require("../sync/backup");
// Store DB in Electron's userData folder so it survives app updates/reinstalls.
// Older builds created the DB inside the install folder via process.cwd(); copy it once if found.
if (electron_1.app.getName() === 'Electron') {
    electron_1.app.setName('Noon Dairy POS');
}
const dataDir = electron_1.app.getPath('userData');
if (!fs_1.default.existsSync(dataDir)) {
    fs_1.default.mkdirSync(dataDir, { recursive: true });
}
(0, backup_1.applyPendingRestoreIfAny)();
const dbPath = path_1.default.join(dataDir, 'noon-dairy.db');
const legacyDataDir = path_1.default.join(process.cwd(), '.noon-dairy-data');
const legacyDbPath = path_1.default.join(legacyDataDir, 'noon-dairy.db');
if (!fs_1.default.existsSync(dbPath) && fs_1.default.existsSync(legacyDbPath)) {
    fs_1.default.copyFileSync(legacyDbPath, dbPath);
    for (const suffix of ['-wal', '-shm']) {
        const legacySidecar = `${legacyDbPath}${suffix}`;
        if (fs_1.default.existsSync(legacySidecar)) {
            fs_1.default.copyFileSync(legacySidecar, `${dbPath}${suffix}`);
        }
    }
}
const db = new better_sqlite3_1.default(dbPath, { verbose: console.log });
// Production stability PRAGMAs
db.pragma('journal_mode = WAL'); // Prevents database locks under concurrent reads
db.pragma('synchronous = NORMAL'); // Balance speed vs. safety (safe with WAL)
db.pragma('foreign_keys = ON'); // Enforce referential integrity
db.pragma('cache_size = -64000'); // 64MB cache for speed
exports.default = db;
