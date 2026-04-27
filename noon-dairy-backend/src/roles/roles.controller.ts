import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  getRolePermissions() {
    return this.rolesService.getRolePermissions();
  }

  @Get(':role')
  getPermissionsForRole(@Param('role') role: Role) {
    return {
      role,
      permissions: this.rolesService.getPermissionsForRole(role),
    };
  }
}
