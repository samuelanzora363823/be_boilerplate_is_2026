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
