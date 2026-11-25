import { IsNumber, IsPositive, Max } from 'class-validator';
import { MAX_DECIMAL_10_2 } from './create-loyalty-benefit.dto.js';

// H22: tasa de acumulación global (loyalty_rules.points_per_dollar).
export class UpdateLoyaltyRuleDto {
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    {
      message:
        'Los puntos por dólar deben ser un número con máximo 2 decimales.',
    },
  )
  @IsPositive({ message: 'Los puntos por dólar deben ser mayores que cero.' })
  @Max(MAX_DECIMAL_10_2, {
    message: 'Los puntos por dólar superan el máximo permitido.',
  })
  pointsPerDollar!: number;
}
