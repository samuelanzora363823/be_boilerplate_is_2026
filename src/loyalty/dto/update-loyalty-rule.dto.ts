import { IsString, Matches } from 'class-validator';

export class UpdateLoyaltyRuleDto {
  @IsString()
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'Los puntos por dólar deben ser mayores que cero y tener máximo 2 decimales.',
  })
  pointsPerDollar!: string;
}
