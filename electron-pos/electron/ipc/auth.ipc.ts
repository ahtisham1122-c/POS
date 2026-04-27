import { ipcMain } from 'electron';
import db from '../database/db';
import bcrypt from 'bcryptjs';
import { logAudit } from '../audit/auditLog';

let currentUser: any = null;

export function getCurrentUser() {
  return currentUser;
}

export function requireCurrentUser(allowedRoles?: string[]) {
  if (!currentUser) {
    throw new Error('Please login first');
  }

  if (allowedRoles && !allowedRoles.includes(currentUser.role)) {
    throw new Error('You do not have permission to perform this action');
  }

  return currentUser;
}

function verifyPasswordOrPin(secret: string, hash: string | null | undefined) {
  if (!hash) return false;
  if (hash.startsWith('$2')) {
    return bcrypt.compareSync(secret, hash);
  }
  return secret === hash;
}

export function requireManagerApproval(pin: unknown, actionLabel: string) {
  requireCurrentUser();
  const approvalPin = String(pin || '').trim();
  if (!approvalPin) {
    throw new Error(`Manager PIN is required for ${actionLabel}`);
  }

  const managers = db.prepare(`
    SELECT id, name, username, role, password_hash, manager_pin_hash
    FROM users
    WHERE is_active = 1 AND role IN ('ADMIN', 'MANAGER')
  `).all() as any[];

  const approver = managers.find((manager) =>
    verifyPasswordOrPin(approvalPin, manager.manager_pin_hash) ||
    verifyPasswordOrPin(approvalPin, manager.password_hash)
  );

  if (!approver) {
    throw new Error('Wrong manager PIN. Action blocked.');
  }

  return {
    id: approver.id,
    name: approver.name,
    username: approver.username,
    role: approver.role
  };
}

export function registerAuthIPC() {
  ipcMain.handle('auth:login', async (_event, credentials: any) => {
    try {
      const username = String(credentials?.username || '').trim();
      const password = String(credentials?.password || '');
      const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username) as any;
      if (!user) return { success: false, error: 'Invalid username or password' };

      let isValid = false;
      if (typeof user.password_hash === 'string' && user.password_hash.startsWith('$2')) {
        isValid = await bcrypt.compare(password, user.password_hash);
      } else {
        // Backward compatibility for non-hashed local test data.
        isValid = password === user.password_hash;
      }

      if (!isValid) return { success: false, error: 'Invalid username or password' };

      currentUser = {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role
      };
      logAudit({
        actionType: 'LOGIN',
        entityType: 'users',
        entityId: user.id,
        after: { username: user.username, role: user.role },
        actor: currentUser
      });
      return { success: true, user: currentUser };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('auth:getMe', () => {
    return currentUser;
  });

  ipcMain.handle('auth:getUsers', () => {
    return db.prepare('SELECT id, name, username, role FROM users WHERE is_active = 1').all();
  });

  ipcMain.handle('auth:logout', () => {
    if (currentUser) {
      logAudit({
        actionType: 'LOGOUT',
        entityType: 'users',
        entityId: currentUser.id,
        actor: currentUser
      });
    }
    currentUser = null;
    return { success: true };
  });

  ipcMain.handle('auth:verifyManagerPin', (_event, data: { pin?: string; action?: string }) => {
    try {
      const approver = requireManagerApproval(data?.pin, data?.action || 'this action');
      return { success: true, approver };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('auth:setManagerPin', async (_event, data: { userId?: string; currentPassword?: string; newPin?: string }) => {
    try {
      const actor = requireCurrentUser(['ADMIN']);
      const targetUserId = String(data?.userId || actor.id);
      const currentPassword = String(data?.currentPassword || '');
      const newPin = String(data?.newPin || '').trim();

      if (!/^\d{4,8}$/.test(newPin)) {
        throw new Error('Manager PIN must be 4 to 8 digits');
      }

      if (newPin === '1234' || newPin === '0000') {
        throw new Error('Please choose a private PIN, not 1234 or 0000');
      }

      const actorRow = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(actor.id) as any;
      if (!actorRow || !verifyPasswordOrPin(currentPassword, actorRow.password_hash)) {
        throw new Error('Admin password is incorrect. PIN was not changed.');
      }

      const target = db.prepare(`
        SELECT id, name, role
        FROM users
        WHERE id = ? AND is_active = 1 AND role IN ('ADMIN', 'MANAGER')
      `).get(targetUserId) as any;
      if (!target) {
        throw new Error('Select an active admin or manager user');
      }

      const now = new Date().toISOString();
      db.prepare('UPDATE users SET manager_pin_hash = ?, updated_at = ?, synced = 0 WHERE id = ?')
        .run(bcrypt.hashSync(newPin, 12), now, target.id);

      logAudit({
        actionType: 'MANAGER_PIN_CHANGED',
        entityType: 'users',
        entityId: target.id,
        after: { targetUser: target.name, role: target.role },
        actor
      });

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
