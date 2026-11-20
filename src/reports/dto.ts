import { IsOptional, IsString } from 'class-validator';

// Parámetros del reporte de horarios pico (H29). Se aceptan como texto
// y el servicio aplica las reglas comunes de los reportes, para devolver
// los mensajes exactos de la Épica 10.
export class PeakHoursQueryDto {
  @IsOptional()
  @IsString({ message: 'branchId debe ser texto' })
  branchId?: string;

  @IsOptional()
  @IsString({ message: 'from debe ser una fecha aaaa-mm-dd' })
  from?: string;

  @IsOptional()
  @IsString({ message: 'to debe ser una fecha aaaa-mm-dd' })
  to?: string;
}

// Parámetros del reporte de ventas totales (H27). branchId es opcional:
// sin valor incluye todas las sucursales.
export class SalesQueryDto {
  @IsOptional()
  @IsString({ message: 'branchId debe ser texto' })
  branchId?: string;

  @IsOptional()
  @IsString({ message: 'from debe ser una fecha aaaa-mm-dd' })
  from?: string;

  @IsOptional()
  @IsString({ message: 'to debe ser una fecha aaaa-mm-dd' })
  to?: string;
}

// Parámetros del reporte de platillos más vendidos (H28): mismos filtros
// que H27 (período y sucursal opcional).
export class TopDishesQueryDto extends SalesQueryDto {}

// Parámetros de la comparación de sucursales (H30): solo el período.
export class BranchComparisonQueryDto {
  @IsOptional()
  @IsString({ message: 'from debe ser una fecha aaaa-mm-dd' })
  from?: string;

  @IsOptional()
  @IsString({ message: 'to debe ser una fecha aaaa-mm-dd' })
  to?: string;
}
