import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  get parsedPage(): number {
    const val = typeof this.page === 'string' ? parseInt(this.page, 10) : this.page;
    return isNaN(val) ? 1 : val;
  }

  get parsedLimit(): number {
    const val = typeof this.limit === 'string' ? parseInt(this.limit, 10) : this.limit;
    return isNaN(val) ? 20 : val;
  }

  get skip(): number {
    return (this.parsedPage - 1) * this.parsedLimit;
  }

  get take(): number {
    return this.parsedLimit;
  }
}
