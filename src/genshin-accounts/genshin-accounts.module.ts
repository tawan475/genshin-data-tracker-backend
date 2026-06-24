import { Module } from '@nestjs/common';
import { GenshinAccountsController } from './genshin-accounts.controller';
import { GenshinAccountsService } from './genshin-accounts.service';
import { SnapshotExportService } from './snapshot-export.service';
import { GenshinImportController } from './genshin-import.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [GenshinAccountsController, GenshinImportController],
  providers: [GenshinAccountsService, SnapshotExportService],
  exports: [GenshinAccountsService, SnapshotExportService],
})
export class GenshinAccountsModule {}
