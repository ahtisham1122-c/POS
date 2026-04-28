import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SyncService } from './sync.service';
import { SyncSecretGuard } from './sync-secret.guard';

// Electron polls every 5 s — exempt from the global rate limit
@SkipThrottle()
@Controller('sync')
@UseGuards(SyncSecretGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('ingest')
  async ingest(@Body() payload: any) {
    return this.syncService.processOperation(payload);
  }

  @Post('ingest-batch')
  async ingestBatch(@Body('operations') operations: any[]) {
    return this.syncService.processBatch(operations);
  }

  @Get('pull')
  async pullData(@Query('deviceId') deviceId: string, @Query('since') since: string) {
    return this.syncService.pullData(deviceId, since);
  }

  @Get('status')
  async getStatus(@Query('deviceId') deviceId: string) {
    return this.syncService.getStatus(deviceId);
  }

  @Post('verify-records')
  async verifyRecords(@Body('records') records: Array<{ table: string; id: string }>) {
    return this.syncService.verifyRecords(records);
  }

  @Post('register-device')
  async registerDevice(@Body() payload: any) {
    return this.syncService.registerDevice(payload);
  }

  @Get('devices')
  async getAllDevices() {
    return this.syncService.getAllDevices();
  }
}
