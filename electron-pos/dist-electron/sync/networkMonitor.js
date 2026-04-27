"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.networkMonitor = void 0;
const dns_1 = __importDefault(require("dns"));
const events_1 = require("events");
class NetworkMonitor extends events_1.EventEmitter {
    isOnline = true;
    interval = null;
    constructor() {
        super();
        this.startMonitoring();
    }
    startMonitoring() {
        // Check every 10 seconds
        this.interval = setInterval(() => this.checkInternet(), 10000);
        // Initial check
        this.checkInternet();
    }
    checkInternet() {
        dns_1.default.lookup('google.com', (err) => {
            const wasOnline = this.isOnline;
            this.isOnline = !err;
            if (!wasOnline && this.isOnline) {
                this.emit('online');
            }
            else if (wasOnline && !this.isOnline) {
                this.emit('offline');
            }
        });
    }
    stopMonitoring() {
        if (this.interval)
            clearInterval(this.interval);
    }
}
exports.networkMonitor = new NetworkMonitor();
