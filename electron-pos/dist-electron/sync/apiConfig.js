"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApiBaseUrl = getApiBaseUrl;
exports.getSyncHeaders = getSyncHeaders;
exports.fetchWithTimeout = fetchWithTimeout;
const db_1 = __importDefault(require("../database/db"));
function getApiBaseUrl() {
    try {
        const row = db_1.default.prepare("SELECT value FROM settings WHERE key = 'APP_API_URL'").get();
        if (row?.value)
            return row.value;
    }
    catch (e) {
        console.error('Error reading APP_API_URL from settings:', e);
    }
    return process.env.APP_API_URL || 'http://localhost:3001/api';
}
function getSyncHeaders(deviceId) {
    let syncSecret = process.env.SYNC_DEVICE_SECRET;
    try {
        const row = db_1.default.prepare("SELECT value FROM settings WHERE key = 'SYNC_DEVICE_SECRET'").get();
        if (row?.value)
            syncSecret = row.value;
    }
    catch (e) {
        console.error('Error reading SYNC_DEVICE_SECRET from settings:', e);
    }
    if (!syncSecret)
        return null;
    return {
        'Content-Type': 'application/json',
        'X-Sync-Secret': syncSecret,
        ...(deviceId ? { 'X-Device-Id': deviceId } : {})
    };
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    }
    finally {
        clearTimeout(timeout);
    }
}
