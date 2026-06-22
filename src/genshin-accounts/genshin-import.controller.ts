import {
  Controller,
  Post,
  Get,
  Body,
  UseInterceptors,
  UploadedFile,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GenshinAccountsService } from './genshin-accounts.service';

@Controller('genshin-accounts-public')
export class GenshinImportController {
  constructor(private readonly genshinAccountsService: GenshinAccountsService) {}

  @Get('verify-key')
  verifyKey(@Headers('x-import-key') importKey: string) {
    if (!importKey) {
      throw new UnauthorizedException('Missing import key header');
    }
    return this.genshinAccountsService.verifyImportKey(importKey);
  }

  @Post('import-by-key')
  @UseInterceptors(FileInterceptor('file'))
  importDataByKey(
    @Headers('x-import-key') importKey: string,
    @UploadedFile() file: any,
    @Body('timestamp') timestamp?: string,
  ) {
    if (!importKey) {
      throw new UnauthorizedException('Missing import key header');
    }
    return this.genshinAccountsService.importDataByKey(importKey, file, timestamp);
  }
}
