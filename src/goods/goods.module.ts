import { Module } from '@nestjs/common';
import { GoodsController } from './goods.controller';
import { GoodsService } from './goods.service';
import { } from '../prisma.service';

@Module({
  controllers: [GoodsController],
  providers: [GoodsService],
  exports: [GoodsService],
})
export class GoodsModule {}
