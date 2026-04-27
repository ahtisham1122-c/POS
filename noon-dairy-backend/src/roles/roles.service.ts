import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';

const ROLE_PERMISSIONS: Record<Role, string[]> = {
  ADMIN: [
    'users.manage',
    'products.manage',
    'customers.manage',
    'sales.manage',
    'reports.view',
    'settings.manage',
  ],
  MANAGER: [
    'products.manage',
    'customers.manage',
    'sales.manage',
    'reports.view',
  ],
  CASHIER: [
    'sales.create',
    'customers.view',
    'customers.collect-payment',
    'products.view',
  ],
  STAFF: [
    'products.view',
    'inventory.manage',
  ],
};

@Injectable()
export class RolesService {
  getRolePermissions() {
    return ROLE_PERMISSIONS;
  }

  getPermissionsForRole(role: Role) {
    return ROLE_PERMISSIONS[role] || [];
  }
}
