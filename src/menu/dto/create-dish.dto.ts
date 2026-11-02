
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';

export class CreateDishDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsString()
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'El precio debe ser positivo y tener máximo 2 decimales',
  })
  price!: string;

  @IsUUID()
  categoryId!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags!: string[];
}
