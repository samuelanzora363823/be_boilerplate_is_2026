import { IsDateString, Matches } from 'class-validator';

export class OccupancyQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato YYYY-MM-DD',
  })
  @IsDateString(
    { strict: true },
    { message: 'La fecha debe ser una fecha válida con formato YYYY-MM-DD' },
  )
  date!: string;
}
