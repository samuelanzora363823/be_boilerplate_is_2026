import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// Parámetros del reporte de horarios pico (H29). Se aceptan como texto
// y el servicio aplica las reglas comunes de los reportes, para devolver
// los mensajes exactos de la Épica 10.
export class PeakHoursQueryDto {
  @ApiProperty({ description: 'Sucursal (obligatoria).', format: 'uuid' })
  @IsOptional()
  @IsString({ message: 'branchId debe ser texto' })
  branchId?: string;

  @ApiProperty({ description: 'Fecha inicial (aaaa-mm-dd), hora de El Salvador.', example: '2026-11-01' })
  @IsOptional()
  @IsString({ message: 'from debe ser una fecha aaaa-mm-dd' })
  from?: string;

  @ApiProperty({ description: 'Fecha final (aaaa-mm-dd), no posterior a hoy.', example: '2026-11-20' })
  @IsOptional()
  @IsString({ message: 'to debe ser una fecha aaaa-mm-dd' })
  to?: string;
}

// Parámetros del reporte de ventas totales (H27). branchId es opcional:
// sin valor incluye todas las sucursales.
export class SalesQueryDto {
  @ApiPropertyOptional({ description: 'Sucursal; sin valor incluye todas.', format: 'uuid' })
  @IsOptional()
  @IsString({ message: 'branchId debe ser texto' })
  branchId?: string;

  @ApiProperty({ description: 'Fecha inicial (aaaa-mm-dd), hora de El Salvador.', example: '2026-11-01' })
  @IsOptional()
  @IsString({ message: 'from debe ser una fecha aaaa-mm-dd' })
  from?: string;

  @ApiProperty({ description: 'Fecha final (aaaa-mm-dd), no posterior a hoy.', example: '2026-11-20' })
  @IsOptional()
  @IsString({ message: 'to debe ser una fecha aaaa-mm-dd' })
  to?: string;
}

// Parámetros del reporte de platillos más vendidos (H28): mismos filtros
// que H27 (período y sucursal opcional).
export class TopDishesQueryDto extends SalesQueryDto {}

// Parámetros de la comparación de sucursales (H30): solo el período.
export class BranchComparisonQueryDto {
  @ApiProperty({ description: 'Fecha inicial (aaaa-mm-dd), hora de El Salvador.', example: '2026-11-01' })
  @IsOptional()
  @IsString({ message: 'from debe ser una fecha aaaa-mm-dd' })
  from?: string;

  @ApiProperty({ description: 'Fecha final (aaaa-mm-dd), no posterior a hoy.', example: '2026-11-20' })
  @IsOptional()
  @IsString({ message: 'to debe ser una fecha aaaa-mm-dd' })
  to?: string;
}
