import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { getCurrentUser } from './auth.ipc';

// ─── Types ────────────────────────────────────────────────────────────────────

type EmployeeInput = {
  name: string;
  phone?: string;
  address?: string;
  startDate: string;
  salary: number;
  notes?: string;
};

type AdvanceInput = {
  employeeId: string;
  amount: number;
  advanceDate: string;
  description?: string;
};

type LeaveInput = {
  employeeId: string;
  leaveDate: string;
  days: number;
  reason?: string;
};

type SalaryPayInput = {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  notes?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextEmployeeCode() {
  const row = db.prepare('SELECT COUNT(*) as count FROM employees').get() as any;
  return `EMP-${String(Number(row?.count || 0) + 1).padStart(4, '0')}`;
}

// Calculate default salary period for an employee.
// Period goes from the employee's start DAY of month to the day before that same day next month.
// e.g. start_date = 2024-03-10 → period for April = 2024-04-10 to 2024-05-09
function getDefaultPeriod(startDate: string, targetMonth?: string): { start: string; end: string } {
  const start = new Date(startDate);
  const startDay = start.getDate();

  const ref = targetMonth ? new Date(targetMonth + '-01') : new Date();
  const year = ref.getFullYear();
  const month = ref.getMonth();

  const periodStart = new Date(year, month, startDay);
  const periodEnd = new Date(year, month + 1, startDay - 1);

  return {
    start: periodStart.toISOString().split('T')[0],
    end: periodEnd.toISOString().split('T')[0],
  };
}

// Core salary calculation — used for preview and for saving a payment.
function calculateSalaryForPeriod(employeeId: string, periodStart: string, periodEnd: string) {
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId) as any;
  if (!employee) throw new Error('Employee not found');

  const salary = Number(employee.salary);
  const dailyRate = salary / 30;

  // Count leave days that fall within this period
  const leaveRow = db.prepare(`
    SELECT COALESCE(SUM(days), 0) as total_days
    FROM employee_leaves
    WHERE employee_id = ? AND leave_date >= ? AND leave_date <= ?
  `).get(employeeId, periodStart, periodEnd) as any;
  const daysOff = Number(leaveRow?.total_days || 0);

  // Total calendar days in the period (inclusive both ends)
  const s = new Date(periodStart);
  const e = new Date(periodEnd);
  const daysInPeriod = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const daysWorked = Math.max(0, daysInPeriod - daysOff);

  // Gross = (salary / 30) * days_worked
  const grossSalary = dailyRate * daysWorked;

  // Sum of PENDING advances in this period
  const advRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM employee_advances
    WHERE employee_id = ? AND advance_date >= ? AND advance_date <= ? AND status = 'PENDING'
  `).get(employeeId, periodStart, periodEnd) as any;
  const advanceDeduction = Number(advRow?.total || 0);

  const netSalary = Math.max(0, grossSalary - advanceDeduction);

  return {
    employee,
    salary,
    dailyRate,
    periodStart,
    periodEnd,
    daysInPeriod,
    daysWorked,
    daysOff,
    grossSalary,
    advanceDeduction,
    netSalary,
  };
}

// ─── IPC Registration ─────────────────────────────────────────────────────────

export function registerEmployeesIPC() {

  // List all employees
  ipcMain.handle('employees:getAll', (_event, showInactive = false) => {
    return db.prepare(`
      SELECT * FROM employees
      ${showInactive ? '' : 'WHERE is_active = 1'}
      ORDER BY name ASC
    `).all();
  });

  // Get one employee with all sub-records
  ipcMain.handle('employees:getOne', (_event, id: string) => {
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as any;
    if (!employee) return null;

    const salaryHistory = db.prepare(`
      SELECT * FROM employee_salary_history WHERE employee_id = ? ORDER BY effective_date DESC
    `).all(id);

    const advances = db.prepare(`
      SELECT * FROM employee_advances WHERE employee_id = ? ORDER BY advance_date DESC
    `).all(id);

    const leaves = db.prepare(`
      SELECT * FROM employee_leaves WHERE employee_id = ? ORDER BY leave_date DESC
    `).all(id);

    const payments = db.prepare(`
      SELECT * FROM employee_salary_payments WHERE employee_id = ? ORDER BY period_start DESC
    `).all(id);

    return { ...employee, salaryHistory, advances, leaves, payments };
  });

  // Create employee
  ipcMain.handle('employees:create', (_event, data: EmployeeInput) => {
    try {
      if (!data.name?.trim()) return { success: false, error: 'Employee name is required' };
      if (!data.startDate) return { success: false, error: 'Start date is required' };
      if (Number(data.salary) < 0) return { success: false, error: 'Salary cannot be negative' };

      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const code = nextEmployeeCode();
      const user = getCurrentUser();

      db.transaction(() => {
        db.prepare(`
          INSERT INTO employees (id, code, name, phone, address, start_date, salary, is_active, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        `).run(id, code, data.name.trim(), data.phone || null, data.address || null, data.startDate, Number(data.salary), data.notes || null, now, now);

        // Record the starting salary in history
        db.prepare(`
          INSERT INTO employee_salary_history (id, employee_id, salary, effective_date, notes, changed_by_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), id, Number(data.salary), data.startDate, 'Starting salary', user?.id || 'system', now);
      })();

      return { success: true, id, code };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Update employee info (name, phone, address, notes only — not salary)
  ipcMain.handle('employees:update', (_event, id: string, data: Partial<EmployeeInput>) => {
    try {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE employees
        SET name = COALESCE(?, name), phone = ?, address = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(data.name?.trim() || null, data.phone || null, data.address || null, data.notes || null, now, id);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Update salary — saves history entry
  ipcMain.handle('employees:updateSalary', (_event, id: string, newSalary: number, effectiveDate: string, notes?: string) => {
    try {
      const user = getCurrentUser();
      const now = new Date().toISOString();

      db.transaction(() => {
        db.prepare(`UPDATE employees SET salary = ?, updated_at = ? WHERE id = ?`).run(Number(newSalary), now, id);
        db.prepare(`
          INSERT INTO employee_salary_history (id, employee_id, salary, effective_date, notes, changed_by_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), id, Number(newSalary), effectiveDate, notes || 'Salary updated', user?.id || 'system', now);
      })();

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Mark employee as left
  ipcMain.handle('employees:markLeft', (_event, id: string, leftDate: string) => {
    try {
      const now = new Date().toISOString();
      db.prepare(`UPDATE employees SET is_active = 0, left_date = ?, updated_at = ? WHERE id = ?`).run(leftDate, now, id);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Add advance payment
  ipcMain.handle('employees:addAdvance', (_event, data: AdvanceInput) => {
    try {
      if (!data.employeeId) return { success: false, error: 'Employee is required' };
      if (Number(data.amount) <= 0) return { success: false, error: 'Amount must be greater than zero' };
      if (!data.advanceDate) return { success: false, error: 'Date is required' };

      const user = getCurrentUser();
      const now = new Date().toISOString();
      const id = crypto.randomUUID();

      db.prepare(`
        INSERT INTO employee_advances (id, employee_id, amount, advance_date, description, status, given_by_id, created_at)
        VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)
      `).run(id, data.employeeId, Number(data.amount), data.advanceDate, data.description || null, user?.id || 'system', now);

      return { success: true, id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Add leave record
  ipcMain.handle('employees:addLeave', (_event, data: LeaveInput) => {
    try {
      if (!data.employeeId) return { success: false, error: 'Employee is required' };
      if (Number(data.days) <= 0) return { success: false, error: 'Days must be greater than zero' };
      if (!data.leaveDate) return { success: false, error: 'Date is required' };

      const user = getCurrentUser();
      const now = new Date().toISOString();
      const id = crypto.randomUUID();

      db.prepare(`
        INSERT INTO employee_leaves (id, employee_id, leave_date, days, reason, created_by_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, data.employeeId, data.leaveDate, Number(data.days), data.reason || null, user?.id || 'system', now);

      return { success: true, id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Preview salary calculation (no save)
  ipcMain.handle('employees:calculateSalary', (_event, employeeId: string, periodStart: string, periodEnd: string) => {
    try {
      const data = calculateSalaryForPeriod(employeeId, periodStart, periodEnd);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Save salary payment and mark advances as deducted
  ipcMain.handle('employees:paySalary', (_event, data: SalaryPayInput) => {
    try {
      if (!data.employeeId || !data.periodStart || !data.periodEnd) {
        return { success: false, error: 'Employee and period dates are required' };
      }

      const user = getCurrentUser();
      const now = new Date().toISOString();
      const calc = calculateSalaryForPeriod(data.employeeId, data.periodStart, data.periodEnd);
      const paymentId = crypto.randomUUID();

      db.transaction(() => {
        db.prepare(`
          INSERT INTO employee_salary_payments (
            id, employee_id, period_start, period_end, base_salary,
            days_in_period, days_worked, days_off, gross_salary,
            advance_deduction, net_salary, paid_date, paid_by_id, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          paymentId, data.employeeId, data.periodStart, data.periodEnd,
          calc.salary, calc.daysInPeriod, calc.daysWorked, calc.daysOff,
          calc.grossSalary, calc.advanceDeduction, calc.netSalary,
          now.split('T')[0], user?.id || 'system', data.notes || null, now
        );

        // Mark all pending advances in this period as DEDUCTED
        db.prepare(`
          UPDATE employee_advances
          SET status = 'DEDUCTED', deducted_payment_id = ?
          WHERE employee_id = ? AND advance_date >= ? AND advance_date <= ? AND status = 'PENDING'
        `).run(paymentId, data.employeeId, data.periodStart, data.periodEnd);
      })();

      return { success: true, id: paymentId, calc };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get default period dates for a given employee and optional target month
  ipcMain.handle('employees:getDefaultPeriod', (_event, startDate: string, targetMonth?: string) => {
    return getDefaultPeriod(startDate, targetMonth);
  });

  // Calculate notice pay when employee leaves: (salary/30) * 35 days
  ipcMain.handle('employees:calculateLeavingPay', (_event, employeeId: string) => {
    try {
      const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId) as any;
      if (!employee) return { success: false, error: 'Employee not found' };
      const dailyRate = Number(employee.salary) / 30;
      const leavingDays = 35; // 1 month + 5 days
      const leavingPay = dailyRate * leavingDays;
      return { success: true, data: { salary: employee.salary, dailyRate, days: leavingDays, leavingPay } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
