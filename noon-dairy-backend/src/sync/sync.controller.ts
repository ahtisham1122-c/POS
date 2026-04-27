import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncSecretGuard } from './sync-secret.guard';

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

  @Post('register-device')
  async registerDevice(@Body() payload: any) {
    return this.syncService.registerDevice(payload);
  }

  @Get('devices')
  async getAllDevices() {
    return this.syncService.getAllDevices();
  }
}
