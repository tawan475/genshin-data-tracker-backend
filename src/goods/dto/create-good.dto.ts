import { Type } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsArray,
  IsBoolean,
  IsObject,
  ValidateNested,
} from 'class-validator';

export class TalentDto {
  @IsNumber()
  auto: number;

  @IsNumber()
  skill: number;

  @IsNumber()
  burst: number;
}

export class CharacterDto {
  @IsString()
  key: string;

  @IsNumber()
  level: number;

  @IsNumber()
  constellation: number;

  @IsNumber()
  ascension: number;

  @ValidateNested()
  @Type(() => TalentDto)
  talent: TalentDto;
}

export class SubstatDto {
  @IsString()
  key: string;

  @IsNumber()
  value: number;

  @IsNumber()
  initialValue: number;
}

export class ArtifactDto {
  @IsString()
  setKey: string;

  @IsString()
  slotKey: string;

  @IsNumber()
  level: number;

  @IsNumber()
  rarity: number;

  @IsString()
  mainStatKey: string;

  @IsString()
  location: string;

  @IsBoolean()
  lock: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubstatDto)
  substats: SubstatDto[];

  @IsNumber()
  totalRolls: number;

  @IsBoolean()
  astralMark: boolean;

  @IsBoolean()
  elixerCrafted: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubstatDto)
  unactivatedSubstats: SubstatDto[];
}

export class WeaponDto {
  @IsString()
  key: string;

  @IsNumber()
  level: number;

  @IsNumber()
  ascension: number;

  @IsNumber()
  refinement: number;

  @IsString()
  location: string;

  @IsBoolean()
  lock: boolean;
}

export class CreateGoodDto {
  @IsString()
  format: string;

  @IsNumber()
  version: number;

  @IsString()
  source: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CharacterDto)
  characters: CharacterDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ArtifactDto)
  artifacts: ArtifactDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WeaponDto)
  weapons: WeaponDto[];

  @IsObject()
  materials: Record<string, number>;

  @IsArray()
  @IsNumber({}, { each: true })
  gi_achievements: number[];
}
