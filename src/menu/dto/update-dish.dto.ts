
import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateDishDto } from './create-dish.dto.js';

export enum DishStatusDto {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}

export class UpdateDishDto extends PartialType(CreateDishDto) {
  @IsOptional()
  @IsEnum(DishStatusDto)
  status?: DishStatusDto;
}
