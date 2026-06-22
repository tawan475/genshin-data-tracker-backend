import { Module } from '@nestjs/common';
import { GenshinAccountsController } from './genshin-accounts.controller';
import { GenshinAccountsService } from './genshin-accounts.service';
import { PrismaService } from '../prisma.service';
import { GenshinImportController } from './genshin-import.controller';

@Module({
  controllers: [GenshinAccountsController, GenshinImportController],
  providers: [GenshinAccountsService, PrismaService],
  exports: [GenshinAccountsService],
})
export class GenshinAccountsModule {}
