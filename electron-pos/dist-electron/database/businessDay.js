"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatLocalDate = formatLocalDate;
exports.getShopTimingSettings = getShopTimingSettings;
exports.getBusinessDate = getBusinessDate;
exports.getOpenShift = getOpenShift;
exports.getActiveBusinessDate = getActiveBusinessDate;
exports.getLateSaleNote = getLateSaleNote;
exports.shouldWarnBeforeOpeningShift = shouldWarnBeforeOpeningShift;
exports.getBusinessDateInfo = getBusinessDateInfo;
const db_1 = __importDefault(require("./db"));
function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function getShopTimingSettings() {
    const rows = db_1.default.prepare(`SELECT key, value FROM settings WHERE key IN ('shopDayStartHour', 'ramadan24Hour', '24_hour_mode')`).all();
    const settings = rows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
    }, {});
    const configuredStartHour = Number(settings.shopDayStartHour ?? 5);
    const shopDayStartHour = Number.isFinite(configuredStartHour)
        ? Math.max(0, Math.min(23, Math.floor(configuredStartHour)))
        : 5;
    const is24HourMode = String(settings['24_hour_mode'] || settings.ramadan24Hour || 'false').toLowerCase() === 'true';
    return { shopDayStartHour, ramadan24Hour: is24HourMode, is24HourMode };
}
function getBusinessDate(now = new Date()) {
    const { shopDayStartHour, is24HourMode } = getShopTimingSettings();
    const businessDate = new Date(now);
    if (!is24HourMode && businessDate.getHours() < shopDayStartHour) {
        businessDate.setDate(businessDate.getDate() - 1);
    }
    return formatLocalDate(businessDate);
}
function getOpenShift() {
    return db_1.default.prepare(`
    SELECT *
    FROM shifts
    WHERE status = 'OPEN'
    ORDER BY opened_at DESC
    LIMIT 1
  `).get();
}
function getActiveBusinessDate(now = new Date()) {
    const openShift = getOpenShift();
    return openShift?.shift_date || getBusinessDate(now);
}
function getLateSaleNote(shift, now = new Date()) {
    const { shopDayStartHour, is24HourMode } = getShopTimingSettings();
    const calendarDate = formatLocalDate(now);
    if (!shift || is24HourMode || now.getHours() >= shopDayStartHour || shift.shift_date === calendarDate) {
        return null;
    }
    return 'Late sale added to previous business day.';
}
function shouldWarnBeforeOpeningShift(now = new Date()) {
    const { shopDayStartHour, is24HourMode } = getShopTimingSettings();
    return !is24HourMode && now.getHours() < shopDayStartHour;
}
function getBusinessDateInfo(now = new Date()) {
    const settings = getShopTimingSettings();
    const openShift = getOpenShift();
    return {
        date: openShift?.shift_date || getBusinessDate(now),
        openShiftId: openShift?.id || null,
        openShiftOpenedAt: openShift?.opened_at || null,
        ...settings
    };
}
