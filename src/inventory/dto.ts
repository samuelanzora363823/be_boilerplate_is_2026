import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { MovementType } from '../generated/prisma/client.js';

// H14: registro de entradas y salidas de insumos.
export class CreateMovementDto {
  @IsString({ message: 'Selecciona un insumo válido' })
  @Length(1, 40, { message: 'Selecciona un insumo válido' })
  supplyId!: string;

  @IsEnum(MovementType, { message: 'El tipo debe ser ENTRADA o SALIDA' })
  type!: MovementType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'La cantidad admite máximo 3 decimales' })
  @Min(0.001, { message: 'La cantidad debe ser mayor que 0' })
  @Max(99999.999, { message: 'La cantidad máxima es 99 999.999' })
  quantity!: number;

  @IsString({ message: 'El motivo debe tener entre 3 y 200 caracteres' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason!: string;
}

// H14: lista de insumos para el formulario (GET /inventory?limit=100).
export class ListInventoryQueryDto {
  @IsOptional() @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe estar entre 1 y 100' })
  @Max(100, { message: 'limit debe estar entre 1 y 100' })
  limit?: number;
}
