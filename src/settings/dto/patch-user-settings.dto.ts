import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class PatchUserSettingsDto {
  @IsOptional()
  @IsIn(['light', 'dark'])
  theme?: 'light' | 'dark';

  @IsOptional()
  @IsBoolean()
  use24Hour?: boolean;
}
