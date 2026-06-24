import { Controller, Get, Param, Query, ParseIntPipe, Patch, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/decorators/user.decorator';
import { SettingsService } from '../settings/settings.service';
import { PatchUserSettingsDto } from '../settings/dto/patch-user-settings.dto';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get()
  findAll(@Query() pagination: PaginationDto) {
    return this.usersService.findAll(pagination);
  }

  @Get('me/settings')
  @UseGuards(JwtAuthGuard)
  getMySettings(@User('id') userId: number) {
    return this.settingsService.getUserSettings(userId);
  }

  @Patch('me/settings')
  @UseGuards(JwtAuthGuard)
  patchMySettings(
    @User('id') userId: number,
    @Body() dto: PatchUserSettingsDto,
  ) {
    return this.settingsService.patchUserSettings(userId, dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }
}
