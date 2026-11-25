import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class ListBranchReviewsDto {
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un entero mayor o igual a 1.' })
  @Min(1, { message: 'page debe ser un entero mayor o igual a 1.' })
  page = 1;

  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero entre 1 y 50.' })
  @Min(1, { message: 'limit debe ser un entero entre 1 y 50.' })
  @Max(50, { message: 'limit no puede ser mayor que 50.' })
  limit = 10;
}
