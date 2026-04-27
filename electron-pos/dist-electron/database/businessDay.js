"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatLocalDate = formatLocalDate;
exports.getShopTimingSettings = getShopTimingSettings;
exports.getBusinessDate = getBusinessDate;
exports.getBusinessDateInfo = getBusinessDateInfo;
const db_1 = __importDefault(require("./db"));
function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function getShopTimingSettings() {
    const rows = db_1.default.prepare(`SELECT key, value FROM settings WHERE key IN ('shopDayStartHour', 'ramadan24Hour')`).all();
    const settings = rows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
    }, {});
    const configuredStartHour = Number(settings.shopDayStartHour ?? 5);
    const shopDayStartHour = Number.isFinite(configuredStartHour)
        ? Math.max(0, Math.min(23, Math.floor(configuredStartHour)))
        : 5;
    const ramadan24Hour = String(settings.ramadan24Hour || 'false').toLowerCase() === 'true';
    return { shopDayStartHour, ramadan24Hour };
}
function getBusinessDate(now = new Date()) {
    const { shopDayStartHour, ramadan24Hour } = getShopTimingSettings();
    const businessDate = new Date(now);
    if (!ramadan24Hour && businessDate.getHours() < shopDayStartHour) {
        businessDate.setDate(businessDate.getDate() - 1);
    }
    return formatLocalDate(businessDate);
}
function getBusinessDateInfo(now = new Date()) {
    const settings = getShopTimingSettings();
    return {
        date: getBusinessDate(now),
        ...settings
    };
}
