import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashSyncToken, safeEqualText } from './sync-token.util';

@Injectable()
export class SyncSecretGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  private isDeviceRegistration(request: any) {
    const method = String(request.method || '').toUpperCase();
    const path = String(request.path || request.url || '').split('?')[0];
    return method === 'POST' && path.endsWith('/sync/register-device');
  }

  private validateMasterSecret(request: any) {
    const expectedSecret = process.env.SYNC_DEVICE_SECRET;
    if (!expectedSecret) {
      throw new UnauthorizedException('Sync is not configured on this server');
    }

    const providedSecret = request.header('x-sync-secret');
    if (!providedSecret) {
      throw new UnauthorizedException('Missing sync credentials');
    }

    if (!safeEqualText(expectedSecret, providedSecret)) {
      throw new UnauthorizedException('Invalid sync credentials');
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    if (this.isDeviceRegistration(request)) {
      this.validateMasterSecret(request);
      return true;
    }

    const deviceId = String(
      request.header('x-device-id') ||
      request.query?.deviceId ||
      request.body?.device?.id ||
      request.body?.deviceId ||
      ''
    ).trim();
    const providedToken = String(request.header('x-device-token') || '').trim();

    if (!deviceId || !providedToken) {
      throw new UnauthorizedException('Missing device sync credentials');
    }

    const device = await this.prisma.device.findUnique({ where: { deviceId } });
    if (!device?.syncTokenHash || device.revokedAt) {
      throw new UnauthorizedException('Device is not registered for sync');
    }

    if (!safeEqualText(device.syncTokenHash, hashSyncToken(providedToken))) {
      throw new UnauthorizedException('Invalid device sync credentials');
    }

    await this.prisma.device.update({
      where: { deviceId },
      data: { lastSeenAt: new Date() }
    }).catch(() => null);

    return true;
  }
}
