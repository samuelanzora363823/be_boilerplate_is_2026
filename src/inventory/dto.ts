import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { MovementType } from '../generated/prisma/client.js';

// H14: registro de entradas y salidas de insumos.
export class CreateMovementDto {
  @ApiProperty({ description: 'Insumo de la sucursal del gerente.' })
  @IsString({ message: 'Selecciona un insumo válido' })
  @Length(1, 40, { message: 'Selecciona un insumo válido' })
  supplyId!: string;

  @ApiProperty({ enum: MovementType })
  @IsEnum(MovementType, { message: 'El tipo debe ser ENTRADA o SALIDA' })
  type!: MovementType;

  @ApiProperty({ example: 5, description: 'Mayor que 0 y hasta 99 999.999, máximo 3 decimales.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'La cantidad admite máximo 3 decimales' })
  @Min(0.001, { message: 'La cantidad debe ser mayor que 0' })
  @Max(99999.999, { message: 'La cantidad máxima es 99 999.999' })
  quantity!: number;

  @ApiProperty({ example: 'Compra semanal', minLength: 3, maxLength: 200 })
  @IsString({ message: 'El motivo debe tener entre 3 y 200 caracteres' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason!: string;
}

// H15: consulta de existencias (H14 la usa con limit=100 para el formulario).
export class ListInventoryQueryDto {
  @ApiPropertyOptional({ maxLength: 50, description: 'Busca por nombre sin distinguir mayúsculas ni acentos.' })
  @IsOptional()
  @IsString({ message: 'La búsqueda admite máximo 50 caracteres.' })
  @MaxLength(50, { message: 'La búsqueda admite máximo 50 caracteres.' })
  search?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Solo por agotarse.' })
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'lowStock debe ser true o false' })
  lowStock?: 'true' | 'false';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional() @Type(() => Number)
  @IsInt({ message: 'page debe ser un entero mayor o igual a 1' })
  @Min(1, { message: 'page debe ser un entero mayor o igual a 1' })
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional() @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe estar entre 1 y 100' })
  @Max(100, { message: 'limit debe estar entre 1 y 100' })
  limit?: number;
}
