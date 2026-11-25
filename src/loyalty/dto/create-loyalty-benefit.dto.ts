import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LoyaltyDiscountType } from '@PrismaClient';

// H22: límites de la ficha y de las columnas de loyalty_benefits.
export const BENEFIT_NAME_MAX_LENGTH = 80;
export const MAX_POINTS_REQUIRED = 2_147_483_647; // INTEGER de PostgreSQL
export const MAX_DECIMAL_10_2 = 99_999_999.99; // DECIMAL(10, 2)

// H22: crea un beneficio. El tope de 100 para porcentajes depende de
// discountType y se valida en LoyaltyAdminService.
export class CreateLoyaltyBenefitDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'El nombre es obligatorio.' })
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(BENEFIT_NAME_MAX_LENGTH, {
    message: `El nombre debe tener entre 1 y ${BENEFIT_NAME_MAX_LENGTH} caracteres.`,
  })
  name!: string;

  @IsInt({ message: 'Los puntos requeridos deben ser un número entero.' })
  @Min(1, { message: 'Los puntos requeridos deben ser mayores que cero.' })
  @Max(MAX_POINTS_REQUIRED, {
    message: 'Los puntos requeridos superan el máximo permitido.',
  })
  pointsRequired!: number;

  @IsEnum(LoyaltyDiscountType, {
    message: 'El tipo de descuento debe ser PERCENTAGE o FIXED.',
  })
  discountType!: LoyaltyDiscountType;

  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'El descuento debe ser un número con máximo 2 decimales.' },
  )
  @IsPositive({ message: 'El descuento debe ser mayor que cero.' })
  @Max(MAX_DECIMAL_10_2, { message: 'El descuento supera el máximo permitido.' })
  discountValue!: number;
}
