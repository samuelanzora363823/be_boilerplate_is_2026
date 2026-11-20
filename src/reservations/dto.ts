import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  branchId!: string;

  @IsISO8601()
  dateTime!: string;

  @IsInt()
  @Min(1)
  peopleCount!: number;
}

export class UpdateReservationDto {
  @IsOptional()
  @IsISO8601()
  dateTime?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  peopleCount?: number;
}
