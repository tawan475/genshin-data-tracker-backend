import { IsArray, IsBoolean, IsInt, IsOptional } from 'class-validator';

export class BulkSnapshotActionDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  snapshotIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;
}
