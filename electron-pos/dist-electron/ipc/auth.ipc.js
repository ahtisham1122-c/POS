"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentUser = getCurrentUser;
exports.requireCurrentUser = requireCurrentUser;
exports.requireManagerApproval = requireManagerApproval;
exports.registerAuthIPC = registerAuthIPC;
const electron_1 = require("electron");
const db_1 = __importDefault(require("../database/db"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const auditLog_1 = require("../audit/auditLog");
let currentUser = null;
function getCurrentUser() {
    return currentUser;
}
function requireCurrentUser(allowedRoles) {
    if (!currentUser) {
        throw new Error('Please login first');
    }
    if (allowedRoles && !allowedRoles.includes(currentUser.role)) {
        throw new Error('You do not have permission to perform this action');
    }
    return currentUser;
}
function verifyPasswordOrPin(secret, hash) {
    if (!hash)
        return false;
    if (hash.startsWith('$2')) {
        return bcryptjs_1.default.compareSync(secret, hash);
    }
    return secret === hash;
}
function requireManagerApproval(pin, actionLabel) {
    requireCurrentUser();
    const approvalPin = String(pin || '').trim();
    if (!approvalPin) {
        throw new Error(`Manager PIN is required for ${actionLabel}`);
    }
    const managers = db_1.default.prepare(`
    SELECT id, name, username, role, password_hash, manager_pin_hash
    FROM users
    WHERE is_active = 1 AND role IN ('ADMIN', 'MANAGER')
  `).all();
    const approver = managers.find((manager) => verifyPasswordOrPin(approvalPin, manager.manager_pin_hash) ||
        verifyPasswordOrPin(approvalPin, manager.password_hash));
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
function registerAuthIPC() {
    electron_1.ipcMain.handle('auth:login', async (_event, credentials) => {
        try {
            const username = String(credentials?.username || '').trim();
            const password = String(credentials?.password || '');
            const user = db_1.default.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
            if (!user)
                return { success: false, error: 'Invalid username or password' };
            let isValid = false;
            if (typeof user.password_hash === 'string' && user.password_hash.startsWith('$2')) {
                isValid = await bcryptjs_1.default.compare(password, user.password_hash);
            }
            else {
                // Backward compatibility for non-hashed local test data.
                isValid = password === user.password_hash;
            }
            if (!isValid)
                return { success: false, error: 'Invalid username or password' };
            currentUser = {
                id: user.id,
                name: user.name,
                username: user.username,
                role: user.role
            };
            (0, auditLog_1.logAudit)({
                actionType: 'LOGIN',
                entityType: 'users',
                entityId: user.id,
                after: { username: user.username, role: user.role },
                actor: currentUser
            });
            return { success: true, user: currentUser };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('auth:getMe', () => {
        return currentUser;
    });
    electron_1.ipcMain.handle('auth:getUsers', () => {
        return db_1.default.prepare('SELECT id, name, username, role FROM users WHERE is_active = 1').all();
    });
    electron_1.ipcMain.handle('auth:logout', () => {
        if (currentUser) {
            (0, auditLog_1.logAudit)({
                actionType: 'LOGOUT',
                entityType: 'users',
                entityId: currentUser.id,
                actor: currentUser
            });
        }
        currentUser = null;
        return { success: true };
    });
    electron_1.ipcMain.handle('auth:verifyManagerPin', (_event, data) => {
        try {
            const approver = requireManagerApproval(data?.pin, data?.action || 'this action');
            return { success: true, approver };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('auth:setManagerPin', async (_event, data) => {
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
            const actorRow = db_1.default.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(actor.id);
            if (!actorRow || !verifyPasswordOrPin(currentPassword, actorRow.password_hash)) {
                throw new Error('Admin password is incorrect. PIN was not changed.');
            }
            const target = db_1.default.prepare(`
        SELECT id, name, role
        FROM users
        WHERE id = ? AND is_active = 1 AND role IN ('ADMIN', 'MANAGER')
      `).get(targetUserId);
            if (!target) {
                throw new Error('Select an active admin or manager user');
            }
            const now = new Date().toISOString();
            db_1.default.prepare('UPDATE users SET manager_pin_hash = ?, updated_at = ?, synced = 0 WHERE id = ?')
                .run(bcryptjs_1.default.hashSync(newPin, 12), now, target.id);
            (0, auditLog_1.logAudit)({
                actionType: 'MANAGER_PIN_CHANGED',
                entityType: 'users',
                entityId: target.id,
                after: { targetUser: target.name, role: target.role },
                actor
            });
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
}
