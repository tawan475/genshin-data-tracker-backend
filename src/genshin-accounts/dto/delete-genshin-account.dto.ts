import { IsString, IsNotEmpty } from 'class-validator';

export class DeleteGenshinAccountDto {
  @IsString()
  @IsNotEmpty()
  accountName: string;
}
