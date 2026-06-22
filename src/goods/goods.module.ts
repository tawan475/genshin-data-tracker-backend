import { Module } from '@nestjs/common';
import { GoodsController } from './goods.controller';
import { GoodsService } from './goods.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [GoodsController],
  providers: [GoodsService, PrismaService],
  exports: [GoodsService],
})
export class GoodsModule {}
