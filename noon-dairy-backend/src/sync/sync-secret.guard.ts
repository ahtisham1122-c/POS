import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class SyncSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedSecret = process.env.SYNC_DEVICE_SECRET;
    if (!expectedSecret) {
      throw new UnauthorizedException('Sync is not configured on this server');
    }

    const request = context.switchToHttp().getRequest();
    const providedSecret = request.header('x-sync-secret');
    if (!providedSecret) {
      throw new UnauthorizedException('Missing sync credentials');
    }

    const expectedBuffer = Buffer.from(expectedSecret);
    const providedBuffer = Buffer.from(providedSecret);
    if (expectedBuffer.length !== providedBuffer.length) {
      throw new UnauthorizedException('Invalid sync credentials');
    }

    if (!timingSafeEqual(expectedBuffer, providedBuffer)) {
      throw new UnauthorizedException('Invalid sync credentials');
    }

    return true;
  }
}
