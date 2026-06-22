import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { GoodsService } from '../goods/goods.service';
import { ImportKeyGuard } from '../auth/guards/import-key.guard';
import { CreateGoodDto } from '../goods/dto/create-good.dto';

@Controller('import')
export class ImportController {
  constructor(private readonly goodsService: GoodsService) {}

  @Get('verify')
  @UseGuards(ImportKeyGuard)
  verifyKey(@Request() req: any) {
    // The ImportKeyGuard already attaches the genshinAccount to the request
    const account = req.genshinAccount;
    return {
      success: true,
      account: {
        id: account.id,
        accountName: account.accountName,
        uid: account.uid,
        server: account.server,
      },
    };
  }

  @Post('goods')
  @UseGuards(ImportKeyGuard)
  importGoods(@Request() req: any, @Body() dto: CreateGoodDto) {
    const accountId = req.genshinAccount.id;
    return this.goodsService.create(accountId, dto);
  }
}
