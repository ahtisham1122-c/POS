"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
class Logger {
    logPath = null;
    ensureLogPath() {
        if (this.logPath)
            return this.logPath;
        const logsDir = electron_1.app.isReady() ? electron_1.app.getPath('logs') : path_1.default.join(process.cwd(), 'logs');
        if (!fs_1.default.existsSync(logsDir)) {
            fs_1.default.mkdirSync(logsDir, { recursive: true });
        }
        this.logPath = path_1.default.join(logsDir, 'noon-dairy.log');
        return this.logPath;
    }
    write(level, ...args) {
        const timestamp = new Date().toISOString();
        const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
        const logLine = `[${timestamp}] [${level}] ${message}\n`;
        // Console output for dev
        if (process.env.NODE_ENV === 'development') {
            console.log(logLine.trim());
        }
        // File output
        fs_1.default.appendFileSync(this.ensureLogPath(), logLine);
    }
    info(...args) { this.write('INFO', ...args); }
    warn(...args) { this.write('WARN', ...args); }
    error(...args) { this.write('ERROR', ...args); }
    debug(...args) { this.write('DEBUG', ...args); }
}
exports.default = new Logger();
