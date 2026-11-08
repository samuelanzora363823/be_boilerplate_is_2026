import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { NotificationSource } from '../generated/prisma/client.js';

// H26: filtros y paginación de la bandeja.
export class ListNotificationsQueryDto {
  @IsOptional()
  @IsIn(['NO_LEIDA', 'LEIDA'], { message: 'status debe ser NO_LEIDA o LEIDA' })
  status?: 'NO_LEIDA' | 'LEIDA';

  @IsOptional()
  @IsEnum(NotificationSource, { message: 'sourceModule debe ser COCINA, RESERVAS o INVENTARIO' })
  sourceModule?: NotificationSource;

  @IsOptional() @Type(() => Number)
  @IsInt({ message: 'page debe ser un entero mayor o igual a 1' })
  @Min(1, { message: 'page debe ser un entero mayor o igual a 1' })
  page?: number;

  @IsOptional() @Type(() => Number)
  @IsInt({ message: 'limit debe estar entre 1 y 50' })
  @Min(1, { message: 'limit debe estar entre 1 y 50' })
  @Max(50, { message: 'limit debe estar entre 1 y 50' })
  limit?: number;
}
