import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Use @Res so we can return 503 when the DB is unavailable. Returning 200
  // OK with a "degraded" body silently lies to uptime monitors and load
  // balancers — they keep routing traffic to a broken backend.
  @Get()
  @HttpCode(HttpStatus.OK)
  async check(@Res() res: Response) {
    let dbOk = false;
    try {
      // Bound the DB probe — if Postgres is hung, don't make the health
      // endpoint hang too. 3 seconds is plenty for a single SELECT 1.
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('DB health probe timed out')), 3000),
        ),
      ]);
      dbOk = true;
    } catch {
      // dbOk stays false
    }

    const body = {
      status: dbOk ? 'ok' : 'degraded',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      services: { database: dbOk ? 'ok' : 'error' },
    };

    res.status(dbOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(body);
  }
}
