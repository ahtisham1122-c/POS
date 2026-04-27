import db from './db';

export function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getShopTimingSettings() {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN ('shopDayStartHour', 'ramadan24Hour', '24_hour_mode')`).all() as Array<{ key: string; value: string }>;
  const settings = rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});

  const configuredStartHour = Number(settings.shopDayStartHour ?? 5);
  const shopDayStartHour = Number.isFinite(configuredStartHour)
    ? Math.max(0, Math.min(23, Math.floor(configuredStartHour)))
    : 5;
  const is24HourMode =
    String(settings['24_hour_mode'] || settings.ramadan24Hour || 'false').toLowerCase() === 'true';

  return { shopDayStartHour, ramadan24Hour: is24HourMode, is24HourMode };
}

export function getBusinessDate(now = new Date()) {
  const { shopDayStartHour, is24HourMode } = getShopTimingSettings();
  const businessDate = new Date(now);

  if (!is24HourMode && businessDate.getHours() < shopDayStartHour) {
    businessDate.setDate(businessDate.getDate() - 1);
  }

  return formatLocalDate(businessDate);
}

export function getOpenShift() {
  return db.prepare(`
    SELECT *
    FROM shifts
    WHERE status = 'OPEN'
    ORDER BY opened_at DESC
    LIMIT 1
  `).get() as any;
}

export function getActiveBusinessDate(now = new Date()) {
  const openShift = getOpenShift();
  return openShift?.shift_date || getBusinessDate(now);
}

export function getLateSaleNote(shift: any, now = new Date()) {
  const { shopDayStartHour, is24HourMode } = getShopTimingSettings();
  const calendarDate = formatLocalDate(now);
  if (!shift || is24HourMode || now.getHours() >= shopDayStartHour || shift.shift_date === calendarDate) {
    return null;
  }

  return 'Late sale added to previous business day.';
}

export function shouldWarnBeforeOpeningShift(now = new Date()) {
  const { shopDayStartHour, is24HourMode } = getShopTimingSettings();
  return !is24HourMode && now.getHours() < shopDayStartHour;
}

export function getBusinessDateInfo(now = new Date()) {
  const settings = getShopTimingSettings();
  const openShift = getOpenShift();
  return {
    date: openShift?.shift_date || getBusinessDate(now),
    openShiftId: openShift?.id || null,
    openShiftOpenedAt: openShift?.opened_at || null,
    ...settings
  };
}
