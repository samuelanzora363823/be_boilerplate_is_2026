import { IsDateString } from 'class-validator';

export class OccupancyQueryDto {
  @IsDateString(
    { strict: true },
    { message: 'La fecha debe tener el formato YYYY-MM-DD' },
  )
  date!: string;
}
