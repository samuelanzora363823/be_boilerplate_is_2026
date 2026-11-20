import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { LoyaltyDiscountType } from '@PrismaClient';

export class CreateLoyaltyBenefitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsInt()
  @Min(1)
  pointsRequired!: number;

  @IsEnum(LoyaltyDiscountType)
  discountType!: LoyaltyDiscountType;

  @IsString()
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'El descuento debe ser mayor que cero y tener máximo 2 decimales.',
  })
  discountValue!: string;
}
