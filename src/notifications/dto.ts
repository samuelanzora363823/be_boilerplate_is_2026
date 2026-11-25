import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { NotificationSource } from '../generated/prisma/client.js';

// H26: filtros y paginación de la bandeja.
export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ enum: ['NO_LEIDA', 'LEIDA'], description: 'Sin valor devuelve todas.' })
  @IsOptional()
  @IsIn(['NO_LEIDA', 'LEIDA'], { message: 'status debe ser NO_LEIDA o LEIDA' })
  status?: 'NO_LEIDA' | 'LEIDA';

  @ApiPropertyOptional({ enum: NotificationSource })
  @IsOptional()
  @IsEnum(NotificationSource, { message: 'sourceModule debe ser COCINA, RESERVAS o INVENTARIO' })
  sourceModule?: NotificationSource;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional() @Type(() => Number)
  @IsInt({ message: 'page debe ser un entero mayor o igual a 1' })
  @Min(1, { message: 'page debe ser un entero mayor o igual a 1' })
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 10 })
  @IsOptional() @Type(() => Number)
  @IsInt({ message: 'limit debe estar entre 1 y 50' })
  @Min(1, { message: 'limit debe estar entre 1 y 50' })
  @Max(50, { message: 'limit debe estar entre 1 y 50' })
  limit?: number;
}
