import { IsOptional, IsString, IsEnum } from 'class-validator';
import { GenshinServer } from '@prisma/client';

export class UpdateGenshinAccountDto {
  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  uid?: string;

  @IsOptional()
  @IsEnum(GenshinServer)
  server?: GenshinServer;

  @IsOptional()
  isGlobalArtifactRankingOptIn?: boolean;
}
