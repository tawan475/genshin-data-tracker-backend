import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { GoodsService } from './goods.service';
import { CreateGoodDto } from './dto/create-good.dto';
import { PaginationDto } from '../common/dto/pagination.dto';

@Controller('genshin-accounts/:accountId/goods')
export class GoodsController {
  constructor(private readonly goodsService: GoodsService) {}

  @Post()
  create(
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() dto: CreateGoodDto,
  ) {
    return this.goodsService.create(accountId, dto);
  }

  @Get()
  findAll(
    @Param('accountId', ParseIntPipe) accountId: number,
    @Query() pagination: PaginationDto,
  ) {
    return this.goodsService.findAllByAccount(accountId, pagination);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.goodsService.findOne(id);
  }
}
