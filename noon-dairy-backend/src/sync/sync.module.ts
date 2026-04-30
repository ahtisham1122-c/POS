import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncSecretGuard } from './sync-secret.guard';

@Module({
  controllers: [SyncController],
  providers: [SyncService, SyncSecretGuard],
  exports: [SyncService],
})
export class SyncModule {}
