import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { GoodsModule } from '../goods/goods.module';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [GoodsModule],
  controllers: [ImportController],
  providers: [PrismaService],
})
export class ImportModule {}
