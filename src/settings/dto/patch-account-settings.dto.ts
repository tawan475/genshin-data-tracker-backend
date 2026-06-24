import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { TimelineGroupBy } from '../../common/settings/settings.types';

export class PatchMaterialsGraphSettingsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedKeys?: string[];

  @IsOptional()
  @IsIn(['hour', 'day', 'month', 'year'])
  groupBy?: TimelineGroupBy;

  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(3650)
  limit?: number;
}

export class PatchAccountSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PatchMaterialsGraphSettingsDto)
  materialsGraph?: PatchMaterialsGraphSettingsDto;
}
