import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { GoodsModule } from '../goods/goods.module';

@Module({
  imports: [GoodsModule],
  controllers: [ImportController],
})
export class ImportModule {}
